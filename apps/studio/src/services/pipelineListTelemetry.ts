import type { ConductorPipeline } from '@sykra/contracts/conductor';
import { query } from '@/lib/db';
import { PIPELINE_ACTIVE_STATUSES_SQL } from '@/services/statuses';

type RunStatsRow = {
  pipeline_id: string;
  total_runs_7d: string;
  success_runs_7d: string;
  failed_runs_7d: string;
};

type RunDailyRow = {
  pipeline_id: string;
  total_runs: string;
  success_runs: string;
};

type ActiveRunRow = {
  pipeline_id: string;
  active_runs: string;
};

type PolicyRejectionRow = {
  pipeline_id: string;
  policy_rejections_7d: string;
};

type OldestActiveRunAgeRow = {
  pipeline_id: string;
  oldest_active_run_age_seconds: string;
};

type MedianFirstFailureRow = {
  pipeline_id: string;
  median_first_failure_ms: string;
};

type WaitingManualDwellRow = {
  pipeline_id: string;
  waiting_manual_dwell_p50_ms: string;
};

type ActorRow = {
  id: string;
  email: string | null;
  display_name: string | null;
};

export type PipelineRunStats7d = {
  total_runs: number;
  success_runs: number;
  failed_runs: number;
  success_rate: number;
  active_runs: number;
  policy_rejections: number;
  daily_total_runs: number[];
  daily_success_runs: number[];
  oldest_active_run_age_seconds: number | null;
  median_first_failure_ms: number | null;
  waiting_manual_dwell_p50_ms: number | null;
};

type PipelineLastRunWithActor = NonNullable<ConductorPipeline['last_run']> & {
  triggered_by_email: string | null;
  triggered_by_name: string | null;
};

export type HydratedPipelineSummary = Omit<ConductorPipeline, 'last_run'> & {
  last_run: PipelineLastRunWithActor | null;
  run_stats_7d: PipelineRunStats7d;
};

const TREND_WINDOW_DAYS = 7;
const DEFAULT_DAILY_SERIES = Array.from({ length: TREND_WINDOW_DAYS }, () => 0);

function createDefaultRunStats7d(): PipelineRunStats7d {
  return {
    total_runs: 0,
    success_runs: 0,
    failed_runs: 0,
    success_rate: 0,
    active_runs: 0,
    policy_rejections: 0,
    daily_total_runs: [...DEFAULT_DAILY_SERIES],
    daily_success_runs: [...DEFAULT_DAILY_SERIES],
    oldest_active_run_age_seconds: null,
    median_first_failure_ms: null,
    waiting_manual_dwell_p50_ms: null,
  };
}

function toInt(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableInt(value: string | null | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadPipelineTelemetry(args: {
  orgId: string;
  pipelineIds: string[];
  triggeredByIds: string[];
}) {
  const { orgId, pipelineIds, triggeredByIds } = args;
  // Keep list-page telemetry in one fan-out/fan-in batch so GET /api/pipelines
  // does not trigger per-pipeline N+1 reads.
  return Promise.all([
    query<RunStatsRow>(
      `select
         pipeline_id,
         count(*)::text as total_runs_7d,
         count(*) filter (where status = 'success')::text as success_runs_7d,
         count(*) filter (where status in ('failed', 'timed_out', 'canceled'))::text as failed_runs_7d
       from pipeline_runs
       where org_id = $1
         and pipeline_id = any($2::uuid[])
         and created_at >= now() - interval '7 days'
       group by pipeline_id`,
      [orgId, pipelineIds]
    ),
    query<RunDailyRow>(
      `select
         p.pipeline_id::text as pipeline_id,
         count(r.id)::text as total_runs,
         count(r.id) filter (where r.status = 'success')::text as success_runs
       from unnest($2::uuid[]) as p(pipeline_id)
       cross join generate_series(
         date_trunc('day', now()) - interval '6 days',
         date_trunc('day', now()),
         interval '1 day'
       ) as d(day_bucket)
       left join pipeline_runs r
         on r.org_id = $1
        and r.pipeline_id = p.pipeline_id
        and r.created_at >= d.day_bucket
        and r.created_at < d.day_bucket + interval '1 day'
       group by p.pipeline_id, d.day_bucket
       order by p.pipeline_id, d.day_bucket`,
      [orgId, pipelineIds]
    ),
    query<ActiveRunRow>(
      `select pipeline_id, count(*)::text as active_runs
       from pipeline_runs
       where org_id = $1
         and pipeline_id = any($2::uuid[])
         and status in (${PIPELINE_ACTIVE_STATUSES_SQL})
       group by pipeline_id`,
      [orgId, pipelineIds]
    ),
    query<PolicyRejectionRow>(
      `select
         entity_id::text as pipeline_id,
         count(*)::text as policy_rejections_7d
       from audit_logs
       where entity_type = 'pipeline'
         and action = 'reject'
         and changes->>'scope' = 'pipeline_policy_reject'
         and entity_id = any($1::uuid[])
         and created_at >= now() - interval '7 days'
       group by entity_id`,
      [pipelineIds]
    ),
    query<OldestActiveRunAgeRow>(
      `select
         pipeline_id,
         extract(epoch from (now() - min(created_at)))::bigint::text as oldest_active_run_age_seconds
       from pipeline_runs
       where org_id = $1
         and pipeline_id = any($2::uuid[])
         and status in (${PIPELINE_ACTIVE_STATUSES_SQL})
       group by pipeline_id`,
      [orgId, pipelineIds]
    ),
    query<MedianFirstFailureRow>(
      `with failure_runs as (
         select
           id,
           pipeline_id,
           coalesce(started_at, created_at) as started_at,
           coalesce(finished_at, updated_at, created_at) as terminal_at
         from pipeline_runs
         where org_id = $1
           and pipeline_id = any($2::uuid[])
           and created_at >= now() - interval '7 days'
           and status in ('failed', 'timed_out', 'canceled')
       ),
       first_failure_steps as (
         select
           j.run_id,
           min(coalesce(s.finished_at, s.updated_at, s.created_at)) as first_failed_at
         from pipeline_steps s
         join pipeline_jobs j on j.id = s.job_id
         where j.run_id in (select id from failure_runs)
           and s.status in ('failed', 'timed_out', 'canceled')
         group by j.run_id
       ),
       samples as (
         select
           fr.pipeline_id,
           greatest(
             0,
             (extract(epoch from (coalesce(fs.first_failed_at, fr.terminal_at) - fr.started_at)) * 1000)::bigint
           ) as duration_ms
         from failure_runs fr
         left join first_failure_steps fs on fs.run_id = fr.id
       )
       select
         pipeline_id,
         percentile_disc(0.5) within group (order by duration_ms)::bigint::text as median_first_failure_ms
       from samples
       group by pipeline_id`,
      [orgId, pipelineIds]
    ),
    query<WaitingManualDwellRow>(
      `with waiting_events as (
         select
           e.run_id,
           r.pipeline_id,
           e.type,
           e.occurred_at,
           lead(e.occurred_at) over (partition by e.run_id order by e.seq) as next_occurred_at,
           lead(e.type) over (partition by e.run_id order by e.seq) as next_type
         from pipeline_run_events e
         join pipeline_runs r on r.id = e.run_id
         where r.org_id = $1
           and r.pipeline_id = any($2::uuid[])
           and e.occurred_at >= now() - interval '7 days'
       ),
       samples as (
         select
           pipeline_id,
           greatest(
             0,
             (extract(epoch from (coalesce(next_occurred_at, now()) - occurred_at)) * 1000)::bigint
           ) as dwell_ms
         from waiting_events
         where type = 'run.waiting_manual'
           and (
             next_type is null
             or next_type in ('run.started', 'run.completed', 'run.failed', 'run.canceled', 'run.waiting_manual')
           )
       )
       select
         pipeline_id,
         percentile_disc(0.5) within group (order by dwell_ms)::bigint::text as waiting_manual_dwell_p50_ms
       from samples
       group by pipeline_id`,
      [orgId, pipelineIds]
    ),
    triggeredByIds.length > 0
      ? query<ActorRow>(
          `select id, email, display_name
           from auth_users
           where id = any($1::uuid[])`,
          [triggeredByIds]
        )
      : Promise.resolve([]),
  ]);
}

export async function hydratePipelinesWithTelemetry(
  orgId: string,
  pipelines: ConductorPipeline[]
): Promise<HydratedPipelineSummary[]> {
  if (pipelines.length === 0) {
    return [];
  }

  const pipelineIds = pipelines.map((pipeline) => pipeline.id);
  const triggeredByIds = Array.from(
    new Set(
      pipelines
        .map((pipeline) => pipeline.last_run?.triggered_by)
        .filter((actorId): actorId is string => typeof actorId === 'string' && actorId.trim().length > 0)
    )
  );
  const [
    runStatsRows,
    runDailyRows,
    activeRunRows,
    policyRejectionRows,
    oldestActiveRunAgeRows,
    medianFirstFailureRows,
    waitingManualDwellRows,
    actorRows,
  ] = await loadPipelineTelemetry({ orgId, pipelineIds, triggeredByIds });

  const dailyTotalRunsByPipelineId = new Map<string, number[]>();
  const dailySuccessRunsByPipelineId = new Map<string, number[]>();
  for (const row of runDailyRows) {
    const totalSeries = dailyTotalRunsByPipelineId.get(row.pipeline_id) ?? [];
    totalSeries.push(toInt(row.total_runs));
    dailyTotalRunsByPipelineId.set(row.pipeline_id, totalSeries);

    const successSeries = dailySuccessRunsByPipelineId.get(row.pipeline_id) ?? [];
    successSeries.push(toInt(row.success_runs));
    dailySuccessRunsByPipelineId.set(row.pipeline_id, successSeries);
  }

  const activeRunsByPipelineId = new Map(activeRunRows.map((row) => [row.pipeline_id, toInt(row.active_runs)]));
  const policyRejectionsByPipelineId = new Map(
    policyRejectionRows.map((row) => [row.pipeline_id, toInt(row.policy_rejections_7d)])
  );
  const oldestActiveRunAgeByPipelineId = new Map(
    oldestActiveRunAgeRows.map((row) => [row.pipeline_id, toNullableInt(row.oldest_active_run_age_seconds)])
  );
  const medianFirstFailureByPipelineId = new Map(
    medianFirstFailureRows.map((row) => [row.pipeline_id, toNullableInt(row.median_first_failure_ms)])
  );
  const waitingManualDwellByPipelineId = new Map(
    waitingManualDwellRows.map((row) => [row.pipeline_id, toNullableInt(row.waiting_manual_dwell_p50_ms)])
  );

  const runStatsByPipelineId = new Map<string, PipelineRunStats7d>();
  for (const row of runStatsRows) {
    const totalRuns = toInt(row.total_runs_7d);
    const successRuns = toInt(row.success_runs_7d);
    const failedRuns = toInt(row.failed_runs_7d);
    // Preserve 1 decimal place for list-page trend badges without sending
    // higher-precision floats that create noisy UI diffs.
    const successRate = totalRuns > 0 ? Math.round((successRuns * 1000) / totalRuns) / 10 : 0;
    runStatsByPipelineId.set(row.pipeline_id, {
      total_runs: totalRuns,
      success_runs: successRuns,
      failed_runs: failedRuns,
      success_rate: successRate,
      active_runs: activeRunsByPipelineId.get(row.pipeline_id) ?? 0,
      policy_rejections: policyRejectionsByPipelineId.get(row.pipeline_id) ?? 0,
      daily_total_runs: dailyTotalRunsByPipelineId.get(row.pipeline_id) ?? [...DEFAULT_DAILY_SERIES],
      daily_success_runs: dailySuccessRunsByPipelineId.get(row.pipeline_id) ?? [...DEFAULT_DAILY_SERIES],
      oldest_active_run_age_seconds: oldestActiveRunAgeByPipelineId.get(row.pipeline_id) ?? null,
      median_first_failure_ms: medianFirstFailureByPipelineId.get(row.pipeline_id) ?? null,
      waiting_manual_dwell_p50_ms: waitingManualDwellByPipelineId.get(row.pipeline_id) ?? null,
    });
  }

  const actorById = new Map(actorRows.map((row) => [row.id, row]));

  return pipelines.map((pipeline) => {
    // Hydrate actor display fields once at API boundary so UI pages can render list + detail
    // cards without extra identity fan-out calls.
    const actorId = pipeline.last_run?.triggered_by ?? null;
    const actor = actorId ? actorById.get(actorId) : undefined;
    const lastRun = pipeline.last_run
      ? {
          ...pipeline.last_run,
          triggered_by_email: actor?.email ?? null,
          triggered_by_name: actor?.display_name ?? null,
        }
      : null;

    return {
      ...pipeline,
      last_run: lastRun,
      run_stats_7d: runStatsByPipelineId.get(pipeline.id) ?? createDefaultRunStats7d(),
    };
  });
}
