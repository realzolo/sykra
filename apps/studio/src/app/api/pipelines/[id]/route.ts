import { NextResponse } from 'next/server';
import { extractClientInfo } from '@/services/audit';
import { getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { withAuthedRoute } from '@/services/apiRoute';
import { updatePipelineSchema } from '@/services/validation';
import {
  formatZodValidationError,
  logPipelinePolicyRejection,
  mapPipelineValidationErrorToPolicyViolation,
} from '@/services/pipelinePolicy';
import {
  deletePipelineForOrg,
  getPipelineForOrg,
  patchPipelineConcurrencyForOrg,
  updatePipelineForOrg,
} from '@/features/pipelines/application/managePipelineForOrg';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export const GET = withAuthedRoute<{ id: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ params, orgId }) => {
    const { id } = await params;
    const result = await getPipelineForOrg({ pipelineId: id, orgId: orgId! });
    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.kind === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(result.data);
  }
);

export const PUT = withAuthedRoute<{ id: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ request, params, user, orgId }) => {
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
    const role = await getOrgMemberRole(orgId!, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const result = await updatePipelineForOrg({
      pipelineId: id,
      orgId: orgId!,
      userId: user.id,
      validated,
      clientInfo,
    });
    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.kind === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (result.kind === 'metadata_missing') {
      return NextResponse.json({ error: 'Pipeline concurrency metadata not found' }, { status: 500 });
    }
    if (result.kind === 'policy_reject') {
      return NextResponse.json(
        { error: result.violation.message, reason_code: result.violation.reasonCode },
        { status: result.violation.statusCode }
      );
    }
    return NextResponse.json(result.data);
  }
);

export const PATCH = withAuthedRoute<{ id: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ request, params, user, orgId }) => {
    const { id } = await params;
    const clientInfo = extractClientInfo(request);
    const body = await request.json();
    const role = await getOrgMemberRole(orgId!, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const result = await patchPipelineConcurrencyForOrg({
      pipelineId: id,
      orgId: orgId!,
      userId: user.id,
      requestedConcurrencyMode: body?.concurrency_mode,
      clientInfo,
    });
    if (result.kind === 'invalid_mode') {
      return NextResponse.json({ error: 'Invalid concurrency_mode' }, { status: 400 });
    }
    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.kind === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (result.kind === 'policy_reject') {
      return NextResponse.json(
        { error: result.violation.message, reason_code: result.violation.reasonCode },
        { status: result.violation.statusCode }
      );
    }
    return NextResponse.json({ concurrency_mode: result.concurrencyMode });
  }
);

export const DELETE = withAuthedRoute<{ id: string }>(
  {
    rateLimiter,
    requireOrg: true,
  },
  async ({ request, params, user, orgId }) => {
    const { id } = await params;
    const role = await getOrgMemberRole(orgId!, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const clientInfo = extractClientInfo(request);
    const result = await deletePipelineForOrg({
      pipelineId: id,
      orgId: orgId!,
      userId: user.id,
      clientInfo,
    });
    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.kind === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  }
);
