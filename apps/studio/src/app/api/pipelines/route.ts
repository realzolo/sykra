import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES, requireProjectAccess } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { createPipelineSchema, projectIdSchema, validateRequest } from '@/services/validation';
import { createPipeline, listPipelines } from '@/services/conductorGateway';
import { query } from '@/lib/db';
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
    const triggeredByIds = Array.from(
      new Set(
        pipelines
          .map((item) => item.last_run?.triggered_by)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    const [runStatsRows, userRows] = await Promise.all([
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
      triggeredByIds.length > 0
        ? query<{ id: string; email: string | null; display_name: string | null }>(
            `select id, email, display_name
             from auth_users
             where id = any($1::uuid[])`,
            [triggeredByIds]
          )
        : Promise.resolve([]),
    ]);

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
    const body = await request.json();
    const validated = validateRequest(createPipelineSchema, body);
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
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
