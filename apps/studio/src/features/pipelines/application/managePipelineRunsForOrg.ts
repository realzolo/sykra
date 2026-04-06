import type {
  ConductorCreatePipelineRunRequest,
  ConductorPipelineRun,
} from '@sykra/contracts/conductor';

import { auditLogger } from '@/services/audit';
import { createPipelineRun, getPipeline, listPipelineRuns } from '@/services/conductorGateway';
import { query, queryOne } from '@/lib/db';

type ClientInfo = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type PipelineOrgCheck =
  | { kind: 'ok'; pipeline: NonNullable<Awaited<ReturnType<typeof getPipeline>>['pipeline']> }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

type RunCreateInput = {
  triggerType?: ConductorCreatePipelineRunRequest['triggerType'];
  idempotencyKey?: string;
  metadata?: unknown;
  rollbackOf?: string;
};

type RunWithActor = ConductorPipelineRun & {
  triggered_by_email?: string | null;
  triggered_by_name?: string | null;
};

export type ListPipelineRunsForOrgResult =
  | { kind: 'ok'; runs: RunWithActor[] }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

export type CreatePipelineRunForOrgResult =
  | { kind: 'ok'; run: ConductorPipelineRun }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'rollback_requires_project' }
  | { kind: 'rollback_artifact_missing' };

async function ensurePipelineBelongsToOrg(pipelineId: string, orgId: string): Promise<PipelineOrgCheck> {
  const data = await getPipeline(pipelineId);
  const pipeline = data.pipeline;
  if (!pipeline) {
    return { kind: 'not_found' };
  }
  if (pipeline.org_id && pipeline.org_id !== orgId) {
    return { kind: 'forbidden' };
  }
  return { kind: 'ok', pipeline };
}

export async function listPipelineRunsForOrg(input: {
  pipelineId: string;
  orgId: string;
  limit: number;
}): Promise<ListPipelineRunsForOrgResult> {
  const { pipelineId, orgId, limit } = input;
  const check = await ensurePipelineBelongsToOrg(pipelineId, orgId);
  if (check.kind !== 'ok') {
    return check;
  }

  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 20;
  const runs = await listPipelineRuns(pipelineId, safeLimit);
  const triggeredByIds = Array.from(
    new Set(
      runs
        .map((run) => run.triggered_by)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    )
  );
  if (triggeredByIds.length === 0) {
    return { kind: 'ok', runs };
  }

  const users = await query<{ id: string; email: string | null; display_name: string | null }>(
    `select id, email, display_name
       from auth_users
      where id = any($1::uuid[])`,
    [triggeredByIds]
  );
  const userById = new Map(users.map((item) => [item.id, item]));
  const hydrated = runs.map((run) => {
    const actor = run.triggered_by ? userById.get(run.triggered_by) : undefined;
    if (!actor) return run;
    return {
      ...run,
      triggered_by_email: actor.email,
      triggered_by_name: actor.display_name,
    };
  });

  return { kind: 'ok', runs: hydrated };
}

export async function createPipelineRunForOrg(input: {
  pipelineId: string;
  orgId: string;
  userId: string;
  body: RunCreateInput;
  clientInfo: ClientInfo;
}): Promise<CreatePipelineRunForOrgResult> {
  const { pipelineId, orgId, userId, body, clientInfo } = input;
  const check = await ensurePipelineBelongsToOrg(pipelineId, orgId);
  if (check.kind !== 'ok') {
    return check;
  }
  const pipeline = check.pipeline;

  if (body.triggerType === 'rollback') {
    if (!pipeline.project_id) {
      return { kind: 'rollback_requires_project' };
    }
    const publishedArtifactVersion = await queryOne<{ id: string }>(
      `select id
         from artifact_versions
        where org_id = $1
          and project_id = $2
          and source_run_id = $3
          and source_pipeline_id = $4
          and status = 'published'
        order by created_at desc
        limit 1`,
      [orgId, pipeline.project_id, body.rollbackOf, pipelineId]
    );
    if (!publishedArtifactVersion) {
      return { kind: 'rollback_artifact_missing' };
    }
  }

  const payload = {
    triggerType: body.triggerType ?? 'manual',
    triggeredBy: userId,
    idempotencyKey: body.idempotencyKey ?? '',
    metadata: body.metadata ?? {},
    ...(body.rollbackOf ? { rollbackOf: body.rollbackOf } : {}),
  };

  const run = await createPipelineRun(pipelineId, payload);
  await auditLogger.log({
    action: 'create',
    entityType: 'pipeline',
    entityId: pipelineId,
    userId,
    changes: {
      scope: 'pipeline_run',
      runId: run.id,
      projectId: pipeline.project_id ?? null,
      triggerType: payload.triggerType,
      rollbackOf: payload.rollbackOf ?? null,
    },
    ...clientInfo,
  });

  return { kind: 'ok', run };
}
