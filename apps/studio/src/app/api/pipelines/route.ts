import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES, requireProjectAccess } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { createPipelineSchema, projectIdSchema } from '@/services/validation';
import { createPipeline, listPipelines } from '@/services/conductorGateway';
import { exec, query } from '@/lib/db';
import { PIPELINE_ACTIVE_STATUSES_SQL } from '@/services/statuses';
import {
  findCreatePipelinePolicyViolation,
  formatZodValidationError,
  logPipelinePolicyRejection,
  mapPipelineValidationErrorToPolicyViolation,
} from '@/services/pipelinePolicy';
import type { ConductorCreatePipelineRequest } from '@sykra/contracts/conductor';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const projectIdRaw = request.nextUrl.searchParams.get('projectId');
    let projectId: string | undefined;
    if (projectIdRaw) {
      projectId = projectIdSchema.parse(projectIdRaw);
      await requireProjectAccess(projectId, user.id);
    }

    const data = await listPipelines(orgId, projectId);
    const pipelines = projectId ? data.filter((item) => item.project_id === projectId) : data;
    if (pipelines.length === 0) {
      return NextResponse.json(pipelines);
    }

    const pipelineIds = pipelines.map((item) => item.id);
    const trendWindowDays = 7;
    const defaultDailySeries = Array.from({ length: trendWindowDays }, () => 0);
    const triggeredByIds = Array.from(
      new Set(
        pipelines
          .map((item) => item.last_run?.triggered_by)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
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
      userRows,
    ] = await Promise.all([
      query<{
        pipeline_id: string;
        total_runs_7d: string;
        success_runs_7d: string;
        failed_runs_7d: string;
      }>(
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
      query<{
        pipeline_id: string;
        total_runs: string;
        success_runs: string;
      }>(
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
      query<{
        pipeline_id: string;
        active_runs: string;
      }>(
        `select pipeline_id, count(*)::text as active_runs
         from pipeline_runs
         where org_id = $1
           and pipeline_id = any($2::uuid[])
           and status in (${PIPELINE_ACTIVE_STATUSES_SQL})
         group by pipeline_id`,
        [orgId, pipelineIds]
      ),
      query<{
        pipeline_id: string;
        policy_rejections_7d: string;
      }>(
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
      query<{
        pipeline_id: string;
        oldest_active_run_age_seconds: string;
      }>(
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
      query<{
        pipeline_id: string;
        median_first_failure_ms: string;
      }>(
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
      query<{
        pipeline_id: string;
        waiting_manual_dwell_p50_ms: string;
      }>(
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
        ? query<{ id: string; email: string | null; display_name: string | null }>(
            `select id, email, display_name
             from auth_users
             where id = any($1::uuid[])`,
            [triggeredByIds]
          )
        : Promise.resolve([]),
    ]);
    const dailyTotalRunsByPipelineId = new Map<string, number[]>();
    const dailySuccessRunsByPipelineId = new Map<string, number[]>();
    for (const row of runDailyRows) {
      const totalRuns = Number.parseInt(row.total_runs, 10);
      const successRuns = Number.parseInt(row.success_runs, 10);
      const totalSeries = dailyTotalRunsByPipelineId.get(row.pipeline_id) ?? [];
      totalSeries.push(Number.isFinite(totalRuns) ? totalRuns : 0);
      dailyTotalRunsByPipelineId.set(row.pipeline_id, totalSeries);
      const successSeries = dailySuccessRunsByPipelineId.get(row.pipeline_id) ?? [];
      successSeries.push(Number.isFinite(successRuns) ? successRuns : 0);
      dailySuccessRunsByPipelineId.set(row.pipeline_id, successSeries);
    }
    const activeRunsByPipelineId = new Map(
      activeRunRows.map((row) => [row.pipeline_id, Number.parseInt(row.active_runs, 10) || 0])
    );
    const policyRejectionsByPipelineId = new Map(
      policyRejectionRows.map((row) => [row.pipeline_id, Number.parseInt(row.policy_rejections_7d, 10) || 0])
    );
    const oldestActiveRunAgeByPipelineId = new Map(
      oldestActiveRunAgeRows.map((row) => [row.pipeline_id, Number.parseInt(row.oldest_active_run_age_seconds, 10) || 0])
    );
    const medianFirstFailureByPipelineId = new Map(
      medianFirstFailureRows.map((row) => [row.pipeline_id, Number.parseInt(row.median_first_failure_ms, 10) || 0])
    );
    const waitingManualDwellByPipelineId = new Map(
      waitingManualDwellRows.map((row) => [row.pipeline_id, Number.parseInt(row.waiting_manual_dwell_p50_ms, 10) || 0])
    );
    const runStatsByPipelineId = new Map(
      runStatsRows.map((row) => {
        const totalRuns = Number.parseInt(row.total_runs_7d, 10);
        const successRuns = Number.parseInt(row.success_runs_7d, 10);
        const failedRuns = Number.parseInt(row.failed_runs_7d, 10);
        const successRate = totalRuns > 0 ? Math.round((successRuns * 1000) / totalRuns) / 10 : 0;
        return [
          row.pipeline_id,
          {
            total_runs: totalRuns,
            success_runs: successRuns,
            failed_runs: failedRuns,
            success_rate: successRate,
            active_runs: activeRunsByPipelineId.get(row.pipeline_id) ?? 0,
            policy_rejections: policyRejectionsByPipelineId.get(row.pipeline_id) ?? 0,
            daily_total_runs: dailyTotalRunsByPipelineId.get(row.pipeline_id) ?? [...defaultDailySeries],
            daily_success_runs: dailySuccessRunsByPipelineId.get(row.pipeline_id) ?? [...defaultDailySeries],
            oldest_active_run_age_seconds: oldestActiveRunAgeByPipelineId.get(row.pipeline_id) ?? null,
            median_first_failure_ms: medianFirstFailureByPipelineId.get(row.pipeline_id) ?? null,
            waiting_manual_dwell_p50_ms: waitingManualDwellByPipelineId.get(row.pipeline_id) ?? null,
          },
        ];
      })
    );
    const userById = new Map(userRows.map((row) => [row.id, row]));

    const hydrated = pipelines.map((item) => {
      const actorId = item.last_run?.triggered_by ?? null;
      const actor = actorId ? userById.get(actorId) : undefined;
      return {
        ...item,
        last_run: item.last_run
          ? {
              ...item.last_run,
              triggered_by_email: actor?.email ?? null,
              triggered_by_name: actor?.display_name ?? null,
            }
          : item.last_run,
        run_stats_7d: runStatsByPipelineId.get(item.id) ?? {
          total_runs: 0,
          success_runs: 0,
          failed_runs: 0,
          success_rate: 0,
          active_runs: 0,
          policy_rejections: 0,
          daily_total_runs: [...defaultDailySeries],
          daily_success_runs: [...defaultDailySeries],
          oldest_active_run_age_seconds: null,
          median_first_failure_ms: null,
          waiting_manual_dwell_p50_ms: null,
        },
      };
    });

    return NextResponse.json(hydrated);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const clientInfo = extractClientInfo(request);
    const body = await request.json();
    const parsed = createPipelineSchema.safeParse(body);
    if (!parsed.success) {
      const validationError = new Error(`Validation error: ${formatZodValidationError(parsed.error)}`);
      const policyViolation = mapPipelineValidationErrorToPolicyViolation(validationError);
      if (policyViolation) {
        await logPipelinePolicyRejection({
          userId: user.id,
          operation: 'create',
          violation: policyViolation,
          ...clientInfo,
        });
        return NextResponse.json(
          { error: policyViolation.message, reason_code: policyViolation.reasonCode },
          { status: policyViolation.statusCode }
        );
      }
      return NextResponse.json({ error: validationError.message }, { status: 400 });
    }
    const validated = parsed.data;
    const requestedConcurrencyMode = validated.concurrency_mode ?? 'queue';
    const policyViolation = findCreatePipelinePolicyViolation(validated.config, requestedConcurrencyMode);
    if (policyViolation) {
      await logPipelinePolicyRejection({
        userId: user.id,
        operation: 'create',
        violation: policyViolation,
        environment: validated.config.environment,
        requestedConcurrencyMode,
        ...clientInfo,
      });
      return NextResponse.json(
        { error: policyViolation.message, reason_code: policyViolation.reasonCode },
        { status: policyViolation.statusCode }
      );
    }
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload: ConductorCreatePipelineRequest = {
      orgId,
      name: validated.name,
      description: validated.description ?? '',
      config: validated.config,
      createdBy: user.id,
    };
    if (validated.projectId) {
      await requireProjectAccess(validated.projectId, user.id);
      payload.projectId = validated.projectId;
    }
    const result = await createPipeline(payload);
    await exec(
      `update pipelines
          set concurrency_mode = $1,
              updated_at = now()
        where id = $2
          and org_id = $3`,
      [requestedConcurrencyMode, result.pipeline.id, orgId]
    );

    await auditLogger.log({
      action: 'create',
      entityType: 'pipeline',
      entityId: result.pipeline.id,
      userId: user.id,
      changes: {
        scope: 'pipeline',
        projectId: payload.projectId ?? null,
        name: payload.name,
        environment: validated.config.environment,
        concurrencyMode: requestedConcurrencyMode,
      },
      ...clientInfo,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
