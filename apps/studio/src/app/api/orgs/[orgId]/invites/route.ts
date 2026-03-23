import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { query, queryOne } from '@/lib/db';
import { getOrgMemberRole } from '@/services/orgs';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { orgInviteColumnList } from '@/services/sql/projections';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type OrgInviteRow = {
  id: string;
  org_id: string;
  email: string;
  role: 'owner' | 'admin' | 'reviewer' | 'member';
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  created_by: string | null;
};

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const { orgId } = await params;
  const role = await getOrgMemberRole(orgId, user.id);
  if (!role) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const data = await query<OrgInviteRow>(
    `select ${orgInviteColumnList}
     from org_invites
     where org_id = $1
     order by created_at desc`,
    [orgId]
  );

  return NextResponse.json(data || []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const { orgId } = await params;
  const role = await getOrgMemberRole(orgId, user.id);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const email = String(body?.email || '').trim().toLowerCase();
  const inviteRole = String(body?.role || 'member') as 'owner' | 'admin' | 'reviewer' | 'member';

  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  if (!['owner', 'admin', 'reviewer', 'member'].includes(inviteRole)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const invite = await queryOne<OrgInviteRow>(
    `insert into org_invites
      (org_id, email, role, token, expires_at, created_by, created_at)
     values ($1,$2,$3,$4,$5,$6,now())
     returning ${orgInviteColumnList}`,
    [orgId, email, inviteRole, token, expiresAt, user.id]
  );

  if (!invite) {
    return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
  }

  const clientInfo = extractClientInfo(request);
  await auditLogger.log({
    action: 'create',
    entityType: 'org',
    entityId: orgId,
    userId: user.id,
    changes: { email, role: inviteRole },
    ...clientInfo,
  });

  return NextResponse.json(invite, { status: 201 });
}
