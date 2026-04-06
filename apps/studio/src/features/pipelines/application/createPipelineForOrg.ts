import type { z } from 'zod';
import type { ConductorCreatePipelineRequest } from '@sykra/contracts/conductor';

import { auditLogger } from '@/services/audit';
import { exec } from '@/lib/db';
import { createPipeline } from '@/services/conductorGateway';
import { requireProjectAccess } from '@/services/orgs';
import {
  findCreatePipelinePolicyViolation,
  logPipelinePolicyRejection,
  type PipelinePolicyViolation,
} from '@/services/pipelinePolicy';
import { createPipelineSchema } from '@/services/validation';

type CreatePipelineInput = z.infer<typeof createPipelineSchema>;

type ClientInfo = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type CreatePipelineForOrgResult =
  | {
      kind: 'ok';
      result: Awaited<ReturnType<typeof createPipeline>>;
    }
  | {
      kind: 'policy_reject';
      violation: PipelinePolicyViolation;
    };

export async function createPipelineForOrg(input: {
  orgId: string;
  userId: string;
  validated: CreatePipelineInput;
  clientInfo: ClientInfo;
}): Promise<CreatePipelineForOrgResult> {
  const { orgId, userId, validated, clientInfo } = input;
  const requestedConcurrencyMode = validated.concurrency_mode ?? 'queue';
  const policyViolation = findCreatePipelinePolicyViolation(validated.config, requestedConcurrencyMode);
  if (policyViolation) {
    await logPipelinePolicyRejection({
      userId,
      operation: 'create',
      violation: policyViolation,
      environment: validated.config.environment,
      requestedConcurrencyMode,
      ...clientInfo,
    });
    return {
      kind: 'policy_reject',
      violation: policyViolation,
    };
  }

  const payload: ConductorCreatePipelineRequest = {
    orgId,
    name: validated.name,
    description: validated.description ?? '',
    config: validated.config,
    createdBy: userId,
  };
  if (validated.projectId) {
    await requireProjectAccess(validated.projectId, userId);
    payload.projectId = validated.projectId;
  }

  const result = await createPipeline(payload);
  await exec(
    `update pipelines
        set concurrency_mode = $1,
            updated_at = now()
      where id = $2
        and org_id = $3`,
    [requestedConcurrencyMode, result.pipeline.id, orgId]
  );

  await auditLogger.log({
    action: 'create',
    entityType: 'pipeline',
    entityId: result.pipeline.id,
    userId,
    changes: {
      scope: 'pipeline',
      projectId: payload.projectId ?? null,
      name: payload.name,
      environment: validated.config.environment,
      concurrencyMode: requestedConcurrencyMode,
    },
    ...clientInfo,
  });

  return {
    kind: 'ok',
    result,
  };
}
