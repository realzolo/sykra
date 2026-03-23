import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { exec, queryOne } from '@/lib/db';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { ORG_COOKIE } from '@/services/orgs';
import { orgInviteAcceptColumnList } from '@/services/sql/projections';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type InviteRow = {
  id: string;
  org_id: string;
  role: string;
  email: string | null;
  expires_at: string;
  accepted_at: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const { token } = await params;
  const invite = await queryOne<InviteRow>(
    `select ${orgInviteAcceptColumnList}
     from org_invites
     where token = $1`,
    [token]
  );

  if (!invite) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }

  if (invite.accepted_at) {
    return NextResponse.json({ error: 'Invite already accepted' }, { status: 409 });
  }

  const inviteEmail = String(invite.email || '').toLowerCase();
  const userEmail = String(user.email || '').toLowerCase();
  if (!inviteEmail || !userEmail || inviteEmail !== userEmail) {
    return NextResponse.json({ error: 'Invite email does not match your account' }, { status: 403 });
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Invite expired' }, { status: 410 });
  }

  await exec(
    `insert into org_members (org_id, user_id, role, status, created_at, updated_at)
     values ($1,$2,$3,'active',now(),now())
     on conflict (org_id, user_id) do update set role = excluded.role, status = 'active', updated_at = now()`,
    [invite.org_id, user.id, invite.role]
  );

  await exec(
    `update org_invites set accepted_at = now() where id = $1`,
    [invite.id]
  );

  const clientInfo = extractClientInfo(request);
  await auditLogger.log({
    action: 'update',
    entityType: 'org',
    entityId: invite.org_id,
    userId: user.id,
    changes: { accepted: true },
    ...clientInfo,
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set(ORG_COOKIE, invite.org_id, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'lax',
  });
  return response;
}
