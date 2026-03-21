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
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import {
  listProjectArtifactRepositories,
  normalizeArtifactChannelNames,
  normalizeArtifactRepositorySlug,
  publishProjectArtifacts,
} from '@/services/artifactRegistry';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

const publishSchema = z.object({
  runId: z.string().uuid(),
  artifactIds: z.array(z.string().uuid()).min(1),
  repositoryName: z.string().trim().min(1).max(100),
  repositorySlug: z.string().trim().max(64).optional(),
  repositoryDescription: z.string().trim().max(240).optional(),
  version: z.string().trim().min(1).max(128),
  channelNames: z.array(z.string().trim().min(1).max(32)).max(16).optional(),
});

export async function GET(
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

    const repositories = await listProjectArtifactRepositories(id, orgId);
    return NextResponse.json({ repositories });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

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

    const payload = publishSchema.parse(await request.json());
    const input = {
      orgId,
      projectId: id,
      runId: payload.runId,
      artifactIds: payload.artifactIds,
      repositoryName: payload.repositoryName,
      repositorySlug: normalizeArtifactRepositorySlug(payload.repositorySlug?.trim() || payload.repositoryName),
      version: payload.version,
      channelNames: normalizeArtifactChannelNames(payload.channelNames),
      publishedBy: user.id,
      ...(payload.repositoryDescription ? { repositoryDescription: payload.repositoryDescription } : {}),
    };
    const result = await publishProjectArtifacts(input);

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
