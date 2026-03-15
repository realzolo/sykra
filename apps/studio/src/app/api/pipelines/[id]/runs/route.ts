import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { createPipelineRun, listPipelineRuns, getPipeline } from '@/services/runnerClient';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();
    const pipelineData = await getPipeline(params.id);
    const pipeline = (pipelineData as any)?.pipeline ?? (pipelineData as any)?.Pipeline;
    if (!pipeline) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (pipeline.org_id && pipeline.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const limitRaw = request.nextUrl.searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : 20;
    const runs = await listPipelineRuns(params.id, Number.isNaN(limit) ? 20 : limit);
    return NextResponse.json(runs);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const body = await request.json();
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const pipelineData = await getPipeline(params.id);
    const pipeline = (pipelineData as any)?.pipeline ?? (pipelineData as any)?.Pipeline;
    if (!pipeline) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (pipeline.org_id && pipeline.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const payload = {
      triggerType: body?.triggerType ?? 'manual',
      triggeredBy: user.id,
      idempotencyKey: body?.idempotencyKey ?? '',
      metadata: body?.metadata ?? {},
    };
    const result = await createPipelineRun(params.id, payload);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
