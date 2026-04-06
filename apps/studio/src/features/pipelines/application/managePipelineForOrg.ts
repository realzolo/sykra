import type { z } from 'zod';
import type {
  ConductorGetPipelineResponse,
  ConductorUpdatePipelineRequest,
} from '@sykra/contracts/conductor';

import { auditLogger } from '@/services/audit';
import { exec, query, queryOne } from '@/lib/db';
import { deletePipeline, getPipeline, updatePipeline } from '@/services/conductorGateway';
import {
  findConcurrencyPatchPolicyViolation,
  findUpdatePipelinePolicyViolation,
  logPipelinePolicyRejection,
  type PipelinePolicyViolation,
} from '@/services/pipelinePolicy';
import { updatePipelineSchema } from '@/services/validation';

type HydratedPipelineVersion = NonNullable<ConductorGetPipelineResponse['version']> & {
  created_by_name?: string | null;
  created_by_email?: string | null;
};

type ClientInfo = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
type ConcurrencyMode = 'allow' | 'queue' | 'cancel_previous';

type PipelineOrgCheck =
  | { kind: 'ok'; data: ConductorGetPipelineResponse }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

export type GetPipelineForOrgResult =
  | {
      kind: 'ok';
      data: ConductorGetPipelineResponse & {
        version: HydratedPipelineVersion | null;
        versions: HydratedPipelineVersion[];
      };
    }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

export type UpdatePipelineForOrgResult =
  | { kind: 'ok'; data: Awaited<ReturnType<typeof updatePipeline>> }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'metadata_missing' }
  | { kind: 'policy_reject'; violation: PipelinePolicyViolation };

export type PatchPipelineConcurrencyForOrgResult =
  | { kind: 'ok'; concurrencyMode: ConcurrencyMode }
  | { kind: 'invalid_mode' }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'policy_reject'; violation: PipelinePolicyViolation };

export type DeletePipelineForOrgResult =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

async function ensurePipelineBelongsToOrg(pipelineId: string, orgId: string): Promise<PipelineOrgCheck> {
  const data = await getPipeline(pipelineId);
  const pipeline = data.pipeline;
  if (!pipeline) {
    return { kind: 'not_found' };
  }
  if (pipeline.org_id && pipeline.org_id !== orgId) {
    return { kind: 'forbidden' };
  }
  return { kind: 'ok', data };
}

export async function getPipelineForOrg(input: {
  pipelineId: string;
  orgId: string;
}): Promise<GetPipelineForOrgResult> {
  const { pipelineId, orgId } = input;
  const existing = await ensurePipelineBelongsToOrg(pipelineId, orgId);
  if (existing.kind !== 'ok') {
    return existing;
  }

  const response = existing.data as ConductorGetPipelineResponse & {
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
    const authors = await query<{ id: string; email: string | null; display_name: string | null }>(
      `select id, email, display_name
         from auth_users
        where id = any($1::uuid[])`,
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

  const concurrencyRow = await queryOne<{ concurrency_mode: ConcurrencyMode }>(
    `select concurrency_mode
       from pipelines
      where id = $1`,
    [pipelineId]
  );
  if (concurrencyRow) {
    response.pipeline.concurrency_mode = concurrencyRow.concurrency_mode;
  }

  return { kind: 'ok', data: response };
}

export async function updatePipelineForOrg(input: {
  pipelineId: string;
  orgId: string;
  userId: string;
  validated: UpdatePipelineInput;
  clientInfo: ClientInfo;
}): Promise<UpdatePipelineForOrgResult> {
  const { pipelineId, orgId, userId, validated, clientInfo } = input;
  const existing = await ensurePipelineBelongsToOrg(pipelineId, orgId);
  if (existing.kind !== 'ok') {
    return existing;
  }

  const pipeline = existing.data.pipeline;
  const modeRow = await queryOne<{ concurrency_mode: ConcurrencyMode }>(
    `select concurrency_mode
       from pipelines
      where id = $1
        and org_id = $2`,
    [pipelineId, orgId]
  );
  if (!modeRow) {
    return { kind: 'metadata_missing' };
  }

  const currentConcurrencyMode = modeRow.concurrency_mode;
  const policyViolation = findUpdatePipelinePolicyViolation(validated.config, currentConcurrencyMode);
  if (policyViolation) {
    await logPipelinePolicyRejection({
      userId,
      entityId: pipelineId,
      operation: 'update',
      violation: policyViolation,
      environment: validated.config.environment,
      currentConcurrencyMode,
      ...clientInfo,
    });
    return { kind: 'policy_reject', violation: policyViolation };
  }

  const payload: ConductorUpdatePipelineRequest = {
    name: validated.name ?? pipeline.name,
    description: validated.description ?? pipeline.description,
    config: validated.config,
    updatedBy: userId,
  };
  const data = await updatePipeline(pipelineId, payload);

  await auditLogger.log({
    action: 'update',
    entityType: 'pipeline',
    entityId: pipelineId,
    userId,
    changes: {
      scope: 'pipeline',
      name: payload.name,
      description: payload.description,
      environment: validated.config?.environment ?? pipeline.environment,
    },
    ...clientInfo,
  });

  return { kind: 'ok', data };
}

export async function patchPipelineConcurrencyForOrg(input: {
  pipelineId: string;
  orgId: string;
  userId: string;
  requestedConcurrencyMode: string | undefined;
  clientInfo: ClientInfo;
}): Promise<PatchPipelineConcurrencyForOrgResult> {
  const { pipelineId, orgId, userId, requestedConcurrencyMode, clientInfo } = input;
  const validModes: ConcurrencyMode[] = ['allow', 'queue', 'cancel_previous'];
  if (!requestedConcurrencyMode || !validModes.includes(requestedConcurrencyMode as ConcurrencyMode)) {
    return { kind: 'invalid_mode' };
  }
  const concurrencyMode = requestedConcurrencyMode as ConcurrencyMode;

  const existing = await ensurePipelineBelongsToOrg(pipelineId, orgId);
  if (existing.kind !== 'ok') {
    return existing;
  }

  const pipeline = existing.data.pipeline;
  const policyViolation = findConcurrencyPatchPolicyViolation(
    pipeline.environment ?? 'production',
    concurrencyMode
  );
  if (policyViolation) {
    await logPipelinePolicyRejection({
      userId,
      entityId: pipelineId,
      operation: 'concurrency_patch',
      violation: policyViolation,
      environment: pipeline.environment ?? 'production',
      requestedConcurrencyMode: concurrencyMode,
      ...clientInfo,
    });
    return { kind: 'policy_reject', violation: policyViolation };
  }

  await exec(
    `update pipelines
        set concurrency_mode = $1,
            updated_at = now()
      where id = $2
        and org_id = $3`,
    [concurrencyMode, pipelineId, orgId]
  );

  return { kind: 'ok', concurrencyMode };
}

export async function deletePipelineForOrg(input: {
  pipelineId: string;
  orgId: string;
  userId: string;
  clientInfo: ClientInfo;
}): Promise<DeletePipelineForOrgResult> {
  const { pipelineId, orgId, userId, clientInfo } = input;
  const existing = await ensurePipelineBelongsToOrg(pipelineId, orgId);
  if (existing.kind !== 'ok') {
    return existing;
  }
  const pipeline = existing.data.pipeline;

  await deletePipeline(pipelineId);
  await auditLogger.log({
    action: 'delete',
    entityType: 'pipeline',
    entityId: pipelineId,
    userId,
    changes: {
      scope: 'pipeline',
      name: pipeline.name,
    },
    ...clientInfo,
  });

  return { kind: 'ok' };
}
