import { z } from 'zod';

// Runner API contracts. Treat these as a hard contract with schema-first validation.

// Runner timestamps are RFC3339/ISO8601 and may include timezone offsets (e.g. +08:00).
const isoDateString = z.string().datetime({ offset: true });

export const runnerPipelineSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  name: z.string(),
  description: z.string(),
  is_active: z.boolean(),
  current_version_id: z.string().uuid().nullable().optional(),
  environment: z.enum(['development', 'staging', 'production']),
  auto_trigger: z.boolean(),
  trigger_branch: z.string(),
  quality_gate_enabled: z.boolean(),
  quality_gate_min_score: z.number().int(),
  notify_on_success: z.boolean(),
  notify_on_failure: z.boolean(),
  concurrency_mode: z.enum(['allow', 'queue', 'cancel_previous']).optional(),
  created_by: z.string().uuid().nullable().optional(),
  created_at: isoDateString,
  updated_at: isoDateString,
  latest_version: z.number().int(),
});

export const runnerPipelineVersionSchema = z.object({
  id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  version: z.number().int(),
  config: z.unknown(),
  created_by: z.string().uuid().nullable().optional(),
  created_at: isoDateString,
});

export const runnerGetPipelineResponseSchema = z.object({
  pipeline: runnerPipelineSchema,
  version: runnerPipelineVersionSchema.nullable(),
});

export const runnerCreatePipelineResponseSchema = runnerGetPipelineResponseSchema;

export const runnerUpdatePipelineResponseSchema = z.object({
  version: runnerPipelineVersionSchema,
});

export const runnerPipelineRunSchema = z.object({
  id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  version_id: z.string().uuid(),
  org_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  status: z.string(),
  trigger_type: z.string(),
  triggered_by: z.string().uuid().nullable().optional(),
  idempotency_key: z.string().nullable().optional(),
  rollback_of: z.string().uuid().nullable().optional(),
  attempt: z.number().int(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  metadata: z.unknown().optional(),
  created_at: isoDateString,
  started_at: isoDateString.nullable().optional(),
  finished_at: isoDateString.nullable().optional(),
  updated_at: isoDateString,
});

export const runnerPipelineJobSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  job_key: z.string(),
  name: z.string(),
  status: z.string(),
  attempt: z.number().int(),
  runner_id: z.string().uuid().nullable().optional(),
  error_message: z.string().nullable().optional(),
  duration_ms: z.number().int().nullable().optional(),
  created_at: isoDateString,
  started_at: isoDateString.nullable().optional(),
  finished_at: isoDateString.nullable().optional(),
  updated_at: isoDateString,
});

export const runnerPipelineStepSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  step_key: z.string(),
  name: z.string(),
  status: z.string(),
  exit_code: z.number().int().nullable().optional(),
  timeout_ms: z.number().int().nullable().optional(),
  duration_ms: z.number().int().nullable().optional(),
  error_message: z.string().nullable().optional(),
  log_path: z.string().nullable().optional(),
  created_at: isoDateString,
  started_at: isoDateString.nullable().optional(),
  finished_at: isoDateString.nullable().optional(),
  updated_at: isoDateString,
});

export const runnerPipelineRunDetailSchema = z.object({
  run: runnerPipelineRunSchema,
  jobs: z.array(runnerPipelineJobSchema),
  steps: z.array(runnerPipelineStepSchema),
});

export const runnerRunEventSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  seq: z.number().int(),
  type: z.string(),
  payload: z.unknown(),
  occurred_at: isoDateString,
});

export const runnerListPipelinesResponseSchema = z.array(runnerPipelineSchema);
export const runnerListPipelineRunsResponseSchema = z.array(runnerPipelineRunSchema);
export const runnerCreatePipelineRunResponseSchema = runnerPipelineRunSchema;
export const runnerListRunEventsResponseSchema = z.array(runnerRunEventSchema);
export const runnerCancelPipelineRunResponseSchema = z.object({ ok: z.literal(true) });

export type RunnerPipeline = z.infer<typeof runnerPipelineSchema>;
export type RunnerPipelineVersion = z.infer<typeof runnerPipelineVersionSchema>;
export type RunnerGetPipelineResponse = z.infer<typeof runnerGetPipelineResponseSchema>;
export type RunnerCreatePipelineResponse = z.infer<typeof runnerCreatePipelineResponseSchema>;
export type RunnerUpdatePipelineResponse = z.infer<typeof runnerUpdatePipelineResponseSchema>;
export type RunnerPipelineRun = z.infer<typeof runnerPipelineRunSchema>;
export type RunnerPipelineRunDetail = z.infer<typeof runnerPipelineRunDetailSchema>;
export type RunnerRunEvent = z.infer<typeof runnerRunEventSchema>;
