# spec-axis

AI-powered code review and CI/CD pipeline platform. Connect GitHub/GitLab repositories, run Claude AI analysis against configurable rule sets, track quality scores over time, and automate builds and deploys with a drag-and-drop pipeline builder.

## Features

- **AI Code Review** — Submit commits for analysis. Issues are ranked by severity, scored 0–100, and tracked across reports.
- **Rule Set Template Marketplace** — Import pre-built rule sets for React, Go, Security (OWASP Top 10), Python, and Performance. Rules > Import Template.
- **Report Comparison** — Select any two reports and diff them side-by-side: new issues, resolved issues, persisting issues, score delta.
- **CI/CD Pipelines** — Four-stage DAG builder (Source → Review → Build → Deploy). Shell and Docker step types, per-step timeouts, secrets injection, concurrency modes (Allow / Queue / Cancel Previous).
- **Notification Settings** — Email notifications on complete, on critical issues, and score threshold. Settings > Notifications.
- **Dashboard Overview** — Pipeline success rate, per-project quality scores, quick actions, and recent activity on the org home page.
- **Multi-VCS & AI** — GitHub, GitLab, Generic Git; Claude, GPT-4, DeepSeek, and other OpenAI-compatible models.
- **Multi-Tenant** — Org-scoped resources with role-based access (owner / admin / reviewer / member).
- **Codebase Browser** — Browse Git mirrors with line-level comments and AI chat.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router, Turbopack) + React 19 + TypeScript |
| UI | HeroUI v3 (beta) + Tailwind CSS v4 + Geist font |
| AI | Anthropic Claude SDK (supports custom `ANTHROPIC_BASE_URL`) |
| Database | PostgreSQL 14+ |
| Queue | Redis + Asynq |
| Runner | Go 1.24 |
| Auth | Session cookies + email verification |

## Monorepo Layout

```
apps/
  studio/     Next.js web app (port 8109 in dev)
  runner/     Go runner service (port 8200 in dev)
docs/
  db/         init.sql schema + incremental migrations
```

## Quick Start

### Prerequisites

- Node.js 20+, pnpm
- Go 1.24+
- PostgreSQL 14+
- Redis

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure Studio

Create `apps/studio/.env`:

```env
DATABASE_URL=postgres://user:pass@localhost/specaxis
ENCRYPTION_KEY=<64-char hex>          # openssl rand -hex 32
RUNNER_BASE_URL=http://localhost:8200
RUNNER_TOKEN=dev-runner
EMAIL_PROVIDER=console
EMAIL_VERIFICATION_REQUIRED=false
```

### 3. Initialize the database

```bash
psql "$DATABASE_URL" -f docs/db/init.sql
# Incremental migrations:
psql "$DATABASE_URL" -f docs/db/migrations/add_concurrency_mode.sql
```

### 4. Configure the Runner

Create `apps/runner/config.toml`:

```toml
[runner]
port = "8200"
token = "dev-runner"

[database]
url = "postgres://user:pass@localhost/specaxis"

[redis]
url = "redis://localhost:6379"

[security]
encryption_key = "<same key as Studio>"

[studio]
url = "http://localhost:8109"
token = "dev-runner"
```

### 5. Start

```bash
# Terminal 1
pnpm dev

# Terminal 2
cd apps/runner && go run ./cmd/runner
```

Open [http://localhost:8109](http://localhost:8109).

## Common Commands

```bash
pnpm dev                                  # Studio dev server
pnpm build                                # Production build + TypeScript check
pnpm lint                                 # ESLint
cd apps/runner && go build ./...          # Build runner
cd apps/runner && go run ./cmd/runner     # Start runner
psql "$DATABASE_URL" -f docs/db/init.sql  # Reset schema
```

## Pipeline Step Types

| Type | Config | Behavior |
|------|--------|----------|
| `shell` (default) | — | Runs script via `/bin/sh -c` |
| `docker` | `dockerImage: "node:22-alpine"` | `docker run --rm -w /workspace -v {workingDir}:/workspace {image} /bin/sh -c "{script}"` |

Set step type in the pipeline editor (Build / Deploy tab > step > Step Type).

## Pipeline Concurrency Modes

| Mode | Behavior |
|------|----------|
| `allow` | Multiple runs run simultaneously (default) |
| `queue` | New trigger rejected with HTTP 409 while a run is active |
| `cancel_previous` | Active runs cancelled before new run starts |

Configure per-pipeline in the pipeline settings tab. Requires the `add_concurrency_mode.sql` migration.

## Rule Template Marketplace

| Template | Rules |
|----------|-------|
| React Best Practices | 6 — hooks, keys, useEffect deps, a11y, performance |
| Go Best Practices | 6 — error handling, goroutine leaks, context, mutex |
| Security (OWASP Top 10) | 7 — SQL injection, XSS, secrets, auth, path traversal |
| Python Best Practices | 5 — type hints, bare except, mutable defaults, resources |
| Performance | 6 — N+1 queries, memory leaks, blocking I/O, caching |

Import via **Rules > Import Template** (admin only).

## Report Comparison

1. Go to a project's Reports tab.
2. Click the checkbox on two report rows (max 2).
3. Click **Compare** in the header.

Issues are matched by `file + rule + category`. The diff shows new (red), resolved (green), and persisting issues with a score delta badge.

## Environment Variables

VCS and AI integrations are configured in the web UI (Settings > Integrations), not via env vars.

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Studio Postgres connection string |
| `ENCRYPTION_KEY` | AES-256-GCM key (32 bytes hex) — same value for Studio and Runner |
| `RUNNER_BASE_URL` | Runner HTTP base URL |
| `RUNNER_TOKEN` | Shared auth token (Studio → Runner) |
| `EMAIL_PROVIDER` | `console` or `resend` |
| `EMAIL_VERIFICATION_REQUIRED` | `true` or `false` |

Runner also needs `REDIS_URL`, `STUDIO_URL`, `STUDIO_TOKEN`. See [CLAUDE.md](./CLAUDE.md) for the full list.

## Deployment

- Studio deploys to Vercel. The `/api/analyze` route is configured for a 300s timeout in `vercel.json`.
- Runner runs as a standalone Go binary on any server with access to Postgres and Redis.
- Apply `docs/db/init.sql` and all migration files in `docs/db/migrations/` before deploying.

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](./CLAUDE.md) | Developer guide: routing, components, env vars, API contracts, i18n, HeroUI v3 patterns |
| [docs/db/init.sql](./docs/db/init.sql) | Full database schema |
| [docs/db/migrations/](./docs/db/migrations/) | Incremental schema migrations |
| [docs/README.md](./docs/README.md) | Integration system documentation |

## License

Proprietary. All rights reserved.
