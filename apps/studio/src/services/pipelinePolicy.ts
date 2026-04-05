import type { ZodError } from 'zod';
import { auditLogger, type AuditEntityType, type AuditAction } from '@/services/audit';
import type { JsonObject } from '@/lib/json';

export const PIPELINE_POLICY_REASON_CODES = {
  productionConcurrencyAllowForbidden: 'production_concurrency_allow_forbidden',
  mixedTriggerPurposeRequired: 'mixed_trigger_purpose_required',
  deployArtifactSourceRequired: 'deploy_artifact_source_required',
  deployArtifactInputsRequired: 'deploy_artifact_inputs_required',
  productionManualDeployGateRequired: 'production_manual_deploy_gate_required',
} as const;

export type PipelinePolicyReasonCode =
  (typeof PIPELINE_POLICY_REASON_CODES)[keyof typeof PIPELINE_POLICY_REASON_CODES];

export type PipelinePolicyOperation = 'create' | 'update' | 'concurrency_patch';

export type PipelinePolicyViolation = {
  reasonCode: PipelinePolicyReasonCode;
  message: string;
  statusCode: number;
  path?: string;
};

type PipelinePolicyAuditPayload = {
  scope: 'pipeline_policy_reject';
  reason_code: PipelinePolicyReasonCode;
  operation: PipelinePolicyOperation;
  status_code: number;
  message: string;
  path?: string;
  environment?: string;
  requested_concurrency_mode?: string;
  current_concurrency_mode?: string;
};

type PipelinePolicyConfigInput = {
  environment?: string;
};

export function findCreatePipelinePolicyViolation(
  config: PipelinePolicyConfigInput,
  requestedConcurrencyMode: 'allow' | 'queue' | 'cancel_previous'
): PipelinePolicyViolation | null {
  const environment = (config.environment ?? 'production').trim().toLowerCase();
  if (environment === 'production' && requestedConcurrencyMode === 'allow') {
    return {
      reasonCode: PIPELINE_POLICY_REASON_CODES.productionConcurrencyAllowForbidden,
      message: 'Production pipelines cannot use concurrency_mode=allow. Use queue for controlled execution.',
      statusCode: 409,
      path: 'concurrency_mode',
    };
  }
  return null;
}

export function findUpdatePipelinePolicyViolation(
  config: PipelinePolicyConfigInput,
  currentConcurrencyMode: 'allow' | 'queue' | 'cancel_previous'
): PipelinePolicyViolation | null {
  const environment = (config.environment ?? 'production').trim().toLowerCase();
  if (environment === 'production' && currentConcurrencyMode === 'allow') {
    return {
      reasonCode: PIPELINE_POLICY_REASON_CODES.productionConcurrencyAllowForbidden,
      message: 'Production pipelines cannot use concurrency_mode=allow. Set queue before saving this config.',
      statusCode: 409,
      path: 'concurrency_mode',
    };
  }
  return null;
}

export function findConcurrencyPatchPolicyViolation(
  environment: string,
  requestedConcurrencyMode: 'allow' | 'queue' | 'cancel_previous'
): PipelinePolicyViolation | null {
  if (environment.trim().toLowerCase() === 'production' && requestedConcurrencyMode === 'allow') {
    return {
      reasonCode: PIPELINE_POLICY_REASON_CODES.productionConcurrencyAllowForbidden,
      message: 'Production pipelines cannot use concurrency_mode=allow. Use queue for controlled execution.',
      statusCode: 409,
      path: 'concurrency_mode',
    };
  }
  return null;
}

export function mapPipelineValidationErrorToPolicyViolation(error: unknown): PipelinePolicyViolation | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const message = error.message;

  if (message.includes('config.trigger.purpose:')) {
    return {
      reasonCode: PIPELINE_POLICY_REASON_CODES.mixedTriggerPurposeRequired,
      message:
        'When push auto-trigger and schedule are both enabled, provide trigger purpose so operators know why both modes are required.',
      statusCode: 409,
      path: 'config.trigger.purpose',
    };
  }
  if (message.includes('artifactSource') && message.includes('Deploy steps must explicitly choose an artifact source')) {
    return {
      reasonCode: PIPELINE_POLICY_REASON_CODES.deployArtifactSourceRequired,
      message: 'Deploy steps must explicitly choose an artifact source: run or registry.',
      statusCode: 409,
      path: 'config.jobs.*.steps.*.artifactSource',
    };
  }
  if (message.includes('artifactInputs') && message.includes('Deploy steps using run artifacts must declare explicit artifact inputs')) {
    return {
      reasonCode: PIPELINE_POLICY_REASON_CODES.deployArtifactInputsRequired,
      message: 'Deploy steps using run artifacts must declare explicit artifact inputs.',
      statusCode: 409,
      path: 'config.jobs.*.steps.*.artifactInputs',
    };
  }
  if (message.includes('config.stages.deploy.entryMode:') && message.includes('manual deploy gate')) {
    return {
      reasonCode: PIPELINE_POLICY_REASON_CODES.productionManualDeployGateRequired,
      message: 'Production pipelines must require a manual deploy gate.',
      statusCode: 409,
      path: 'config.stages.deploy.entryMode',
    };
  }
  if (message.includes('concurrency_mode:') && message.includes('Production pipelines cannot use concurrency_mode=allow')) {
    return {
      reasonCode: PIPELINE_POLICY_REASON_CODES.productionConcurrencyAllowForbidden,
      message: 'Production pipelines cannot use concurrency_mode=allow. Use queue for controlled execution.',
      statusCode: 409,
      path: 'concurrency_mode',
    };
  }
  return null;
}

export async function logPipelinePolicyRejection(input: {
  userId?: string | null;
  entityId?: string;
  operation: PipelinePolicyOperation;
  violation: PipelinePolicyViolation;
  entityType?: AuditEntityType;
  action?: AuditAction;
  ipAddress?: string | null;
  userAgent?: string | null;
  environment?: string;
  requestedConcurrencyMode?: string;
  currentConcurrencyMode?: string;
}): Promise<void> {
  const changes: PipelinePolicyAuditPayload = {
    scope: 'pipeline_policy_reject',
    reason_code: input.violation.reasonCode,
    operation: input.operation,
    status_code: input.violation.statusCode,
    message: input.violation.message,
    ...(input.violation.path ? { path: input.violation.path } : {}),
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.requestedConcurrencyMode ? { requested_concurrency_mode: input.requestedConcurrencyMode } : {}),
    ...(input.currentConcurrencyMode ? { current_concurrency_mode: input.currentConcurrencyMode } : {}),
  };
  await auditLogger.log({
    action: input.action ?? 'reject',
    entityType: input.entityType ?? 'pipeline',
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    changes: changes as unknown as JsonObject,
    ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });
}

export function formatZodValidationError(error: ZodError): string {
  return error.issues.map((item) => `${item.path.join('.')}: ${item.message}`).join('; ');
}
