import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRuleSets, createRuleSet } from '@/services/db';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
  const data = await getRuleSets(orgId);
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await request.json();
  if (!body.name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
  const role = await getOrgMemberRole(orgId, user.id);
  if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const data = await createRuleSet({ ...body, org_id: orgId });
  return NextResponse.json(data);
}
