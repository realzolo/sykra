# Pipeline Engine (CI/CD)

See also: `docs/pipeline/pipeline-optimization-handbook.md` for a step-by-step optimization workflow that turns these runtime capabilities into an execution manual.

## Pipeline Runtime UX

- Pipeline runtime UX is separate from authoring: runs render as stage columns with per-node status, logs, artifacts, and node-level manual trigger actions for jobs that enter a manual stage
- Pipeline runtime views must keep the selected run summary synchronized with the latest run detail response so status badges and retry/manual actions update without a page refresh after background state changes.
- When a retry or other recovery action moves the selected pipeline run from a terminal state back to an active state, Studio must re-establish the live run stream automatically so queued/running badges and node details refresh without a manual page reload.
- Pipeline run creation and rollback flows should switch the detail view to the exact run id returned by Conductor, rather than inferring the target from list ordering.
- Pipeline runtime views should subscribe to `/api/pipeline-runs/[runId]/stream` for live run snapshot updates driven by Conductor run events; client-side polling is only a fallback when the stream cannot be established.
- The runtime board horizontal scrollbar is rendered as a dedicated bottom rail, while the main runtime viewport keeps only vertical scrolling; the board itself should also support drag-to-pan for horizontal navigation.
- Pipeline runtime and settings loading states should render skeleton placeholders instead of inline "Loading..." text so the page keeps a uniform loading language.
- Pipeline authoring views should expose version history from `pipeline_versions` and compare a selected snapshot against the previous snapshot so operators can review config drift before saving a new revision or triggering a run.
- While dragging the runtime board to pan horizontally, text selection must be suppressed so node cards and log content do not get highlighted.
- Runtime board node clicks must only clear selection when the viewport background itself is clicked; child node clicks should open the node dialog without being canceled by the board-level click handler.
- Runtime board drag-to-pan must only start from blank canvas regions; pointer interaction that begins on a node card must never move the board.
- Pipeline runtime cards should project job status from step state when the job row lags behind the latest step progress, so `queued` does not mask active or terminal step states in the UI.
- Conductor run detail responses should already project job status from step state before Studio renders them, so the API contract itself remains the source of truth for the visible runtime state.
- Source resolution is part of the Source job lifecycle: Conductor should mark the Source run/job/first step as running before writing source snapshot logs, so log output never appears while the UI still shows `queued`.
- Run termination must be consistent: when Conductor marks a pipeline run as failed, timed out, or deadlocked, any remaining queued jobs/steps should be terminalized as canceled instead of left in `queued` state.
- Studio runtime projection should also consider the parent run terminal state so stale queued jobs render as canceled after a failed/canceled/timed_out run instead of appearing live.

## Node Logs & Terminal

- Node detail logs should use a terminal-style pane with line numbers and a full-height scroll region so the log viewport always fills the dialog height instead of shrinking to content; line numbers should render as plain integers without zero padding and terminal text should use a neutral foreground instead of a green default.
- Node detail dialog bodies and loading skeletons should explicitly stretch to full available width so the terminal pane does not shrink during initial render.
- Node detail dialog content grids inside flex containers must use `flex-1 w-full min-w-0` so the right-side log pane fills the dialog width instead of shrink-wrapping to content.
- Terminal-style pipeline logs should classify npm `warn` / `error` prefixes and `deprecated` lines as warning/error severity, so install output highlights like a real shell session instead of leaving important lines muted.
- Terminal-style pipeline logs should colorize warning/error lines in-place using severity-aware styling so console output reads like a real shell session, while neutral and system lines stay muted.
- Node detail dialogs should follow the currently active step within the selected job when the previously viewed step becomes terminal, so live log viewing automatically advances to the next running step.
- Run-history logs should stream through a Conductor-native long-lived text stream endpoint that Studio proxies directly, instead of repeated client-side polling; do not require the user to wait for the entire step to finish before any log content becomes visible. Source-stage diagnostics should initialize a log entry as soon as source resolution begins so setup failures still surface immediately.
- Step logs should include a command preamble, working directory, stdout/stderr stream, and final exit status so users can see the exact shell/git/docker command that was executed and how it completed, not only the resulting output.
- Run-history node logs should be cached per step in Studio and resumed from byte offsets when revisiting a step, so switching steps does not force a full reload. Step rows should present human-readable outcomes such as Succeeded, Failed, Timed out, or Canceled instead of raw `exit 0` / `exit xxx` codes.
- When a node is retried or re-triggered, Studio must clear the visible log pane immediately and only reopen the stream after the step has a fresh non-empty `log_path`, so a queued node never shows stale logs from a previous attempt.

## Manual Execution & Recovery

- Manual execution semantics are node-based, not stage-resume based: when a manual stage becomes ready, each ready job is marked `waiting_manual`; Studio triggers a specific `job_key`, Conductor requeues the run, and only that approved node proceeds
- Pipeline run lifecycle control is explicit: active runs can be canceled from Studio through the local `/api/pipeline-runs/:runId/cancel` route before pipeline deletion can succeed, and run-history node details should open in a dialog instead of a persistent right-side inspector panel.
- Pipeline node recovery is explicit: failed nodes can be retried from the node dialog, and Conductor re-queues the target job plus downstream affected jobs in the same pipeline run while clearing old logs/artifacts for the retried subtree. Retries emit a dedicated `run.retried` event and normalize retry attempts across the retried subtree.
- Node retry semantics are sandbox-based: a retry always creates a fresh execution sandbox for the retried job, restarts that job from its first step, and preserves upstream successful jobs as immutable inputs. Studio should make it explicit in both the retry dialog and run header via a light info tooltip that retry reuses the original run's version snapshot; users who want the latest pipeline config must trigger a new run after saving changes.

## Execution Engine

- **Studio** ships a native stage builder under `/pipelines` with fixed lifecycle columns (`source -> after_source -> review -> after_review -> build -> after_build -> deploy -> after_deploy`), on-demand automation insertion, stage-level controls for core stages, and an in-place job inspector.
- **Pipeline execution roles** are split by responsibility: `source/quality_gate/build` stages execute inside Conductor-managed per-job runner containers created from the pipeline `buildImage`, while `deploy/after_deploy` stages route to remote deploy workers over the worker control channel.
- Conductor must verify local Docker daemon availability at startup because CI sandbox creation depends on it.
- Workers that advertise the `docker` capability must verify Docker daemon availability at startup and fail fast if it is unavailable.
- Docker step containers use a `conductor-step-<run>-<job>-<step>-<request>` name so container inspection maps cleanly back to pipeline execution.
- **Pipelines** always belong to a project (`project_id` is required, never null).
- **Pipeline config** is versioned in `pipeline_versions` and linked from `pipelines.current_version_id`.
- **Pipeline secrets** are stored in `pipeline_secrets` encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`) and injected into every step as environment variables (write-only in UI). Secret keys are canonical uppercase env names, may be multiline, are limited to 100 per pipeline, and cannot use the reserved `PIPELINE_` namespace.
- **Authoring model**: users edit stage settings plus stage-local jobs; `source` is fixed single-entry, automation slots are fixed `auto + parallel`, and runtime `needs` edges are derived from stage order and stage `dispatchMode`.
- **Execution model**: jobs still execute as a DAG after derivation, and steps run sequentially inside a job.

## CI Sandbox

- **CI sandbox image**: every pipeline must define a top-level `buildImage`. Conductor creates a fresh runner container from that image for each `source/quality_gate/build` job, mounts an isolated self-contained workspace snapshot into `/workspace`, and runs all job steps via `docker exec` inside the same container so step state persists across the job. Build images should start from official runtime base images and already include git plus any package-manager tooling required by the repo; Conductor does not mutate the image at runtime.
- Node CI pipeline defaults should be derived from repository metadata (lockfile / `packageManager` field) rather than hardcoding a single package manager into the template; if the repo cannot be inferred yet, keep the template generic and let the user choose explicitly.
- **Pipeline source snapshots**: Conductor owns CI source resolution. Before any CI job starts, it resolves the configured source branch to a pinned commit, stores that `branch + commit_sha + commit_message` on `pipeline_runs`, updates a local bare mirror cache under `apps/conductor/data/git/mirrors/.../mirror.git`, and materializes each CI job workspace as a self-contained local clone from that mirror. Runner containers must consume only these local workspaces; CI step execution must not fetch from external Git remotes directly.
- **Built-in CI stages**: `source_checkout` and `quality_gate` are Conductor-native built-ins. `source_checkout` only verifies and reports the pinned local workspace snapshot that Conductor already prepared; it must not perform network clone/pull work. `quality_gate` is pinned to the `review` stage, reads the latest completed review score for the current run commit directly from PostgreSQL, enforces the configured `minScore` threshold, writes a changed-file manifest into the job workspace for scoped analyzers, injects `PIPELINE_CHANGED_FILES_MANIFEST` and `PIPELINE_CHANGED_FILES_COUNT`, then runs the configured static-analysis command in the build sandbox.
- **Quality gate evidence**: quality gate execution must emit structured run events for AI review and static analysis results, including commit SHA, threshold, score, command, exit code, artifact path, and outcome. Logs remain human-readable, but auditability must not depend on parsing plain text output. Static-analysis steps must declare a report artifact path, and the artifact must still be captured when the analyzer exits non-zero so blocking findings remain auditable.
- **Static analysis ingestion**: when a static-analysis step publishes a SARIF artifact, normalized `sykra.static-analysis.v1` JSON artifact, or Go vet JSON artifact, Conductor ingests it into quality-gate run events with tool metadata, severity counts, blocking counts, sampled findings, and finding fingerprints. The pipeline should prefer SARIF-producing analyzers and artifact paths for supported ecosystems, and it should scope supported analyzers to the changed-file manifest so the UI and audit trail can render machine-readable evidence without full-repo scans.
- **CI build image authoring**: Studio may offer curated build-image presets for common runtimes, but persisted pipeline config must remain explicit `buildImage` only. Presets are UI affordances derived from the current image value; do not persist preset identifiers into pipeline versions or execution-facing runtime config. Conductor validates that runner images already provide the required tools (`git`, and `corepack` for pnpm/yarn workspaces) and fails fast with an explicit image-scoped error if the image cannot satisfy the pipeline contract.
- **Pipeline default inference**: Studio should infer the initial `buildImage` and default build steps from repository metadata such as `packageManager`, lockfiles, and common framework markers, expose the suggestion through `GET /api/projects/:id/pipeline-defaults`, and apply it in the create wizard only before the user edits the config so explicit overrides always win.

## Step Types & Artifacts

- **Step types**: in CI stages, steps run as `shell` inside the job sandbox created from `buildImage`; step-level `docker` is not allowed there. In deploy stages, `shell` runs on the remote worker host and `docker` runs `docker run --rm -w /workspace --mount type=bind,src={workingDir},dst=/workspace {envFlags} {image} /bin/sh -c "{script}"`. Docker env values are inherited from the executor process environment instead of being embedded into CLI args, so injected secrets are not exposed in the host process list.
- **Step artifacts**: each user-defined step can declare `artifactPaths` (glob/file list, one per line in UI). Conductor resolves and uploads artifacts after CI sandbox steps complete; deploy workers download required inputs from Conductor-backed artifact storage before deployment steps execute.
- **Artifact upload reliability**: worker uploads each artifact with bounded retry (`maxAttempts=3`) and emits attempt metadata; Conductor records observability events (`step.artifact.uploaded`, `step.artifact.upload_failed`, `step.artifact.upload_observed`) for timing/error-category analysis.
- **Concurrency modes**: each pipeline has a `concurrency_mode` column (`allow` / `queue` / `cancel_previous`). Conductor is the execution source of truth for concurrency across all trigger sources (manual/API, webhook, schedule): `queue` allows enqueueing but dispatch claims only the oldest eligible queued run per pipeline when no `running`/`waiting_manual` run exists; `cancel_previous` cancels existing `queued`/`running`/`waiting_manual` runs before creating the next run. Included in `docs/db/init.sql`; existing DBs should apply `docs/db/migrations/add_concurrency_mode.sql`.
- **Events** are appended to `pipeline_run_events` for UI polling and audit.
- **Logs** are stored locally under `CONDUCTOR_DATA_DIR`: `logs/{run_id}/{job_key}/{step_key}.log`

## Artifact Storage & Registry

- **Artifacts** use org-level storage backend settings (`org_storage_settings`):
  - `local` provider: `{CONDUCTOR_DATA_DIR}/{localBasePath}/{org_id}/{run_id}/{job_id}/{step_id}/...`
  - `s3` provider: `s3://{bucket}/{prefix}/{org_id}/{run_id}/{job_id}/{step_id}/...`
  - Worker uploads artifacts through Conductor internal API `PUT /v1/workers/artifacts/upload`
  - Artifact rows include optional `expires_at`; conductor performs periodic expiry cleanup (storage delete + DB row delete) based on retention policy.
- Pipeline artifact observability: project pipelines page includes artifact download health cards (total, success rate, p95 latency, failures) powered by `GET /api/projects/:id/artifact-download-stats`
- Pipeline artifact retention supports project-level override via `code_projects.artifact_retention_days`; Conductor uses project override first, then global Conductor default
- Worker artifact handoff: deploy steps can declare `artifactInputs` patterns; Worker downloads matched artifacts from earlier steps in the same run before step execution, with checksum validation + retry and run events (`step.artifact.pull_*`)
- Studio callback delivery uses a durable `studio_callback_outbox` table plus a background Conductor delivery loop; direct HTTP fallback is only used if enqueueing fails.
- **Artifact registry** elevates selected run outputs into immutable project release versions:
  - `artifact_repositories` defines the package/repository namespace per project.
  - `artifact_versions` stores immutable published versions with source run / pipeline / commit provenance.
  - `artifact_files` maps logical file paths to deduplicated `artifact_blobs`.
  - `artifact_channels` maps mutable channels like `dev`, `preview`, `prod`, `latest` onto immutable versions.
  - `artifact_version_usages` records promotion / download / deployment consumption events for traceability and future retention protection.
- Pipeline run artifact release cards should surface source run, source commit, source branch, publish timestamp, publisher identity, and channels so release provenance stays visible in the run detail workflow.
- Artifact blob storage is deduplicated by `(org_id, sha256)` in `artifact_blobs`; Conductor cleanup must not delete storage objects that are referenced by published registry versions.
- Artifact deployment flow is pull-based for remote workers: workers should fetch immutable artifact versions from Conductor-backed artifact storage rather than receiving binary payloads over the WebSocket control channel; deployment/promotion provenance is recorded in `artifact_version_usages`.
- Deploy steps can choose their artifact source explicitly: `run` consumes same-run outputs while `registry` consumes an immutable published repository version or deployment channel, and Conductor resolves the selected registry version before handing the step to Worker.
- **Artifact download path**:
  - Studio issues short-lived signed download tokens at `POST /api/pipeline-runs/:runId/artifacts/:artifactId/download-token`
  - Studio streams artifact content via `GET /api/pipeline-runs/:runId/artifacts/:artifactId/download?token=...`
  - Studio fetches raw bytes from Conductor private endpoint `GET /v1/pipeline-runs/:runId/artifacts/:artifactId/content` using `X-Conductor-Token`
  - Published registry files stream through `GET /api/projects/:id/artifacts/files/:fileId/download`, which proxies Conductor private endpoint `GET /v1/artifact-files/:fileId/content`

## Conductor → Studio Callbacks

- Conductor emits completion events to Studio at `POST /api/conductor/events` (authorized via `X-Conductor-Token`) so Studio can send notifications
- Conductor must be configured with `STUDIO_URL` and a token (`STUDIO_TOKEN`, defaults to `CONDUCTOR_TOKEN`) and Studio must accept `X-Conductor-Token` (shared secret)

**GitHub webhook:** `/api/webhooks/github` supports `?project_id=...`. If a repo matches multiple projects, the endpoint returns 409 and requires `project_id`.
