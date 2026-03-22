import { NextResponse } from 'next/server';
import { getSession, unauthorized } from '@/services/auth';
import { getActiveOrgId, getUserOrgs } from '@/services/orgs';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const [orgs, activeOrgId] = await Promise.all([
    getUserOrgs(session.user.id),
    getActiveOrgId(session.user.id, session.user.email ?? undefined, request),
  ]);

  return NextResponse.json({
    user: session.user,
    orgs,
    activeOrgId,
  });
}
