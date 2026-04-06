import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { createPipelineSchema, projectIdSchema } from '@/services/validation';
import {
  formatZodValidationError,
  logPipelinePolicyRejection,
  mapPipelineValidationErrorToPolicyViolation,
} from '@/services/pipelinePolicy';
import { listPipelinesForOrg } from '@/features/pipelines/application/listPipelinesForOrg';
import { createPipelineForOrg } from '@/features/pipelines/application/createPipelineForOrg';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const projectIdRaw = request.nextUrl.searchParams.get('projectId');
    let projectId: string | undefined;
    if (projectIdRaw) {
      projectId = projectIdSchema.parse(projectIdRaw);
    }
    const hydrated = await listPipelinesForOrg({
      orgId,
      userId: user.id,
      ...(projectId ? { projectId } : {}),
    });
    return NextResponse.json(hydrated);
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
    const clientInfo = extractClientInfo(request);
    const body = await request.json();
    const parsed = createPipelineSchema.safeParse(body);
    if (!parsed.success) {
      const validationError = new Error(`Validation error: ${formatZodValidationError(parsed.error)}`);
      const policyViolation = mapPipelineValidationErrorToPolicyViolation(validationError);
      if (policyViolation) {
        await logPipelinePolicyRejection({
          userId: user.id,
          operation: 'create',
          violation: policyViolation,
          ...clientInfo,
        });
        return NextResponse.json(
          { error: policyViolation.message, reason_code: policyViolation.reasonCode },
          { status: policyViolation.statusCode }
        );
      }
      return NextResponse.json({ error: validationError.message }, { status: 400 });
    }
    const validated = parsed.data;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const createResult = await createPipelineForOrg({
      orgId,
      userId: user.id,
      validated,
      clientInfo,
    });
    if (createResult.kind === 'policy_reject') {
      return NextResponse.json(
        { error: createResult.violation.message, reason_code: createResult.violation.reasonCode },
        { status: createResult.violation.statusCode }
      );
    }

    return NextResponse.json(createResult.result, { status: 201 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
