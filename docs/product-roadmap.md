# Spec-Axis Product Roadmap

> **Last updated:** 2026-03-21

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Completed Features](#3-completed-features)
   - [3.1 Authentication & Accounts](#31-authentication--accounts)
   - [3.2 Organizations & Multi-Tenancy](#32-organizations--multi-tenancy)
   - [3.3 Project Management](#33-project-management)
   - [3.4 Codebase Browser](#34-codebase-browser)
   - [3.5 AI Code Review](#35-ai-code-review)
   - [3.6 Rule System](#36-rule-system)
   - [3.7 Integration Management](#37-integration-management)
   - [3.8 CI/CD Pipeline Engine](#38-cicd-pipeline-engine)
   - [3.9 Settings & Localization](#39-settings--localization)
   - [3.10 Artifact Registry & Deployment](#310-artifact-registry--deployment)
4. [Next Build Order](#4-next-build-order)
   - [P0 — Core Experience](#p0--core-experience)
   - [P1 — Product Completeness](#p1--product-completeness)
   - [P2 — Growth & Collaboration](#p2--growth--collaboration)
   - [P3 — Platform Scale](#p3--platform-scale)
5. [Release Phases](#5-release-phases)
6. [Technical Debt & Improvements](#6-technical-debt--improvements)

---

## 1. Product Overview

**Spec-Axis** is an AI-powered code review and automated CI/CD deployment platform designed for engineering teams.

### Core Value Proposition

| Problem | Solution |
|---------|----------|
| Manual code review is slow, inconsistent, and expensive | AI analyzes every commit with configurable rule sets — no human bottleneck |
| Code quality and deployment are disconnected | Pipeline quality gate blocks deployment if review score is too low |
| Tool sprawl across review, CI, and deploy tools | Single platform covering the full loop: commit → review → build → deploy |
| Secrets and integrations are hard to manage per team | Org-scoped encrypted integrations with project-level overrides |

### Target Users

- **Engineering teams** (5–200 engineers) running regular code reviews
- **Platform / DevOps teams** managing CI/CD pipelines across projects
- **Tech leads** who need quality gates and audit trails without manual review overhead

---

## 2. Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│                    apps/studio                       │
│        Next.js 16 · React 19 · TypeScript           │
│   UI · API Routes · Auth · DB Services · Webhooks   │
└────────────────────┬────────────────────────────────┘
                     │ HTTP (SCHEDULER_BASE_URL)
                     │ X-Scheduler-Token
┌────────────────────▼────────────────────────────────┐
│                    apps/scheduler                       │
│                  Go 1.24 Service                     │
│  Control Plane · Queue · Worker Dispatch · Storage  │
└──────────┬──────────────────────────┬───────────────┘
           │                          │
    ┌──────▼──────┐           ┌───────▼──────┐
    │  PostgreSQL  │           │    Redis      │
    │  (all data)  │           │ (Asynq queue) │
    └─────────────┘           └──────────────┘
                     WebSocket control channel
                               │
                     ┌─────────▼─────────┐
                     │    apps/worker    │
                     │ Execution Agent   │
                     │ Shell · Docker    │
                     └───────────────────┘
```

**Key design decisions:**
- Studio and Scheduler are separate services communicating over HTTP — Scheduler can be scaled independently
- Scheduler is the control plane; Worker agents execute pipeline jobs and stream step progress, logs, and artifacts back to Scheduler
- Integrations (VCS, AI) configured via web UI, stored encrypted in DB — no env var sprawl
- Stage-based pipeline builder with fixed core columns (`source`, `review`, `build`, `deploy`) and on-demand automation slots; runtime DAG is derived from stage order and dispatch mode

---

## 3. Completed Features

### 3.1 Authentication & Accounts

| Feature | Status | Notes |
|---------|--------|-------|
| Email + password registration | ✅ Done | With email verification (configurable) |
| Login with session cookie | ✅ Done | HTTP-only cookie, `auth_sessions` table |
| Email verification flow | ✅ Done | Resend support, configurable via `EMAIL_VERIFICATION_REQUIRED` |
| Forgot password / reset | ✅ Done | Token-based, expiring links |
| GitHub OAuth login | ✅ Done | Via `/auth/callback` |
| Session management UI | ✅ Done | View and revoke active sessions |
| Login rate limiting | ✅ Done | `auth_login_attempts` table |
| Audit logging | ✅ Done | Structured `audit_logs` table, all sensitive actions |

### 3.2 Organizations & Multi-Tenancy

| Feature | Status | Notes |
|---------|--------|-------|
| Personal org on signup | ✅ Done | Auto-created, cannot be deleted |
| Org roles: owner / admin / reviewer / member | ✅ Done | Role-gated UI actions and API routes |
| Member invitation by email | ✅ Done | Token link, expiry, accept flow at `/invite/[token]` |
| Remove members / change role | ✅ Done | Admin-only |
| Active org cookie switching | ✅ Done | `/o/:orgId/...` URL prefix, middleware-synced |
| Org-scoped asset isolation | ✅ Done | All projects, pipelines, rules, integrations are org-scoped |

### 3.3 Project Management

| Feature | Status | Notes |
|---------|--------|-------|
| Create / edit / delete projects | ✅ Done | Name, description, repo link, ruleset binding |
| Link GitHub repository | ✅ Done | Via org integration; validated against connected account |
| Ruleset binding per project | ✅ Done | Overrides org-default rules |
| Project statistics | ✅ Done | Report count, issue count, average score |
| Repository branch listing | ✅ Done | Live from VCS integration |
| Commit history browser | ✅ Done | Paginated, select commits to analyze |
| GitHub Webhook receiver | ✅ Done | `push` + `pull_request` events; `?project_id=` disambiguation |
| Initial mirror sync on create | ✅ Done | Background, non-blocking |

### 3.4 Codebase Browser

| Feature | Status | Notes |
|---------|--------|-------|
| Local Git mirror cache | ✅ Done | Per-project, synced on demand or via webhook |
| Directory tree navigation | ✅ Done | File tree with expand/collapse |
| File content preview | ✅ Done | CodeMirror read-only, syntax highlighting |
| Line-level comments | ✅ Done | Scoped by org, project, repo, commit SHA, path, line |
| Multi-line / selection comments | ✅ Done | `line_end` + `selection_text` fields |
| Comment assignees | ✅ Done | `codebase_comment_assignees` table |
| Manual sync trigger | ✅ Done | UI button + `POST /api/codebase/sync` |
| `sync=0` fast browse mode | ✅ Done | Skips mirror fetch, uses cached state |
| Stale workspace cleanup | ✅ Done | `POST /api/codebase/cleanup` |
| Max file preview size guard | ✅ Done | `CODEBASE_FILE_MAX_BYTES` |

### 3.5 AI Code Review

| Feature | Status | Notes |
|---------|--------|-------|
| Trigger analysis by commit SHA | ✅ Done | `POST /api/analyze`, returns `reportId` immediately |
| Incremental analysis | ✅ Done | Compares against previous report, analyzes only changed files |
| Any OpenAI API-format AI backend | ✅ Done | Claude, GPT-4, DeepSeek, etc. via integration config |
| Real-time status streaming | ✅ Done | SSE on `/api/reports/[id]/stream`, polling fallback at 2.5 s |
| Issue list with code location | ✅ Done | Category, severity, file path, line number |
| Issue status management | ✅ Done | `open / fixed / ignored / false_positive / planned` |
| Batch status update | ✅ Done | Select multiple issues, bulk-update |
| AI Chat on report | ✅ Done | Context-aware Q&A about the current report |
| Report export | ✅ Done | Downloadable report artifact |
| Quality score (0–100) | ✅ Done | Computed from issue severity and rule weights |
| Report comparison view | ✅ Done | Side-by-side diff between two reports |
| PR review write-back | ✅ Done | GitHub / GitLab comment summary after analysis completes |
| Historical score trend chart | ✅ Done | Line chart per project over time |
| PR auto-trigger via webhook | ✅ Done | `opened / reopened / synchronize` events |
| Saved filters | ✅ Done | Per-user, per-project filter presets |
| Notification settings | ✅ Done | `notification_settings` table; per-user email preferences for pipeline runs and report-ready events |

### 3.6 Rule System

| Feature | Status | Notes |
|---------|--------|-------|
| Rule set CRUD | ✅ Done | Name, description, org-scoped |
| Rule set template marketplace | ✅ Done | Built-in templates importable as a starting point |
| Individual rule config | ✅ Done | Category, name, AI prompt, severity level |
| Rule feedback | ✅ Done | Mark rules as helpful / noisy, stored in `quality_rule_feedback` |
| Rule learning statistics | ✅ Done | Trigger count, hit rate in `quality_rule_stats` |
| Rule weight adjustment | ✅ Done | Affects score computation via `quality_rule_weights` |
| AI-learned patterns | ✅ Done | `quality_learned_patterns` — auto-refined prompts from feedback |
| Admin-only rule management | ✅ Done | `owner / admin` roles required |

### 3.7 Integration Management

| Feature | Status | Notes |
|---------|--------|-------|
| VCS integrations | ✅ Done | GitHub, GitLab, Generic Git |
| AI integrations | ✅ Done | Any OpenAI API-format provider |
| Org-default + project-level override | ✅ Done | Priority: project-specific > org default |
| AES-256-GCM secret encryption | ✅ Done | Key via `ENCRYPTION_KEY`, stored in `vault_secret_name` |
| Connection test | ✅ Done | `POST /api/integrations/[id]/test` |
| Set default integration | ✅ Done | `POST /api/integrations/[id]/set-default` |
| Provider templates | ✅ Done | `GET /api/integrations/providers` — pre-filled forms per provider |
| First-time onboarding check | ✅ Done | Banner shown if no integration configured |

### 3.8 CI/CD Pipeline Engine

The pipeline system follows a stage-based model inspired by enterprise DevOps platforms (Alibaba Cloud DevOps, etc.):

```
Source Checkout → Code Review Gate → Build → Deploy
```

| Feature | Status | Notes |
|---------|--------|-------|
| Stage-based pipeline profile | ✅ Done | Replaces the old free-form DAG builder |
| 3-step creation wizard | ✅ Done | Basic Info → Configure Stages → Notifications |
| Source stage — git clone / pull | ✅ Done | Repo URL fetched from Studio API via `source_checkout` executor |
| Review stage — quality gate | ✅ Done | Fetches latest report score; blocks deploy if score < `minScore` |
| Build / Deploy — shell steps | ✅ Done | Custom scripts, step templates (Node.js, Python, Go) |
| Per-step timeout | ✅ Done | `timeoutSeconds` field per step and per job |
| Continue-on-error per step | ✅ Done | `continueOnError` flag |
| Environment variable injection | ✅ Done | Pipeline-level → job-level → step-level cascade |
| Encrypted env secrets | ✅ Done | Write-only secret manager backed by `pipeline_secrets`, AES-256-GCM encryption, multiline values, reserved system namespace protection, and runtime env injection |
| Pipeline-level environment tag | ✅ Done | `development / staging / production` |
| Auto-trigger on git push | ✅ Done | Branch matching; triggered from GitHub webhook |
| Manual trigger from UI | ✅ Done | "Run" button, `triggerType: "manual"` |
| Rollback trigger | ✅ Done | `triggerType: "rollback"`, `rollback_of` FK |
| Retry | ✅ Done | UI button re-triggers with same config |
| Run history list | ✅ Done | Status icon, trigger type, branch, timestamp, duration |
| Stage progress visualization | ✅ Done | 4-dot pipeline bar with labels |
| Real-time log viewer | ✅ Done | Dark terminal UI, polling at 2.5 s while running |
| Per-step log files | ✅ Done | Stored at `SCHEDULER_DATA_DIR/logs/{run_id}/{job}/{step}.log` |
| Concurrent job execution | ✅ Done | `PIPELINE_CONCURRENCY` config |
| Job DAG dependency resolution | ✅ Done | `needs` field, topological scheduling |
| Cancel pending jobs on failure | ✅ Done | Upstream failure cancels downstream queued jobs |
| Pipeline concurrency control | ✅ Done | `allow / queue / cancel_previous` modes |
| Log retention cleanup | ✅ Done | Configurable via `PIPELINE_LOG_RETENTION_DAYS` |
| Run output artifacts | ✅ Done | Shell steps upload matched files, retention cleanup preserves downloadability, and Studio can fetch/download per-run artifacts |
| Docker / container executor | ⬜ Planned | Currently shell-only |
| In-place config editor | ✅ Done | "Configure" tab in detail page |
| Notification on success / failure | ✅ Done | Scheduler posts pipeline/report events back to Studio; Studio sends email notifications with per-user preferences and pipeline-level channel gating |
| Cron / scheduled trigger | ✅ Done | `trigger_schedule` + `last_scheduled_at` + `next_scheduled_at` persisted on pipelines; scheduler scans and enqueues due runs |
| TOML config file for Scheduler | ✅ Done | `[scheduler]`, `[pipeline]`, `[studio]`, `[database]`, etc. |

### 3.9 Settings & Localization

| Feature | Status | Notes |
|---------|--------|-------|
| Security settings page | ✅ Done | Password change, session list |
| Organization management | ✅ Done | Members, invites, roles |
| Integration management | ✅ Done | VCS + AI providers |
| Language switcher | ✅ Done | English / Chinese, cookie-persisted |
| Full i18n coverage | ✅ Done | All UI strings in `en.json` / `zh.json` |

### 3.10 Artifact Registry & Deployment

| Feature | Status | Notes |
|---------|--------|-------|
| Project-scoped artifact repositories | ✅ Done | Immutable repositories live under each project and are separate from run outputs |
| Artifact publishing from pipeline runs | ✅ Done | Selected run outputs are promoted into versioned release artifacts |
| Artifact channels | ✅ Done | Channels point to immutable versions for deploy-time resolution |
| Artifact browser and download routes | ✅ Done | Studio exposes artifact pages and file download endpoints |
| Deploy-step artifact source selection | ✅ Done | Deploy steps can target same-run outputs or a published registry version/channel |
| Pull-based remote deployment | ✅ Done | Worker pulls immutable files from scheduler-backed storage during deployment |

---

## 4. Next Build Order

The roadmap below excludes capabilities already shipped in the current build, including the dashboard home page, rule set template marketplace, report comparison view, pipeline concurrency control, PR review write-back, and artifact registry/deployment.

### P0 — Core Experience

These are the most important remaining gaps for daily product use.

---

#### 4.3 Link Report Issues to Codebase Browser

**Why:** Issues in a report identify the file and line number, but there is no click-through to the Codebase Browser. Users have to navigate manually, which breaks review flow.

**Scope:**
- "View in Codebase" button on each issue card
- Opens Codebase Browser at the correct file + line, scoped to the analyzed commit SHA
- If the file no longer exists at HEAD, fall back gracefully

#### 4.4 External API Tokens

**Why:** Teams want to integrate Spec-Axis into GitHub Actions, Makefiles, and external automation without sharing user sessions.

**Scope:**
- API token management UI in Settings > Security
- Token scopes: `read` / `write` / `pipeline:trigger`
- Token used as Bearer in `Authorization` header
- `api_tokens` table with hashed storage
- Rate-limited separately from session-based requests

---

### P1 — Workflow Completeness

#### 4.5 GitLab Webhook Support

**Why:** The webhook receiver currently only handles GitHub events. Teams using GitLab cannot trigger analysis or pipeline runs automatically.

**Scope:**
- `POST /api/webhooks/gitlab` endpoint
- Verify `X-Gitlab-Token` header
- Handle `Push Hook` and `Merge Request Hook` events
- Mirror sync + auto-trigger pipelines on push
- Trigger analysis on MR open/update

---

#### 4.6 Team Discussion on Issues

**Why:** Teams need collaboration around false positives and remediation approaches without leaving the product.

**Scope:**
- Comment thread on each issue card
- @mention team members with in-app notification support
- Emoji reactions
- Mark comment as resolving the issue

---

### P2 — Platform Scale

#### 4.7 Org-Level Analytics Dashboard

**Why:** Engineering managers need cross-project visibility: which projects have degrading quality, which teams are resolving issues fastest.

**Scope:**
- Org dashboard page with:
  - Quality score heatmap across all projects
  - Issue resolution rate per team / project
  - Pipeline success rate and average duration
  - Top recurring issue categories
- Date range filter (last 7 / 30 / 90 days)
- CSV export

---

#### 4.8 Docker / Container Step Executor

**Why:** Shell steps require the host to have all build tools installed. A container executor isolates builds and allows any language without host configuration.

**Scope:**
- New `docker` step type in pipeline config
- Scheduler spawns Docker containers, mounts workspace, streams logs
- Image pull policy
- Resource limits for CPU and memory

---

#### 4.9 Multi-Scheduler Node Support

**Why:** A single Scheduler process becomes a bottleneck as pipeline volume grows.

**Scope:**
- Scheduler registration/heartbeat
- Studio-side load balancing: assign runs to available schedulers
- Scheduler health endpoint
- Graceful drain on shutdown
- Run-to-scheduler assignment visible in run detail

---

### P3 — Enterprise

#### 4.10 SSO / SAML Integration

**Why:** Enterprise customers require integration with their corporate identity providers.

**Scope:**
- SAML 2.0 SP-initiated flow
- OIDC / OAuth 2.0 generic provider support
- Auto-provision users on first SSO login
- Map IdP groups to org roles
- Org-level SSO enforcement

---

#### 4.11 Fine-Grained RBAC

**Why:** The current role model is coarse. Large teams need more control over pipeline, rule, and report actions.

**Scope:**
- Permission-based model replacing role-based checks in API routes
- Built-in permission sets that map to existing roles
- Custom role creation
- Permission matrix UI in Settings > Organizations

---

## 5. Release Phases

### Phase 1 — Stable MVP *(~6 weeks)*

Focus: close the remaining product gaps that block daily use.

```
🚧 To complete in Phase 1:
   ├── 4.3  Link Report Issues to Codebase Browser
   └── 4.4  External API Tokens
```

**Exit criteria:** An engineering team can onboard, run reviews and pipelines, and complete the core loop without leaving the product.

---

### Phase 2 — Product Complete *(~8 weeks)*

Focus: make the review and delivery workflow feel native and continuous.

```
🚧 To complete in Phase 2:
   ├── 4.5  GitLab Webhook Support
   └── 4.6  Team Discussion on Issues
```

**Exit criteria:** Spec-Axis can stay inside the developer workflow across Git providers and recurring pipeline use cases.

---

### Phase 3 — Growth *(~10 weeks)*

Focus: collaboration and management visibility.

```
🚧 To complete in Phase 3:
   ├── 4.7  Org-Level Analytics Dashboard
   ├── 4.8  Docker / Container Step Executor
   └── 4.9  Multi-Scheduler Node Support
```

**Exit criteria:** Multi-team organizations can use Spec-Axis as their shared code quality control plane.

---

### Phase 4 — Enterprise *(12+ weeks)*

Focus: scale, isolation, and enterprise security.

```
🚧 To complete in Phase 4:
   ├── 4.10  SSO / SAML Integration
   └── 4.11  Fine-Grained RBAC
```

**Exit criteria:** Spec-Axis can support large organizations with stricter security and scale requirements.

---

## 6. Technical Debt & Improvements

The following items are not user-facing features but should be addressed alongside feature development.

| Item | Priority | Notes |
|------|----------|-------|
| Remove duplicate report-detail clients | Medium | Keep single `ReportDetailClient.tsx` implementation |
| Remove `proxy.ts` (unused auth middleware) | Low | Already marked unused in CLAUDE.md |
| Pipeline `auto_trigger` webhook — multiple orgs same repo | Medium | Currently iterates all orgs, could be expensive at scale |
| Store `GetPipeline` / `ListPipelines` — add cursor pagination | Medium | Currently unbounded queries; will degrade with 1000+ pipelines |
| SSE report streaming — add heartbeat | Low | Clients can time out on slow analyses |
| Test coverage — Scheduler pipeline package | High | No unit tests for `engine.go`, `executor.go`, `types.go` |
| Test coverage — Studio API routes | High | No integration tests for critical routes |
| Dependency audit | Low | Review and approve any new `pnpm` build scripts in `.npmrc` |
