import { withAuthedRoute } from '@/services/apiRoute';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { openPipelineStepLogStreamForOrg } from '@/features/pipeline-runs/application/managePipelineRunOperationsForOrg';

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
    return openPipelineStepLogStreamForOrg({
      runId,
      stepId,
      orgId: orgId!,
      signal: request.signal,
      offset: Number.isNaN(offset) ? 0 : offset,
      limit: Number.isNaN(limit) ? 200000 : limit,
    });
  }
);
