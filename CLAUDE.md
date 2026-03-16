# spec-axis — Project Guide

## General Rules

- **Documentation language**: All documentation files must be written in English.

## Internationalization (i18n)

5 languages, English default: `en` | `zh` | `ja` | `es` | `zh-TW`

**Server component:**
```tsx
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
const locale = await getLocale();
const dict = await getDictionary(locale);
```

**Client component:** Pass `dict` as prop from server page, type as `Dictionary` from `@/i18n`.

**Rules:**
- All 5 dictionary files (`src/i18n/dictionaries/*.json`) must have **identical key structure** — TypeScript infers types from `en.json`
- When adding keys, update ALL 5 files simultaneously or the build fails
- Run `rm -rf .next` if TypeScript type cache is stale after dict changes
- `LanguageSwitcher` in Sidebar footer persists locale in cookies

## Project Overview

AI code review + CI/CD platform: Next.js 16 + React 19 + TypeScript + HeroUI v3 (beta) + Tailwind CSS v4.
Multi-GitHub project management, commit selection, Claude AI analysis, configurable rule sets, quality report scoring, and pipeline DAG builder.
Backend: PostgreSQL for core data, Go runner executes analysis jobs and pipeline runs via Redis queue; status updates stream via SSE with polling fallback.
Monorepo layout: `apps/studio` (Next.js), `apps/runner` (Go runner), `packages/*` (shared contracts).
Unless stated otherwise, paths in this guide are relative to `apps/studio`.

## Organization Model & Routing

Multi-tenant org system (Vercel-like UI). Each user has a **personal org** on signup.

**Org-scoped assets:** projects, reports, rule sets, rules, integrations, rule learning stats.

**Roles:** `owner | admin | reviewer | member`
- `owner/admin`: manage org assets (create/update/delete projects, rules, integrations, config)
- `reviewer/member`: read-only (view projects/reports/rules)

**Active org:**
- Stored in `org_id` cookie
- Resolved via `/api/orgs/active` (GET/POST)
- Auth callback + invite accept also set the cookie

**URL routing:**
- Dashboard URLs must include org prefix: `/o/:orgId/...`
- `middleware.ts` rewrites `/o/:orgId/...` to the internal route and keeps cookie in sync
- If a user hits `/projects` (or other dashboard path) and has `org_id`, middleware redirects to `/o/:orgId/...`

**Frontend helpers:**
- `src/lib/orgPath.ts` → `withOrgPrefix`, `stripOrgPrefix`, `replaceOrgInPath`, `extractOrgFromPath`
- `src/lib/useOrgRole.ts` → `isAdmin` gating for UI actions

## Tech Stack

| Tech | Version | Notes |
|------|---------|-------|
| Next.js | 16.1.6 | App Router, Turbopack |
| React | 19.2.3 | — |
| HeroUI | 3.0.0-beta.8 | `@heroui/react` |
| Tailwind CSS | v4.2.1 | `@import "@heroui/styles"` in globals.css |
| Geist Font | 1.7.x | Geist Sans/Mono via `geist` package |
| Radix UI Primitives | ^2.1.4 | `@radix-ui/react-primitive` (Radix Select/Popper dependency) |
| CodeMirror | 6.x | Read-only codebase editor preview |
| React Flow (XYFlow) | ^12.7 | Pipeline DAG builder |
| PostgreSQL | 14+ | Primary database (self-managed) |
| Octokit | `^5.0.5` | GitHub API |
| Anthropic SDK | `^0.78` | Claude AI, supports `ANTHROPIC_BASE_URL` |
| Go | 1.24.0 | Runner service |
| Asynq | 0.26.0 | Redis-backed job queue (runner) |
| sonner | ^2 | Toast notifications |
| zod | `^4.3.6` | Runtime validation |
| lucide-react | ^0.577 | Icons |

## HeroUI v3 Configuration

- **globals.css**: `@import "@heroui/styles";` — do NOT use `heroui()` tailwind plugin
- **No** `HeroUIProvider` wrapper needed
- **.npmrc**: `public-hoist-pattern[]=*@heroui/*` (required for correct hoisting)
- **No Progress component** — use Tailwind: `<div className="h-1 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-success" style={{ width: `${v}%` }} /></div>`

## HeroUI v3 Component API

```tsx
// Card
<Card><Card.Header><Card.Title /></Card.Header><Card.Content className="p-4" /></Card>

// Modal
<Modal state={modalState}>
  <Modal.Backdrop isDismissable>
    <Modal.Container size="md"> {/* xs|sm|md|lg|full|cover */}
      <Modal.Dialog>
        <Modal.Header><Modal.Heading>Title</Modal.Heading></Modal.Header>
        <Modal.Body /><Modal.Footer />
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
</Modal>

// Modal state
const modalState = useOverlayState({ isOpen: show, onOpenChange: (v) => { if (!v) setShow(false); } });

// Tabs — NEVER use <Tabs.Indicator /> (causes SharedElement runtime error)
<Tabs defaultSelectedKey="tab1">
  <Tabs.ListContainer className="border-b border-border px-4">
    <Tabs.List><Tabs.Tab id="tab1">Tab</Tabs.Tab></Tabs.List>
  </Tabs.ListContainer>
  <Tabs.Panel id="tab1">Content</Tabs.Panel>
</Tabs>

// Select
<Select selectedKey={value} onSelectionChange={(key) => setValue(key as string)}>
  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
  <Select.Popover>
    <ListBox items={items}>{(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}</ListBox>
  </Select.Popover>
</Select>

// Tooltip
<Tooltip><Tooltip.Trigger><Button /></Tooltip.Trigger><Tooltip.Content>text</Tooltip.Content></Tooltip>

// Input with icon (no startContent prop)
<InputGroup>
  <InputGroup.Prefix><Search className="size-4" /></InputGroup.Prefix>
  <InputGroup.Input placeholder="..." value={v} onChange={e => setV(e.target.value)} />
</InputGroup>
```

### API Limitations

| Component | Limitation |
|-----------|------------|
| `Modal.Container` | `size`: `xs\|sm\|md\|lg\|full\|cover` only |
| `Input` | No `startContent`, no `isDisabled` — use HTML `disabled` |
| `Button` | No `isLoading` — use `isDisabled` + conditional text |
| `Card` | No `onPress` — use `onClick` |
| `Select.Value` | No `placeholder` — use children |
| `Switch` | `onChange` receives `boolean`, not event |
| `Tabs.Indicator` | **Forbidden** — SharedElement runtime error |
| `Separator` | Replaces v2 `Divider` |

**Button variants:** `primary | outline | ghost | secondary | tertiary | danger | danger-soft`
**Chip variants:** `primary | secondary | tertiary | soft`
**Chip colors:** `default | primary | accent | success | warning | danger`

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
- `apps/studio/src/proxy.ts` is legacy and currently unused.
- **Dynamic pages**: any dashboard page that depends on auth/session or database reads must use `export const dynamic = 'force-dynamic'`
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
          projects/             # ProjectsClient
            [id]/               # CommitsClient + EnhancedProjectDetail + Tabs
          pipelines/            # PipelinesClient + DAG builder
            [id]/               # PipelineDetailClient (builder + runs)
          reports/              # ReportsClient
            [id]/               # EnhancedReportDetailClient (primary), ReportDetailClient (legacy)
          rules/                # RulesClient
            [id]/               # RuleSetDetailClient
          settings/integrations/
          settings/security/
        api/
          analyze/              # POST → enqueue runner task
          pipelines/            # CRUD + runs (proxy to runner)
          pipeline-runs/         # Run detail + logs (proxy to runner)
          tasks/run/            # Deprecated (runner handles tasks)
          commits/ projects/ reports/ rules/ stats/ github/ stream/
        layout.tsx providers.tsx globals.css
      components/
        layout/Sidebar.tsx
        project/ProjectCard, AddProjectModal, EditProjectModal, ProjectConfigPanel
        report/EnhancedIssueCard, AIChat, TrendChart, ExportButton
        dashboard/DashboardStats.tsx
        common/LanguageSwitcher.tsx
      i18n/
        index.ts                # getDictionary(), Dictionary type (inferred from en.json)
        dictionaries/           # en.json zh.json ja.json es.json zh-TW.json
      lib/locale.ts             # getLocale() — reads NEXT_LOCALE cookie
      lib/orgPath.ts            # /o/:orgId path helpers
      lib/useOrgRole.ts         # client hook for org role + admin gating
      services/db.ts github.ts claude.ts taskQueue.ts analyzeTask.ts ...
      proxy.ts                  # Legacy auth middleware (unused)
    middleware.ts               # Org path rewrite + redirect (Next.js middleware)
  runner/
    cmd/runner/                 # Go runner entrypoint
    internal/pipeline/          # Pipeline engine, executors, storage, API
packages/
  contracts/                    # Shared API/contracts (future)
```

## Environment Variables

```
DATABASE_URL=               # Studio Postgres connection string
ENCRYPTION_KEY=             # AES-256-GCM key for secrets
RUNNER_BASE_URL=            # Runner base URL (e.g. http://localhost:8200)
RUNNER_TOKEN=               # Shared token for runner auth
TASK_RUNNER_TOKEN=          # Optional, protects internal task endpoints (e.g. /api/codebase/sync)
```

**Runner env (apps/runner):**
```
RUNNER_PORT=8200
RUNNER_TOKEN=
DATABASE_URL=               # Postgres connection string
REDIS_URL=                  # Redis queue
ENCRYPTION_KEY=             # Same key used by studio for decrypting secrets
PIPELINE_QUEUE=             # Pipeline queue name
PIPELINE_CONCURRENCY=       # Max concurrent pipeline jobs
PIPELINE_RUN_TIMEOUT=       # Overall run timeout (e.g. 2h)
RUNNER_DATA_DIR=            # Local logs/artifacts root
PIPELINE_LOG_RETENTION_DAYS=
PIPELINE_ARTIFACT_RETENTION_DAYS=
```
Environment files live under `apps/studio` (e.g. `apps/studio/.env`).

**VCS and AI integrations** are configured via web UI at **Settings > Integrations** — NOT via env vars.
- VCS: GitHub, GitLab, Generic Git
- AI: Any OpenAI-compatible API (Claude, GPT-4, DeepSeek, etc.)
- Non-sensitive config → `org_integrations` table; secrets → encrypted in `vault_secret_name`
- Priority: project-specific > org default (no env var fallback)

## Common Commands

```bash
pnpm dev     # Console dev server (port 8109)
pnpm build   # Console production build (TypeScript check)
pnpm start   # Console production server
pnpm lint    # Console ESLint
pnpm codebase:cleanup   # Cleanup stale workspaces (uses TASK_RUNNER_TOKEN; optional STUDIO_BASE_URL)
psql "$DATABASE_URL" -f docs/db/init.sql   # Initialize schema (fresh DB)
cd apps/runner && go run ./cmd/runner   # Runner service
```

`pnpm codebase:cleanup` uses `TASK_RUNNER_TOKEN` and optional `STUDIO_BASE_URL` (default `http://localhost:8109`).

## Dependency Build Scripts

pnpm is configured to only allow approved dependency build scripts.
The allowlist lives in `.npmrc` under `only-built-dependencies[]` (currently includes `msgpackr-extract`).
If new install warnings appear, approve the dependency and update the allowlist.

## AI Analysis Flow

1. `POST /api/analyze` → returns `{ reportId }` immediately, enqueues runner task
2. Runner: fetch diff by commit SHA → AI analysis → sync `analysis_issues` → update status
3. Frontend: SSE on `/api/reports/[id]/stream`, fallback to polling every 2.5s

## Pipeline Engine (CI/CD)

- **Studio** ships a drag-and-drop DAG builder under `/pipelines` with stage/job/step configuration.
- **Pipeline config** is versioned in `pipeline_versions` and linked from `pipelines.current_version_id`.
- **Execution model**: jobs form a DAG via `needs`; steps run sequentially inside a job.
- **Runner** executes **shell** steps only (for now) with per-step timeouts, retries, and status events.
- **Events** are appended to `pipeline_run_events` for UI polling and audit.
- **Logs** and **artifacts** are stored locally under `RUNNER_DATA_DIR`:
  - `logs/{run_id}/{job_key}/{step_key}.log`
  - `artifacts/{run_id}/{job_key}/{step_key}/...`

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

Local cache directories (for example `apps/studio/.codebase/` and `/.pnpm-store/`) are not committed to Git.

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

- All API routes require login; runner endpoints accept `X-Runner-Token`
- Auth uses the `session` HTTP-only cookie; email verification is required before login
- `analysis_issues.status`: `open | fixed | ignored | false_positive | planned`
- `/api/projects/[id]/trends` returns array directly (no `data` wrapper)
- Rules learning endpoints are admin-only (org-scoped)
- Public pages accessible without login: `/`, `/login`, `/verify`, `/reset`, `/auth/*`, `/invite/*`, `/terms`, `/privacy`
- Dashboard routes must be accessed via `/o/:orgId/...` (middleware rewrites internally)

## FAQ

**TypeScript build errors?** Run `pnpm build`. Common: use `disabled` not `isDisabled` on Input; `onClick` not `onPress` on Card; Modal size only `xs|sm|md|lg|full|cover`. If type errors persist after dict changes, run `rm -rf .next`.

**Dark mode?** Add `dark` class to `html` tag — HeroUI v3 CSS variables adapt automatically.
