# Spec-Axis Product Roadmap

> **Last updated:** 2026-03-17

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
4. [Planned Features](#4-planned-features)
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
                     │ HTTP (RUNNER_BASE_URL)
                     │ X-Runner-Token
┌────────────────────▼────────────────────────────────┐
│                    apps/runner                       │
│                  Go 1.24 Service                     │
│   Pipeline Engine · Step Executors · Log Storage     │
└──────────┬──────────────────────────┬───────────────┘
           │                          │
    ┌──────▼──────┐           ┌───────▼──────┐
    │  PostgreSQL  │           │    Redis      │
    │  (all data)  │           │ (Asynq queue) │
    └─────────────┘           └──────────────┘
```

**Key design decisions:**
- Studio and Runner are separate services communicating over HTTP — Runner can be scaled independently
- All pipeline execution happens in Runner; Studio is the management UI + API proxy
- Integrations (VCS, AI) configured via web UI, stored encrypted in DB — no env var sprawl
- Four-stage pipeline model (Source → Review → Build → Deploy) maps directly to internal job DAG at runtime

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
| Any OpenAI-compatible AI backend | ✅ Done | Claude, GPT-4, DeepSeek, etc. via integration config |
| Real-time status streaming | ✅ Done | SSE on `/api/reports/[id]/stream`, polling fallback at 2.5 s |
| Issue list with code location | ✅ Done | Category, severity, file path, line number |
| Issue status management | ✅ Done | `open / fixed / ignored / false_positive / planned` |
| Batch status update | ✅ Done | Select multiple issues, bulk-update |
| AI Chat on report | ✅ Done | Context-aware Q&A about the current report |
| Report export | ✅ Done | Downloadable report artifact |
| Quality score (0–100) | ✅ Done | Computed from issue severity and rule weights |
| Historical score trend chart | ✅ Done | Line chart per project over time |
| PR auto-trigger via webhook | ✅ Done | `opened / reopened / synchronize` events |
| Saved filters | ✅ Done | Per-user, per-project filter presets |
| Notification settings | ✅ Done | `notification_settings` table; per-user toggles |

### 3.6 Rule System

| Feature | Status | Notes |
|---------|--------|-------|
| Rule set CRUD | ✅ Done | Name, description, org-scoped |
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
| AI integrations | ✅ Done | Any OpenAI-compatible API |
| Org-default + project-level override | ✅ Done | Priority: project-specific > org default |
| AES-256-GCM secret encryption | ✅ Done | Key via `ENCRYPTION_KEY`, stored in `vault_secret_name` |
| Connection test | ✅ Done | `POST /api/integrations/[id]/test` |
| Set default integration | ✅ Done | `POST /api/integrations/[id]/set-default` |
| Provider templates | ✅ Done | `GET /api/integrations/providers` — pre-filled forms per provider |
| First-time onboarding check | ✅ Done | Banner shown if no integration configured |

### 3.8 CI/CD Pipeline Engine

The pipeline system follows a fixed four-stage model inspired by enterprise DevOps platforms (Alibaba Cloud DevOps, etc.):

```
Source Checkout → Code Review Gate → Build → Deploy
```

| Feature | Status | Notes |
|---------|--------|-------|
| Fixed four-stage model | ✅ Done | Replaces the old free-form DAG builder |
| 3-step creation wizard | ✅ Done | Basic Info → Configure Stages → Notifications |
| Source stage — git clone / pull | ✅ Done | Repo URL fetched from Studio API via `source_checkout` executor |
| Review stage — quality gate | ✅ Done | Fetches latest report score; blocks deploy if score < `minScore` |
| Build / Deploy — shell steps | ✅ Done | Custom scripts, step templates (Node.js, Python, Go) |
| Per-step timeout | ✅ Done | `timeoutSeconds` field per step and per job |
| Continue-on-error per step | ✅ Done | `continueOnError` flag |
| Environment variable injection | ✅ Done | Pipeline-level → job-level → step-level cascade |
| Encrypted env secrets | ⬜ Planned | Currently env vars are stored as plain text in config |
| Pipeline-level environment tag | ✅ Done | `development / staging / production` |
| Auto-trigger on git push | ✅ Done | Branch matching; triggered from GitHub webhook |
| Cron / scheduled trigger | ⬜ Planned | — |
| Manual trigger from UI | ✅ Done | "Run" button, `triggerType: "manual"` |
| Rollback trigger | ✅ Done | `triggerType: "rollback"`, `rollback_of` FK |
| Retry | ✅ Done | UI button re-triggers with same config |
| Run history list | ✅ Done | Status icon, trigger type, branch, timestamp, duration |
| Stage progress visualization | ✅ Done | 4-dot pipeline bar with labels |
| Real-time log viewer | ✅ Done | Dark terminal UI, polling at 2.5 s while running |
| Per-step log files | ✅ Done | Stored at `RUNNER_DATA_DIR/logs/{run_id}/{job}/{step}.log` |
| Concurrent job execution | ✅ Done | `PIPELINE_CONCURRENCY` config |
| Job DAG dependency resolution | ✅ Done | `needs` field, topological scheduling |
| Cancel pending jobs on failure | ✅ Done | Upstream failure cancels downstream queued jobs |
| Log retention cleanup | ✅ Done | Configurable via `PIPELINE_LOG_RETENTION_DAYS` |
| Artifact storage (reserved) | ⬜ Planned | Schema exists (`pipeline_artifacts`), executor not implemented |
| Docker / container executor | ⬜ Planned | Currently shell-only |
| In-place config editor | ✅ Done | "Configure" tab in detail page |
| Notification on success / failure | ⬜ Planned | Fields exist (`notify_on_success/failure`), email not wired |
| TOML config file for Runner | ✅ Done | `[runner]`, `[pipeline]`, `[studio]`, `[database]`, etc. |

### 3.9 Settings & Localization

| Feature | Status | Notes |
|---------|--------|-------|
| Security settings page | ✅ Done | Password change, session list |
| Organization management | ✅ Done | Members, invites, roles |
| Integration management | ✅ Done | VCS + AI providers |
| Language switcher | ✅ Done | English / Chinese, cookie-persisted |
| Full i18n coverage | ✅ Done | All UI strings in `en.json` / `zh.json` |

---

## 4. Planned Features

### P0 — Core Experience

These are the most critical gaps that affect the daily usability of the product.

#### 4.1 Notification System

**Why:** The `notify_on_success` and `notify_on_failure` fields on pipelines already exist in the DB and config schema, but the actual delivery mechanism is not implemented. Users have no way to know when a run finishes without watching the UI.

**Scope:**
- Email notification on pipeline run completion (success / failure)
- Email notification when a code review report is ready
- Configurable per-pipeline and per-user
- Unsubscribe / preference center in Settings

**Implementation notes:**
- Add an email service abstraction (SMTP / SendGrid / Resend)
- Trigger from Runner on `run.completed` / `run.failed` events
- Respect `notify_on_success` / `notify_on_failure` flags already on the `pipelines` table

---

#### 4.2 Dashboard Home Page

**Why:** The current home page immediately redirects to the projects list. There is no high-level overview for a user returning to the product.

**Scope:**
- Summary cards: total projects, open issues, pipelines running, avg quality score
- Recent activity feed: last 10 reports, last 5 pipeline runs
- Quality trend sparklines across all projects
- Quick actions: "Analyze latest commit", "Trigger pipeline"

**Implementation notes:**
- Extend `GET /api/stats` (already exists) to return org-level aggregates
- New dashboard page at `(dashboard)/page.tsx`

---

#### 4.3 Pipeline Encrypted Environment Variables (Secrets)

**Why:** Build and deploy steps often require tokens, passwords, and API keys. Storing them in plain text in the pipeline config is a security risk.

**Scope:**
- Secrets UI in pipeline Configure tab — key/value pairs, values are write-only (masked after save)
- Secrets stored encrypted (reuse existing AES-256-GCM infrastructure)
- Referenced in step scripts as `$SECRET_NAME`
- Separate `pipeline_secrets` table or extend `vault_secret_name` pattern

---

#### 4.4 Link Report Issues to Codebase Browser

**Why:** Issues in a report identify the file and line number, but there is no click-through to the Codebase Browser. Users manually navigate — a poor UX.

**Scope:**
- "View in Codebase" button on each issue card
- Opens Codebase Browser at the correct file + line, scoped to the analyzed commit SHA
- If the file no longer exists at HEAD, fall back gracefully

---

### P1 — Product Completeness

#### 4.5 PR Review Result Write-Back

**Why:** The AI analysis is triggered by GitHub PRs, but results stay inside Spec-Axis. Developers want to see the score and issues as GitHub PR comments — they shouldn't need to leave their workflow.

**Scope:**
- Post a PR comment on GitHub / GitLab with:
  - Quality score badge
  - Top 5 issues summary
  - Link to full report
- Update comment on re-analysis (instead of posting a new one)
- Configurable: on/off per project

**Implementation notes:**
- Extend `review_runs` table with `comment_id` (to enable update vs. create)
- GitHub API: `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`
- GitLab API: `POST /projects/{id}/merge_requests/{iid}/notes`

---

#### 4.6 Scheduled Pipeline Triggers (Cron)

**Why:** Many teams want nightly builds or weekly security scans without relying on a git push.

**Scope:**
- Cron expression input in pipeline configuration (e.g., `0 2 * * *` = 2 AM daily)
- Next scheduled run time displayed in list and detail pages
- Stored as `trigger_schedule` on the `pipelines` table
- Runner or Studio cron scheduler evaluates and enqueues runs

---

#### 4.7 Concurrent Run Mutex / Queue

**Why:** If a webhook fires twice quickly (force push, double event), two runs can start simultaneously for the same pipeline, wasting resources and producing inconsistent artifacts.

**Scope:**
- Per-pipeline: `concurrency_mode` = `allow / queue / cancel_previous`
- `queue`: new run waits until previous completes
- `cancel_previous`: new run immediately cancels the in-flight one
- Displayed as a badge ("Waiting" / "Canceling") in run list

---

#### 4.8 Rule Set Template Marketplace

**Why:** New users struggle to write effective AI prompts for code review rules from scratch. Pre-built templates dramatically lower the onboarding barrier.

**Scope:**
- Built-in template library: React, Next.js, Go, Python, Java, Security (OWASP Top 10), Performance
- "Import from template" button on the Rule Set page
- Templates importable as a starting point (editable after import)
- Stored as seed data in `init.sql` or loaded from a bundled JSON file

---

#### 4.9 Report Comparison View

**Why:** Teams want to see concrete improvement between two reports (e.g., before and after a sprint). Currently reports can only be viewed individually.

**Scope:**
- "Compare" button on the report list: select two reports
- Side-by-side diff: new issues, resolved issues, score delta
- Issue status changes highlighted (e.g., `open → fixed`)
- Shareable comparison URL

---

### P2 — Growth & Collaboration

#### 4.10 GitLab Webhook Support

**Why:** The webhook receiver currently only handles GitHub events. Teams using GitLab cannot trigger analysis or pipeline runs automatically.

**Scope:**
- `POST /api/webhooks/gitlab` endpoint
- Verify `X-Gitlab-Token` header
- Handle `Push Hook` and `Merge Request Hook` events
- Mirror sync + auto-trigger pipelines on push (same logic as GitHub)
- Trigger analysis on MR open/update

---

#### 4.11 External API Tokens

**Why:** Teams want to integrate Spec-Axis into their existing CI/CD workflows (e.g., call the analysis API from a GitHub Actions step, or trigger a pipeline from a Makefile).

**Scope:**
- API token management UI in Settings > Security
- Token scopes: `read` / `write` / `pipeline:trigger`
- Token used as Bearer in `Authorization` header
- `api_tokens` table; hashed storage (never returned after creation)
- Rate-limited separately from session-based requests

---

#### 4.12 Org-Level Analytics Dashboard

**Why:** Engineering managers need cross-project visibility: which projects have degrading quality, which teams are resolving issues fastest.

**Scope:**
- Org dashboard page with:
  - Quality score heatmap across all projects
  - Issue resolution rate per team / project
  - Pipeline success rate and avg duration
  - Top recurring issue categories
- Date range filter (last 7 / 30 / 90 days)
- CSV export

---

#### 4.13 Team Discussion on Issues

**Why:** The `analysis_issue_comments` table exists in the schema but the UI for collaborative discussion threads on issues is not implemented. Teams want to discuss false positives and remediation approaches without leaving the tool.

**Scope:**
- Comment thread on each issue card (expand/collapse)
- @mention team members (triggers in-app notification)
- Emoji reactions
- Mark comment as "resolves issue" (changes status to `ignored` or `fixed`)

---

### P3 — Platform Scale

#### 4.14 Artifact Management

**Why:** The `pipeline_artifacts` table and `LocalStorage` abstraction already exist in the Runner, but no executor produces or serves artifacts. Build outputs (binaries, Docker images, test results) need to be stored and downloadable.

**Scope:**
- Artifact upload from shell steps via a sidecar or runner API endpoint
- Artifact list in the run detail page (file name, size, download link)
- Configurable retention (`PIPELINE_ARTIFACT_RETENTION_DAYS`)
- Optional S3-compatible remote storage backend

---

#### 4.15 Docker / Container Step Executor

**Why:** Shell steps require the host to have all build tools installed (Node.js, Go, Python, etc.). A container executor isolates builds and allows any language without host configuration.

**Scope:**
- New `docker` step type in pipeline config:
  ```yaml
  - id: build
    type: docker
    image: node:22-alpine
    script: npm ci && npm run build
  ```
- Runner spawns Docker container, mounts workspace, streams logs
- Image pull policy (always / if-not-present)
- Resource limits (CPU, memory)

---

#### 4.16 Multi-Runner Node Support

**Why:** A single Runner process becomes a bottleneck as pipeline volume grows. The architecture should support horizontal scaling.

**Scope:**
- Runner registration/heartbeat (`runner_nodes` table)
- Studio-side load balancing: assign runs to available runners
- Runner health endpoint (`GET /v1/health`)
- Graceful drain on shutdown (finish in-flight, reject new)
- Run-to-runner assignment visible in run detail

---

#### 4.17 SSO / SAML Integration

**Why:** Enterprise customers require integration with their corporate identity providers (Okta, Azure AD, Google Workspace).

**Scope:**
- SAML 2.0 SP-initiated flow
- OIDC / OAuth 2.0 generic provider support
- Auto-provision users on first SSO login
- Map IdP groups to org roles
- Org-level SSO enforcement (block password login when SSO is configured)

---

#### 4.18 Fine-Grained RBAC

**Why:** The current role model (`owner / admin / reviewer / member`) is coarse. Large teams need more control — e.g., a user who can trigger pipelines but not edit rules, or view reports but not export them.

**Scope:**
- Permission-based model replacing role-based checks in API routes
- Built-in permission sets that map to existing roles (backwards compatible)
- Custom role creation (admin-only)
- Permission matrix UI in Settings > Organizations

---

## 5. Release Phases

### Phase 1 — Stable MVP *(~6 weeks)*

Focus: make the product reliable and usable for early adopters.

```
✅ Already done:
   Auth · Orgs · Projects · AI Code Review · Rule System
   Integrations · Pipeline Engine (4-stage) · Codebase Browser

🚧 To complete in Phase 1:
   ├── 4.1  Notification System (email)
   ├── 4.2  Dashboard Home Page
   ├── 4.3  Pipeline Encrypted Secrets
   └── 4.4  Link Report Issues to Codebase Browser
```

**Exit criteria:** An engineering team can onboard, run their first AI review, set up a pipeline, and receive email alerts — end to end, without leaving the product.

---

### Phase 2 — Product Complete *(~8 weeks)*

Focus: close the remaining workflow gaps and drive retention.

```
🚧 To complete in Phase 2:
   ├── 4.5  PR Review Write-Back (GitHub + GitLab)
   ├── 4.6  Scheduled Pipeline Triggers (Cron)
   ├── 4.7  Concurrent Run Mutex / Queue
   ├── 4.8  Rule Set Template Marketplace
   └── 4.9  Report Comparison View
```

**Exit criteria:** The product covers the full code review + deploy lifecycle with no manual workarounds.

---

### Phase 3 — Growth *(~10 weeks)*

Focus: expand reach and enable team-scale usage.

```
🚧 To complete in Phase 3:
   ├── 4.10  GitLab Webhook Support
   ├── 4.11  External API Tokens
   ├── 4.12  Org-Level Analytics Dashboard
   └── 4.13  Team Discussion on Issues
```

**Exit criteria:** Multi-team organizations can use Spec-Axis as their primary code quality + delivery control plane.

---

### Phase 4 — Enterprise *(12+ weeks)*

Focus: enterprise features, scale, and compliance.

```
🚧 To complete in Phase 4:
   ├── 4.14  Artifact Management
   ├── 4.15  Docker / Container Step Executor
   ├── 4.16  Multi-Runner Node Support
   ├── 4.17  SSO / SAML Integration
   └── 4.18  Fine-Grained RBAC
```

**Exit criteria:** Spec-Axis can be deployed on-premises by enterprise customers with hundreds of engineers.

---

## 6. Technical Debt & Improvements

The following items are not user-facing features but should be addressed alongside feature development.

| Item | Priority | Notes |
|------|----------|-------|
| Remove `ReportDetailClient.tsx` (legacy) | Medium | `EnhancedReportDetailClient` is the current version |
| Remove `proxy.ts` (unused legacy auth middleware) | Low | Already marked unused in CLAUDE.md |
| Runner `collectArtifacts` stub | Low | Kept as placeholder; remove or implement in Phase 4 |
| Pipeline `auto_trigger` webhook — multiple orgs same repo | Medium | Currently iterates all orgs, could be expensive at scale |
| Store `GetPipeline` / `ListPipelines` — add cursor pagination | Medium | Currently unbounded queries; will degrade with 1000+ pipelines |
| SSE report streaming — add heartbeat | Low | Clients can time out on slow analyses |
| Test coverage — Runner pipeline package | High | No unit tests for `engine.go`, `executor.go`, `types.go` |
| Test coverage — Studio API routes | High | No integration tests for critical routes |
| Dependency audit | Low | Review and approve any new `pnpm` build scripts in `.npmrc` |
