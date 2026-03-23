import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { query, exec } from '@/lib/db';
import { encrypt } from '@/lib/encryption';
import { getPipeline } from '@/services/conductorGateway';
import { auditLogger, extractClientInfo } from '@/services/audit';
import {
  PIPELINE_SECRET_MAX_COUNT,
  normalizePipelineSecretName,
  validatePipelineSecretName,
  validatePipelineSecretValue,
} from '@/services/pipelineSecrets';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

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
  const pipeline = data.pipeline;
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
    const name = normalizePipelineSecretName(String(body?.name ?? ''));
    const value = typeof body?.value === 'string' ? body.value : String(body?.value ?? '');

    const nameError = validatePipelineSecretName(name);
    if (nameError === 'required') {
      return NextResponse.json({ error: 'name_required' }, { status: 400 });
    }
    if (nameError === 'invalid_format' || !isValidEnvKey(name)) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    }
    if (nameError === 'too_long') {
      return NextResponse.json({ error: 'name_too_long' }, { status: 400 });
    }
    if (nameError === 'reserved_name') {
      return NextResponse.json({ error: 'reserved_name' }, { status: 400 });
    }

    const valueError = validatePipelineSecretValue(value);
    if (valueError === 'required') {
      return NextResponse.json({ error: 'value_required' }, { status: 400 });
    }
    if (valueError === 'too_large') {
      return NextResponse.json({ error: 'value_too_large' }, { status: 400 });
    }

    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const gate = await requirePipelineInOrg(id, orgId);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const existing = await query<{ name: string }>(
      `select name
       from pipeline_secrets
       where pipeline_id = $1 and org_id = $2 and name = $3`,
      [id, orgId, name]
    );
    const alreadyExists = existing.length > 0;
    if (!alreadyExists) {
      const counts = await query<{ count: string }>(
        `select count(*)::text as count
         from pipeline_secrets
         where pipeline_id = $1 and org_id = $2`,
        [id, orgId]
      );
      const currentCount = Number(counts[0]?.count ?? '0');
      if (currentCount >= PIPELINE_SECRET_MAX_COUNT) {
        return NextResponse.json({ error: 'secret_limit_exceeded' }, { status: 400 });
      }
    }

    const encrypted = encrypt(value);

    await exec(
      `insert into pipeline_secrets (pipeline_id, org_id, name, value_encrypted, created_at, updated_at)
       values ($1,$2,$3,$4,now(),now())
       on conflict (pipeline_id, name)
       do update set value_encrypted = excluded.value_encrypted, updated_at = now()`,
      [id, orgId, name, encrypted]
    );

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: alreadyExists ? 'update' : 'create',
      entityType: 'pipeline',
      entityId: id,
      userId: user.id,
      changes: {
        scope: 'pipeline_secret',
        name,
      },
      ...clientInfo,
    });

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

    const name = normalizePipelineSecretName(request.nextUrl.searchParams.get('name') ?? '');
    if (!name) {
      return NextResponse.json({ error: 'name_required' }, { status: 400 });
    }

    await exec(
      `delete from pipeline_secrets where pipeline_id = $1 and org_id = $2 and name = $3`,
      [id, orgId, name]
    );

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'delete',
      entityType: 'pipeline',
      entityId: id,
      userId: user.id,
      changes: {
        scope: 'pipeline_secret',
        name,
      },
      ...clientInfo,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
