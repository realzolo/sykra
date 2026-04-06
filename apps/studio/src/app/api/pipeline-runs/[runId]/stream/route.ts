import type { NextRequest } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { withAuthedRoute } from '@/services/apiRoute';
import { openPipelineRunStreamForOrg } from '@/features/pipeline-runs/application/openPipelineRunStreamForOrg';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export const GET = withAuthedRoute<{ runId: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ request, params, orgId }: { request: NextRequest; params: Promise<{ runId: string }>; orgId?: string }) => {
    const { runId } = await params;
    return openPipelineRunStreamForOrg({
      request,
      runId,
      orgId: orgId!,
    });
  }
);
