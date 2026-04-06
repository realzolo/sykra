import { NextResponse } from 'next/server';
import { withAuthedRoute } from '@/services/apiRoute';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { getPipelineStepLogForOrg } from '@/features/pipeline-runs/application/managePipelineRunOperationsForOrg';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export const GET = withAuthedRoute<{ runId: string; stepId: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ request, params, orgId }) => {
    const { runId, stepId } = await params;
    const offset = Number(request.nextUrl.searchParams.get('offset') ?? 0);
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 200000);
    const result = await getPipelineStepLogForOrg({
      runId,
      stepId,
      orgId: orgId!,
      offset: Number.isNaN(offset) ? 0 : offset,
      limit: Number.isNaN(limit) ? 200000 : limit,
    });
    const response = new NextResponse(result.data);
    response.headers.set('Content-Type', 'text/plain; charset=utf-8');
    response.headers.set('X-Log-Next-Offset', String(result.nextOffset));
    return response;
  }
);
