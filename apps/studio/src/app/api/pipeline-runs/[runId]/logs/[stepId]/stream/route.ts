import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { getPipelineRun, openPipelineStepLogStream } from '@/services/conductorClient';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; stepId: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { runId, stepId } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    const runData = await getPipelineRun(runId);
    if (runData.run.org_id && runData.run.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const offset = Number(request.nextUrl.searchParams.get('offset') ?? 0);
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 200000);
    const upstream = await openPipelineStepLogStream(
      runId,
      stepId,
      request.signal,
      Number.isNaN(offset) ? 0 : offset,
      Number.isNaN(limit) ? 200000 : limit
    );
    const headers = new Headers(upstream.headers);
    headers.set('Content-Type', headers.get('Content-Type') ?? 'text/plain; charset=utf-8');
    headers.set('Cache-Control', 'no-cache, no-transform');
    headers.set('Connection', 'keep-alive');
    headers.set('X-Accel-Buffering', 'no');
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
