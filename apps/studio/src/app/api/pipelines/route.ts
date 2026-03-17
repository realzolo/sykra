import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { createPipelineSchema, validateRequest } from '@/services/validation';
import { createPipeline, listPipelines } from '@/services/runnerClient';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
    const data = await listPipelines(orgId, projectId);
    return NextResponse.json(data);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const body = await request.json();
    const validated = validateRequest(createPipelineSchema, body);
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload: Record<string, unknown> = {
      orgId,
      name: validated.name,
      description: validated.description ?? '',
      environment: validated.environment ?? 'production',
      config: validated.config,
      autoTrigger: validated.config.source.autoTrigger,
      triggerBranch: validated.config.source.branch,
      qualityGateEnabled: validated.config.review.qualityGateEnabled,
      qualityGateMinScore: validated.config.review.qualityGateMinScore,
      notifyOnSuccess: validated.config.notifications.onSuccess,
      notifyOnFailure: validated.config.notifications.onFailure,
      createdBy: user.id,
    };
    if (validated.projectId) {
      payload.projectId = validated.projectId;
    }
    const result = await createPipeline(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
