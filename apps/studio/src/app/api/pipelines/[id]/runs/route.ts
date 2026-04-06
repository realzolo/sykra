import { NextResponse } from 'next/server';
import { extractClientInfo } from '@/services/audit';
import { getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { withAuthedRoute } from '@/services/apiRoute';
import {
  createPipelineRunForOrg,
  listPipelineRunsForOrg,
} from '@/features/pipelines/application/managePipelineRunsForOrg';

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
    const parsedLimit = limitRaw ? Number(limitRaw) : 20;
    const result = await listPipelineRunsForOrg({
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
    return NextResponse.json(result.runs);
  }
);

export const POST = withAuthedRoute<{ id: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ request, params, user, orgId }) => {
    const { id } = await params;
    const body = await request.json();
    const role = await getOrgMemberRole(orgId!, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const result = await createPipelineRunForOrg({
      pipelineId: id,
      orgId: orgId!,
      userId: user.id,
      body,
      clientInfo: extractClientInfo(request),
    });
    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.kind === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (result.kind === 'rollback_requires_project') {
      return NextResponse.json({ error: 'Rollback requires a project-scoped pipeline' }, { status: 409 });
    }
    if (result.kind === 'rollback_artifact_missing') {
      return NextResponse.json(
        { error: 'Rollback requires a published artifact version for the source run' },
        { status: 409 }
      );
    }
    return NextResponse.json(result.run, { status: 202 });
  }
);
