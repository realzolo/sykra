import { z } from 'zod';

// Scheduler API contracts. Treat these as a hard contract with schema-first validation.

// Scheduler timestamps are RFC3339/ISO8601 and may include timezone offsets (e.g. +08:00).
const isoDateString = z.string().datetime({ offset: true });

export const schedulerPipelineSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  name: z.string(),
  description: z.string(),
  is_active: z.boolean(),
  current_version_id: z.string().uuid().nullable().optional(),
  concurrency_mode: z.enum(['allow', 'queue', 'cancel_previous']),
  trigger_schedule: z.string().nullable().optional(),
  last_scheduled_at: isoDateString.nullable().optional(),
  next_scheduled_at: isoDateString.nullable().optional(),
  source_branch: z.string().optional(),
  source_branch_source: z.enum(['project_default', 'custom']).optional(),
  created_by: z.string().uuid().nullable().optional(),
  created_at: isoDateString,
  updated_at: isoDateString,
  latest_version: z.number().int(),
});

export const schedulerPipelineVersionSchema = z.object({
  id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  version: z.number().int(),
  config: z.unknown(),
  created_by: z.string().uuid().nullable().optional(),
  created_at: isoDateString,
});

export const schedulerGetPipelineResponseSchema = z.object({
  pipeline: schedulerPipelineSchema,
  version: schedulerPipelineVersionSchema.nullable(),
});

export const schedulerCreatePipelineResponseSchema = schedulerGetPipelineResponseSchema;

export const schedulerUpdatePipelineResponseSchema = z.object({
  version: schedulerPipelineVersionSchema,
});

export const schedulerPipelineRunSchema = z.object({
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

export const schedulerPipelineJobSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  job_key: z.string(),
  name: z.string(),
  status: z.string(),
  attempt: z.number().int(),
  worker_id: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  duration_ms: z.number().int().nullable().optional(),
  created_at: isoDateString,
  started_at: isoDateString.nullable().optional(),
  finished_at: isoDateString.nullable().optional(),
  updated_at: isoDateString,
});

export const schedulerPipelineStepSchema = z.object({
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

export const schedulerPipelineRunDetailSchema = z.object({
  run: schedulerPipelineRunSchema,
  jobs: z.array(schedulerPipelineJobSchema),
  steps: z.array(schedulerPipelineStepSchema),
});

export const schedulerRunEventSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  seq: z.number().int(),
  type: z.string(),
  payload: z.unknown(),
  occurred_at: isoDateString,
});

export const schedulerListPipelinesResponseSchema = z.array(schedulerPipelineSchema);
export const schedulerListPipelineRunsResponseSchema = z.array(schedulerPipelineRunSchema);
export const schedulerCreatePipelineRunResponseSchema = schedulerPipelineRunSchema;
export const schedulerListRunEventsResponseSchema = z.array(schedulerRunEventSchema);
export const schedulerCancelPipelineRunResponseSchema = z.object({ ok: z.literal(true) });
export const schedulerTriggerPipelineRunJobResponseSchema = z.object({ ok: z.literal(true) });

export type SchedulerPipeline = z.infer<typeof schedulerPipelineSchema>;
export type SchedulerPipelineVersion = z.infer<typeof schedulerPipelineVersionSchema>;
export type SchedulerGetPipelineResponse = z.infer<typeof schedulerGetPipelineResponseSchema>;
export type SchedulerCreatePipelineResponse = z.infer<typeof schedulerCreatePipelineResponseSchema>;
export type SchedulerUpdatePipelineResponse = z.infer<typeof schedulerUpdatePipelineResponseSchema>;
export type SchedulerPipelineRun = z.infer<typeof schedulerPipelineRunSchema>;
export type SchedulerPipelineRunDetail = z.infer<typeof schedulerPipelineRunDetailSchema>;
export type SchedulerRunEvent = z.infer<typeof schedulerRunEventSchema>;
