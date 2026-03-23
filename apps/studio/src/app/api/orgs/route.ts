import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { exec, queryOne } from '@/lib/db';
import { ensurePersonalOrg, getUserOrgs } from '@/services/orgs';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { organizationCoreColumnList } from '@/services/sql/projections';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
  owner_id: string | null;
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  await ensurePersonalOrg(user.id, user.email ?? undefined);
  const orgs = await getUserOrgs(user.id);
  return NextResponse.json(orgs);
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await request.json();
  const name = String(body?.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const baseSlug = slugify(body?.slug || name) || `org-${user.id.slice(0, 8)}`;
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  const org = await queryOne<OrgRow>(
    `insert into organizations
      (name, slug, is_personal, owner_id, created_at, updated_at)
     values ($1,$2,false,$3,now(),now())
     returning ${organizationCoreColumnList}`,
    [name, slug, user.id]
  );

  if (!org) {
    return NextResponse.json({ error: 'Failed to create org' }, { status: 500 });
  }

  await exec(
    `insert into org_members (org_id, user_id, role, status, created_at, updated_at)
     values ($1,$2,'owner','active',now(),now())
     on conflict (org_id, user_id) do nothing`,
    [org.id, user.id]
  );

  const clientInfo = extractClientInfo(request);
  await auditLogger.log({
    action: 'create',
    entityType: 'org',
    entityId: org.id,
    userId: user.id,
    changes: { name, slug },
    ...clientInfo,
  });

  return NextResponse.json(org, { status: 201 });
}
