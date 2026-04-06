import { NextResponse } from 'next/server';
import { extractClientInfo } from '@/services/audit';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { withAuthedRoute } from '@/services/apiRoute';
import { retryPipelineRunJobForOrg } from '@/features/pipeline-runs/application/managePipelineRunOperationsForOrg';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export const POST = withAuthedRoute<{ runId: string; jobId: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ request, params, user, orgId }) => {
    const { runId, jobId } = await params;
    const result = await retryPipelineRunJobForOrg({
      runId,
      jobId,
      orgId: orgId!,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      clientInfo: extractClientInfo(request),
    });

    return NextResponse.json(result);
  }
);
