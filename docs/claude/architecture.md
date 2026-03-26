# Architecture & Project Overview

AI code review + CI/CD platform: Next.js 16 + React 19 + TypeScript + Tailwind CSS v4.
Multi-GitHub project management, commit selection, Claude AI analysis, configurable rule sets, quality report scoring, and a stage-based pipeline builder.
Backend: PostgreSQL for core data, Go Conductor executes analysis jobs, evaluates cron-based pipeline schedules, and orchestrates analysis/pipeline execution with Postgres-backed polling; pipeline `source/review/build` execution runs inside Conductor-managed per-job runner containers while remote Worker agents remain deploy-only executors connected over WebSocket control channels; status updates stream via SSE with polling fallback. Conductor→Studio pipeline notifications use a persistent outbox with background delivery retries.
Monorepo layout: `apps/studio` (Next.js), `apps/conductor` (Go Conductor service), `apps/worker` (Go execution agent), `packages/*` (shared contracts).
Deployment model: Studio and Conductor are self-hosted services deployed with the same container-first workflow; Studio is built as a Next.js server image, Conductor as a Go service image, and both are run behind a reverse proxy on the same platform or cluster. Conductor is also the CI sandbox manager for pipeline `source/review/build` stages and must have access to the host Docker daemon (for example via `/var/run/docker.sock`) so it can create per-job runner containers from the pipeline `buildImage`; remote Workers are deploy-only nodes that pull prepared artifacts for deployment.
Unless stated otherwise, paths in this guide are relative to `apps/studio`.

## Key Platform Features

- AI code review with configurable rule sets, quality gate scoring, and issue tracking
- Issues are normalized with a single source of truth in `analysis_issues`; report detail/chat/export/stats all read issue data from the normalized table.
- PR review write-back mirrors analysis summaries back into GitHub / GitLab PR or MR comments, updating the same external comment on re-analysis
- Rule set template marketplace: 5 built-in templates (React, Go, Security/OWASP, Python, Performance) importable via `GET /api/rules/templates` + `POST /api/rules/templates/[id]/import`
- Report comparison view: diff two reports side-by-side (new / resolved / persisting issues) at `/o/:orgId/projects/:id/reports/compare?a=...&b=...`
- Pipeline concurrency control: `allow | queue | cancel_previous` modes stored in `pipelines.concurrency_mode` column (included in `docs/db/init.sql`; use migration for existing DBs)
- Pipeline runtime status model includes `waiting_manual` across run/job/step persistence, matching stage/job manual-entry execution semantics.
- Pipeline config is authored as a stage-based profile (`trigger + stages + jobs + notifications`) with fixed core columns (`source`, `review`, `build`, `deploy`) plus automation slots between them; Studio derives runtime `needs` edges from stage order and dispatch mode
- Pipeline editor UX is stage-driven: `source` is a fixed single-entry system stage, `review/build/deploy` expose stage-level `entryMode` (`auto | manual`) and `dispatchMode` (`parallel | serial`), automation slots are inserted on demand between core stages, and automation slots are fixed to `auto + parallel`
- Pipeline branch configuration has a single source of truth: the fixed `source` node owns `source_checkout.branch`, and top-level `config.trigger` only controls trigger policy such as `autoTrigger`. New pipelines default that branch from `code_projects.default_branch`, the Source inspector uses a searchable combobox backed by project branches, the inspector can reset back to the project default, and pipeline summaries expose `auto_trigger`, `source_branch`, and `source_branch_source` so list/detail/webhook logic can decide auto-trigger eligibility and branch matching without per-pipeline detail fan-out.
- Project branch selection is unified through a shared searchable combobox + `useProjectBranches` hook across codebase browsing, commit filtering/compare, and pipeline Source editing so branch UX stays consistent everywhere.
- Project-scoped single-value filters that need searchable selection, such as report status or commit author, should also use the shared combobox rather than bespoke select widgets.
- Project configuration selectors that are effectively searchable single-value bindings, such as AI integration selection, should also use the shared combobox.
- Pipeline environment is execution-semantic, not decorative: `config.environment` is sent through Conductor dispatch for worker selection and exposed to steps as `PIPELINE_ENVIRONMENT`.
- Pipeline trigger scheduling is first-class: `config.trigger.schedule` stores a UTC cron expression, Conductor persists `pipelines.trigger_schedule` / `last_scheduled_at` / `next_scheduled_at`, and the schedule loop owns due-run enqueueing.
- Pipeline version history is part of the product contract: Studio renders saved `pipeline_versions` snapshots and config diffs directly in the pipeline detail view, rather than reconstructing history from UI edits.
- Artifact release provenance is first-class: published run artifacts carry source run, commit, branch, publish timestamp, and publisher identity so run-detail UX can show immutable lineage inline.
- Notification settings UI at `/o/:orgId/settings/notifications` is delivery-aware and backed by `/api/notification-settings`; it exposes only shipped email preferences (`pipeline run results`, `analysis report ready`, optional report score threshold) and surfaces provider health (`live`, `development console`, `misconfigured`)
- Dashboard org home page (`/o/:orgId`) shows 4 stat cards (projects, avg score, open issues, pipeline success rate), quick actions, per-project score list, and recent activity
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
- Personal orgs are auto-named from the user's email local-part as `xxx's Org` (for example `lixm@github.com` -> `lixm's Org`, `lixm.open@foxmail.com` -> `lixm's Org`).

**URL routing:**
- Dashboard URLs must include org prefix: `/o/:orgId/...`
- `/o/:orgId/...` routes are real wrappers that mirror the dashboard pages
- Org home page: `/o/:orgId` renders the dashboard overview (no longer auto-redirects to projects)
- Personal account pages are canonical at `/account` and are intentionally outside the org-prefixed dashboard tree; account security, linked providers, sessions, and workspace tokens all live there, while `/settings` remains the org settings entry point.
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
| Go | 1.24.0 | Conductor service |
| Gorilla WebSocket | ^1.5.3 | Conductor↔Worker long-lived control channel |
| AWS SDK for Go v2 | ^1.39 | Conductor artifact backend for S3-compatible object storage |
| robfig/cron/v3 | ^3.x | Conductor cron parsing and next-run evaluation |
| doublestar | ^4.10 | Worker-side `artifactPaths` glob matching (includes `**`) |
| TOML | 1.6.0 | `github.com/BurntSushi/toml` for conductor config |
| sonner | ^2 | Toast notifications |
| zod | `^4.3.6` | Runtime validation |
| lucide-react | ^0.577 | Icons |

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
        auth/github/            # GitHub OAuth start / account linking entry
        auth/callback/          # GitHub OAuth callback + account linking
        (dashboard)/            # Protected pages + Sidebar
          layout.tsx
          rules/                # RulesClient (rule sets + template marketplace)
            [id]/               # RuleSetDetailClient
          settings/integrations/
          settings/notifications/ # Notification settings UI
          account/              # AccountScreen (personal profile, connections, sessions, workspace tokens)
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
          analyze/              # POST → create report with admission control
          pipelines/[id]/       # GET/PUT/PATCH/DELETE (PATCH updates concurrency_mode; DELETE blocks when runs are active)
          pipelines/[id]/runs/  # GET list + POST (enforces concurrency gate)
          pipeline-runs/        # Run detail + logs (proxy to Conductor)
          projects/[id]/artifact-download-stats/ # Artifact download observability metrics
          projects/[id]/artifacts/      # Project artifact registry list + publish entrypoint
          projects/[id]/artifacts/channels/ # Promote artifact versions onto channels
          reports/[id]/         # Report CRUD + issues + stream + chat + export
          rules/
            templates/          # GET list of built-in templates
            templates/[id]/import/ # POST import template → new ruleset
          notification-settings/ # GET/PUT notification preferences
          dashboard/bootstrap/    # GET consolidated sidebar bootstrap payload
          auth/connections/      # GET linked auth providers for account settings
          conductor/events/        # POST (Conductor → Studio callbacks)
          commits/ projects/ stats/ github/ stream/ webhooks/
        layout.tsx providers.tsx globals.css
      components/
        layout/Sidebar.tsx, Topbar.tsx, CommandPalette.tsx
               DashboardShellContext.tsx, MobileBottomNav.tsx
        project/ProjectCard, ProjectCommitsView, ProjectReportsView, ProjectPipelinesView
                ProjectArtifactsView, ProjectCodebaseView, ProjectSettingsView
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
        db.ts github.ts aiReviewService.ts analyzeTask.ts
        pipelineTypes.ts        # Pipeline editor/view types + pipeline summaries
        conductorGateway.ts         # cancelPipelineRun() + other Conductor proxy functions
      proxy.ts                  # Unused auth middleware
    middleware.ts               # Org cookie sync + dashboard redirect (Next.js middleware)
  apps/conductor/
    main.go                     # Go Conductor entrypoint (control plane)
    internal/workerhub/         # Conductor-side worker connection/session hub + dispatch
    pkg/workerprotocol/         # Conductor↔Worker control-plane message contract (shared)
    internal/pipeline/
      executor.go               # ShellExecutor, DockerExecutor, ReviewGateExecutor
      engine.go                 # Conductor-local build execution + deploy-worker dispatch
      source_manager.go         # Local mirror cache + pinned source snapshot materialization
      types.go                  # Pipeline config + step/job contracts
      storage.go, api.go, graph.go, service.go
  apps/worker/
    main.go                     # Go worker agent entrypoint (execution plane; deploy-only)
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
      013_orchestrator_dag_schema.sql # Conductor/worker schema normalization after control-plane redesign
      014_artifact_registry.sql # Adds immutable artifact registry tables, channels, and usage provenance
packages/
  contracts/                    # Shared API/contracts (active)
```
