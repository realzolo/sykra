import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exec, query, queryOne } from '@/lib/db';
import { requireUser, unauthorized } from '@/services/auth';
import { getOrgMemberRole } from '@/services/orgs';

const roles = ['owner', 'admin', 'reviewer', 'member'] as const;
type OrgRole = (typeof roles)[number];
type OrgMemberRow = {
  user_id: string;
  role: OrgRole;
  status: string;
  created_at: string;
  email: string | null;
};

function isValidRole(value: string): value is OrgRole {
  return roles.includes(value as OrgRole);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { orgId } = await params;
  const requesterRole = await getOrgMemberRole(orgId, user.id);
  if (!requesterRole) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const members = await query<OrgMemberRow>(
    `select m.user_id, m.role, m.status, m.created_at, u.email
     from org_members m
     left join auth_users u on u.id = m.user_id
     where m.org_id = $1
     order by m.created_at asc`,
    [orgId]
  );

  return NextResponse.json(members ?? []);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { orgId } = await params;
  const requesterRole = await getOrgMemberRole(orgId, user.id);
  if (!requesterRole || (requesterRole !== 'owner' && requesterRole !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const userId = String(body?.userId || '').trim();
  const nextRole = String(body?.role || '').trim();

  if (!userId || !isValidRole(nextRole)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (requesterRole !== 'owner' && nextRole === 'owner') {
    return NextResponse.json({ error: 'Only owners can assign owner role' }, { status: 403 });
  }

  const target = await queryOne<{ role: OrgRole }>(
    `select role from org_members where org_id = $1 and user_id = $2`,
    [orgId, userId]
  );

  if (!target) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  if (target.role === 'owner' && requesterRole !== 'owner') {
    return NextResponse.json({ error: 'Only owners can update other owners' }, { status: 403 });
  }

  if (userId === user.id && target.role === 'owner' && nextRole !== 'owner') {
    return NextResponse.json({ error: 'Cannot change your own owner role' }, { status: 400 });
  }

  await exec(
    `update org_members set role = $1, updated_at = now()
     where org_id = $2 and user_id = $3`,
    [nextRole, orgId, userId]
  );

  const updated = await queryOne<OrgMemberRow>(
    `select m.user_id, m.role, m.status, m.created_at, u.email
     from org_members m
     left join auth_users u on u.id = m.user_id
     where m.org_id = $1 and m.user_id = $2`,
    [orgId, userId]
  );

  if (!updated) {
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }

  return NextResponse.json(updated);
}
