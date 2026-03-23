import { z } from 'zod';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import {
  getActiveOrgId,
  getOrgMemberRole,
  isRoleAllowed,
  ORG_ADMIN_ROLES,
  requireProjectAccess,
} from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { promoteProjectArtifactChannel } from '@/services/artifactRegistry';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

const promoteSchema = z.object({
  repositoryId: z.string().uuid(),
  versionId: z.string().uuid(),
  channelName: z.string().trim().min(1).max(32),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const project = await requireProjectAccess(id, user.id);
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (project.org_id !== orgId) return unauthorized();

    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = promoteSchema.parse(await request.json());
    const channel = await promoteProjectArtifactChannel({
      orgId,
      projectId: id,
      repositoryId: payload.repositoryId,
      versionId: payload.versionId,
      channelName: payload.channelName,
      updatedBy: user.id,
    });

    return NextResponse.json({ channel });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
