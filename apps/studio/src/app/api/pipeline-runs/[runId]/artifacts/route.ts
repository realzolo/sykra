import { NextResponse } from 'next/server';
import { withAuthedRoute } from '@/services/apiRoute';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { listPipelineRunArtifactsForOrg } from '@/features/pipeline-runs/application/managePipelineRunArtifactsForOrg';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export const GET = withAuthedRoute<{ runId: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ params, orgId }) => {
    const { runId } = await params;
    const result = await listPipelineRunArtifactsForOrg({
      runId,
      orgId: orgId!,
    });
    return NextResponse.json(result);
  }
);
