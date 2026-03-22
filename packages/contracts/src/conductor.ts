import { z } from 'zod';

// Conductor API contracts. Treat these as a hard contract with schema-first validation.

// Conductor timestamps are RFC3339/ISO8601 and may include timezone offsets (e.g. +08:00).
const isoDateString = z.string().datetime({ offset: true });

export const conductorPipelineSchema = z.object({
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

export const conductorPipelineVersionSchema = z.object({
  id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  version: z.number().int(),
  config: z.unknown(),
  created_by: z.string().uuid().nullable().optional(),
  created_at: isoDateString,
});

export const conductorGetPipelineResponseSchema = z.object({
  pipeline: conductorPipelineSchema,
  version: conductorPipelineVersionSchema.nullable(),
});

export const conductorCreatePipelineResponseSchema = conductorGetPipelineResponseSchema;

export const conductorUpdatePipelineResponseSchema = z.object({
  version: conductorPipelineVersionSchema,
});

export const conductorCreatePipelineRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  name: z.string().min(1),
  description: z.string(),
  config: z.unknown(),
  createdBy: z.string().uuid(),
});

export const conductorUpdatePipelineRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  config: z.unknown(),
  updatedBy: z.string().uuid(),
});

export const conductorPipelineRunSchema = z.object({
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
  branch: z.string().nullable().optional(),
  commit_sha: z.string().nullable().optional(),
  commit_message: z.string().nullable().optional(),
  attempt: z.number().int(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  metadata: z.unknown().optional(),
  created_at: isoDateString,
  started_at: isoDateString.nullable().optional(),
  finished_at: isoDateString.nullable().optional(),
  updated_at: isoDateString,
});

export const conductorPipelineJobSchema = z.object({
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

export const conductorPipelineStepSchema = z.object({
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

export const conductorPipelineRunDetailSchema = z.object({
  run: conductorPipelineRunSchema,
  jobs: z.array(conductorPipelineJobSchema),
  steps: z.array(conductorPipelineStepSchema),
});

export const conductorRunEventSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  seq: z.number().int(),
  type: z.string(),
  payload: z.unknown(),
  occurred_at: isoDateString,
});

export const conductorListPipelinesResponseSchema = z.array(conductorPipelineSchema);
export const conductorListPipelineRunsResponseSchema = z.array(conductorPipelineRunSchema);
export const conductorCreatePipelineRunResponseSchema = conductorPipelineRunSchema;
export const conductorListRunEventsResponseSchema = z.array(conductorRunEventSchema);
export const conductorCancelPipelineRunResponseSchema = z.object({ ok: z.literal(true) });
export const conductorDeletePipelineResponseSchema = z.object({ ok: z.literal(true) });
export const conductorTriggerPipelineRunJobResponseSchema = z.object({ ok: z.literal(true) });
export const conductorRetryPipelineRunJobResponseSchema = z.object({ ok: z.literal(true) });

export type ConductorPipeline = z.infer<typeof conductorPipelineSchema>;
export type ConductorPipelineVersion = z.infer<typeof conductorPipelineVersionSchema>;
export type ConductorGetPipelineResponse = z.infer<typeof conductorGetPipelineResponseSchema>;
export type ConductorCreatePipelineResponse = z.infer<typeof conductorCreatePipelineResponseSchema>;
export type ConductorUpdatePipelineResponse = z.infer<typeof conductorUpdatePipelineResponseSchema>;
export type ConductorCreatePipelineRequest = z.infer<typeof conductorCreatePipelineRequestSchema>;
export type ConductorUpdatePipelineRequest = z.infer<typeof conductorUpdatePipelineRequestSchema>;
export type ConductorPipelineRun = z.infer<typeof conductorPipelineRunSchema>;
export type ConductorPipelineRunDetail = z.infer<typeof conductorPipelineRunDetailSchema>;
export type ConductorRunEvent = z.infer<typeof conductorRunEventSchema>;
export type ConductorDeletePipelineResponse = z.infer<typeof conductorDeletePipelineResponseSchema>;
export type ConductorRetryPipelineRunJobResponse = z.infer<typeof conductorRetryPipelineRunJobResponseSchema>;
