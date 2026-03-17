import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { query, exec } from '@/lib/db';
import { encrypt } from '@/lib/encryption';
import { getPipeline } from '@/services/runnerClient';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

type SecretMeta = {
  name: string;
  created_at: string;
  updated_at: string;
};

function isValidEnvKey(name: string): boolean {
  // Keep it shell-friendly and predictable.
  return /^[A-Z_][A-Z0-9_]*$/.test(name);
}

async function requirePipelineInOrg(pipelineId: string, orgId: string) {
  const data = await getPipeline(pipelineId);
  const pipeline = (data as any)?.pipeline ?? (data as any)?.Pipeline;
  if (!pipeline) {
    return { ok: false as const, status: 404, error: 'Not found' };
  }
  if (pipeline.org_id && pipeline.org_id !== orgId) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  return { ok: true as const };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    const gate = await requirePipelineInOrg(id, orgId);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const secrets = await query<SecretMeta>(
      `select name, created_at, updated_at
       from pipeline_secrets
       where pipeline_id = $1 and org_id = $2
       order by name asc`,
      [id, orgId]
    );

    return NextResponse.json({ secrets });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const name = String(body?.name ?? '').trim();
    const value = String(body?.value ?? '');

    if (!name) {
      return NextResponse.json({ error: 'name_required' }, { status: 400 });
    }
    if (!isValidEnvKey(name)) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    }
    if (!value) {
      return NextResponse.json({ error: 'value_required' }, { status: 400 });
    }

    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const gate = await requirePipelineInOrg(id, orgId);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const encrypted = encrypt(value);

    await exec(
      `insert into pipeline_secrets (pipeline_id, org_id, name, value_encrypted, created_at, updated_at)
       values ($1,$2,$3,$4,now(),now())
       on conflict (pipeline_id, name)
       do update set value_encrypted = excluded.value_encrypted, updated_at = now()`,
      [id, orgId, name, encrypted]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const gate = await requirePipelineInOrg(id, orgId);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const name = request.nextUrl.searchParams.get('name')?.trim() ?? '';
    if (!name) {
      return NextResponse.json({ error: 'name_required' }, { status: 400 });
    }

    await exec(
      `delete from pipeline_secrets where pipeline_id = $1 and org_id = $2 and name = $3`,
      [id, orgId, name]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

