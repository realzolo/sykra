export const PIPELINE_SECRET_MAX_COUNT = 100;
export const PIPELINE_SECRET_KEY_MAX_LENGTH = 64;
export const PIPELINE_SECRET_VALUE_MAX_BYTES = 32 * 1024;
export const PIPELINE_RESERVED_ENV_PREFIX = 'PIPELINE_';
export const PIPELINE_RESERVED_ENV_KEYS = [
  'PIPELINE_RUN_ID',
  'PIPELINE_JOB_ID',
  'PIPELINE_STEP_ID',
  'PIPELINE_ENVIRONMENT',
] as const;

const PIPELINE_SECRET_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export type PipelineSecretNameError =
  | 'required'
  | 'too_long'
  | 'invalid_format'
  | 'reserved_name';

export type PipelineSecretValueError = 'required' | 'too_large';

export function normalizePipelineSecretName(value: string): string {
  return value.trim().toUpperCase();
}

export function validatePipelineSecretName(value: string): PipelineSecretNameError | null {
  const normalized = normalizePipelineSecretName(value);
  if (!normalized) return 'required';
  if (normalized.length > PIPELINE_SECRET_KEY_MAX_LENGTH) return 'too_long';
  if (!PIPELINE_SECRET_NAME_PATTERN.test(normalized)) return 'invalid_format';
  if (normalized.startsWith(PIPELINE_RESERVED_ENV_PREFIX)) return 'reserved_name';
  return null;
}

export function getPipelineSecretValueBytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validatePipelineSecretValue(value: string): PipelineSecretValueError | null {
  if (!value) return 'required';
  if (getPipelineSecretValueBytes(value) > PIPELINE_SECRET_VALUE_MAX_BYTES) return 'too_large';
  return null;
}
