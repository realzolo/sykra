# Pipeline P0 Audit Template

Use this template to execute the `P0 — Stabilize the execution baseline` phase from `docs/pipeline/pipeline-optimization-handbook.md`.

This audit is designed for operations + engineering collaboration. It should produce:

1. A complete pipeline inventory for one organization/project scope.
2. A ranked top-3 remediation shortlist.
3. A P0 acceptance decision (`pass` / `partial` / `fail`) for each pipeline.

## Scope and cadence

- Scope unit: one `project_id` at a time.
- Review cadence: weekly until all production-facing pipelines pass P0, then bi-weekly.
- Data window: default `last 7 days` plus latest run details.

## Data sources

- API:
  - `GET /api/pipelines?projectId=<projectId>`
  - `GET /api/pipelines/:id`
  - `GET /api/pipelines/:id/runs?limit=50`
- Database (`docs/db/init.sql`):
  - `pipelines`
  - `pipeline_versions`
  - `pipeline_runs`
  - `pipeline_jobs`
  - `pipeline_steps`
  - `pipeline_artifacts`
  - `artifact_versions`
  - `artifact_channels`

## Inventory matrix (fill for every pipeline)

| Field | Value | Evidence |
|------|------|------|
| Pipeline ID |  | API/DB |
| Pipeline name |  | API |
| Environment (`development/preview/production/custom`) |  | `config.environment` |
| Primary purpose (`validation/release/deploy/e2e`) |  | Team declaration |
| Concurrency mode (`allow/queue/cancel_previous`) |  | `pipelines.concurrency_mode` |
| Trigger mode (`push/schedule/manual/mixed`) |  | `config.trigger`, run history |
| Schedule expression (if any) |  | `config.trigger.schedule` |
| Source branch strategy (`project_default/custom`) |  | `source_branch_source` |
| Production deploy gate present (`yes/no`) |  | `config.stages.deploy.entryMode` |
| `quality_gate` exists and on review stage (`yes/no`) |  | pipeline config |
| `quality_gate.minScore` |  | pipeline config |
| Static analysis artifact path declared (`yes/no`) |  | `quality_gate` step config |
| Structured static-analysis artifact (`sarif/json/go-vet`) |  | step artifact paths |
| `buildImage` explicit (`yes/no`) |  | `config.buildImage` |
| Artifact outputs declared (`yes/no`) |  | `artifactPaths` |
| Deploy source explicit (`run/registry`) |  | deploy step `artifactSource` |
| `run_stats_7d.total_runs` |  | list API |
| `run_stats_7d.success_rate` |  | list API |
| `run_stats_7d.failed_runs` |  | list API |
| `run_stats_7d.active_runs` |  | list API |
| First actionable failure clear within 3 minutes (`yes/no`) |  | run replay drill |

## P0 scoring rubric

Use this scoring only for triage order, not for replacing engineering judgment.

- Critical blocker (`3 points`):
  - Production pipeline without manual deploy gate.
  - Missing canonical `quality_gate`.
  - Missing static-analysis report artifact path on `quality_gate`.
  - Missing explicit `buildImage`.
- Major risk (`2 points`):
  - Push + schedule both enabled with no distinct purpose.
  - Concurrency mode mismatched to pipeline purpose.
  - Deploy artifact source is implicit/unclear.
  - No reusable artifact outputs.
- Optimization gap (`1 point`):
  - Weak `minScore` choice without tuning rationale.
  - Step/job boundaries make first failure slow to locate.
  - No regular use of `run_stats_7d` in pipeline review.

Recommended triage:

- `>=6`: fix in current sprint.
- `3..5`: fix in next sprint.
- `0..2`: keep in monitored backlog.

## Audit SQL starter queries

Replace placeholders:

- `<PROJECT_ID>` with the target project UUID.
- `<ORG_ID>` with organization UUID.

```sql
-- 1) Pipeline inventory with latest version snapshot metadata
select
  p.id,
  p.name,
  p.concurrency_mode,
  p.trigger_schedule,
  pv.version as current_version,
  pv.created_at as version_created_at
from pipelines p
left join pipeline_versions pv on pv.id = p.current_version_id
where p.project_id = '<PROJECT_ID>'::uuid
order by p.created_at desc;
```

```sql
-- 2) 7-day operational summary per pipeline
select
  r.pipeline_id,
  count(*) as total_runs_7d,
  count(*) filter (where r.status = 'success') as success_runs_7d,
  count(*) filter (where r.status in ('failed', 'timed_out', 'canceled')) as failed_runs_7d,
  count(*) filter (where r.status in ('queued', 'running', 'waiting_manual')) as active_runs_now
from pipeline_runs r
where r.project_id = '<PROJECT_ID>'::uuid
  and r.org_id = '<ORG_ID>'::uuid
  and r.created_at >= now() - interval '7 days'
group by r.pipeline_id
order by failed_runs_7d desc, total_runs_7d desc;
```

```sql
-- 3) Trigger mix and overlap signal
select
  r.pipeline_id,
  r.trigger_type,
  count(*) as runs_7d
from pipeline_runs r
where r.project_id = '<PROJECT_ID>'::uuid
  and r.org_id = '<ORG_ID>'::uuid
  and r.created_at >= now() - interval '7 days'
group by r.pipeline_id, r.trigger_type
order by r.pipeline_id, runs_7d desc;
```

```sql
-- 4) Long-running or stuck active runs
select
  r.id as run_id,
  r.pipeline_id,
  r.status,
  r.created_at,
  now() - r.created_at as age
from pipeline_runs r
where r.project_id = '<PROJECT_ID>'::uuid
  and r.org_id = '<ORG_ID>'::uuid
  and r.status in ('queued', 'running', 'waiting_manual')
order by r.created_at asc;
```

## Audit output format

Produce one summary block per pipeline:

```text
Pipeline: <name> (<id>)
P0 score: <0-9>
Status: pass | partial | fail
Top risks:
- ...
- ...
Planned fixes:
- [P0-xx] ...
- [P0-yy] ...
```

Then produce project-level conclusion:

- Top 3 pipelines by risk score.
- Sprint candidate fixes (max 5 items).
- Expected outcome after P0 (target success rate, reduced active backlog, faster first-failure identification).

## P0 exit criteria (project-level)

- Every production-facing pipeline has manual deploy entry gate.
- Every pipeline has explicit environment, trigger strategy, and concurrency mode rationale.
- Every pipeline has canonical `quality_gate` with explicit `minScore` and structured static-analysis evidence.
- Every pipeline has explicit `buildImage` and useful artifact outputs.
- Every deploy path has explicit artifact source semantics (`run` vs `registry`).

