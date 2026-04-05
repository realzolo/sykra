import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { getPipelineRun, triggerPipelineRunJob } from '@/services/conductorGateway';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; jobId: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { runId, jobId } = await params;
    const body = await request.json().catch(() => ({}));
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

    const approvalComment =
      typeof body?.comment === 'string' && body.comment.trim().length > 0 ? body.comment.trim() : undefined;
    const result = await triggerPipelineRunJob(runId, jobId, {
      approvedBy: user.id,
      ...(user.email ? { approvedByEmail: user.email } : {}),
      ...(user.displayName ? { approvedByName: user.displayName } : {}),
      ...(approvalComment ? { comment: approvalComment } : {}),
    });

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'update',
      entityType: 'pipeline',
      entityId: run.pipeline_id,
      userId: user.id,
      changes: {
        scope: 'pipeline_run_job',
        runId,
        jobId,
        action: 'manual_trigger',
        projectId: run.project_id ?? null,
        approvedBy: user.id,
        approvedByEmail: user.email ?? null,
        approvedByName: user.displayName ?? null,
        approvalComment: approvalComment ?? null,
      },
      ...clientInfo,
    });

    return NextResponse.json(result);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
