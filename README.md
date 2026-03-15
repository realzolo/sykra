# spec-axis

An AI-powered code review + CI/CD pipeline platform built with Next.js 16 + React 19 + TypeScript. It integrates GitHub/GitLab repository management, commit-based analysis, configurable AI models (Claude, GPT-4, etc.), custom rule sets, quality scoring, and a drag-and-drop pipeline DAG builder. The UI follows a Supabase Dashboard-style white theme using HeroUI v3 (beta) and Tailwind CSS v4. The backend runs analysis and pipeline jobs in a Go runner via a Redis-backed queue and streams updates via SSE (NATS optional). The repo is a monorepo with `apps/studio` (Next.js console) and `apps/runner` (Go runner).

## ✨ Features

- **Multi-VCS Support**: GitHub, GitLab, and generic Git repositories
- **AI-Powered Analysis**: Claude, GPT-4, DeepSeek, and other OpenAI-compatible models
- **Smart Task Queue**: Go runner with Redis-backed queue and SSE updates (NATS optional)
- **Configurable Rule Sets**: Custom code quality rules per project
- **Quality Scoring**: Detailed reports with severity-based metrics
- **Pipeline DAG Builder**: Drag-and-drop jobs, stages, and shell steps
- **Local Logs & Artifacts**: Run logs and artifacts stored on the runner node
- **Multi-Tenant**: Complete user isolation with secure integration storage
- **Modern UI**: Supabase Dashboard-style interface with HeroUI v3 components

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Supabase project
- Go 1.22 (runner)
- golang-migrate (DB migrations)
- Redis (queue)
- NATS (optional, report status events)

### Installation

1. **Clone and install dependencies**:
```bash
git clone <your-repo-url>
cd spec-axis
pnpm install
```

2. **Setup environment variables**:
```bash
cp apps/studio/.env.example apps/studio/.env
```

Edit `apps/studio/.env` and add your Supabase credentials:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ENCRYPTION_KEY=<generated-key>  # See encryption setup below
RUNNER_BASE_URL=http://localhost:8200
RUNNER_TOKEN=your_runner_token
```

3. **Generate encryption key** (required for secure storage):
```bash
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

Add the output to your `apps/studio/.env` file.

4. **Setup runner environment**:
```bash
cp apps/runner/.env.example apps/runner/.env
```

Edit `apps/runner/.env` and add:
```bash
DATABASE_URL=postgres://...
REDIS_URL=redis://...
RUNNER_TOKEN=your_runner_token
ENCRYPTION_KEY=<same as studio>
PIPELINE_QUEUE=pipelines
PIPELINE_CONCURRENCY=4
PIPELINE_RUN_TIMEOUT=2h
RUNNER_DATA_DIR=data
PIPELINE_LOG_RETENTION_DAYS=30
PIPELINE_ARTIFACT_RETENTION_DAYS=30
```

5. **Run database migrations**:

Core schema (Supabase SQL editor, run in order):
```sql
-- Run these in sequence from supabase/migrations/
001_initial_schema.sql
002_enhanced_analysis.sql
003_learning_engine.sql
004_task_queue_and_monitoring.sql
005_fix_snapshot_severity.sql
006_user_integrations.sql
```

Pipeline schema (golang-migrate):
```bash
cd apps/runner
migrate -path ./migrations -database "$DATABASE_URL" up
```

6. **Start development server**:
```bash
pnpm dev
```

Open [http://localhost:8109](http://localhost:8109) to see the application.

7. **Start runner service**:
```bash
cd apps/runner
go run ./cmd/runner
```

## 📚 Documentation

### Getting Started
- **[Quick Setup Guide](./docs/quick-setup-guide.md)** - 5-minute setup walkthrough
- **[Vault Setup](./docs/vault-setup.md)** - Enable Supabase Vault (optional)
- **[Custom Encryption](./docs/custom-encryption-setup.md)** - AES-256-GCM encryption setup

### System Documentation
- **[Integration System](./docs/integration-system-implementation.md)** - Complete integration architecture
- **[Implementation Progress](./docs/implementation-progress.md)** - Current status and roadmap
- **[API Reference](./docs/api-reference.md)** - Integration API documentation

### Technical Reference
- **[CLAUDE.md](./CLAUDE.md)** - Project guide, HeroUI v3 patterns, and coding standards

## 🔧 Environment Variables

### Required
```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Encryption (for secure token storage)
ENCRYPTION_KEY=<64-hex-characters>

# Runner
RUNNER_BASE_URL=http://localhost:8200
RUNNER_TOKEN=your-runner-token
```

### Optional
```bash
# Event bus (optional)
NATS_URL=nats://localhost:4222

# Internal task endpoints (optional)
TASK_RUNNER_TOKEN=your-secure-token
```

### Runner (apps/runner)
```bash
RUNNER_PORT=8200
RUNNER_TOKEN=your-runner-token
DATABASE_URL=postgres://...
REDIS_URL=redis://...
NATS_URL=nats://localhost:4222
ENCRYPTION_KEY=<same as studio>
PIPELINE_QUEUE=pipelines
PIPELINE_CONCURRENCY=4
PIPELINE_RUN_TIMEOUT=2h
RUNNER_DATA_DIR=data
PIPELINE_LOG_RETENTION_DAYS=30
PIPELINE_ARTIFACT_RETENTION_DAYS=30
```

**Note**: VCS (GitHub/GitLab) and AI (Claude/GPT-4) integrations are configured through the web UI at **Settings > Integrations**, not via environment variables. See [Quick Setup Guide](./docs/quick-setup-guide.md) for details.

## 🏗️ Architecture

### Integration System

The platform uses a multi-layer integration system:

```
User Interface (Settings > Integrations)
    ↓
API Layer (/api/integrations)
    ↓
Service Layer (apps/studio/src/services/integrations/)
    ↓
Database (user_integrations table + Encrypted secrets)
```

**Configuration Priority**:
```
Project-specific integration > User default integration > Error (must configure)
```

**Supported Providers**:
- **VCS**: GitHub, GitLab, Generic Git
- **AI**: OpenAI-compatible APIs (Anthropic Claude, OpenAI GPT-4, DeepSeek, etc.)

### Pipeline Engine

- **Studio** provides a drag-and-drop DAG builder for stages, jobs, and shell steps.
- **Runner** executes pipeline runs via Redis queue with job-level concurrency.
- **Events** are appended to `run_events` for polling/streaming.
- **Logs & artifacts** are stored locally under `RUNNER_DATA_DIR`.

### Security

- **AES-256-GCM Encryption**: All tokens and API keys encrypted at rest
- **Supabase Vault**: Optional secure secret storage (Pro plan)
- **Row-Level Security**: Multi-tenant data isolation
- **No Client Exposure**: Sensitive data never sent to browser

See [Integration System Implementation](./docs/integration-system-implementation.md) for complete architecture details.

## ⚙️ Scripts

```bash
pnpm dev     # Studio dev server (port 8109)
pnpm build   # Studio production build with TypeScript check
pnpm start   # Studio production server
pnpm lint    # Studio ESLint analysis
cd apps/runner && go run ./cmd/runner   # Runner service
```

## 🌐 API Endpoints

### Core APIs
- `POST /api/analyze` - Trigger AI code analysis (returns immediately, queues task)
- `GET /api/stream` - Server-Sent Events for real-time report updates
- `GET /api/reports/[id]` - Get analysis report details
- `GET /api/commits` - Fetch commits from VCS provider

### Integration Management
- `GET /api/integrations` - List user integrations
- `POST /api/integrations` - Create new integration
- `PUT /api/integrations/:id` - Update integration
- `DELETE /api/integrations/:id` - Delete integration
- `POST /api/integrations/:id/test` - Test connection
- `POST /api/integrations/:id/set-default` - Set as default
- `GET /api/integrations/providers` - Get provider templates

See [API Reference](./docs/api-reference.md) for complete endpoint documentation.

## 📁 Project Structure

```
spec-axis/
├── apps/
│   ├── studio/                # Next.js console
│   │   └── src/               # App Router, components, services, libs
│   └── runner/                # Go runner service
│       ├── internal/pipeline  # Pipeline engine + executors
│       └── migrations         # golang-migrate SQL files
├── packages/
│   └── contracts/             # Shared API/contracts (future)
├── docs/                     # Documentation
├── supabase/migrations/      # Database migrations
├── CLAUDE.md                 # Development guide
└── README.md                 # This file
```

## 🚢 Deployment

### Vercel

Deploy to Vercel with one click. The analysis API is configured for 300s timeout in `vercel.json`.

### Production Checklist

- [ ] Generate production encryption key
- [ ] Run all database migrations
- [ ] Configure environment variables
- [ ] Test in staging environment first
- [ ] Set up monitoring and alerts
- [ ] Document encryption key backup procedure

See [Quick Setup Guide](./docs/quick-setup-guide.md#production-deployment) for deployment details.

## 🧪 Testing

### Integration Testing Checklist

- [ ] VCS integrations (GitHub, GitLab)
- [ ] AI integrations (Anthropic, OpenAI)
- [ ] First-time onboarding flow
- [ ] Project-level vs user-level integration priority
- [ ] Multi-tenant data isolation
- [ ] Task queue execution
- [ ] SSE report updates

## 🛠️ Troubleshooting

### Common Issues

**Error: "ENCRYPTION_KEY environment variable is not set"**
- Solution: Add `ENCRYPTION_KEY` to `apps/studio/.env` and restart server

**Error: "relation user_integrations does not exist"**
- Solution: Run database migration `006_user_integrations.sql`

**Onboarding modal doesn't appear**
- Solution: Clear browser cache or try incognito mode

For more issues, see [Quick Setup Guide](./docs/quick-setup-guide.md#troubleshooting).

## 📖 Additional Resources

- [HeroUI v3 Documentation](https://heroui.com/docs) (beta)
- [Next.js 16 Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)

## 🤝 Contributing

Contributions are welcome! Please read our development guidelines in [CLAUDE.md](./CLAUDE.md) before contributing.

## 📄 License

This project is proprietary software. All rights reserved.

---

**Need Help?** Check out our documentation in the [`docs`](./docs/) folder or refer to [CLAUDE.md](./CLAUDE.md) for development guidelines.
