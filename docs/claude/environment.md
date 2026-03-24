# Environment Variables & Configuration

Bootstrap-first rule: `.env.example` and `apps/conductor/config.example.toml` intentionally contain only startup-essential settings. Product runtime policy knobs such as analyze admission thresholds, report timeout, and codebase preview limits are configured from Studio Settings > Runtime instead of per-developer local files. Additional env overrides listed below are supported for advanced local debugging, but they are intentionally omitted from the example templates.

## Studio Env

```
DATABASE_URL=               # Studio Postgres connection string
ENCRYPTION_KEY=             # AES-256-GCM key for secrets
GITHUB_CLIENT_ID=            # GitHub OAuth app client ID
GITHUB_CLIENT_SECRET=        # GitHub OAuth app client secret
GITHUB_CALLBACK_URL=         # Optional override for the GitHub OAuth callback URL
CONDUCTOR_BASE_URL=            # Conductor base URL (e.g. http://localhost:8200)
CONDUCTOR_TOKEN=               # Shared token for Conductor auth; also used for internal task endpoints (e.g. /api/codebase/sync)
EMAIL_PROVIDER=             # Email provider for auth verification/notifications: resend (required for live delivery)
EMAIL_FROM=                 # From address (required)
RESEND_API_KEY=             # Resend API key (required)
STUDIO_BASE_URL=            # Public base URL for links included in emails (required for verification links)
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

Environment files for Studio live under `apps/studio` (e.g. `apps/studio/.env`).

Auth email verification is strict: `/api/auth/register` and `/api/auth/resend-verification` require live email delivery configuration and return `503 EMAIL_DELIVERY_UNAVAILABLE` when email delivery is not configured.

## Conductor Env (apps/conductor)

```
CONDUCTOR_PORT=8200
CONDUCTOR_TOKEN=
DATABASE_URL=               # Postgres connection string
ENCRYPTION_KEY=             # Same key used by studio for decrypting secrets
STUDIO_URL=                 # Studio base URL (Conductor -> Studio), used by pipeline executors
STUDIO_TOKEN=               # Optional: token presented to Studio as X-Conductor-Token (defaults to CONDUCTOR_TOKEN)
PIPELINE_CONCURRENCY=       # Max concurrent pipeline jobs
PIPELINE_RUN_CONCURRENCY=   # Max concurrent pipeline runs claimed by dispatch loop (default 1)
WORKER_LEASE_TTL=           # Worker heartbeat lease window (default 45s)
CONDUCTOR_DATA_DIR=            # Local logs/artifacts root
PIPELINE_LOG_RETENTION_DAYS=
PIPELINE_ARTIFACT_RETENTION_DAYS=
ANALYZE_PHASE_CORE_TIMEOUT=                 # Optional phase timeout override (e.g. 20m)
ANALYZE_PHASE_QUALITY_TIMEOUT=              # Optional phase timeout override (e.g. 10m)
ANALYZE_PHASE_SECURITY_PERFORMANCE_TIMEOUT= # Optional phase timeout override (e.g. 15m)
ANALYZE_PHASE_SUGGESTIONS_TIMEOUT=          # Optional phase timeout override (e.g. 10m)
```

Conductor startup now fails fast if Docker daemon access is unavailable because CI sandbox creation depends on it.

### Conductor Config File (TOML, optional)

- Auto-detected: `apps/conductor/config.toml` or `config.toml` in current working directory
- Override path via `CONDUCTOR_CONFIG` or `-config`
- Precedence: env vars > TOML > defaults

Example config (tables, no redundant prefixes):
```toml
[conductor]
port = "8200"
token = ""
concurrency = 4
analyze_timeout = "900s"
data_dir = "data"

[database]
url = ""

[pipeline]
concurrency = 4
run_concurrency = 1
log_retention_days = 30
artifact_retention_days = 30

[worker]
lease_ttl = "45s"

[security]
encryption_key = ""

[studio]
url = ""
```

## Worker Env (apps/worker)

```
CONDUCTOR_BASE_URL=            # Conductor control-plane URL (e.g. http://conductor:8200)
CONDUCTOR_TOKEN=               # Same shared token used by Conductor auth
WORKER_ID=                  # Stable worker identifier (required in production)
WORKER_HOSTNAME=            # Optional display hostname
WORKER_VERSION=             # Optional worker version metadata
WORKER_MAX_CONCURRENCY=     # Parallel job slots per worker (default 1)
WORKER_CAPABILITIES=        # Comma list override; default: deploy,shell,docker,artifact_download
WORKER_LABELS=              # Comma kv list: env=production,region=cn-shanghai
WORKER_WORKSPACE_ROOT=      # Run workspace root on worker (default /tmp/sykra-runs)
WORKER_HEARTBEAT_SECONDS=   # Heartbeat interval (default 10)
WORKER_RECONNECT_DELAY=     # Reconnect backoff (default 3s)
```

## Integrations (via Web UI, NOT env vars)

**VCS and AI integrations** are configured via web UI at **Settings > Integrations**.
- **Artifact storage backend** is configured per organization via web UI at **Settings > Storage** (`GET/PUT /api/storage-settings`).
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
- Studio and Conductor both enforce this format for integration secrets; if old secrets were produced with non-standard nonce/tag size, re-save/recreate those integrations to rotate ciphertext
- Priority: project-specific > org default (no env var fallback)

## Codebase Cache Env

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

Note: env vars like `CODEBASE_ROOT` / `CODEBASE_MIRRORS_DIR` / `CODEBASE_WORKSPACES_DIR` treat empty values (e.g. `FOO=` in `.env`) as "unset" and fall back to defaults.
