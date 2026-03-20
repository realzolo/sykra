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
  type: z.enum(['shell', 'docker']).optional(),
  dockerImage: z.string().min(1).optional(),
  continueOnError: z.boolean().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
  workingDir: z.string().optional(),
});

const pipelineSourceSchema = z.object({
  branch: z.string().min(1).default('main'),
  autoTrigger: z.boolean().default(false),
});

const pipelineReviewSchema = z.object({
  enabled: z.boolean().default(true),
  qualityGateEnabled: z.boolean().default(false),
  qualityGateMinScore: z.number().int().min(0).max(100).default(60),
});

const pipelineBuildSchema = z.object({
  enabled: z.boolean().default(true),
  steps: z.array(pipelineStepSchema),
});

const pipelineDeploySchema = z.object({
  enabled: z.boolean().default(true),
  steps: z.array(pipelineStepSchema),
  rollbackEnabled: z.boolean().default(true),
});

const pipelineNotificationsSchema = z.object({
  onSuccess: z.boolean().default(true),
  onFailure: z.boolean().default(true),
  channels: z.array(z.enum(['email', 'inapp'])).default(['inapp', 'email']),
});

export const pipelineConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  source: pipelineSourceSchema,
  review: pipelineReviewSchema,
  build: pipelineBuildSchema,
  deploy: pipelineDeploySchema,
  notifications: pipelineNotificationsSchema,
});

export const createPipelineSchema = z.object({
  projectId: projectIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  environment: z.enum(['development', 'staging', 'production']).default('production'),
  config: pipelineConfigSchema,
});

export const updatePipelineSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  environment: z.enum(['development', 'staging', 'production']).optional(),
  config: pipelineConfigSchema.optional(),
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
