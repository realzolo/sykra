import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { cancelPipelineRun, getPipelineRun } from '@/services/conductorClient';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { runId } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const detail = await getPipelineRun(runId);
    const run = detail.run;
    if (run.org_id && run.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await cancelPipelineRun(runId);

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'update',
      entityType: 'pipeline',
      entityId: run.pipeline_id,
      userId: user.id,
      changes: {
        scope: 'pipeline_run',
        runId,
        projectId: run.project_id ?? null,
        status: 'canceled',
        reason: 'terminated_by_user',
      },
      ...clientInfo,
    });

    return NextResponse.json(result);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
