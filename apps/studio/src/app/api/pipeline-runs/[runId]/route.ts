import { NextResponse } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { withAuthedRoute } from '@/services/apiRoute';
import { getPipelineRunDetailForOrg } from '@/features/pipeline-runs/application/getPipelineRunDetailForOrg';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export const GET = withAuthedRoute<{ runId: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ params, orgId }) => {
    const { runId } = await params;
    const detail = await getPipelineRunDetailForOrg({ runId, orgId: orgId! });
    return NextResponse.json(detail);
  }
);
