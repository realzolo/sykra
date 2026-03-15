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
  category: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  prompt: z.string().min(1).max(5000),
  weight: z.number().min(0).max(1).default(1),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('medium'),
  is_enabled: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const pipelineStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal('shell'),
  script: z.string().min(1),
  env: z.record(z.string()).optional(),
  workingDir: z.string().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
  continueOnError: z.boolean().optional(),
  artifacts: z.array(z.string()).optional(),
});

const pipelineJobSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  needs: z.array(z.string()).optional(),
  steps: z.array(pipelineStepSchema).min(1),
  timeoutSeconds: z.number().int().positive().optional(),
  env: z.record(z.string()).optional(),
  workingDir: z.string().optional(),
});

const pipelineStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  jobIds: z.array(z.string()).min(1),
});

export const pipelineConfigSchema = z.object({
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  variables: z.record(z.string()).optional(),
  stages: z.array(pipelineStageSchema),
  jobs: z.array(pipelineJobSchema).min(1),
});

export const createPipelineSchema = z.object({
  projectId: projectIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  config: pipelineConfigSchema,
});

export const updatePipelineSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  config: pipelineConfigSchema,
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
