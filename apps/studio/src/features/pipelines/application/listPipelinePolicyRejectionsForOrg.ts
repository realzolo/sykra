import { asJsonObject, type JsonObject } from '@/lib/json';
import { query, queryOne } from '@/lib/db';

type PipelineRow = {
  id: string;
  org_id: string;
};

type PolicyRejectionRow = {
  id: string;
  user_id: string | null;
  changes: JsonObject | null;
  created_at: string;
};

export type PipelinePolicyRejectionItem = {
  id: string;
  reason_code: string;
  operation: string;
  message: string;
  path: string | null;
  created_at: string;
  rejected_by: string | null;
  rejected_by_name: string | null;
  rejected_by_email: string | null;
};

export type ListPipelinePolicyRejectionsForOrgResult =
  | { kind: 'ok'; items: PipelinePolicyRejectionItem[] }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

export async function listPipelinePolicyRejectionsForOrg(input: {
  pipelineId: string;
  orgId: string;
  limit: number;
}): Promise<ListPipelinePolicyRejectionsForOrgResult> {
  const { pipelineId, orgId, limit } = input;
  const pipeline = await queryOne<PipelineRow>(
    `select id, org_id
       from pipelines
      where id = $1`,
    [pipelineId]
  );
  if (!pipeline) {
    return { kind: 'not_found' };
  }
  if (pipeline.org_id !== orgId) {
    return { kind: 'forbidden' };
  }

  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 20;
  const rows = await query<PolicyRejectionRow>(
    `select id, user_id, changes, created_at
       from audit_logs
      where entity_type = 'pipeline'
        and entity_id = $1
        and action = 'reject'
        and changes->>'scope' = 'pipeline_policy_reject'
      order by created_at desc
      limit $2`,
    [pipelineId, safeLimit]
  );

  const actorIds = Array.from(
    new Set(
      rows
        .map((item) => item.user_id)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    )
  );
  const actorRows =
    actorIds.length > 0
      ? await query<{ id: string; email: string | null; display_name: string | null }>(
          `select id, email, display_name
             from auth_users
            where id = any($1::uuid[])`,
          [actorIds]
        )
      : [];
  const actorById = new Map(actorRows.map((item) => [item.id, item]));

  const items: PipelinePolicyRejectionItem[] = rows.map((row) => {
    const payload = asJsonObject(row.changes) ?? {};
    const actor = row.user_id ? actorById.get(row.user_id) : undefined;
    return {
      id: row.id,
      reason_code: typeof payload.reason_code === 'string' ? payload.reason_code : 'unknown',
      operation: typeof payload.operation === 'string' ? payload.operation : 'unknown',
      message: typeof payload.message === 'string' ? payload.message : '',
      path: typeof payload.path === 'string' ? payload.path : null,
      created_at: row.created_at,
      rejected_by: row.user_id,
      rejected_by_name: actor?.display_name ?? null,
      rejected_by_email: actor?.email ?? null,
    };
  });

  return { kind: 'ok', items };
}
