# spec-axis — Project Guide

## General Rules

- **Documentation language**: All documentation files must be written in English.

## Internationalization (i18n)

2 languages, English default: `en` | `zh`

**Server component:**
```tsx
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
const locale = await getLocale();
const dict = await getDictionary(locale);
```

**Client component:** Pass `dict` as prop from server page, type as `Dictionary` from `@/i18n`.
If a client-only page cannot receive `dict` from a server parent, use `useClientDictionary()` from `src/i18n/client.ts` instead of duplicating cookie parsing.

**Rules:**
- Both dictionary files (`src/i18n/dictionaries/en.json` and `src/i18n/dictionaries/zh.json`) must have **identical key structure** — TypeScript infers types from `en.json`
- When adding keys, update BOTH files simultaneously or the build fails
- Run `rm -rf .next` if TypeScript type cache is stale after dict changes
- `LanguageSwitcher` in Sidebar footer persists locale in cookies
- User-facing copy in dashboard/product UI must come from dictionary keys. Do not hardcode English/Chinese strings directly in feature components.
- Prefer shared client i18n helper (`src/i18n/client.ts`) for locale + dictionary access; do not implement ad-hoc `document.cookie` locale readers in feature components.

## Project Overview

AI code review + CI/CD platform: Next.js 16 + React 19 + TypeScript + Tailwind CSS v4.
Multi-GitHub project management, commit selection, Claude AI analysis, configurable rule sets, quality report scoring, and pipeline DAG builder.
Backend: PostgreSQL for core data, Go runner executes analysis jobs and pipeline runs via Redis queue; status updates stream via SSE with polling fallback.
Monorepo layout: `apps/studio` (Next.js), `apps/runner` (Go runner), `packages/*` (shared contracts).
Unless stated otherwise, paths in this guide are relative to `apps/studio`.

**Key platform features:**
- AI code review with configurable rule sets, quality gate scoring, and issue tracking
- Rule set template marketplace: 5 built-in templates (React, Go, Security/OWASP, Python, Performance) importable via `GET /api/rules/templates` + `POST /api/rules/templates/[id]/import`
- Report comparison view: diff two reports side-by-side (new / resolved / persisting issues) at `/o/:orgId/projects/:id/reports/compare?a=...&b=...`
- Pipeline concurrency control: `allow | queue | cancel_previous` modes stored in `pipelines.concurrency_mode` column (included in `docs/db/init.sql`; use migration for existing DBs)
- Notification settings UI at `/o/:orgId/settings/notifications` backed by `/api/notification-settings`
- Dashboard org home page (`/o/:orgId`) shows 4 stat cards (projects, avg score, open issues, pipeline success rate), quick actions, per-project score list, and recent activity

## Organization Model & Routing

Multi-tenant org system (Vercel-like UI). Each user has a **personal org** on signup.

**Org-scoped assets:** projects, reports, pipelines, rule sets, rules, integrations, rule learning stats.

**Roles:** `owner | admin | reviewer | member`
- `owner/admin`: manage org assets (create/update/delete projects, rules, integrations, config)
- `reviewer/member`: read-only (view projects/reports/rules)

**Active org:**
- Stored in `org_id` cookie
- Resolved via `/api/orgs/active` (GET/POST)
- Auth callback + invite accept also set the cookie

**URL routing:**
- Dashboard URLs must include org prefix: `/o/:orgId/...`
- `/o/:orgId/...` routes are real wrappers that mirror the dashboard pages
- Org home page: `/o/:orgId` renders the dashboard overview (no longer auto-redirects to projects)
- `middleware.ts` keeps the `org_id` cookie in sync when an `/o/:orgId/...` path is requested
- If a user hits `/projects` (or other dashboard path) and has `org_id`, middleware redirects to `/o/:orgId/...`

**Frontend helpers:**
- `src/lib/orgPath.ts` → `withOrgPrefix`, `stripOrgPrefix`, `replaceOrgInPath`, `extractOrgFromPath`
- `src/lib/useOrgRole.ts` → `isAdmin` gating for UI actions

## Tech Stack

| Tech | Version | Notes |
|------|---------|-------|
| Next.js | 16.1.6 | App Router, Turbopack |
| React | 19.2.3 | — |
| Tailwind CSS | v4.2.1 | Design tokens live in `apps/studio/src/app/globals.css` |
| Geist Font | 1.7.x | Geist Sans/Mono via `geist` package |
| Radix UI Primitives | ^2.1.4 | `@radix-ui/react-primitive` (Radix Select/Popper dependency) |
| CodeMirror | 6.x | Read-only codebase editor preview |
| React Flow (XYFlow) | ^12.7 | Pipeline DAG builder |
| PostgreSQL | 14+ | Primary database (self-managed) |
| Octokit | `^5.0.5` | GitHub API |
| Anthropic SDK | `^0.78` | Claude AI, supports `ANTHROPIC_BASE_URL` |
| Go | 1.24.0 | Runner service |
| TOML | 1.6.0 | `github.com/BurntSushi/toml` for runner config |
| Asynq | 0.26.0 | Redis-backed job queue (runner) |
| sonner | ^2 | Toast notifications |
| zod | `^4.3.6` | Runtime validation |
| lucide-react | ^0.577 | Icons |

## Engineering Constraints

- **No compatibility design/code paths**: Do not add dual-field parsing (`foo ?? Foo`), legacy aliases, or fallback branches for stale response shapes.
- **No compatibility naming**: Do not introduce `legacy*`, `compat*`, `polyfill*`, or similar identifiers.
- **Single contract source**: Runner HTTP contracts are defined in `packages/contracts/src/runner.ts` and consumed by Studio.
- **Type safety baseline**: `apps/studio/tsconfig.json` enforces strict type checks (`allowJs: false`, `skipLibCheck: false`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`).
- **Schema requirement**: latest schema (`docs/db/init.sql`) and any required upgrade migrations must be applied before runtime. Missing required columns (for example `pipelines.concurrency_mode`) are treated as errors, not tolerated with fallback logic.
- **Canonical provider IDs only**: Use a single provider identifier per integration type (current AI provider key is `openai-api`). Do not add alias keys.
- **Fail-fast on unsupported providers**: Provider switch statements must throw on unknown values; no silent fallback client selection.

## Naming & Design Rules

- Prefer domain names over technical workaround names (`pipelineRun`, `rulesetSnapshot`, `integrationConfig`).
- Use final-state naming only. Do not use transitional prefixes/suffixes like `Enhanced*`, `New*`, `Old*`, `V2*`, `Temp*`, or `*Legacy`.
- Optional fields must be modeled as truly optional fields; never assign `undefined` to an explicitly present property under `exactOptionalPropertyTypes`.
- External API payload parsing must be schema-first (`zod` contract parse before business logic).
- Do not add transitional adapter layers for old payloads or old naming; update all callers to the canonical contract in one change set.

## Quality Gates

- Studio CI baseline must be green on every change set:
  - `pnpm -C apps/studio lint` returns 0 errors and 0 warnings.
  - `pnpm -C apps/studio build` succeeds.
- Runner backend baseline must compile:
  - `cd apps/runner && GOMODCACHE=../../.cache/go/mod GOCACHE=../../.cache/go/build go build ./...`

## UI Components

This project does **not** use HeroUI. UI is built from:
- Local reusable components under `apps/studio/src/components/ui/*`
- Radix primitives where needed
- Tailwind CSS tokens defined in `apps/studio/src/app/globals.css`

Rules:
- Prefer `components/ui/*` wrappers over direct Radix usage to keep styling and behavior consistent.
- Do not introduce compatibility props or dual APIs (for example `foo` vs `Foo`, `onPress` vs `onClick`). Pick one naming and enforce it.
- Do not add framework-specific naming that implies legacy support (for example `legacy*`, `compat*`, `polyfill*`).
- Interactive containers (cards/rows/panels) must be keyboard accessible (`role`, `tabIndex`, `Enter/Space` handling) when not using native interactive elements.
- Primary async route segments should provide `loading.tsx` boundaries; avoid pure text placeholders as the only loading state.
- Destructive actions in product UI must use in-app confirmation dialogs (`components/ui/confirm-dialog.tsx`), not native `window.confirm`.
- In client UI, use shared date format helpers from `src/lib/dateFormat.ts` instead of direct `toLocaleString`/`toLocaleDateString` calls in feature components.

## UI Design Guidelines

Geist-aligned neutral theme: layered surfaces, thin borders, restrained shadows, and clear typographic hierarchy.
Project UI spec: `docs/memories/ui-spec-geist.md` (source of truth).

**Typography:** Use utility classes from `src/app/globals.css`:
`text-heading-*`, `text-label-*`, `text-copy-*`, `text-button-*`.
Avoid custom font sizes unless a new token is added.

**Color tokens:** `bg-background` | `bg-card` | `bg-muted` | `bg-muted/30` (hover) | `border-border` | `text-foreground` | `text-muted-foreground` | `text-primary` | `text-success` | `text-warning` | `text-danger` | `text-accent`

**List page structure:**
```tsx
<div className="flex flex-col h-full">
  <div className="px-6 py-4 border-b border-border bg-background shrink-0">...</div> {/* header */}
  <div className="px-6 py-3 border-b border-border bg-background shrink-0">...</div> {/* toolbar */}
  <div className="flex-1 overflow-auto">
    <div className="flex items-center px-4 py-2 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground gap-4">...</div>
    {/* rows: border-b border-border hover:bg-muted/30 */}
  </div>
</div>
```

**Empty state:** `<div className="flex flex-col items-start gap-3 px-6 py-20">` with icon (bg-muted rounded-lg) + title + description + Button.

## Next.js 16 Special Configuration

- **Middleware**: file is `apps/studio/middleware.ts` (Next.js middleware). It handles `/o/:orgId` rewrites and org redirects.
- `apps/studio/src/proxy.ts` is currently unused.
- **Dynamic pages**: any dashboard page that depends on auth/session or database reads must use `export const dynamic = 'force-dynamic'`
- **Dynamic route params**: in pages and route handlers, `params` is async — `const { id } = await params` (avoid sync dynamic APIs errors)
- **Vercel timeout**: analyze route configured for 300s in `vercel.json`

## Directory Structure

```
apps/
  studio/
    src/
      app/
        (auth)/login/           # Login (no Sidebar)
        (auth)/verify/          # Email verification
        (auth)/reset/           # Password reset
        (auth)/invite/[token]/  # Invite accept
        auth/callback/          # OAuth callback
        (dashboard)/            # Protected pages + Sidebar
          layout.tsx
          rules/                # RulesClient (rule sets + template marketplace)
            [id]/               # RuleSetDetailClient
          settings/integrations/
          settings/security/
          settings/notifications/ # Notification settings UI
        o/[orgId]/              # Org-prefixed wrappers (all dashboard routes live here)
          page.tsx              # Org home: stats, quick actions, project scores, activity
          projects/
            page.tsx            # ProjectsClient
            [id]/
              layout.tsx        # Fetches project, wraps in ProjectDataProvider
              commits/          # CommitsClient
              reports/
                page.tsx        # ProjectReportsView (with multi-select + compare)
                [rid]/          # ReportDetailClient
                compare/        # ReportCompareClient (?a=reportId&b=reportId)
              pipelines/
                page.tsx        # ProjectPipelinesView
                [pid]/          # PipelineDetailClient (builder + runs + concurrency mode)
              codebase/         # CodebaseClient
              settings/         # ProjectConfigPanel
          rules/                # Org-level rule sets
          settings/notifications/
        api/
          analyze/              # POST → enqueue runner task
          pipelines/[id]/       # GET/PUT/PATCH (PATCH updates concurrency_mode)
          pipelines/[id]/runs/  # GET list + POST (enforces concurrency gate)
          pipeline-runs/        # Run detail + logs (proxy to runner)
          reports/[id]/         # Report CRUD + issues + stream + chat + export
          rules/
            templates/          # GET list of built-in templates
            templates/[id]/import/ # POST import template → new ruleset
          notification-settings/ # GET/PUT notification preferences
          runner/events/        # POST (Runner → Studio callbacks)
          commits/ projects/ stats/ github/ stream/ webhooks/
        layout.tsx providers.tsx globals.css
      components/
        layout/Sidebar.tsx, Topbar.tsx
        project/ProjectCard, ProjectCommitsView, ProjectReportsView, ProjectPipelinesView
                ProjectCodebaseView, ProjectSettingsView
        report/IssueCard, AIChat, TrendChart, ExportButton, ReportCompareClient
        pipeline/PipelineDetailClient  # Builder, runs, concurrency mode, docker step editor
        dashboard/DashboardStats.tsx
        common/LanguageSwitcher.tsx
      i18n/
        index.ts                # getDictionary(), Dictionary type (inferred from en.json)
        dictionaries/           # en.json zh.json
      lib/
        locale.ts               # getLocale() — reads NEXT_LOCALE cookie
        orgPath.ts              # /o/:orgId path helpers
        useOrgRole.ts           # client hook for org role + admin gating
        projectContext.tsx      # ProjectDataProvider + useProject() hook
        ruleTemplates.ts        # Static built-in rule template data
      services/
        db.ts github.ts claude.ts taskQueue.ts analyzeTask.ts
        pipelineTypes.ts        # PipelineStep (type/dockerImage), PipelineSummary (concurrency_mode)
        runnerClient.ts         # cancelPipelineRun() + other runner proxy functions
      proxy.ts                  # Unused auth middleware
    middleware.ts               # Org cookie sync + dashboard redirect (Next.js middleware)
  runner/
    cmd/runner/                 # Go runner entrypoint
    internal/pipeline/
      executor.go               # ShellExecutor, DockerExecutor, SourceCheckoutExecutor, ReviewGateExecutor
      engine.go                 # runStep() routes to DockerExecutor when step.Type == "docker"
      types.go                  # PipelineStep: Type, DockerImage fields
      storage.go, api.go, graph.go, service.go
docs/
  db/
    init.sql                    # Full schema initialization
    migrations/
      004_api_tokens.sql        # Adds api_tokens table for existing DB upgrades
      add_concurrency_mode.sql  # Adds pipelines.concurrency_mode for existing DB upgrades
packages/
  contracts/                    # Shared API/contracts (active)
```

## Environment Variables

```
DATABASE_URL=               # Studio Postgres connection string
ENCRYPTION_KEY=             # AES-256-GCM key for secrets
EMAIL_VERIFICATION_REQUIRED= # Require email verification before login (true|false)
RUNNER_BASE_URL=            # Runner base URL (e.g. http://localhost:8200)
RUNNER_TOKEN=               # Shared token for runner auth
TASK_RUNNER_TOKEN=          # Optional, protects internal task endpoints (e.g. /api/codebase/sync)
EMAIL_PROVIDER=             # Email provider for notifications: console|resend
EMAIL_FROM=                 # From address (required for resend)
RESEND_API_KEY=             # Resend API key (required when EMAIL_PROVIDER=resend)
STUDIO_BASE_URL=            # Public base URL for links included in emails (optional)
REDIS_URL=                  # Redis URL used by BullMQ and analyze admission control (recommended in production)
ANALYZE_RATE_LIMIT_WINDOW_MS=          # Analyze rate-limit window in ms (default 60000)
ANALYZE_RATE_LIMIT_USER_PROJECT_MAX=   # Max analyze requests/window per org+user+project (default 6)
ANALYZE_RATE_LIMIT_ORG_MAX=            # Max analyze requests/window per org (default 60)
ANALYZE_RATE_LIMIT_IP_MAX=             # Auxiliary max analyze requests/window per IP hash (default 120)
ANALYZE_DEDUPE_TTL_SEC=                # Identical analyze request result reuse TTL in seconds (default 180)
ANALYZE_DEDUPE_LOCK_TTL_SEC=           # In-flight dedupe lock TTL in seconds (default 15)
ANALYZE_BACKPRESSURE_PROJECT_ACTIVE_MAX= # Max active (pending/analyzing) reports per project before 503 (default 6)
ANALYZE_BACKPRESSURE_ORG_ACTIVE_MAX=     # Max active (pending/analyzing) reports per org before 503 (default 60)
ANALYZE_BACKPRESSURE_RETRY_AFTER_SEC=    # Retry-After hint for backpressure rejections (default 15)
```

**Runner env (apps/runner):**
```
RUNNER_PORT=8200
RUNNER_TOKEN=
DATABASE_URL=               # Postgres connection string
REDIS_URL=                  # Redis queue
ENCRYPTION_KEY=             # Same key used by studio for decrypting secrets
STUDIO_URL=                 # Studio base URL (Runner -> Studio), used by pipeline executors
STUDIO_TOKEN=               # Token presented to Studio as X-Runner-Token (defaults to RUNNER_TOKEN; dev falls back to "dev-runner")
PIPELINE_QUEUE=             # Pipeline queue name
PIPELINE_CONCURRENCY=       # Max concurrent pipeline jobs
PIPELINE_RUN_TIMEOUT=       # Overall run timeout (e.g. 2h)
RUNNER_DATA_DIR=            # Local logs/artifacts root
PIPELINE_LOG_RETENTION_DAYS=
PIPELINE_ARTIFACT_RETENTION_DAYS=
```
**Runner config file (TOML, optional):**
- Auto-detected: `apps/runner/config.toml` (repo root) or `config.toml` in current working directory
- Override path via `RUNNER_CONFIG` or `-config`
- Precedence: env vars > TOML > defaults

Example config (tables, no redundant prefixes):
```
[runner]
port = "8200"
token = ""
concurrency = 4
queue = "analysis"
analyze_timeout = "300s"
data_dir = "data"

[database]
url = ""

[redis]
url = ""

[pipeline]
queue = "pipelines"
concurrency = 4
run_timeout = "2h"
log_retention_days = 30
artifact_retention_days = 30

[security]
encryption_key = ""

[studio]
url = ""
token = ""
```

Environment files for Studio live under `apps/studio` (e.g. `apps/studio/.env`).

**VCS and AI integrations** are configured via web UI at **Settings > Integrations** — NOT via env vars.
- VCS: GitHub, GitLab, Generic Git
- AI: Any OpenAI API-format provider (Claude, GPT-4, DeepSeek, etc.)
- AI config supports `model` (manual model ID allowed), optional `maxTokens`, `temperature`, and optional `reasoningEffort` (`none|minimal|low|medium|high|xhigh`)
- Add/Edit AI Integration modals provide quick `maxTokens` profiles for common workloads (quick review, deep review, log analysis, auto-fix) while still allowing manual override
- For official OpenAI endpoint (`https://api.openai.com/v1`), reasoning-capable models (for example `gpt-5*`, `o*`, `codex*`) use `/responses`; other providers remain on `/chat/completions`
- Non-sensitive config → `org_integrations` table; secrets → encrypted in `vault_secret_name`
- Secret encryption format is strict AES-256-GCM with 12-byte nonce and 16-byte tag: `iv:authTag:salt:ciphertext`
- Studio and Runner both enforce this format for integration secrets; if old secrets were produced with non-standard nonce/tag size, re-save/recreate those integrations to rotate ciphertext
- Priority: project-specific > org default (no env var fallback)

## Common Commands

```bash
pnpm dev     # Console dev server (port 8109)
pnpm build   # Console production build (TypeScript check)
pnpm start   # Console production server
pnpm lint    # Console ESLint
pnpm codebase:cleanup   # Cleanup stale workspaces (uses TASK_RUNNER_TOKEN; optional STUDIO_BASE_URL)
psql "$DATABASE_URL" -f docs/db/init.sql   # Initialize schema (fresh DB)
cd apps/runner && go run ./cmd/runner   # Runner service (reads config.toml if present)
```

`pnpm codebase:cleanup` uses `TASK_RUNNER_TOKEN` and optional `STUDIO_BASE_URL` (default `http://localhost:8109`).

## Dependency Build Scripts

pnpm is configured to only allow approved dependency build scripts.
The allowlist lives in `.npmrc` under `only-built-dependencies[]` (currently includes `msgpackr-extract`).
If new install warnings appear, approve the dependency and update the allowlist.

## AI Analysis Flow

1. `POST /api/analyze` (auth required) applies admission control before enqueue:
   - request dedupe by semantic fingerprint (`org + project + commits + rules + mode`) with short Redis TTL
   - distributed rate limits (`org+user+project`, `org`, auxiliary IP hash)
   - queue backpressure guard based on active `analysis_reports` (`pending`/`analyzing`) counts
2. On accepted request, Studio creates `analysis_reports` row and enqueues runner task
3. API returns `{ reportId, status: "queued", taskId }` (or deduped existing report/task when applicable)
4. Runner: fetch diff by commit SHA → AI analysis → sync `analysis_issues` → update status
5. Frontend: SSE on `/api/reports/[id]/stream`, fallback to polling every 2.5s

## Pipeline Engine (CI/CD)

- **Studio** ships a drag-and-drop DAG builder under `/pipelines` with stage/job/step configuration.
- **Pipelines** always belong to a project (`project_id` is required, never null).
- **Pipeline config** is versioned in `pipeline_versions` and linked from `pipelines.current_version_id`.
- **Pipeline secrets** are stored in `pipeline_secrets` encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`) and injected into every step as environment variables (write-only in UI).
- **Execution model**: jobs form a DAG via `needs`; steps run sequentially inside a job.
- **Step types**: `shell` (default) runs via `/bin/sh -c`; `docker` runs `docker run --rm -w /workspace -v {workingDir}:/workspace {envFlags} {image} /bin/sh -c "{script}"`. Set `type: "docker"` and `dockerImage` on a step to use Docker.
- **Concurrency modes**: each pipeline has a `concurrency_mode` column (`allow` / `queue` / `cancel_previous`). Studio API enforces this before creating a new run. Included in `docs/db/init.sql`; existing DBs should apply `docs/db/migrations/add_concurrency_mode.sql`.
- **Events** are appended to `pipeline_run_events` for UI polling and audit.
- **Logs** and **artifacts** are stored locally under `RUNNER_DATA_DIR`:
  - `logs/{run_id}/{job_key}/{step_key}.log`
  - `artifacts/{run_id}/{job_key}/{step_key}/...`
- **Runner → Studio callbacks (pipelines)**:
  - `source_checkout` fetches repo info from `GET /api/projects/:id`
  - `review_gate` fetches latest completed report score from `GET /api/reports?projectId=...&limit=1`
  - Runner emits completion events to Studio at `POST /api/runner/events` (authorized via `X-Runner-Token`) so Studio can send notifications
  - Runner must be configured with `STUDIO_URL` and a token (`STUDIO_TOKEN`, defaults to `RUNNER_TOKEN`) and Studio must accept `X-Runner-Token` (shared secret)

**GitHub webhook:** `/api/webhooks/github` supports `?project_id=...`. If a repo matches multiple projects, the endpoint returns 409 and requires `project_id`.

## Codebase Cache (Backend)

`CodebaseService` manages per-project local Git mirrors and per-job workspaces for AI analysis and pipeline tasks.
Mirrors are cache-only (not a source of truth) and are synced on demand or on a schedule; workspaces are isolated and must be cleaned after each job.
Codebase browsing uses the same mirror cache and enforces a max preview size for files.
Line-level comments for code browsing are stored in `codebase_comments` and scoped by org, project, repo, commit SHA, and path (with `ref` retained for display). Optional line ranges (`line_end`) and selection text (`selection_text`) capture multi-line or partial-text comments.
Comment assignees are stored in `codebase_comment_assignees` and attached to codebase comments.
Codebase tree/file endpoints accept `sync=0` to skip mirror fetch for faster browsing (manual sync still available).
Automatic mirror sync can be triggered by:
- GitHub `push` webhooks (forces mirror fetch for matching projects).
- Scheduled POST to `/api/codebase/sync` (uses `x-task-token` if `TASK_RUNNER_TOKEN` is set). Supports `limit`, `force`, `project_id`, and `org_id`.
- Project creation triggers an initial mirror sync in the background.
Stale workspaces can be cleared via `POST /api/codebase/cleanup` (uses `x-task-token` if `TASK_RUNNER_TOKEN` is set).

Tool caches are centralized under repo root `/.cache/` (for example `/.cache/go/mod`, `/.cache/go/build`, `/.cache/pnpm/store`, `/.cache/codebase`) and are not committed to Git.
`CodebaseService` default root is `/.cache/codebase` (override via `CODEBASE_ROOT` when needed).
Note: env vars like `CODEBASE_ROOT` / `CODEBASE_MIRRORS_DIR` / `CODEBASE_WORKSPACES_DIR` treat empty values (e.g. `FOO=` in `.env`) as "unset" and fall back to defaults.

```
CODEBASE_ROOT=
CODEBASE_MIRRORS_DIR=
CODEBASE_WORKSPACES_DIR=
CODEBASE_SYNC_INTERVAL_MS=
CODEBASE_LOCK_TIMEOUT_MS=
CODEBASE_LOCK_STALE_MS=
CODEBASE_WORKSPACE_TTL_MS=
CODEBASE_FILE_MAX_BYTES=
CODEBASE_GIT_BIN=
CODEBASE_GIT_TIMEOUT_MS=
```

## Toast Usage

```ts
import { toast } from 'sonner';
toast.success('...'); toast.error('...'); toast.warning('...');
```
`Toaster` mounted in `apps/studio/src/app/providers.tsx`.

## Runtime Contracts

- All API routes require login; a small set of Studio endpoints accept `X-Runner-Token` for Runner-to-Studio calls (pipeline executors)
- Auth uses the `session` HTTP-only cookie; email verification is controlled by `EMAIL_VERIFICATION_REQUIRED` (default true)
- `analysis_issues.status`: `open | fixed | ignored | false_positive | planned`
- `/api/projects/[id]/trends` returns array directly (no `data` wrapper)
- Rules learning endpoints are admin-only (org-scoped)
- Public pages accessible without login: `/`, `/login`, `/verify`, `/reset`, `/auth/*`, `/invite/*`, `/terms`, `/privacy`
- Dashboard routes must be accessed via `/o/:orgId/...` (middleware rewrites internally)
- Project detail tabs support deep links via query params: `?tab=commits|codebase|stats|config`. Codebase supports `ref`, `path`, `line` for jump-to-location.
- `PATCH /api/pipelines/[id]` updates `concurrency_mode` in Studio DB (schema must include `pipelines.concurrency_mode`; present in `init.sql`)
- `POST /api/pipelines/[id]/runs` enforces concurrency gate before calling runner (409 if `queue` mode and run active)
- Studio server calls Runner `POST /v1/pipeline-runs/{runId}/cancel` and expects `{ ok: true }` (used by `cancel_previous` concurrency mode)
- AI integration runtime routing: official OpenAI + reasoning-capable model (or explicit `reasoningEffort`) calls `/responses`; otherwise calls `/chat/completions` (Anthropic base URL uses Messages API)
- `GET /api/rules/templates` returns static template list; `POST /api/rules/templates/[id]/import` is admin-only
- Report compare page: `/o/:orgId/projects/:id/reports/compare?a=reportIdA&b=reportIdB`

## DB Migrations

Incremental migrations live in `docs/db/migrations/` and are used to upgrade existing databases.
`docs/db/init.sql` already contains the latest full schema for fresh databases.

```bash
psql "$DATABASE_URL" -f docs/db/migrations/004_api_tokens.sql
psql "$DATABASE_URL" -f docs/db/migrations/add_concurrency_mode.sql
```

| File | Description |
|------|-------------|
| `004_api_tokens.sql` | Adds `api_tokens` table and related indexes |
| `add_concurrency_mode.sql` | Adds `concurrency_mode TEXT NOT NULL DEFAULT 'allow'` to `pipelines` table |

## FAQ

**TypeScript build errors?** Run `pnpm build`. Common causes: contract mismatch between Runner and Studio, dictionary key mismatch between `en.json` and `zh.json`, or stale type cache (`rm -rf .next`).

**Dark mode?** Theme is controlled via `data-theme` on `:root` (see `apps/studio/src/app/globals.css`). Prefer token-driven styling instead of per-component theme conditionals.
