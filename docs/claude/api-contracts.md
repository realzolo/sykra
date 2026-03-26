# API & Runtime Contracts

## Authentication & Access

- All API routes require login; a small set of Studio endpoints accept `X-Conductor-Token` for Conductor-to-Studio calls (pipeline executors)
- Auth uses the `session` HTTP-only cookie; email/password accounts are created pending and must verify email before login, while GitHub OAuth accounts are linked through `auth_identities`
- GitHub OAuth sign-in starts at `/auth/github`; signed-in users can pass `mode=link` to bind GitHub to their existing account from the global account page, and the callback should return them to `/account`
- User avatars are resolved automatically on the server with the order `Gravatar -> GitHub -> Google -> other linked provider profiles -> stored avatar fallback`, persisted into `auth_users.avatar_url`, and revalidated only through the cached `auth_users.avatar_checked_at` refresh window so session/account hot paths never probe remote services; there is no manual avatar upload flow
- Dashboard shell bootstrap data is fetched through `/api/dashboard/bootstrap`, which consolidates orgs, active org, and the signed-in user profile for sidebar chrome.
- Public pages accessible without login: `/`, `/login`, `/verify`, `/reset`, `/auth/*`, `/invite/*`, `/terms`, `/privacy`
- Dashboard routes must be accessed via `/o/:orgId/...` (middleware rewrites internally)

## Report & Analysis APIs

- `analysis_issues.status`: `open | fixed | ignored | false_positive | planned`
- `analysis_issues` is the canonical issue store; latest schema no longer keeps report-level `analysis_reports.issues`, and issue lists for detail/chat/export/stats must be read from `analysis_issues`.
- `/api/projects/[id]/trends` returns array directly (no `data` wrapper)
- Rules learning endpoints are admin-only (org-scoped)
- Report stream payload (`type: "status_update"`) includes `status`, `score`, `analysisProgress`, `analysisSections`, `tokenUsage`, `tokensUsed`, `errorMessage`, and `sequence`
- `GET /api/rules/templates` returns static template list; `POST /api/rules/templates/[id]/import` is admin-only
- Report compare page: `/o/:orgId/projects/:id/reports/compare?a=reportIdA&b=reportIdB`
- Commit compare diff: `GET /api/commits/compare?repo=...&project_id=...&base=...&head=...`
- Commit review markers: `GET/POST/DELETE /api/projects/:id/commits/review` for per-file/line reviewed state
- `GET /api/reports/[id]` enriches `issues` with canonical `analysis_issues.id` UUID (plus normalized issue fields from `analysis_issues`) so frontend issue actions (comments/chat) use stable per-issue identifiers without client-side fuzzy matching.
- `GET /api/stats` and `GET /api/projects/[id]/stats` compute total/critical/open issue counts from `analysis_issues` joined to completed reports.
- Project detail tabs support deep links via query params: `?tab=commits|codebase|stats|config`. Codebase supports `ref`, `path`, `line`, `commentId` for jump-to-location/thread.

## AI Chat APIs

- `POST /api/reports/[id]/chat` resolves AI config from project/org integrations (same precedence as analyze), streams assistant output via SSE (`meta` / `delta` / `done` / `error` events), and returns integration binding errors (`AI_INTEGRATION_MISSING` / `AI_INTEGRATION_REBIND_REQUIRED`) instead of relying on `ANTHROPIC_API_KEY`.
- Chat issue context is loaded from `analysis_issues` (scoped by `report_id`), and persisted conversation `issue_id` must reference an issue that belongs to the same report.
- `POST /api/reports/[id]/chat` accepts `issueId` as either canonical issue UUID or composite fallback key (`file::line::category::rule::message`) for report rows that lack persisted issue UUIDs; composite keys are used for focus-context matching only.
- `GET /api/reports/[id]/chat?issueId=<issue-uuid>` returns the latest conversation for that issue (used to restore chat history when reopening the same issue dialog).
- `GET /api/reports/[id]/chat?latest=1` returns only the latest conversation for the report (used by AI chat initialization to avoid loading full history).
- Chat history query responses include `updated_at` for ordering conversation history in the AI reviewer dialog.
- Studio AI runtime implementation is SDK-free and uses a single HTTP adapter strategy across providers (including Anthropic Messages API).

## AI Integration Routing

- AI integration runtime routing: official OpenAI + reasoning-capable model (or explicit `reasoningEffort`) calls `/responses`; otherwise calls `/chat/completions` (Anthropic base URL uses Messages API)
- AI integration protocol selection requires explicit `apiStyle`: `anthropic` forces Messages API; `openai` forces OpenAI-compatible APIs.
- Conductor analysis error normalization: token-limit truncation and empty upstream body are surfaced as actionable messages instead of raw JSON parse errors.
- Conductor AI client performs one automatic token-budget retry on output truncation (`max_tokens` / `max_output_tokens`) before failing.

## Pipeline APIs

- `PATCH /api/pipelines/[id]` updates `concurrency_mode` in Studio DB (schema must include `pipelines.concurrency_mode`; present in `init.sql`)
- `GET /api/pipelines/[id]` returns the current pipeline snapshot plus a `versions` array so Studio can render version history and config diffs without ad-hoc DB fan-out.
- `DELETE /api/pipelines/[id]` deletes a pipeline across Conductor + Studio-backed state, but returns conflict when the pipeline still has `queued` / `running` / `waiting_manual` runs
- `POST /api/pipelines/[id]/runs` enforces concurrency gate before calling Conductor (409 if `queue` mode and run active)
- Studio server calls Conductor `POST /v1/pipeline-runs/{runId}/cancel` and expects `{ ok: true }` (used by `cancel_previous` concurrency mode)
- DB status constraints for `pipeline_runs` / `pipeline_jobs` / `pipeline_steps` include `waiting_manual` as a first-class runtime state.
- `GET /api/pipeline-runs/:runId/artifacts` returns release provenance fields (`source_run_id`, `source_pipeline_id`, `source_commit_sha`, `source_branch`, `published_by`, `published_at`, `channel_names`), and Studio hydrates publisher display names before rendering the run detail release cards.

## AI Analysis Flow

1. `POST /api/analyze` (auth required) applies admission control before report creation:
   - request dedupe by semantic fingerprint (`org + project + commits + rules + mode`) backed by PostgreSQL advisory locking and a short reuse window for recent identical reports
   - fixed-window rate limits stored in PostgreSQL (`org+user+project`, `org`, auxiliary IP hash)
   - queue backpressure guard based on active `analysis_reports` (`pending`/`running`) counts
2. Studio performs integration preflight (AI integration must decrypt/resolve successfully) before creating the report.
3. On accepted request, Studio creates `analysis_reports` with an immutable `analysis_snapshot`; the Conductor later claims `pending` reports directly from PostgreSQL.
4. API returns `{ reportId, status: "queued" | "running" | "done" | "partial_failed", deduplicated }` depending on whether the request created a new report or reused an existing one.
4.1 `POST /api/analyze-cached` reuses recent identical analyses (`project + commits`) from persisted `analysis_reports` only; no process-local memory cache is used for cross-request reuse decisions.
5. Reports support manual termination via `POST /api/reports/[id]/terminate` (Studio marks the report `canceled`; Conductor watches the database state and aborts in-flight analysis).
6. Studio also auto-fails timed-out reports (`pending`/`running`) based on `ANALYZE_REPORT_TIMEOUT_MS`.
7. Conductor canonical report status model is `pending -> running -> done | partial_failed | failed | canceled`.
8. Conductor executes phased analysis:
   - `core` (score/category/issues/summary/context)
   - `quality` (complexity/duplication/dependency metrics)
   - `security_performance` (security + performance findings)
   - `suggestions` (refactor suggestions + code explanations)
   Non-core phases run in parallel after core completes.
9. Each phase is persisted in `analysis_report_sections` (`report_id + phase + attempt`), including payload, duration, token usage, and failure reason.
10. Conductor stores canonical issue rows in `analysis_issues`; completed-report issue statistics are aggregated from `analysis_issues`.
10.1 Incremental analysis snapshot payloads should embed previous report issue context from `analysis_issues` (not report-level issue JSON columns).
11. Conductor increments `analysis_reports.sse_seq` on progress/section/status updates; SSE uses sequence + snapshot diff to stream ordered updates.
12. Frontend subscribes to `/api/reports/[id]/stream` and receives `status_update` with `status`, `score`, `analysisProgress`, `analysisSections`, `tokenUsage`, `tokensUsed`, `errorMessage`, `sequence`.
13. Studio SSE backend is event-driven via Postgres `LISTEN/NOTIFY` channel `analysis_report_updates` (with periodic timeout sweep checks), not fixed-interval polling.
14. Analysis SSE responses are same-origin authenticated streams; do not expose wildcard CORS headers on authenticated stream endpoints.

## Codebase Cache (Backend)

`CodebaseService` manages per-project local Git mirrors and per-job workspaces for AI analysis tasks.
Mirrors are cache-only (not a source of truth) and are synced on demand or on a schedule; analysis workspaces are isolated and must be cleaned after each job.
Pipeline CI source snapshots use a separate Conductor-local mirror cache under `apps/conductor/data/git/` because Conductor, not Studio, owns pipeline execution.
Codebase browsing uses the same mirror cache and enforces a max preview size for files.

### Code Comments (Thread Model)

- `codebase_comment_threads` stores thread-level anchor + lifecycle (`open` / `resolved`) at file/line scope.
- `codebase_comments` stores individual messages (replies) under `thread_id`.
- `codebase_comment_assignees` stores optional assignees per message.

Thread anchoring and projection model:
- `codebase_thread_anchors` stores immutable anchor snapshots (`anchor_commit_sha`, `anchor_path`, anchor line range, selection/context, optional blob SHA).
- `codebase_thread_projections` stores computed per-target-commit projections (`projected_path`, projected line range, status/confidence/reason).
- `codebase_thread_projection_jobs` stores batch projection compute status (`running|completed|failed`) per project+target commit.
- Projection statuses are canonical: `exact | shifted | ambiguous | outdated | missing`.
- Only `exact` / `shifted` projections are rendered inline in code view; non-inline statuses are preserved in projection records to prevent false location claims.

### Codebase Comments API Contract

- `GET /api/projects/:id/codebase/comments` returns flattened comments enriched with thread metadata (`thread_id`, `thread_status`, `thread_line`, `thread_line_end`, `resolved_by`, `resolved_at`).
- `POST /api/projects/:id/codebase/comments` accepts either:
  - a new thread payload (`ref`, `commit`, `path`, `line`, optional `line_end`, `selection_text`) + `body`, or
  - a reply payload (`thread_id`) + `body`.
- `PATCH /api/projects/:id/codebase/comments` updates thread status (`open` / `resolved`).

### Mirror Sync Triggers

- Codebase tree/file endpoints accept `sync=0` to skip mirror fetch for faster browsing (manual sync still available).
- GitHub `push` webhooks (forces mirror fetch for matching projects).
- Scheduled POST to `/api/codebase/sync` (uses `x-task-token` if `TASK_CONDUCTOR_TOKEN` is set). Supports `limit`, `force`, `project_id`, and `org_id`.
- Project creation triggers an initial mirror sync in the background.
- Stale workspaces can be cleared via `POST /api/codebase/cleanup` (uses `x-task-token` if `TASK_CONDUCTOR_TOKEN` is set).

Tool caches are centralized under repo root `/.cache/` (for example `/.cache/go/mod`, `/.cache/go/build`, `/.cache/pnpm/store`, `/.cache/codebase`) and are not committed to Git.
`CodebaseService` default root is `/.cache/codebase` (override via `CODEBASE_ROOT` when needed).

## DB Migrations

Incremental migrations live in `docs/db/migrations/` and are used to upgrade existing databases.
`docs/db/init.sql` already contains the latest full schema for fresh databases.

```bash
psql "$DATABASE_URL" -f docs/db/migrations/004_api_tokens.sql
psql "$DATABASE_URL" -f docs/db/migrations/add_concurrency_mode.sql
psql "$DATABASE_URL" -f docs/db/migrations/005_analysis_progress_and_token_usage.sql
psql "$DATABASE_URL" -f docs/db/migrations/006_commit_review_items.sql
psql "$DATABASE_URL" -f docs/db/migrations/007_codebase_comment_threads.sql
psql "$DATABASE_URL" -f docs/db/migrations/008_codebase_thread_projections.sql
psql "$DATABASE_URL" -f docs/db/migrations/009_phased_analysis_sections.sql
psql "$DATABASE_URL" -f docs/db/migrations/010_analysis_rate_buckets.sql
psql "$DATABASE_URL" -f docs/db/migrations/018_drop_analysis_tasks.sql
psql "$DATABASE_URL" -f docs/db/migrations/019_studio_callback_outbox.sql
psql "$DATABASE_URL" -f docs/db/migrations/020_avatar_cache.sql
psql "$DATABASE_URL" -f docs/db/migrations/021_issue_sot_and_pipeline_manual_status.sql
```

| File | Description |
|------|-------------|
| `004_api_tokens.sql` | Adds `api_tokens` table and related indexes |
| `add_concurrency_mode.sql` | Adds `concurrency_mode TEXT NOT NULL DEFAULT 'allow'` to `pipelines` table |
| `005_analysis_progress_and_token_usage.sql` | Adds `analysis_progress JSONB` and `token_usage JSONB` to `analysis_reports` |
| `006_commit_review_items.sql` | Adds commit review markers for per-file/line review state |
| `007_codebase_comment_threads.sql` | Adds thread model (`codebase_comment_threads`) and links `codebase_comments.thread_id` |
| `008_codebase_thread_projections.sql` | Adds immutable thread anchors and per-commit projection cache/status tables |
| `009_phased_analysis_sections.sql` | Adds phased analysis sections, `analysis_snapshot`, `sse_seq`, and canonical report running status constraint |
| `010_analysis_rate_buckets.sql` | Adds fixed-window analysis rate limit buckets backed by PostgreSQL |
| `018_drop_analysis_tasks.sql` | Removes the obsolete analysis task queue table |
| `019_studio_callback_outbox.sql` | Adds durable Conductor→Studio callback outbox storage |
| `020_avatar_cache.sql` | Adds `auth_users.avatar_checked_at` for cached avatar revalidation |
| `021_issue_sot_and_pipeline_manual_status.sql` | Makes `analysis_issues` the canonical issue source for snapshots, drops report-level issue JSON columns, and aligns pipeline run/job/step status constraints with `waiting_manual` |
