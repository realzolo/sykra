# spec-axis

An AI code review platform built with Next.js 16 + React 19 + TypeScript. It integrates GitHub project management, commit selection, Claude analysis, configurable rule sets, and quality report scoring. The UI follows a Supabase Dashboard-style white theme using HeroUI v3 (beta) and Tailwind CSS v4. The backend runs analysis via a task queue and streams incremental updates over SSE.

## Features

- Multi-GitHub project management and commit-based analysis
- Claude AI reviews with configurable rule sets
- Quality scoring and report detail pages
- Incremental report updates via SSE
- Admin-friendly task queue with secure trigger endpoint

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- React 19 + TypeScript
- HeroUI v3 (beta) + Tailwind CSS v4
- Supabase (auth + database)
- Octokit (GitHub API)
- Anthropic SDK (Claude)

## Quick Start

Install dependencies and run the dev server:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:8109`.

## Environment Variables

Copy the example file and fill in values:

```bash
cp .env.example .env
```

Required variables:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GITHUB_PAT=
ANTHROPIC_API_KEY=
```

Optional:

```
ANTHROPIC_BASE_URL=
TASK_RUNNER_TOKEN=
```

## Scripts

```bash
pnpm dev     # start dev server (port 8109)
pnpm build   # production build
pnpm start   # start production server
pnpm lint    # run ESLint
```

## API Notes

- `POST /api/analyze` triggers analysis (returns `{ reportId }` immediately).
- `POST /api/tasks/run?limit=1` runs the task queue. Use `x-task-token` if `TASK_RUNNER_TOKEN` is set.
- `GET /api/stream` provides SSE updates for report status.

## Project Structure

```
src/
  app/              # Next.js routes (auth, dashboard, api)
  components/       # UI components
  services/         # Supabase, GitHub, Claude, queue, and helpers
  lib/              # shared utilities
  proxy.ts          # Next.js 16 proxy (middleware equivalent)
```

## Deployment

Vercel is supported. The analysis API uses a 300s function timeout in `vercel.json`.
