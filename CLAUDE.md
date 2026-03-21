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
Multi-GitHub project management, commit selection, Claude AI analysis, configurable rule sets, quality report scoring, and a stage-based pipeline builder.
Backend: PostgreSQL for core data, Go scheduler executes analysis jobs and orchestrates pipeline runs via Redis queue; pipeline step execution is worker-only and handled by long-lived Worker agents connected over WebSocket control channels (Scheduler=control plane, Worker=execution plane); status updates stream via SSE with polling fallback.
Monorepo layout: `apps/studio` (Next.js), `apps/scheduler` (Go scheduler control plane), `apps/worker` (Go execution agent), `packages/*` (shared contracts).
Unless stated otherwise, paths in this guide are relative to `apps/studio`.

**Key platform features:**
- AI code review with configurable rule sets, quality gate scoring, and issue tracking
- PR review write-back mirrors analysis summaries back into GitHub / GitLab PR or MR comments, updating the same external comment on re-analysis
- Rule set template marketplace: 5 built-in templates (React, Go, Security/OWASP, Python, Performance) importable via `GET /api/rules/templates` + `POST /api/rules/templates/[id]/import`
- Report comparison view: diff two reports side-by-side (new / resolved / persisting issues) at `/o/:orgId/projects/:id/reports/compare?a=...&b=...`
- Pipeline concurrency control: `allow | queue | cancel_previous` modes stored in `pipelines.concurrency_mode` column (included in `docs/db/init.sql`; use migration for existing DBs)
- Pipeline config is authored as a stage-based profile (`trigger + stages + jobs + notifications`) with fixed core columns (`source`, `review`, `build`, `deploy`) plus automation slots between them; Studio derives runtime `needs` edges from stage order and dispatch mode
- Pipeline editor UX is stage-driven: `source` is a fixed single-entry system stage, `review/build/deploy` expose stage-level `entryMode` (`auto | manual`) and `dispatchMode` (`parallel | serial`), automation slots are inserted on demand between core stages, and automation slots are fixed to `auto + parallel`
- Pipeline branch configuration has a single source of truth: the fixed `source` node owns `source_checkout.branch`, and top-level `config.trigger` only controls trigger policy such as `autoTrigger`. New pipelines default that branch from `code_projects.default_branch`, the Source inspector uses a searchable combobox backed by project branches, the inspector can reset back to the project default, and pipeline summaries expose `source_branch` plus `source_branch_source` so list/detail UI can distinguish project default versus custom branch state.
- Project branch selection is unified through a shared searchable combobox + `useProjectBranches` hook across codebase browsing, commit filtering/compare, and pipeline Source editing so branch UX stays consistent everywhere.
- Project-scoped single-value filters that need searchable selection, such as report status or commit author, should also use the shared combobox rather than bespoke select widgets.
- Project configuration selectors that are effectively searchable single-value bindings, such as AI integration selection, should also use the shared combobox.
- Pipeline environment is execution-semantic, not decorative: `config.environment` is sent through scheduler dispatch for worker selection and exposed to steps as `PIPELINE_ENVIRONMENT`.
- Pipeline runtime UX is separate from authoring: runs render as stage columns with per-node status, logs, artifacts, and node-level manual trigger actions for jobs that enter a manual stage
- Manual execution semantics are node-based, not stage-resume based: when a manual stage becomes ready, each ready job is marked `waiting_manual`; Studio triggers a specific `job_key`, scheduler requeues the run, and only that approved node proceeds
- Pipeline artifact observability: project pipelines page includes artifact download health cards (total, success rate, p95 latency, failures) powered by `GET /api/projects/:id/artifact-download-stats`
- Pipeline artifact retention supports project-level override via `code_projects.artifact_retention_days`; scheduler uses project override first, then global scheduler default
- Worker artifact handoff: deploy steps can declare `artifactInputs` patterns; Worker downloads matched artifacts from earlier steps in the same run before step execution, with checksum validation + retry and run events (`step.artifact.pull_*`)
- Notification settings UI at `/o/:orgId/settings/notifications` backed by `/api/notification-settings`
- Dashboard org home page (`/o/:orgId`) shows 4 stat cards (projects, avg score, open issues, pipeline success rate), quick actions, per-project score list, and recent activity
- Dashboard navigation shell is contextual: global routes render org-level sidebar items, and project routes (`/o/:orgId/projects/:id/*`) switch sidebar to project-scoped navigation (commits/reports/pipelines/codebase/settings) with in-sidebar project switcher.
- Dashboard shell includes productivity navigation aids: collapsible sidebar rail (persisted in local storage), a compact topbar scope switcher (single dropdown for team/project context on project-domain pages), global quick-jump command palette (`Cmd/Ctrl + K`) with keyboard navigation and grouped results, and mobile bottom navigation for project/global context switching on small screens.
- Dashboard shell project data is single-source: `Sidebar`, `Topbar`, and `CommandPalette` consume shared project state from `DashboardShellProvider` (no duplicated `/api/projects` fetches per component).
- Integration deletion is non-blocking: deleting an integration does not check `code_projects` usage references.
- Analyze preflight uses structured AI binding errors: `/api/analyze` returns `AI_INTEGRATION_REBIND_REQUIRED` or `AI_INTEGRATION_MISSING`, and clients should guide users to rebind in Project Settings.

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
| Radix UI Primitives | ^2.1.4 | `@radix-ui/react-primitive` (Radix Select/Popper/Popover dependency) |
| cmdk | ^1.1.1 | Searchable command palette / combobox interactions |
| CodeMirror | 6.x | Read-only codebase viewer (`CodeViewer`) with dynamic language loading via `@codemirror/language-data` |
| react-diff-viewer-continued | ^4.2.0 | Split diff viewer for commit detail modal (IDE-style review UI) |
| Lezer Highlight | ^1.2 | Diff syntax highlighting for commit review |
| PostgreSQL | 14+ | Primary database (self-managed) |
| Octokit | `^5.0.5` | GitHub API |
| Native Fetch (LLM adapters) | Built-in | Unified provider transport for AI integrations (`/chat/completions`, `/responses`, Anthropic Messages API) |
| Go | 1.24.0 | Scheduler service |
| Gorilla WebSocket | ^1.5.3 | Scheduler↔Worker long-lived control channel |
| AWS SDK for Go v2 | ^1.39 | Scheduler artifact backend for S3-compatible object storage |
| doublestar | ^4.10 | Worker-side `artifactPaths` glob matching (includes `**`) |
| TOML | 1.6.0 | `github.com/BurntSushi/toml` for scheduler config |
| Asynq | 0.26.0 | Redis-backed job queue (scheduler) |
| sonner | ^2 | Toast notifications |
| zod | `^4.3.6` | Runtime validation |
| lucide-react | ^0.577 | Icons |

## Engineering Constraints

- **No compatibility design/code paths**: Do not add dual-field parsing (`foo ?? Foo`), legacy aliases, or fallback branches for stale response shapes.
- **No compatibility naming**: Do not introduce `legacy*`, `compat*`, `polyfill*`, or similar identifiers.
- **Single contract source**: Scheduler HTTP contracts are defined in `packages/contracts/src/scheduler.ts` and consumed by Studio.
- **Scheduler timestamp contract**: Scheduler API datetime fields must be validated as ISO8601/RFC3339 with timezone offsets allowed (`datetime({ offset: true })`), not `Z`-only.
- **Server-enforced project scope**: Project-scoped list APIs (for example `/api/reports` and `/api/pipelines`) must validate `projectId` access and enforce filtering on the server side; never rely on client-side filtering for tenant boundaries.
- **Type safety baseline**: `apps/studio/tsconfig.json` enforces strict type checks (`allowJs: false`, `skipLibCheck: false`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`).
- **Schema requirement**: latest schema (`docs/db/init.sql`) and any required upgrade migrations must be applied before runtime. Missing required columns/tables (for example `pipelines.concurrency_mode`, `code_projects.artifact_retention_days`, `pipeline_artifact_download_events`) are treated as errors, not tolerated with fallback logic.
- **Canonical provider IDs only**: Use a single provider identifier per integration type (current AI provider key is `openai-api`). Do not add alias keys.
- **Fail-fast on unsupported providers**: Provider switch statements must throw on unknown values; no silent fallback client selection.
- **Unified AI transport**: Studio AI integrations must use the shared fetch-based adapter path; do not add provider-specific SDK dependencies in feature/business routes.
- **Capability-driven AI params**: AI integration forms must render advanced parameters (for example `temperature`, `reasoningEffort`) from model/baseUrl/apiStyle capability rules, and unsupported parameters must not be sent in runtime requests.
- **Git hygiene**: Runtime and build outputs must stay untracked (`apps/scheduler/data/`, `apps/scheduler/scheduler`, `apps/worker/worker`), and local environment files should use `*.env` patterns while keeping `*.env.example` tracked. Scheduler local config lives at `apps/scheduler/config.toml` and must remain untracked.

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
- Scheduler backend baseline must compile:
  - `cd apps/scheduler && GOMODCACHE=../../.cache/go/mod GOCACHE=../../.cache/go/build go build ./...`

## UI Components

This project does **not** use HeroUI. UI is built from:
- Local reusable components under `apps/studio/src/components/ui/*`
- Radix primitives where needed
- Tailwind CSS tokens defined in `apps/studio/src/app/globals.css`

Rules:
- Prefer `components/ui/*` wrappers over direct Radix usage to keep styling and behavior consistent.
- Use `components/ui/combobox.tsx` for searchable selection controls that need project branch discovery or any similar branch-picking UX; avoid ad hoc native `<select>` controls in those flows.
- Direct `@radix-ui/*` imports are forbidden outside `src/components/ui/*` and enforced by ESLint (`no-restricted-imports`).
- Language-aware code rendering must use shared resolver `src/lib/codeLanguage.ts` (`@codemirror/language-data`), not ad-hoc direct `@codemirror/lang-*` imports in feature components.
- Do not introduce compatibility props or dual APIs (for example `foo` vs `Foo`, `onPress` vs `onClick`). Pick one naming and enforce it.
- Do not add framework-specific naming that implies legacy support (for example `legacy*`, `compat*`, `polyfill*`).
- Interactive containers (cards/rows/panels) must be keyboard accessible (`role`, `tabIndex`, `Enter/Space` handling) when not using native interactive elements.
- Primary async route segments should provide `loading.tsx` boundaries; avoid pure text placeholders as the only loading state.
- Destructive actions in product UI must use in-app confirmation dialogs (`components/ui/confirm-dialog.tsx`), not native `window.confirm`.
- In client UI, use shared date format helpers from `src/lib/dateFormat.ts` instead of direct `toLocaleString`/`toLocaleDateString` calls in feature components.
- Dialogs follow a **single-scroll-container** rule: avoid outer `DialogContent` scrolling for complex modals; body/content panes should own scrolling to prevent nested or redundant scrollbars.
- Dashboard information architecture is single-source navigation: in project scope, use sidebar navigation only (do not add an additional top tab bar such as `ProjectNav`).
- Responsive navigation contract: desktop (`lg+`) uses sidebar + topbar, while mobile (`<lg`) hides sidebar and uses bottom navigation with the same route semantics.

## UI Design Guidelines

Geist-aligned neutral theme: layered surfaces, thin borders, restrained shadows, and clear typographic hierarchy.
Project UI spec: `docs/memories/ui-spec-geist.md` (source of truth).

**Typography:** Use utility classes from `src/app/globals.css`:
`text-heading-*`, `text-label-*`, `text-copy-*`, `text-button-*`.
Avoid custom font sizes unless a new token is added.
Dashboard baseline typography is density-aware: `14px` for primary UI text (navigation/body/controls), `13px` for compact control text, and `12px` for metadata/helper labels.
Do not use `text-xs` for primary labels, tab titles, or actionable control text. Reserve it only for dense metadata chips where `12px` would materially break layout.

**Control density and states:** Keep control rhythm consistent across `Button/Input/Select/Textarea/Tabs/Dropdown` wrappers.
Default control heights should align to `h-9` as baseline (`h-8` for compact, `h-10` for prominent actions). Hover/active/focus states must use the same neutral-surface progression and subtle accent focus ring.
Avoid `h-7` as a default interactive control height in dashboard/product UI.

**Focus visibility:** Do not globally disable focus outlines/rings in dialogs or shells. If custom focus styles are required, replace defaults with an explicit, visible ring to preserve keyboard accessibility.

**Layout width rhythm:** Dashboard pages should use the shared `dashboard-container` utility from `src/app/globals.css` for consistent content width and horizontal padding. Avoid per-page hardcoded `max-w-*` wrappers for primary page shells.

**Overlay surfaces:** Menus/select popovers/dialogs should use restrained overlay shadows and 8–12px corner radii. Avoid heavy, high-contrast shadow stacks that visually overpower surrounding neutral surfaces.

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
          analyze/              # POST → enqueue scheduler task
          pipelines/[id]/       # GET/PUT/PATCH (PATCH updates concurrency_mode)
          pipelines/[id]/runs/  # GET list + POST (enforces concurrency gate)
          pipeline-runs/        # Run detail + logs (proxy to scheduler)
          projects/[id]/artifact-download-stats/ # Artifact download observability metrics
          reports/[id]/         # Report CRUD + issues + stream + chat + export
          rules/
            templates/          # GET list of built-in templates
            templates/[id]/import/ # POST import template → new ruleset
          notification-settings/ # GET/PUT notification preferences
          scheduler/events/        # POST (Scheduler → Studio callbacks)
          commits/ projects/ stats/ github/ stream/ webhooks/
        layout.tsx providers.tsx globals.css
      components/
        layout/Sidebar.tsx, Topbar.tsx, CommandPalette.tsx
               DashboardShellContext.tsx, MobileBottomNav.tsx
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
        recentNavigation.ts     # Client-side recent route history for sidebar + command palette
        useOrgRole.ts           # client hook for org role + admin gating
        codeLanguage.ts         # Shared CodeMirror language resolver (dynamic loading via language-data)
        projectContext.tsx      # ProjectDataProvider + useProject() hook
        ruleTemplates.ts        # Static built-in rule template data
      services/
        db.ts github.ts claude.ts taskQueue.ts analyzeTask.ts
        pipelineTypes.ts        # Pipeline editor/view types + pipeline summaries
        schedulerClient.ts         # cancelPipelineRun() + other scheduler proxy functions
      proxy.ts                  # Unused auth middleware
    middleware.ts               # Org cookie sync + dashboard redirect (Next.js middleware)
  apps/scheduler/
    main.go                     # Go scheduler entrypoint (control plane)
    internal/workerhub/         # Scheduler-side worker connection/session hub + dispatch
    pkg/workerprotocol/         # Scheduler↔Worker control-plane message contract (shared)
    internal/pipeline/
      executor.go               # ShellExecutor, DockerExecutor, SourceCheckoutExecutor, ReviewGateExecutor
      engine.go                 # Worker-dispatched job execution engine (no local fallback)
      types.go                  # Pipeline config + step/job contracts
      storage.go, api.go, graph.go, service.go
  apps/worker/
    main.go                     # Go worker agent entrypoint (execution plane)
docs/
  db/
    init.sql                    # Full schema initialization
    migrations/
      004_api_tokens.sql        # Adds api_tokens table for existing DB upgrades
      add_concurrency_mode.sql  # Adds pipelines.concurrency_mode for existing DB upgrades
      005_analysis_progress_and_token_usage.sql # Adds analysis progress/token usage fields
      010_worker_nodes.sql      # Legacy migration creating worker_nodes (renamed later)
      011_org_storage_settings.sql # Adds per-org artifact storage backend settings
      012_artifact_download_events_and_project_retention.sql # Adds artifact download audit table + project retention override
      013_orchestrator_dag_schema.sql # Scheduler/worker schema normalization after control-plane redesign
packages/
  contracts/                    # Shared API/contracts (active)
```

## Environment Variables

```
DATABASE_URL=               # Studio Postgres connection string
ENCRYPTION_KEY=             # AES-256-GCM key for secrets
EMAIL_VERIFICATION_REQUIRED= # Require email verification before login (true|false)
SCHEDULER_BASE_URL=            # Scheduler base URL (e.g. http://localhost:8200)
SCHEDULER_TOKEN=               # Shared token for scheduler auth
TASK_SCHEDULER_TOKEN=          # Optional, protects internal task endpoints (e.g. /api/codebase/sync)
EMAIL_PROVIDER=             # Email provider for notifications: console|resend
EMAIL_FROM=                 # From address (required for resend)
RESEND_API_KEY=             # Resend API key (required when EMAIL_PROVIDER=resend)
STUDIO_BASE_URL=            # Public base URL for links included in emails (optional)
REDIS_URL=                  # Redis URL used by BullMQ and analyze admission control (recommended in production)
                            # Required for analyze admission control (no in-memory fallback)
ANALYZE_RATE_LIMIT_WINDOW_MS=          # Analyze rate-limit window in ms (default 60000)
ANALYZE_RATE_LIMIT_USER_PROJECT_MAX=   # Max analyze requests/window per org+user+project (default 6)
ANALYZE_RATE_LIMIT_ORG_MAX=            # Max analyze requests/window per org (default 60)
ANALYZE_RATE_LIMIT_IP_MAX=             # Auxiliary max analyze requests/window per IP hash (default 120)
ANALYZE_DEDUPE_TTL_SEC=                # Identical analyze request result reuse TTL in seconds (default 180)
ANALYZE_DEDUPE_LOCK_TTL_SEC=           # In-flight dedupe lock TTL in seconds (default 15)
ANALYZE_BACKPRESSURE_PROJECT_ACTIVE_MAX= # Max active (pending/running) reports per project before 503 (default 6)
ANALYZE_BACKPRESSURE_ORG_ACTIVE_MAX=     # Max active (pending/running) reports per org before 503 (default 60)
ANALYZE_BACKPRESSURE_RETRY_AFTER_SEC=    # Retry-After hint for backpressure rejections (default 15)
ANALYZE_REPORT_TIMEOUT_MS=               # Auto-fail threshold for pending/running reports (ms, default 3600000)
ANALYZE_REPORT_TIMEOUT_SWEEP_INTERVAL_MS= # Min interval between timeout sweeps in Studio workers (ms, default 30000)
ANALYZE_CORE_TOP_K_FILES=               # Core phase pre-filter top-K changed files by risk/size (default 40)
AI_COST_INPUT_PER_MILLION_USD=          # Optional cost model for phase-level cost estimation
AI_COST_OUTPUT_PER_MILLION_USD=         # Optional cost model for phase-level cost estimation
```

**Scheduler env (apps/scheduler):**
```
SCHEDULER_PORT=8200
SCHEDULER_TOKEN=
DATABASE_URL=               # Postgres connection string
REDIS_URL=                  # Redis queue
ENCRYPTION_KEY=             # Same key used by studio for decrypting secrets
STUDIO_URL=                 # Studio base URL (Scheduler -> Studio), used by pipeline executors
STUDIO_TOKEN=               # Token presented to Studio as X-Scheduler-Token (defaults to SCHEDULER_TOKEN; dev falls back to "dev-scheduler")
PIPELINE_QUEUE=             # Pipeline queue name
PIPELINE_CONCURRENCY=       # Max concurrent pipeline jobs
PIPELINE_RUN_TIMEOUT=       # Overall run timeout (e.g. 2h)
WORKER_LEASE_TTL=           # Worker heartbeat lease window (default 45s)
SCHEDULER_DATA_DIR=            # Local logs/artifacts root
PIPELINE_LOG_RETENTION_DAYS=
PIPELINE_ARTIFACT_RETENTION_DAYS=
ANALYZE_PHASE_CORE_TIMEOUT=                 # Optional phase timeout override (e.g. 20m)
ANALYZE_PHASE_QUALITY_TIMEOUT=              # Optional phase timeout override (e.g. 10m)
ANALYZE_PHASE_SECURITY_PERFORMANCE_TIMEOUT= # Optional phase timeout override (e.g. 15m)
ANALYZE_PHASE_SUGGESTIONS_TIMEOUT=          # Optional phase timeout override (e.g. 10m)
```
**Scheduler config file (TOML, optional):**
- Auto-detected: `apps/scheduler/config.toml` or `config.toml` in current working directory
- Override path via `SCHEDULER_CONFIG` or `-config`
- Precedence: env vars > TOML > defaults

Example config (tables, no redundant prefixes):
```
[scheduler]
port = "8200"
token = ""
concurrency = 4
queue = "analysis"
analyze_timeout = "900s"
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

[worker]
lease_ttl = "45s"

[security]
encryption_key = ""

[studio]
url = ""
token = ""
```

**Worker env (apps/worker):**
```
SCHEDULER_BASE_URL=            # Scheduler control-plane URL (e.g. http://scheduler:8200)
SCHEDULER_TOKEN=               # Same shared token used by Scheduler auth
WORKER_ID=                  # Stable worker identifier (required in production)
WORKER_HOSTNAME=            # Optional display hostname
WORKER_VERSION=             # Optional worker version metadata
WORKER_MAX_CONCURRENCY=     # Parallel job slots per worker (default 1)
WORKER_CAPABILITIES=        # Comma list: shell,docker,source_checkout,review_gate
WORKER_LABELS=              # Comma kv list: env=production,region=cn-shanghai
WORKER_WORKSPACE_ROOT=      # Run workspace root on worker (default /tmp/spec-axis-runs)
WORKER_HEARTBEAT_SECONDS=   # Heartbeat interval (default 10)
WORKER_RECONNECT_DELAY=     # Reconnect backoff (default 3s)
```

Environment files for Studio live under `apps/studio` (e.g. `apps/studio/.env`).

**VCS and AI integrations** are configured via web UI at **Settings > Integrations** — NOT via env vars.
- **Artifact storage backend** is configured per organization via web UI at **Settings > Storage** (`GET/PUT /api/storage-settings`) — NOT via env vars.
- VCS: GitHub, GitLab, Generic Git
- AI: Any OpenAI API-format provider (Claude, GPT-4, DeepSeek, etc.)
- AI config supports `model` (manual model ID allowed), required `apiStyle` (`openai|anthropic`), optional `maxTokens`, `temperature`, and optional `reasoningEffort` (`none|minimal|low|medium|high|xhigh`)
- AI config also supports optional per-phase overrides:
  - `phaseModels.{core|quality|security_performance|suggestions}`
  - `phaseMaxTokens.{...}`
  - `phaseReasoningEffort.{...}`
  - `phaseTemperature.{...}`
- Add/Edit AI Integration modals provide quick `maxTokens` profiles for common workloads (quick review, deep review, log analysis, auto-fix) while still allowing manual override
- For official OpenAI endpoint (`https://api.openai.com/v1`), reasoning-capable models (for example `gpt-5*`, `o*`, `codex*`) use `/responses`; other providers remain on `/chat/completions`
- Project-level AI integration binding can be changed in **Project Settings > Project Configuration**; selecting "Use organization default" clears project override and falls back to org default.
- Non-sensitive config → `org_integrations` table; secrets → encrypted in `vault_secret_name`
- Secret encryption format is strict AES-256-GCM with 12-byte nonce and 16-byte tag: `iv:authTag:salt:ciphertext`
- Studio and Scheduler both enforce this format for integration secrets; if old secrets were produced with non-standard nonce/tag size, re-save/recreate those integrations to rotate ciphertext
- Priority: project-specific > org default (no env var fallback)

## Common Commands

```bash
pnpm dev     # Console dev server (port 8109)
pnpm build   # Console production build (TypeScript check)
pnpm start   # Console production server
pnpm lint    # Console ESLint
pnpm codebase:cleanup   # Cleanup stale workspaces (uses TASK_SCHEDULER_TOKEN; optional STUDIO_BASE_URL)
psql "$DATABASE_URL" -f docs/db/init.sql   # Initialize schema (fresh DB)
cd apps/scheduler && go run .   # Scheduler service (reads config.toml if present)
cd apps/worker && go run .   # Worker service
```

`pnpm codebase:cleanup` uses `TASK_SCHEDULER_TOKEN` and optional `STUDIO_BASE_URL` (default `http://localhost:8109`).

## Dependency Build Scripts

pnpm is configured to only allow approved dependency build scripts.
The allowlist lives in `.npmrc` under `only-built-dependencies[]` (currently includes `msgpackr-extract`).
If new install warnings appear, approve the dependency and update the allowlist.

## AI Analysis Flow

1. `POST /api/analyze` (auth required) applies admission control before enqueue:
   - request dedupe by semantic fingerprint (`org + project + commits + rules + mode`) with short Redis TTL
   - distributed rate limits (`org+user+project`, `org`, auxiliary IP hash)
   - queue backpressure guard based on active `analysis_reports` (`pending`/`running`) counts
2. Studio performs integration preflight (AI integration must decrypt/resolve successfully) before creating report/task.
3. On accepted request, Studio creates `analysis_reports` row with immutable `analysis_snapshot` and enqueues scheduler task
4. API returns `{ reportId, status: "queued", taskId }` (or deduped existing report/task when applicable)
5. Reports support manual termination via `POST /api/reports/[id]/terminate` (Studio marks report `canceled` and requests Scheduler task cancellation).
6. Studio also auto-fails timed-out reports (`pending`/`running`) based on `ANALYZE_REPORT_TIMEOUT_MS`.
7. Scheduler canonical report status model is `pending -> running -> done | partial_failed | failed | canceled`.
8. Scheduler executes phased analysis:
   - `core` (score/category/issues/summary/context)
   - `quality` (complexity/duplication/dependency metrics)
   - `security_performance` (security + performance findings)
   - `suggestions` (refactor suggestions + code explanations)
   Non-core phases run in parallel after core completes.
9. Each phase is persisted in `analysis_report_sections` (`report_id + phase + attempt`), including payload, duration, token usage, and failure reason.
10. Scheduler increments `analysis_reports.sse_seq` on progress/section/status updates; SSE uses sequence + snapshot diff to stream ordered updates.
11. Frontend subscribes to `/api/reports/[id]/stream` and receives `status_update` with `status`, `score`, `analysisProgress`, `analysisSections`, `tokenUsage`, `tokensUsed`, `errorMessage`, `sequence`.
12. Studio SSE backend is event-driven via Postgres `LISTEN/NOTIFY` channel `analysis_report_updates` (with periodic timeout sweep checks), not fixed-interval polling.

## Pipeline Engine (CI/CD)

- **Studio** ships a native stage builder under `/pipelines` with fixed lifecycle columns (`source -> after_source -> review -> after_review -> build -> after_build -> deploy -> after_deploy`), on-demand automation insertion, stage-level controls for core stages, and an in-place job inspector.
- **Pipelines** always belong to a project (`project_id` is required, never null).
- **Pipeline config** is versioned in `pipeline_versions` and linked from `pipelines.current_version_id`.
- **Pipeline secrets** are stored in `pipeline_secrets` encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`) and injected into every step as environment variables (write-only in UI).
- **Authoring model**: users edit stage settings plus stage-local jobs; `source` is fixed single-entry, automation slots are fixed `auto + parallel`, and runtime `needs` edges are derived from stage order and stage `dispatchMode`.
- **Execution model**: jobs still execute as a DAG after derivation, and steps run sequentially inside a job.
- **Step types**: `shell` (default) runs via `/bin/sh -c`; `docker` runs `docker run --rm -w /workspace -v {workingDir}:/workspace {envFlags} {image} /bin/sh -c "{script}"`. Set `type: "docker"` and `dockerImage` on a step to use Docker.
- **Step artifacts**: each user-defined step can declare `artifactPaths` (glob/file list, one per line in UI). Worker resolves patterns within the workspace (supports `**`) and uploads matched files after successful step execution.
- **Artifact upload reliability**: worker uploads each artifact with bounded retry (`maxAttempts=3`) and emits attempt metadata; scheduler records observability events (`step.artifact.uploaded`, `step.artifact.upload_failed`, `step.artifact.upload_observed`) for timing/error-category analysis.
- **Concurrency modes**: each pipeline has a `concurrency_mode` column (`allow` / `queue` / `cancel_previous`). Studio API enforces this before creating a new run. Included in `docs/db/init.sql`; existing DBs should apply `docs/db/migrations/add_concurrency_mode.sql`.
- **Events** are appended to `pipeline_run_events` for UI polling and audit.
- **Logs** are stored locally under `SCHEDULER_DATA_DIR`:
  - `logs/{run_id}/{job_key}/{step_key}.log`
- **Artifacts** use org-level storage backend settings (`org_storage_settings`):
  - `local` provider: `{SCHEDULER_DATA_DIR}/{localBasePath}/{org_id}/{run_id}/{job_id}/{step_id}/...`
  - `s3` provider: `s3://{bucket}/{prefix}/{org_id}/{run_id}/{job_id}/{step_id}/...`
  - Worker uploads artifacts through Scheduler internal API `PUT /v1/workers/artifacts/upload`
  - Artifact rows include optional `expires_at`; scheduler performs periodic expiry cleanup (storage delete + DB row delete) based on retention policy.
- **Artifact download path**:
  - Studio issues short-lived signed download tokens at `POST /api/pipeline-runs/:runId/artifacts/:artifactId/download-token`
  - Studio streams artifact content via `GET /api/pipeline-runs/:runId/artifacts/:artifactId/download?token=...`
  - Studio fetches raw bytes from scheduler private endpoint `GET /v1/pipeline-runs/:runId/artifacts/:artifactId/content` using `X-Scheduler-Token`
- **Scheduler → Studio callbacks (pipelines)**:
  - `source_checkout` fetches repo info from `GET /api/projects/:id`
  - `review_gate` fetches latest completed report score from `GET /api/reports?projectId=...&limit=1`
  - Scheduler emits completion events to Studio at `POST /api/scheduler/events` (authorized via `X-Scheduler-Token`) so Studio can send notifications
  - Scheduler must be configured with `STUDIO_URL` and a token (`STUDIO_TOKEN`, defaults to `SCHEDULER_TOKEN`) and Studio must accept `X-Scheduler-Token` (shared secret)

**GitHub webhook:** `/api/webhooks/github` supports `?project_id=...`. If a repo matches multiple projects, the endpoint returns 409 and requires `project_id`.

## Codebase Cache (Backend)

`CodebaseService` manages per-project local Git mirrors and per-job workspaces for AI analysis and pipeline tasks.
Mirrors are cache-only (not a source of truth) and are synced on demand or on a schedule; workspaces are isolated and must be cleaned after each job.
Codebase browsing uses the same mirror cache and enforces a max preview size for files.
Code comments are modeled as threads:
- `codebase_comment_threads` stores thread-level anchor + lifecycle (`open` / `resolved`) at file/line scope.
- `codebase_comments` stores individual messages (replies) under `thread_id`.
- `codebase_comment_assignees` stores optional assignees per message.
Thread anchoring and projection model:
- `codebase_thread_anchors` stores immutable anchor snapshots (`anchor_commit_sha`, `anchor_path`, anchor line range, selection/context, optional blob SHA).
- `codebase_thread_projections` stores computed per-target-commit projections (`projected_path`, projected line range, status/confidence/reason).
- `codebase_thread_projection_jobs` stores batch projection compute status (`running|completed|failed`) per project+target commit.
Projection statuses are canonical: `exact | shifted | ambiguous | outdated | missing`.
Only `exact` / `shifted` projections are rendered inline in code view; non-inline statuses are preserved in projection records to prevent false location claims.
Codebase comments API contract:
- `GET /api/projects/:id/codebase/comments` returns flattened comments enriched with thread metadata (`thread_id`, `thread_status`, `thread_line`, `thread_line_end`, `resolved_by`, `resolved_at`).
- `POST /api/projects/:id/codebase/comments` accepts either:
  - a new thread payload (`ref`, `commit`, `path`, `line`, optional `line_end`, `selection_text`) + `body`, or
  - a reply payload (`thread_id`) + `body`.
- `PATCH /api/projects/:id/codebase/comments` updates thread status (`open` / `resolved`).
Codebase tree/file endpoints accept `sync=0` to skip mirror fetch for faster browsing (manual sync still available).
Automatic mirror sync can be triggered by:
- GitHub `push` webhooks (forces mirror fetch for matching projects).
- Scheduled POST to `/api/codebase/sync` (uses `x-task-token` if `TASK_SCHEDULER_TOKEN` is set). Supports `limit`, `force`, `project_id`, and `org_id`.
- Project creation triggers an initial mirror sync in the background.
Stale workspaces can be cleared via `POST /api/codebase/cleanup` (uses `x-task-token` if `TASK_SCHEDULER_TOKEN` is set).

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

- All API routes require login; a small set of Studio endpoints accept `X-Scheduler-Token` for Scheduler-to-Studio calls (pipeline executors)
- Auth uses the `session` HTTP-only cookie; email verification is controlled by `EMAIL_VERIFICATION_REQUIRED` (default true)
- `analysis_issues.status`: `open | fixed | ignored | false_positive | planned`
- `/api/projects/[id]/trends` returns array directly (no `data` wrapper)
- Rules learning endpoints are admin-only (org-scoped)
- Public pages accessible without login: `/`, `/login`, `/verify`, `/reset`, `/auth/*`, `/invite/*`, `/terms`, `/privacy`
- Dashboard routes must be accessed via `/o/:orgId/...` (middleware rewrites internally)
- Project detail tabs support deep links via query params: `?tab=commits|codebase|stats|config`. Codebase supports `ref`, `path`, `line`, `commentId` for jump-to-location/thread.
- `PATCH /api/pipelines/[id]` updates `concurrency_mode` in Studio DB (schema must include `pipelines.concurrency_mode`; present in `init.sql`)
- `POST /api/pipelines/[id]/runs` enforces concurrency gate before calling scheduler (409 if `queue` mode and run active)
- Studio server calls Scheduler `POST /v1/pipeline-runs/{runId}/cancel` and expects `{ ok: true }` (used by `cancel_previous` concurrency mode)
- AI integration runtime routing: official OpenAI + reasoning-capable model (or explicit `reasoningEffort`) calls `/responses`; otherwise calls `/chat/completions` (Anthropic base URL uses Messages API)
- AI integration protocol selection requires explicit `apiStyle`: `anthropic` forces Messages API; `openai` forces OpenAI-compatible APIs.
- `POST /api/reports/[id]/chat` resolves AI config from project/org integrations (same precedence as analyze), streams assistant output via SSE (`meta` / `delta` / `done` / `error` events), and returns integration binding errors (`AI_INTEGRATION_MISSING` / `AI_INTEGRATION_REBIND_REQUIRED`) instead of relying on `ANTHROPIC_API_KEY`.
- `POST /api/reports/[id]/chat` accepts `issueId` as either canonical issue UUID or composite fallback key (`file::line::category::rule::message`) for report rows that lack persisted issue UUIDs; composite keys are used for focus-context matching only.
- `GET /api/reports/[id]` enriches `issues` with canonical `analysis_issues.id` UUID (plus normalized issue fields from `analysis_issues`) so frontend issue actions (comments/chat) use stable per-issue identifiers without client-side fuzzy matching.
- `GET /api/reports/[id]/chat?issueId=<issue-uuid>` returns the latest conversation for that issue (used to restore chat history when reopening the same issue dialog).
- `GET /api/reports/[id]/chat?latest=1` returns only the latest conversation for the report (used by AI chat initialization to avoid loading full history).
- Chat history query responses include `updated_at` for ordering conversation history in the AI reviewer dialog.
- Studio AI runtime implementation is SDK-free and uses a single HTTP adapter strategy across providers (including Anthropic Messages API).
- Scheduler analysis error normalization: token-limit truncation and empty upstream body are surfaced as actionable messages instead of raw JSON parse errors.
- Scheduler AI client performs one automatic token-budget retry on output truncation (`max_tokens` / `max_output_tokens`) before failing.
- Report stream payload (`type: "status_update"`) includes `status`, `score`, `analysisProgress`, `analysisSections`, `tokenUsage`, `tokensUsed`, `errorMessage`, and `sequence`
- `GET /api/rules/templates` returns static template list; `POST /api/rules/templates/[id]/import` is admin-only
- Report compare page: `/o/:orgId/projects/:id/reports/compare?a=reportIdA&b=reportIdB`
- Commit compare diff: `GET /api/commits/compare?repo=...&project_id=...&base=...&head=...`
- Commit review markers: `GET/POST/DELETE /api/projects/:id/commits/review` for per-file/line reviewed state

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

## FAQ

**TypeScript build errors?** Run `pnpm build`. Common causes: contract mismatch between Scheduler and Studio, dictionary key mismatch between `en.json` and `zh.json`, or stale type cache (`rm -rf .next`).

**Dark mode?** Theme is controlled via `data-theme` on `:root` (see `apps/studio/src/app/globals.css`). Prefer token-driven styling instead of per-component theme conditionals.
