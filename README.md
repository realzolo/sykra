# spec-axis

AI-powered code review and CI/CD platform. It combines repository analysis, pipeline automation, and deploy workflows in a single self-hosted system.

## Core Capabilities

- AI code review with configurable rule sets, quality scoring, and issue tracking
- Stage-based CI/CD pipelines with Conductor-managed sandboxed CI jobs and remote deploy workers
- Codebase browsing with line-level comments and AI chat
- Rule template import for common stacks and security/performance checks
- Org-scoped dashboard, projects, reports, artifacts, and notification settings
- Multi-VCS support with GitHub, GitLab, and generic Git

## How It Runs

- `Studio` is the web app for configuration and observability
- `Conductor` is the control plane that orchestrates analysis and pipeline execution
- `Worker` is a deploy-only agent that receives prepared artifacts and performs deployment steps on target hosts

Conductor runs CI jobs inside sandboxed runner containers. Worker does not participate in CI build execution.

## Quick Start

### Requirements

- Node.js 20+ and pnpm
- Go 1.24+
- PostgreSQL 14+
- Docker available to Conductor for CI sandbox creation

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

### 5. Start the apps

```bash
# Terminal 1
pnpm dev

# Terminal 2
cd apps/conductor && go run .

# Terminal 3
cd apps/worker && WORKER_ID=deploy-worker-1 go run .
```

Open [http://localhost:8109](http://localhost:8109).

## Common Commands

```bash
pnpm dev
pnpm build
pnpm lint
cd apps/conductor && go run .
cd apps/worker && go run .
psql "$DATABASE_URL" -f docs/db/init.sql
```

## Deployment

- Studio and Conductor are self-hosted services and should be deployed with the same container-first workflow.
- Studio runs as a Next.js server image.
- Conductor runs as a Go service with access to the host Docker daemon so it can create CI runner containers.
- Worker is deploy-only and can run on a separate server.
- Keep PostgreSQL as the required external service and apply `docs/db/init.sql` plus migrations before deploying.

## Documentation

- [CLAUDE.md](./CLAUDE.md) for developer context, runtime contracts, and architecture notes
- [docs/db/init.sql](./docs/db/init.sql) for the full database schema
- [docs/db/migrations/](./docs/db/migrations/) for incremental schema changes
- [docs/README.md](./docs/README.md) for integration system documentation

## License

Proprietary. All rights reserved.
