# Sykra — Project Guide

## General Rules

- **Documentation language**: All documentation files must be written in English.

## Detailed Documentation

Full details are split into topic files under `docs/claude/`:

| File | Contents |
|------|----------|
| [`architecture.md`](docs/claude/architecture.md) | Project overview, tech stack, org model, routing, directory structure |
| [`ui-guidelines.md`](docs/claude/ui-guidelines.md) | UI components, design tokens, dialog/navigation/settings rules, toast usage |
| [`pipeline-engine.md`](docs/claude/pipeline-engine.md) | CI/CD pipeline engine, runtime UX, logs, artifacts, sandbox, recovery |
| [`environment.md`](docs/claude/environment.md) | All env vars (Studio/Conductor/Worker), TOML config, integrations, codebase cache env |
| [`api-contracts.md`](docs/claude/api-contracts.md) | Runtime contracts, auth, analysis flow, chat APIs, codebase cache, DB migrations |

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

## Engineering Constraints

- **No compatibility design/code paths**: Do not add dual-field parsing (`foo ?? Foo`), legacy aliases, or fallback branches for stale response shapes.
- **No compatibility naming**: Do not introduce `legacy*`, `compat*`, `polyfill*`, or similar identifiers.
- **Single contract source**: Conductor HTTP contracts are defined in `packages/contracts/src/conductor.ts` and consumed by Studio.
- **Conductor gateway payload typing**: `apps/studio/src/services/conductorGateway.ts` request payload parameters must use explicit DTO types; do not use `unknown` for outbound Conductor request bodies.
- **Array response contract**: Conductor list endpoints must serialize empty collections as `[]`, not `null`, so Studio Zod array schemas always receive an array shape.
- **Conductor timestamp contract**: Conductor API datetime fields must be validated as ISO8601/RFC3339 with timezone offsets allowed (`datetime({ offset: true })`), not `Z`-only.
- **Pipeline summary contract**: Conductor pipeline list/get payloads must include `environment`, `last_run`, `auto_trigger`, `source_branch`, and `source_branch_source` so Studio can render consistent list/detail summaries and webhook auto-trigger matching can run without per-pipeline detail fan-out.
- **Pipeline status contract**: `pipeline_runs`, `pipeline_jobs`, and `pipeline_steps` status constraints must all include `waiting_manual` to match runtime state transitions.
- **Pipeline runs list bounds**: pipeline runs list APIs must clamp `limit` to a safe range (`1..100`) at HTTP boundaries.
- **Pipeline run actor contract**: Studio pipeline run APIs (`/api/pipelines/:id/runs`, `/api/pipeline-runs/:runId`) must hydrate `triggered_by_name` / `triggered_by_email` from `auth_users` so runtime UI shows human actor identity instead of UUID fragments.
- **Pipeline list telemetry contract**: Studio `/api/pipelines` responses must include lightweight per-pipeline 7-day run summary (`run_stats_7d`) and hydrated last-run actor identity for list-page operational scanning without N+1 detail fetches.
- **Pipeline list run-health contract**: Studio `/api/pipelines` responses must expose 7-day totals, success rate, failed-run count, active-run count, and daily trend series so the list page can render operational summaries without additional analytics queries.
- **Pipeline last-run failure contract**: Conductor `last_run` payloads must include `error_message` so Studio can surface the latest failure reason directly in list and detail views.
- **Pipeline run execution summary contract**: Pipeline detail views should derive critical path, total duration, and first failure summary from the selected run's jobs and steps instead of forcing operators to inspect every node manually.
- **Pipeline run release status contract**: Pipeline run artifact responses should expose published release versions and channel assignments for the selected run so detail views can show release state inline without an extra catalog fetch.
- **Pipeline run channel promotion contract**: Pipeline detail views should allow promoting the latest published release to a named channel inline, reusing the project artifact channel API instead of forcing a separate catalog workflow.
- **Pipeline version history contract**: `GET /api/pipelines/:id` should expose the saved `pipeline_versions` history alongside the current version so Studio can render version timelines and config diffs without ad-hoc database reads in the UI.
- **Artifact release provenance contract**: Pipeline run artifact release summaries should surface source run, commit, branch, publish timestamp, publisher identity, and channel assignments so Studio can show immutable release lineage inline.
- **Pipeline environment options contract**: Pipeline environments are org-configurable runtime settings (`org_runtime_settings.pipeline_environments`) stored as ordered definitions (`key`, `label`, `order`) with canonical defaults Development/Preview/Production; Studio pipeline forms and badges must consume this settings field instead of hardcoded environment arrays.
- **Pipeline environment immutability contract**: The default pipeline environments (`development`, `preview`, `production`) are immutable runtime definitions. They may be reordered and extended with custom entries, but their keys and labels must never be edited or deleted.
- **Production deploy gate contract**: Pipelines targeting the `production` environment must require a manual deploy entry gate. Studio forms must enforce this at edit time, and backend validation must reject production configs without the manual deploy gate.
- **Rollback artifact contract**: Pipeline rollback triggers must target a published artifact version derived from the source run. A rollback run must be rejected unless a published artifact version exists for the source run and pipeline.
- **Issue source of truth**: `analysis_issues` is the canonical issue store; do not read issue aggregates from `analysis_reports.issues`.
- **Quality snapshot source**: `create_quality_snapshot` must compute issue counts from `analysis_issues` (by `report_id`), not from report-level JSON issue payloads.
- **Analyze cache consistency**: `/api/analyze-cached` must reuse recent identical analyses from persistent database reads only; do not rely on process-local result caches for cross-request decisions.
- **SQL projection discipline**: Service/API SQL must use explicit column projections for read/write-return paths; avoid `select *` / `returning *` in production flows. Studio lint enforces this via `apps/studio/src/scripts/check-sql-projections.mjs` (also checks alias wildcards such as `i.*` / `jsonb_agg(c.*)`). Shared table projection constants must be defined in `apps/studio/src/services/sql/projections.ts` and reused across routes/services instead of duplicating inline column lists.
- **DTO typing discipline**: API routes and services must use explicit row/response interfaces for DB query results; avoid `Record<string, unknown>` in production read/write paths when the payload shape is known.
- **Weak-type elimination baseline**: In `apps/studio/src/app/api/**` and `apps/studio/src/services/**`, `Record<string, unknown>` should not be used. Use explicit DTO interfaces for stable contracts and `JsonObject`/`asJsonObject` (`apps/studio/src/lib/json.ts`) for genuinely dynamic JSON payloads.
- **DB query typing discipline**: Calls to `query` / `queryOne` in Studio API/services must specify generic row types explicitly (no implicit default row typing). Enforced by `apps/studio/src/scripts/check-db-query-typing.mjs` in Studio lint.
- **DB helper strictness**: `apps/studio/src/lib/db.ts` `query` / `queryOne` are generic-only (no default `any` type parameter). Do not reintroduce implicit row typing defaults.
- **Write-path execution semantics**: Use `exec` (pool scope) and `execTx` (`apps/studio/src/lib/db.ts`, transaction scope) for write-only SQL that does not read row payloads, instead of ad-hoc `query` calls.
- **Status constant centralization**: Reused analysis/pipeline status groups (active/terminal/failure/result-ready) must be defined in `apps/studio/src/services/statuses.ts` and reused across routes/services; avoid scattering duplicated hardcoded status sets.
- **Status SQL list reuse**: For repeated status filters in SQL, reuse the status SQL list constants exported from `apps/studio/src/services/statuses.ts` (for example analysis active/result-ready, pipeline active/running) instead of duplicating inline `status in (...)` strings.
- **Analysis report status type source**: Use `AnalysisReportStatus` from `apps/studio/src/services/statuses.ts` for shared report status typing in services/routes instead of repeating union literals.
- **Shared JSON object helper**: Generic unknown-object guards must reuse `apps/studio/src/lib/json.ts` (`JsonObject`, `asJsonObject`) instead of duplicating ad-hoc object-cast helpers in routes/services.
- **Server-enforced project scope**: Project-scoped list APIs (for example `/api/reports` and `/api/pipelines`) must validate `projectId` access and enforce filtering on the server side; never rely on client-side filtering for tenant boundaries.
- **Type safety baseline**: `apps/studio/tsconfig.json` enforces strict type checks (`allowJs: false`, `skipLibCheck: false`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`).
- **Schema requirement**: latest schema (`docs/db/init.sql`) and any required upgrade migrations must be applied before runtime. Missing required columns/tables are treated as errors, not tolerated with fallback logic.
- **Canonical provider IDs only**: Use a single provider identifier per integration type (current AI provider key is `openai-api`). Do not add alias keys.
- **Fail-fast on unsupported providers**: Provider switch statements must throw on unknown values; no silent fallback client selection.
- **Unified AI transport**: Studio AI integrations must use the shared fetch-based adapter path; do not add provider-specific SDK dependencies in feature/business routes.
- **Capability-driven AI params**: AI integration forms must render advanced parameters from model/baseUrl/apiStyle capability rules, and unsupported parameters must not be sent in runtime requests.
- **Git hygiene**: Runtime and build outputs must stay untracked (`apps/conductor/data/`, `apps/conductor/conductor`, `apps/worker/worker`), and local environment files should use `*.env` patterns while keeping `*.env.example` tracked.
- **Package manager bootstrap**: repository-level scripts must invoke Corepack-managed pnpm through `scripts/run-pnpm.mjs` instead of a bare global `pnpm` binary. The root `packageManager` field is pinned to the repository pnpm version, and the wrapper keeps `COREPACK_HOME` under the repo-local `.cache/corepack` directory.
- **Production config strictness**: production runtime must fail fast on missing required secrets/integration settings (no dev token defaults, no console email fallback for auth, no optionalized OAuth credentials).

## Naming & Design Rules

- Prefer domain names over technical workaround names (`pipelineRun`, `rulesetSnapshot`, `integrationConfig`).
- Use final-state naming only. Do not use transitional prefixes/suffixes like `Enhanced*`, `New*`, `Old*`, `V2*`, `Temp*`, or `*Legacy`.
- External service access modules should use gateway naming (`*Gateway`) instead of generic client naming (`*Client`) when they encapsulate transport + contract parsing.
- Process-local implementations must be explicitly named with scope semantics (for example `createInMemoryRateLimiter`) to avoid distributed behavior ambiguity.
- Audit log metadata must use domain-correct nouns (`entityType: 'org'` for organization entities, `entityType: 'project'` for project entities) and should not reuse unrelated entity labels.
- Optional fields must be modeled as truly optional fields; never assign `undefined` to an explicitly present property under `exactOptionalPropertyTypes`.
- External API payload parsing must be schema-first (`zod` contract parse before business logic).
- Do not add transitional adapter layers for old payloads or old naming; update all callers to the canonical contract in one change set.

## Quality Gates

- Studio CI baseline must be green on every change set:
  - `pnpm -C apps/studio lint` returns 0 errors and 0 warnings (ESLint + SQL projection guard).
  - `pnpm -C apps/studio build` succeeds.
- Conductor backend baseline must compile:
  - `cd apps/conductor && GOMODCACHE=../../.cache/go/mod GOCACHE=../../.cache/go/build go build ./...`

## Next.js 16 Special Configuration

- **Middleware**: file is `apps/studio/middleware.ts` (Next.js middleware). It handles `/o/:orgId` rewrites and org redirects.
- `apps/studio/src/proxy.ts` is currently unused.
- **Dynamic pages**: any dashboard page that depends on auth/session or database reads must use `export const dynamic = 'force-dynamic'`
- **Dynamic route params**: in pages and route handlers, `params` is async — `const { id } = await params` (avoid sync dynamic APIs errors)
- **Self-hosted request timeouts**: long-running routes such as analyze/chat should be protected by the deployment platform or reverse proxy; do not rely on Vercel-specific timeout behavior in self-hosted environments.
- **Auth email delivery requirement**: email-password registration and verification resend endpoints must fail fast when live email delivery is not configured (`503 EMAIL_DELIVERY_UNAVAILABLE`); do not silently degrade to console-only logging.

## Common Commands

```bash
pnpm dev     # Console dev server (port 8109)
pnpm build   # Console production build (TypeScript check)
pnpm start   # Console production server
pnpm lint    # Console ESLint
pnpm codebase:cleanup   # Cleanup stale workspaces (uses CONDUCTOR_TOKEN; optional STUDIO_BASE_URL)
psql "$DATABASE_URL" -f docs/db/init.sql   # Initialize schema (fresh DB)
cd apps/conductor && go run .   # Conductor service (reads config.toml if present)
cd apps/worker && go run .      # Deploy worker service
```

## Dependency Build Scripts

pnpm is configured to only allow approved dependency build scripts.
The allowlist lives in `.npmrc` under `only-built-dependencies[]` (currently includes `msgpackr-extract`).
If new install warnings appear, approve the dependency and update the allowlist.

## FAQ

**TypeScript build errors?** Run `pnpm build`. Common causes: contract mismatch between Conductor and Studio, dictionary key mismatch between `en.json` and `zh.json`, or stale type cache (`rm -rf .next`).

**Dark mode?** Theme is controlled via `data-theme` on `:root` (see `apps/studio/src/app/globals.css`). Prefer token-driven styling instead of per-component theme conditionals.
