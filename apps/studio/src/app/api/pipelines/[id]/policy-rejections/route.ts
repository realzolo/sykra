import { NextResponse } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { withAuthedRoute } from '@/services/apiRoute';
import { listPipelinePolicyRejectionsForOrg } from '@/features/pipelines/application/listPipelinePolicyRejectionsForOrg';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export const GET = withAuthedRoute<{ id: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ request, params, orgId }) => {
    const { id } = await params;

    const limitRaw = request.nextUrl.searchParams.get('limit');
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
    const result = await listPipelinePolicyRejectionsForOrg({
      pipelineId: id,
      orgId: orgId!,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
    });
    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.kind === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ items: result.items });
  }
);
