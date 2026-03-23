import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { updatePipelineSchema, validateRequest } from '@/services/validation';
import { deletePipeline, getPipeline, updatePipeline } from '@/services/conductorGateway';
import { query as dbQuery } from '@/lib/db';
import type { ConductorUpdatePipelineRequest } from '@sykra/contracts/conductor';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();
    const data = await getPipeline(id);
    const pipeline = data.pipeline;
    if (!pipeline) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (pipeline.org_id && pipeline.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Augment with concurrency_mode from Studio DB (must exist; schema is treated as required).
    const rows = await dbQuery<{ concurrency_mode: 'allow' | 'queue' | 'cancel_previous' }>(
      `SELECT concurrency_mode FROM pipelines WHERE id = $1`,
      [id]
    );
    const concurrencyRow = rows[0];
    if (concurrencyRow) {
      pipeline.concurrency_mode = concurrencyRow.concurrency_mode;
    }
    return NextResponse.json(data);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const body = await request.json();
    const validated = validateRequest(updatePipelineSchema, body);
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const existing = await getPipeline(id);
    const pipeline = existing.pipeline;
    if (!pipeline) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (pipeline.org_id && pipeline.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload: ConductorUpdatePipelineRequest = {
      name: validated.name ?? pipeline.name,
      description: validated.description ?? pipeline.description,
      config: validated.config,
      updatedBy: user.id,
    };
    const result = await updatePipeline(id, payload);
    return NextResponse.json(result);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const body = await request.json();
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const VALID_MODES = ['allow', 'queue', 'cancel_previous'];
    const concurrencyMode = body?.concurrency_mode;
    if (!concurrencyMode || !VALID_MODES.includes(concurrencyMode)) {
      return NextResponse.json({ error: 'Invalid concurrency_mode' }, { status: 400 });
    }

    await dbQuery(
      `UPDATE pipelines SET concurrency_mode = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
      [concurrencyMode, id, orgId]
    );
    return NextResponse.json({ concurrency_mode: concurrencyMode });
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

    const existing = await getPipeline(id);
    const pipeline = existing.pipeline;
    if (!pipeline) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (pipeline.org_id && pipeline.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await deletePipeline(id);

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'delete',
      entityType: 'pipeline',
      entityId: id,
      changes: {
        scope: 'pipeline',
        name: pipeline.name,
      },
      ...clientInfo,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
