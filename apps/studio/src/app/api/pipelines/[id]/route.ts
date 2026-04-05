import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { updatePipelineSchema } from '@/services/validation';
import { deletePipeline, getPipeline, updatePipeline } from '@/services/conductorGateway';
import { query as dbQuery } from '@/lib/db';
import {
  findConcurrencyPatchPolicyViolation,
  findUpdatePipelinePolicyViolation,
  formatZodValidationError,
  logPipelinePolicyRejection,
  mapPipelineValidationErrorToPolicyViolation,
} from '@/services/pipelinePolicy';
import type { ConductorGetPipelineResponse, ConductorUpdatePipelineRequest } from '@sykra/contracts/conductor';

type HydratedPipelineVersion = NonNullable<ConductorGetPipelineResponse['version']> & {
  created_by_name?: string | null;
  created_by_email?: string | null;
};

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
    const response = data as ConductorGetPipelineResponse & {
      version: HydratedPipelineVersion | null;
      versions: HydratedPipelineVersion[];
    };
    const versionAuthorIds = Array.from(
      new Set(
        [
          response.version?.created_by,
          ...(Array.isArray(response.versions) ? response.versions.map((version) => version.created_by) : []),
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );
    if (versionAuthorIds.length > 0) {
      const authors = await dbQuery<{ id: string; email: string | null; display_name: string | null }>(
        `SELECT id, email, display_name
           FROM auth_users
          WHERE id = ANY($1::uuid[])`,
        [versionAuthorIds]
      );
      const authorById = new Map(authors.map((item) => [item.id, item]));
      response.version = response.version
        ? {
            ...response.version,
            created_by_name: response.version.created_by ? authorById.get(response.version.created_by)?.display_name ?? null : null,
            created_by_email: response.version.created_by ? authorById.get(response.version.created_by)?.email ?? null : null,
          }
        : response.version;
      response.versions = response.versions.map((version) => {
        const author = version.created_by ? authorById.get(version.created_by) : undefined;
        return {
          ...version,
          created_by_name: author?.display_name ?? null,
          created_by_email: author?.email ?? null,
        };
      });
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
    return NextResponse.json(response);
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
    const clientInfo = extractClientInfo(request);
    const body = await request.json();
    const parsed = updatePipelineSchema.safeParse(body);
    if (!parsed.success) {
      const validationError = new Error(`Validation error: ${formatZodValidationError(parsed.error)}`);
      const policyViolation = mapPipelineValidationErrorToPolicyViolation(validationError);
      if (policyViolation) {
        await logPipelinePolicyRejection({
          userId: user.id,
          entityId: id,
          operation: 'update',
          violation: policyViolation,
          ...clientInfo,
        });
        return NextResponse.json(
          { error: policyViolation.message, reason_code: policyViolation.reasonCode },
          { status: policyViolation.statusCode }
        );
      }
      return NextResponse.json({ error: validationError.message }, { status: 400 });
    }
    const validated = parsed.data;
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
    const modeRows = await dbQuery<{ concurrency_mode: 'allow' | 'queue' | 'cancel_previous' }>(
      `SELECT concurrency_mode FROM pipelines WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );
    if (modeRows.length === 0) {
      return NextResponse.json({ error: 'Pipeline concurrency metadata not found' }, { status: 500 });
    }
    const currentConcurrencyMode = modeRows[0]?.concurrency_mode ?? 'allow';
    const policyViolation = findUpdatePipelinePolicyViolation(validated.config, currentConcurrencyMode);
    if (policyViolation) {
      await logPipelinePolicyRejection({
        userId: user.id,
        entityId: id,
        operation: 'update',
        violation: policyViolation,
        environment: validated.config.environment,
        currentConcurrencyMode,
        ...clientInfo,
      });
      return NextResponse.json(
        { error: policyViolation.message, reason_code: policyViolation.reasonCode },
        { status: policyViolation.statusCode }
      );
    }

    const payload: ConductorUpdatePipelineRequest = {
      name: validated.name ?? pipeline.name,
      description: validated.description ?? pipeline.description,
      config: validated.config,
      updatedBy: user.id,
    };
    const result = await updatePipeline(id, payload);

    await auditLogger.log({
      action: 'update',
      entityType: 'pipeline',
      entityId: id,
      userId: user.id,
      changes: {
        scope: 'pipeline',
        name: payload.name,
        description: payload.description,
        environment: validated.config?.environment ?? pipeline.environment,
      },
      ...clientInfo,
    });

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
    const clientInfo = extractClientInfo(request);
    const body = await request.json();
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const VALID_MODES = ['allow', 'queue', 'cancel_previous'] as const;
    const concurrencyMode = body?.concurrency_mode as typeof VALID_MODES[number] | undefined;
    if (!concurrencyMode || !VALID_MODES.includes(concurrencyMode)) {
      return NextResponse.json({ error: 'Invalid concurrency_mode' }, { status: 400 });
    }
    const existing = await getPipeline(id);
    const pipeline = existing.pipeline;
    if (!pipeline) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (pipeline.org_id && pipeline.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const policyViolation = findConcurrencyPatchPolicyViolation(
      pipeline.environment ?? 'production',
      concurrencyMode
    );
    if (policyViolation) {
      await logPipelinePolicyRejection({
        userId: user.id,
        entityId: id,
        operation: 'concurrency_patch',
        violation: policyViolation,
        environment: pipeline.environment ?? 'production',
        requestedConcurrencyMode: concurrencyMode,
        ...clientInfo,
      });
      return NextResponse.json(
        { error: policyViolation.message, reason_code: policyViolation.reasonCode },
        { status: policyViolation.statusCode }
      );
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
