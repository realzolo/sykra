import { NextResponse } from 'next/server';
import { withAuthedRoute } from '@/services/apiRoute';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { issuePipelineRunArtifactDownloadTokenForOrg } from '@/features/pipeline-runs/application/managePipelineRunArtifactsForOrg';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export const POST = withAuthedRoute<{ runId: string; artifactId: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ params, user, orgId }) => {
    const { runId, artifactId } = await params;
    const result = await issuePipelineRunArtifactDownloadTokenForOrg({
      runId,
      artifactId,
      orgId: orgId!,
      userId: user.id,
    });
    return NextResponse.json(result);
  }
);
