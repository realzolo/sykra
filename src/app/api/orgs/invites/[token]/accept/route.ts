import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { ORG_COOKIE } from '@/services/orgs';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const { token } = await params;
  const db = createAdminClient();

  const { data: invite, error } = await db
    .from('org_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error || !invite) {
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

  await db.from('org_members').upsert({
    org_id: invite.org_id,
    user_id: user.id,
    role: invite.role,
    status: 'active',
  });

  await db
    .from('org_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

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
