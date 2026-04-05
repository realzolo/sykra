import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { createPipelineRun, listPipelineRuns, getPipeline } from '@/services/conductorGateway';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();
    const pipelineData = await getPipeline(id);
    const pipeline = pipelineData.pipeline;
    if (!pipeline) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (pipeline.org_id && pipeline.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const limitRaw = request.nextUrl.searchParams.get('limit');
    const parsedLimit = limitRaw ? Number(limitRaw) : 20;
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, Math.trunc(parsedLimit))) : 20;
    const runs = await listPipelineRuns(id, limit);
    const triggeredByIds = Array.from(
      new Set(
        runs
          .map((run) => run.triggered_by)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );
    if (triggeredByIds.length === 0) {
      return NextResponse.json(runs);
    }

    const users = await query<{ id: string; email: string | null; display_name: string | null }>(
      `select id, email, display_name
         from auth_users
        where id = any($1::uuid[])`,
      [triggeredByIds]
    );
    const userById = new Map(users.map((item) => [item.id, item]));
    const hydrated = runs.map((run) => {
      const actor = run.triggered_by ? userById.get(run.triggered_by) : undefined;
      if (!actor) return run;
      return {
        ...run,
        triggered_by_email: actor.email,
        triggered_by_name: actor.display_name,
      };
    });
    return NextResponse.json(hydrated);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const body = await request.json();
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const pipelineData = await getPipeline(id);
    const pipeline = pipelineData.pipeline;
    if (!pipeline) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (pipeline.org_id && pipeline.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (body?.triggerType === 'rollback') {
      if (!pipeline.project_id) {
        return NextResponse.json({ error: 'Rollback requires a project-scoped pipeline' }, { status: 409 });
      }
      const publishedArtifactVersion = await queryOne<{ id: string }>(
        `select id
         from artifact_versions
         where org_id = $1
           and project_id = $2
           and source_run_id = $3
           and source_pipeline_id = $4
           and status = 'published'
         order by created_at desc
         limit 1`,
        [orgId, pipeline.project_id, body?.rollbackOf, id]
      );
      if (!publishedArtifactVersion) {
        return NextResponse.json(
          { error: 'Rollback requires a published artifact version for the source run' },
          { status: 409 }
        );
      }
    }

    const payload = {
      triggerType: body?.triggerType ?? 'manual',
      triggeredBy: user.id,
      idempotencyKey: body?.idempotencyKey ?? '',
      metadata: body?.metadata ?? {},
      ...(body?.rollbackOf ? { rollbackOf: body.rollbackOf } : {}),
    };
    const result = await createPipelineRun(id, payload);

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'create',
      entityType: 'pipeline',
      entityId: id,
      userId: user.id,
      changes: {
        scope: 'pipeline_run',
        runId: result.id,
        projectId: pipeline.project_id ?? null,
        triggerType: payload.triggerType,
        rollbackOf: payload.rollbackOf ?? null,
      },
      ...clientInfo,
    });

    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
