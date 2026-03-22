# spec-axis

AI-powered code review and CI/CD pipeline platform. Connect GitHub/GitLab repositories, run Claude AI analysis against configurable rule sets, track quality scores over time, and automate builds and deploys with a native DAG job editor.

## Features

- **AI Code Review** — Submit commits for analysis. Issues are ranked by severity, scored 0–100, and tracked across reports.
- **Rule Set Template Marketplace** — Import pre-built rule sets for React, Go, Security (OWASP Top 10), Python, and Performance. Rules > Import Template.
- **Report Comparison** — Select any two reports and diff them side-by-side: new issues, resolved issues, persisting issues, score delta.
- **CI/CD Pipelines** — DAG-based pipeline engine (`trigger + jobs + notifications`) with interactive DAG overview (drag to add dependency edges, click edges to remove), Shell and Docker step types, per-step timeouts, artifact handoff, and concurrency modes (Allow / Queue / Cancel Previous).
- **Notification Settings** — Email notifications on complete, on critical issues, and score threshold. Settings > Notifications.
- **Dashboard Overview** — Pipeline success rate, per-project quality scores, quick actions, and recent activity on the org home page.
- **Multi-VCS & AI** — GitHub, GitLab, Generic Git; Claude, GPT-4, DeepSeek, and other OpenAI API-format models.
- **Multi-Tenant** — Org-scoped resources with role-based access (owner / admin / reviewer / member).
- **Codebase Browser** — Browse Git mirrors with line-level comments and AI chat.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router, Turbopack) + React 19 + TypeScript |
| UI | Tailwind CSS v4 + Geist font |
| AI | Anthropic Claude SDK (supports custom `ANTHROPIC_BASE_URL`) |
| Database | PostgreSQL 14+ |
| Coordination | PostgreSQL-backed polling |
| Conductor (Control Plane) | Go 1.24 |
| Auth | Session cookies + email verification |

## Monorepo Layout

```
apps/
  studio/     Next.js web app (port 8109 in dev)
  conductor/  Go Conductor service (port 8200 in dev)
  worker/     Go deploy worker (remote deployment executor)
docs/
  db/         init.sql schema + incremental migrations
```

## Quick Start

### Prerequisites

- Node.js 20+, pnpm
- Go 1.24+
- PostgreSQL 14+

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure Studio

Create `apps/studio/.env`:

```env
DATABASE_URL=postgres://user:pass@localhost/specaxis
ENCRYPTION_KEY=<64-char hex>          # openssl rand -hex 32
CONDUCTOR_BASE_URL=http://localhost:8200
CONDUCTOR_TOKEN=dev-conductor
EMAIL_PROVIDER=console
EMAIL_VERIFICATION_REQUIRED=false
```

### 3. Initialize the database

```bash
psql "$DATABASE_URL" -f docs/db/init.sql
# Incremental migrations:
# Apply the numbered files in docs/db/migrations/ in order.
```

### 4. Configure Conductor

Create `apps/conductor/config.toml`:

```toml
[conductor]
port = "8200"
token = "dev-conductor"

[database]
url = "postgres://user:pass@localhost/specaxis"

[security]
encryption_key = "<same key as Studio>"

[studio]
url = "http://localhost:8109"
token = "dev-conductor"
```

### 5. Start

```bash
# Terminal 1
pnpm dev

# Terminal 2
cd apps/conductor && go run .

# Terminal 3 (remote deploy worker)
cd apps/worker && WORKER_ID=deploy-worker-1 go run .
```

Open [http://localhost:8109](http://localhost:8109).

## Common Commands

```bash
pnpm dev                                  # Studio dev server
pnpm build                                # Production build + TypeScript check
pnpm lint                                 # ESLint
cd apps/conductor && GOMODCACHE=../../.cache/go/mod GOCACHE=../../.cache/go/build go build ./...  # Build Conductor
cd apps/worker && GOMODCACHE=../../.cache/go/mod GOCACHE=../../.cache/go/build go build ./...  # Build worker
cd apps/conductor && go run .                # Start Conductor
cd apps/worker && go run .                    # Start deploy worker
psql "$DATABASE_URL" -f docs/db/init.sql  # Reset schema
```

Local caches are standardized under repository root `/.cache/` (for example `/.cache/go/mod/`, `/.cache/go/build/`, `/.cache/pnpm/store/`, `/.cache/codebase/`) and are ignored by Git.

## Pipeline Execution Types

| Type | Config | Behavior |
|------|--------|----------|
| `shell` (default) | — | Runs script via `/bin/sh -c` |
| `docker` | `dockerImage: "node:22-alpine"` | `docker run --rm -w /workspace -v {workingDir}:/workspace {image} /bin/sh -c "{script}"` |

Set step type in pipeline job steps (Shell/Docker).

## Pipeline Execution Model

| Executor | Responsibility | Typical Location |
|----------|----------------|------------------|
| `Conductor` | Create CI runner containers, execute checkout/review/build inside the sandbox, publish artifacts | Same server as Studio or same private network |
| `Worker` | Pull artifacts from Conductor and deploy to target environment | Remote server / target environment |

Conductor is the only CI executor. Every pipeline must define a top-level `buildImage`; Conductor uses that image to create a fresh per-job runner container for every `source`, `review`, and `build` job, then runs all steps in that job via `docker exec` inside the same sandbox so workspace state persists across steps. Worker is deploy-only; it connects to Conductor over WebSocket, downloads prepared artifacts, and executes deployment steps remotely. Workers that advertise the `docker` capability probe the Docker daemon at startup and fail fast if it is unavailable.

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
| `ENCRYPTION_KEY` | AES-256-GCM key (32 bytes hex) — same value for Studio and Conductor |
| `CONDUCTOR_BASE_URL` | Conductor HTTP base URL |
| `CONDUCTOR_TOKEN` | Shared auth token (Studio → Conductor) |
| `EMAIL_PROVIDER` | `console` or `resend` |
| `EMAIL_VERIFICATION_REQUIRED` | `true` or `false` |

Conductor also needs `STUDIO_URL` and `STUDIO_TOKEN`, and it now fails fast at startup if Docker is unavailable. See [CLAUDE.md](./CLAUDE.md) for the full list.

Worker is deploy-only and no longer uses `WORKER_ROLE`. See [CLAUDE.md](./CLAUDE.md) for the full worker env matrix.

## Deployment

- Studio and Conductor should be deployed with the same container-first workflow on your own infrastructure.
- Studio runs as a Next.js server image, Conductor runs as a Go service image, and both sit behind a reverse proxy such as nginx, Traefik, or Caddy.
- Conductor itself must run with access to the host Docker daemon (for example by mounting `/var/run/docker.sock`) so CI runner containers can be created and destroyed per job.
- The pipeline `buildImage` must already contain the toolchain your project needs. CI stages no longer support step-level `docker` mode; `source`, `review`, and `build` all run inside the job sandbox image.
- Keep Postgres as the required external service, and apply `docs/db/init.sql` plus all migrations before deploying.

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](./CLAUDE.md) | Developer guide: routing, components, env vars, API contracts, i18n |
| [docs/db/init.sql](./docs/db/init.sql) | Full database schema |
| [docs/db/migrations/](./docs/db/migrations/) | Incremental schema migrations |
| [docs/README.md](./docs/README.md) | Integration system documentation |

## License

Proprietary. All rights reserved.
