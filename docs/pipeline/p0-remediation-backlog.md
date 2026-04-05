# Pipeline P0 Initial Remediation Backlog

This backlog translates the handbook into executable engineering work items with concrete code/API touchpoints in this repository.

Assumption:

- This is an initial backlog before running a full per-project audit.
- Priorities should be re-ranked after filling `docs/pipeline/p0-audit-template.md`.

## Priority model

- `P0-now`: high-risk baseline issues that can cause unsafe or noisy pipeline behavior.
- `P0-next`: baseline hardening after `P0-now` merges.
- `P1-candidate`: high-value follow-ups once baseline is stable.

## P0-now

### P0-01 Enforce production-safe concurrency policy

- Problem:
  - Production pipelines are already required to have manual deploy gate, but concurrency policy is not explicitly constrained for production in Studio API validation/update flows.
  - This leaves room for unsafe overlap (`allow`) on production-targeted pipelines.
- Desired behavior:
  - For `config.environment = production`, reject `concurrency_mode = allow`.
  - Default production mode to `queue` on create path when mode is omitted.
- Touchpoints:
  - `apps/studio/src/services/pipelineTypes.ts`
  - `apps/studio/src/app/api/pipelines/route.ts`
  - `apps/studio/src/app/api/pipelines/[id]/route.ts`
  - `apps/studio/src/services/validation.ts`
- Validation:
  - Unit/integration tests for create/update endpoints with production config + `allow`.
  - UI diagnostic messaging should explain why `queue` is required for production.

### P0-02 Promote trigger-discipline warning to enforceable policy toggle

- Problem:
  - `autoTrigger + schedule` currently emits a warning only.
  - In many teams this generates duplicated runs and low-signal noise.
- Desired behavior:
  - Add server-side guardrail that can reject mixed triggers unless a distinct-purpose flag is provided.
  - Keep explicit escape hatch for valid dual-trigger pipelines (for example push validation + nightly drift check).
- Touchpoints:
  - `apps/studio/src/services/pipelineTypes.ts` (diagnostics/rules)
  - `apps/studio/src/services/validation.ts` (request contract extension)
  - `apps/studio/src/app/api/pipelines/route.ts`
  - `apps/studio/src/app/api/pipelines/[id]/route.ts`
  - `packages/contracts/src/conductor.ts` (if payload contract changes)
- Validation:
  - Reject mixed triggers by default in API tests.
  - Accept mixed triggers only when purpose flag is present and non-empty.

### P0-03 Add strict deploy artifact-source UX constraints in pipeline editor

- Problem:
  - Runtime contract supports explicit deploy artifact source (`run` or `registry`), but teams can still configure ambiguous deploy intent in practice.
- Desired behavior:
  - Make `artifactSource` selection mandatory for deploy steps.
  - For `run`, require explicit `artifactInputs`.
  - For `registry`, require repository plus exactly one selector (`registryVersion` xor `registryChannel`).
- Touchpoints:
  - `apps/studio/src/components/pipeline/StageBuilder.tsx`
  - `apps/studio/src/services/pipelineTypes.ts`
  - `apps/conductor/internal/pipeline/types.go` (already validates; keep parity)
- Validation:
  - Editor blocks save on ambiguous deploy source.
  - Contract and UI errors remain aligned.

### P0-04 Add quick-fail pipeline lint command for CI authoring quality

- Problem:
  - Authoring quality checks are spread across UI/API runtime paths; there is no single lightweight CLI command for PR-time config validation.
- Desired behavior:
  - Add a script that validates pipeline JSON against core P0 rules before merging config changes.
  - Scope: build image required, canonical quality gate, structured static-analysis artifact, production gate, concurrency/environment compatibility.
- Touchpoints:
  - `apps/studio/src/scripts/` (new script)
  - `apps/studio/package.json` scripts
  - `apps/studio/src/services/pipelineTypes.ts` rule reuse
- Validation:
  - CI job can run script with non-zero exit on violations.
  - Script output is actionable and references failing path keys.

## P0-next

### P0-05 Pipeline-level SLO dashboard card set (first-failure latency + backlog age)

- Problem:
  - `run_stats_7d` exists, but P0 operations still lack one place to see backlog age and first-failure diagnosis speed.
- Desired behavior:
  - Extend pipeline list/detail telemetry with:
    - oldest active run age
    - median time-to-first-terminal-failure per pipeline
    - waiting-manual dwell time
- Touchpoints:
  - `apps/studio/src/app/api/pipelines/route.ts`
  - `apps/studio/src/components/project/ProjectPipelinesView.tsx`
  - `apps/studio/src/components/pipeline/PipelineDetailClient.tsx`
  - `apps/studio/src/services/pipelineTypes.ts` (typed response additions)
- Validation:
  - Metrics visible without extra API fan-out.
  - Existing `run_stats_7d` consumers remain backward compatible.

### P0-06 Add audit trail marker for pipeline-risk policy violations

- Problem:
  - Rejected creates/updates do not consistently produce a distinct audit-class event for policy enforcement analysis.
- Desired behavior:
  - Log policy-rejection reason codes for pipeline create/update attempts.
  - Allow later analysis of common misconfigurations.
- Touchpoints:
  - `apps/studio/src/app/api/pipelines/route.ts`
  - `apps/studio/src/app/api/pipelines/[id]/route.ts`
  - `apps/studio/src/services/audit.ts`
- Validation:
  - Audit entries include stable reason code and actor context.

## P1-candidate (after baseline stability)

### P1-01 Add pipeline remediation assistant view (from run_stats + config diff)

- Goal:
  - Convert observed failure patterns into suggested next optimizations in UI.
- Touchpoints:
  - `apps/studio/src/components/pipeline/PipelineDetailClient.tsx`
  - `apps/studio/src/services/pipelineTypes.ts`
  - `apps/studio/src/app/api/pipelines/[id]/route.ts`

### P1-02 Operator runbook links from runtime failure signatures

- Goal:
  - Link first-failure signatures to internal runbook snippets directly in node dialog.
- Touchpoints:
  - `apps/studio/src/components/pipeline/PipelineDetailClient.tsx`
  - `apps/studio/src/i18n/dictionaries/en.json`
  - `apps/studio/src/i18n/dictionaries/zh.json`

## Delivery sequence (recommended)

1. Ship `P0-01`, `P0-03` first (strongest safety and reproducibility impact).
2. Ship `P0-02` with team sign-off on mixed-trigger escape hatch semantics.
3. Ship `P0-04` so future config changes fail fast in CI.
4. Re-run P0 audit and only then decide whether `P0-05` and `P0-06` are needed immediately.

## Definition of done for this backlog slice

- All `P0-now` items have owner, ETA, and acceptance test reference.
- At least one target project has completed the P0 audit template.
- Top-3 highest-risk pipelines have approved remediation PRs.

