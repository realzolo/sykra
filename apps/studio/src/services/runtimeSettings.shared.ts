import type { PipelineEnvironmentDefinition } from '@/services/pipelineTypes';
import { DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS } from '@/services/pipelineTypes';

export type OrgRuntimeSettings = {
  analyzeRateWindowMs: number;
  analyzeRateUserProjectMax: number;
  analyzeRateOrgMax: number;
  analyzeRateIpMax: number;
  analyzeDedupeTtlSec: number;
  analyzeDedupeLockTtlSec: number;
  analyzeBackpressureProjectActiveMax: number;
  analyzeBackpressureOrgActiveMax: number;
  analyzeBackpressureRetryAfterSec: number;
  analyzeReportTimeoutMs: number;
  codebaseFileMaxBytes: number;
  pipelineEnvironments: PipelineEnvironmentDefinition[];
};

export const DEFAULT_ORG_RUNTIME_SETTINGS: OrgRuntimeSettings = {
  analyzeRateWindowMs: 60_000,
  analyzeRateUserProjectMax: 6,
  analyzeRateOrgMax: 60,
  analyzeRateIpMax: 120,
  analyzeDedupeTtlSec: 180,
  analyzeDedupeLockTtlSec: 15,
  analyzeBackpressureProjectActiveMax: 6,
  analyzeBackpressureOrgActiveMax: 60,
  analyzeBackpressureRetryAfterSec: 15,
  analyzeReportTimeoutMs: 60 * 60 * 1000,
  codebaseFileMaxBytes: 256 * 1024,
  pipelineEnvironments: DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map((item) => ({ ...item })),
};
