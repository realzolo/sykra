/**
 * Input validation service
 * Uses Zod for runtime validation
 */

import { z } from 'zod';

// Common schema
export const projectIdSchema = z.string().uuid('Invalid project ID');
export const reportIdSchema = z.string().uuid('Invalid report ID');
export const rulesetIdSchema = z.string().uuid('Invalid ruleset ID');

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

// API request schema
export const analyzeRequestSchema = z.object({
  projectId: projectIdSchema,
  commits: z.array(z.string()).min(1),
  forceFullAnalysis: z.boolean().default(false),
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  repo: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  default_branch: z.string().default('main'),
  ruleset_id: rulesetIdSchema.optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  ruleset_id: rulesetIdSchema.nullable().optional(),
});

export const createRuleSchema = z.object({
  ruleset_id: rulesetIdSchema,
  category: z.enum(['style', 'security', 'architecture', 'performance', 'maintainability']),
  name: z.string().min(1).max(100),
  prompt: z.string().min(1).max(5000),
  weight: z.number().int().min(0).max(100).default(20),
  severity: z.enum(['error', 'warning', 'info']).default('warning'),
  is_enabled: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

// ─── Pipeline schemas ──────────────────────────────────────────────────────

const pipelineStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  script: z.string(),
  artifactPaths: z.array(z.string().min(1)).optional(),
  artifactInputs: z.array(z.string().min(1)).optional(),
  artifactSource: z.enum(['run', 'registry']).optional(),
  registryRepository: z.string().min(1).optional(),
  registryVersion: z.string().min(1).optional(),
  registryChannel: z.string().min(1).optional(),
  type: z.enum(['shell', 'docker']).optional(),
  dockerImage: z.string().min(1).optional(),
  continueOnError: z.boolean().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
  workingDir: z.string().optional(),
}).superRefine((step, ctx) => {
  if (step.artifactSource !== 'registry') {
    return;
  }
  if (!step.registryRepository?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'registryRepository is required when artifactSource=registry',
      path: ['registryRepository'],
    });
  }
  const hasVersion = !!step.registryVersion?.trim();
  const hasChannel = !!step.registryChannel?.trim();
  if (hasVersion === hasChannel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose exactly one of registryVersion or registryChannel',
      path: hasVersion ? ['registryVersion'] : ['registryChannel'],
    });
  }
});

const pipelineJobSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stage: z
    .enum([
      'source',
      'after_source',
      'review',
      'after_review',
      'build',
      'after_build',
      'deploy',
      'after_deploy',
    ])
    .optional(),
  needs: z.array(z.string().min(1)).optional(),
  steps: z.array(pipelineStepSchema).min(1),
  timeoutSeconds: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
  workingDir: z.string().optional(),
  type: z.enum(['shell', 'source_checkout', 'review_gate']).optional(),
  branch: z.string().min(1).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
});

const pipelineTriggerSchema = z.object({
  autoTrigger: z.boolean().default(false),
  schedule: z.string().optional(),
});

const pipelineNotificationsSchema = z.object({
  onSuccess: z.boolean().default(true),
  onFailure: z.boolean().default(true),
  channels: z.array(z.enum(['email', 'inapp'])).default(['inapp', 'email']),
});

const pipelineStageConfigSchema = z.object({
  entryMode: z.enum(['auto', 'manual']).optional(),
  dispatchMode: z.enum(['parallel', 'serial']).optional(),
});

const pipelineStagesSchema = z
  .object({
    source: pipelineStageConfigSchema.optional(),
    after_source: pipelineStageConfigSchema.optional(),
    review: pipelineStageConfigSchema.optional(),
    after_review: pipelineStageConfigSchema.optional(),
    build: pipelineStageConfigSchema.optional(),
    after_build: pipelineStageConfigSchema.optional(),
    deploy: pipelineStageConfigSchema.optional(),
    after_deploy: pipelineStageConfigSchema.optional(),
  })
  .optional();

export const pipelineConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  buildImage: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  environment: z.enum(['development', 'staging', 'production']).default('production'),
  trigger: pipelineTriggerSchema,
  notifications: pipelineNotificationsSchema,
  stages: pipelineStagesSchema,
  jobs: z.array(pipelineJobSchema).min(1),
}).superRefine((config, ctx) => {
  for (const job of config.jobs) {
    const stage = job.stage ?? (job.type === 'source_checkout' ? 'source' : job.type === 'review_gate' ? 'review' : 'build');
    const isDeployStage = stage === 'deploy' || stage === 'after_deploy';
    for (const step of job.steps) {
      if (!isDeployStage && (step.type ?? 'shell') === 'docker') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CI stages must use the pipeline buildImage instead of step-level docker mode',
          path: ['jobs', config.jobs.indexOf(job), 'steps', job.steps.indexOf(step), 'type'],
        });
      }
    }
  }
});

export const createPipelineSchema = z.object({
  projectId: projectIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  config: pipelineConfigSchema,
}).superRefine((value, ctx) => {
  if (!value.config.buildImage?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'buildImage is required',
      path: ['config', 'buildImage'],
    });
  }
});

export const updatePipelineSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  config: pipelineConfigSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.config && !value.config.buildImage?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'buildImage is required',
      path: ['config', 'buildImage'],
    });
  }
});

export const notificationSettingsSchema = z.object({
  email_enabled: z.boolean(),
  notify_on_pipeline_run: z.boolean(),
  notify_on_report_ready: z.boolean(),
  notify_on_report_score_below: z.union([z.number().int().min(0).max(100), z.null()]),
});

export const runtimeSettingsSchema = z.object({
  analyzeRateWindowMs: z.number().int().min(1).max(3_600_000),
  analyzeRateUserProjectMax: z.number().int().min(1).max(10_000),
  analyzeRateOrgMax: z.number().int().min(1).max(100_000),
  analyzeRateIpMax: z.number().int().min(1).max(100_000),
  analyzeDedupeTtlSec: z.number().int().min(1).max(86_400),
  analyzeDedupeLockTtlSec: z.number().int().min(1).max(3_600),
  analyzeBackpressureProjectActiveMax: z.number().int().min(1).max(10_000),
  analyzeBackpressureOrgActiveMax: z.number().int().min(1).max(100_000),
  analyzeBackpressureRetryAfterSec: z.number().int().min(1).max(3_600),
  analyzeReportTimeoutMs: z.number().int().min(60_000).max(24 * 60 * 60 * 1000),
  codebaseFileMaxBytes: z.number().int().min(16 * 1024).max(10 * 1024 * 1024),
});

/**
 * Validate request payload
 */
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data) as T;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const messages = err.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join('; ');
      throw new Error(`Validation error: ${messages}`);
    }
    throw err;
  }
}

/**
 * Safe JSON parse
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
