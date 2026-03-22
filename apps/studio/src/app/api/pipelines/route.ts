import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES, requireProjectAccess } from '@/services/orgs';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { createPipelineSchema, projectIdSchema, validateRequest } from '@/services/validation';
import { createPipeline, listPipelines } from '@/services/conductorClient';
import type { ConductorCreatePipelineRequest } from '@spec-axis/contracts/conductor';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

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
      await requireProjectAccess(projectId, user.id);
    }

    const data = await listPipelines(orgId, projectId);
    if (!projectId) {
      return NextResponse.json(data);
    }

    const filtered = data.filter((item) => item.project_id === projectId);
    return NextResponse.json(filtered);
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

    const payload: ConductorCreatePipelineRequest = {
      orgId,
      name: validated.name,
      description: validated.description ?? '',
      config: validated.config,
      createdBy: user.id,
    };
    if (validated.projectId) {
      await requireProjectAccess(validated.projectId, user.id);
      payload.projectId = validated.projectId;
    }
    const result = await createPipeline(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
