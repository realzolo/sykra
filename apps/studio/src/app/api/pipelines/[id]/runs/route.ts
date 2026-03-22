import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { createPipelineRun, listPipelineRuns, getPipeline, cancelPipelineRun } from '@/services/conductorClient';
import { queryOne, query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

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
    const limit = limitRaw ? Number(limitRaw) : 20;
    const runs = await listPipelineRuns(id, Number.isNaN(limit) ? 20 : limit);
    return NextResponse.json(runs);
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

    // Check concurrency mode from Studio DB
    const pipelineRow = await queryOne<{ concurrency_mode: string }>(
      `SELECT concurrency_mode FROM pipelines WHERE id = $1`,
      [id]
    );
    const concurrencyMode = pipelineRow?.concurrency_mode ?? 'allow';

    if (concurrencyMode === 'queue' || concurrencyMode === 'cancel_previous') {
      // Find active runs for this pipeline
      const activeRuns = await query<{ id: string; status: string }>(
        `SELECT id, status FROM pipeline_runs WHERE pipeline_id = $1 AND status IN ('queued', 'running', 'waiting_manual') ORDER BY created_at ASC`,
        [id]
      );

      if (activeRuns.length > 0) {
        if (concurrencyMode === 'queue') {
          return NextResponse.json(
            { error: 'Pipeline run already in progress', mode: 'queue' },
            { status: 409 }
          );
        } else if (concurrencyMode === 'cancel_previous') {
          // Cancel all active runs before proceeding
          await Promise.allSettled(activeRuns.map(r => cancelPipelineRun(r.id)));
        }
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
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
