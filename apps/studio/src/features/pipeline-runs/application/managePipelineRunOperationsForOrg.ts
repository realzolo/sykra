import { NextResponse } from 'next/server';
import type {
  ConductorPipelineRunDetail,
  ConductorRetryPipelineRunJobResponse,
} from '@sykra/contracts/conductor';

import { auditLogger } from '@/services/audit';
import { getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import {
  cancelPipelineRun,
  getPipelineRun,
  getPipelineStepLog,
  openPipelineStepLogStream,
  retryPipelineRunJob,
  triggerPipelineRunJob,
} from '@/services/conductorGateway';

type ClientInfo = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type RunActor = {
  id: string;
  email?: string | null | undefined;
  displayName?: string | null | undefined;
};

function requireRunBelongsToOrg(detail: ConductorPipelineRunDetail, orgId: string) {
  if (detail.run.org_id && detail.run.org_id !== orgId) {
    throw new Error('Forbidden');
  }
}

async function getRunForOrg(runId: string, orgId: string): Promise<ConductorPipelineRunDetail> {
  const detail = await getPipelineRun(runId);
  requireRunBelongsToOrg(detail, orgId);
  return detail;
}

async function ensurePipelineRunAdminAccess(orgId: string, userId: string) {
  const role = await getOrgMemberRole(orgId, userId);
  if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
    throw new Error('Forbidden');
  }
}

function readApprovalComment(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const comment = (body as { comment?: unknown }).comment;
  if (typeof comment !== 'string') {
    return undefined;
  }
  const trimmed = comment.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function cancelPipelineRunForOrg(input: {
  runId: string;
  orgId: string;
  user: RunActor;
  clientInfo: ClientInfo;
}) {
  await ensurePipelineRunAdminAccess(input.orgId, input.user.id);
  const detail = await getRunForOrg(input.runId, input.orgId);
  const result = await cancelPipelineRun(input.runId);

  await auditLogger.log({
    action: 'update',
    entityType: 'pipeline',
    entityId: detail.run.pipeline_id,
    userId: input.user.id,
    changes: {
      scope: 'pipeline_run',
      runId: input.runId,
      projectId: detail.run.project_id ?? null,
      status: 'canceled',
      reason: 'terminated_by_user',
    },
    ...input.clientInfo,
  });

  return result;
}

export async function retryPipelineRunJobForOrg(input: {
  runId: string;
  jobId: string;
  orgId: string;
  user: RunActor;
  clientInfo: ClientInfo;
}): Promise<ConductorRetryPipelineRunJobResponse> {
  await ensurePipelineRunAdminAccess(input.orgId, input.user.id);
  const detail = await getRunForOrg(input.runId, input.orgId);
  const result = await retryPipelineRunJob(input.runId, input.jobId);

  await auditLogger.log({
    action: 'update',
    entityType: 'pipeline',
    entityId: detail.run.pipeline_id,
    userId: input.user.id,
    changes: {
      scope: 'pipeline_run_job',
      runId: input.runId,
      jobId: input.jobId,
      action: 'retry',
      projectId: detail.run.project_id ?? null,
    },
    ...input.clientInfo,
  });

  return result;
}

export async function triggerPipelineRunJobForOrg(input: {
  runId: string;
  jobId: string;
  body: unknown;
  orgId: string;
  user: RunActor;
  clientInfo: ClientInfo;
}): Promise<Awaited<ReturnType<typeof triggerPipelineRunJob>>> {
  await ensurePipelineRunAdminAccess(input.orgId, input.user.id);
  const detail = await getRunForOrg(input.runId, input.orgId);
  const approvalComment = readApprovalComment(input.body);
  const result = await triggerPipelineRunJob(input.runId, input.jobId, {
    approvedBy: input.user.id,
    ...(input.user.email ? { approvedByEmail: input.user.email } : {}),
    ...(input.user.displayName ? { approvedByName: input.user.displayName } : {}),
    ...(approvalComment ? { comment: approvalComment } : {}),
  });

  await auditLogger.log({
    action: 'update',
    entityType: 'pipeline',
    entityId: detail.run.pipeline_id,
    userId: input.user.id,
    changes: {
      scope: 'pipeline_run_job',
      runId: input.runId,
      jobId: input.jobId,
      action: 'manual_trigger',
      projectId: detail.run.project_id ?? null,
      approvedBy: input.user.id,
      approvedByEmail: input.user.email ?? null,
      approvedByName: input.user.displayName ?? null,
      approvalComment: approvalComment ?? null,
    },
    ...input.clientInfo,
  });

  return result;
}

export async function getPipelineStepLogForOrg(input: {
  runId: string;
  stepId: string;
  orgId: string;
  offset: number;
  limit: number;
}) {
  await getRunForOrg(input.runId, input.orgId);
  return getPipelineStepLog(input.runId, input.stepId, input.offset, input.limit);
}

export async function openPipelineStepLogStreamForOrg(input: {
  runId: string;
  stepId: string;
  orgId: string;
  signal?: AbortSignal;
  offset: number;
  limit: number;
}) {
  await getRunForOrg(input.runId, input.orgId);

  const upstream = await openPipelineStepLogStream(
    input.runId,
    input.stepId,
    input.signal,
    input.offset,
    input.limit
  );
  const headers = new Headers(upstream.headers);
  headers.set('Content-Type', headers.get('Content-Type') ?? 'text/plain; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('Connection', 'keep-alive');
  headers.set('X-Accel-Buffering', 'no');
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
