import { queryOne } from '@/lib/db';
import {
  normalizePipelineEnvironmentDefinitions,
  type PipelineEnvironmentDefinition,
} from '@/services/pipelineTypes';
import { DEFAULT_ORG_RUNTIME_SETTINGS, type OrgRuntimeSettings } from '@/services/runtimeSettings.shared';

type RuntimeSettingsRow = {
  analyze_rate_window_ms: number | null;
  analyze_rate_user_project_max: number | null;
  analyze_rate_org_max: number | null;
  analyze_rate_ip_max: number | null;
  analyze_dedupe_ttl_sec: number | null;
  analyze_dedupe_lock_ttl_sec: number | null;
  analyze_backpressure_project_active_max: number | null;
  analyze_backpressure_org_active_max: number | null;
  analyze_backpressure_retry_after_sec: number | null;
  analyze_report_timeout_ms: number | null;
  codebase_file_max_bytes: number | null;
  pipeline_environments: PipelineEnvironmentDefinition[] | null;
};

type CacheEntry = {
  value: OrgRuntimeSettings;
  expiresAt: number;
};

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, CacheEntry>();

function positiveInt(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value) || value == null || value <= 0) return fallback;
  return Math.round(value);
}

function normalizeSettings(row: RuntimeSettingsRow | null | undefined): OrgRuntimeSettings {
  return {
    analyzeRateWindowMs: positiveInt(
      row?.analyze_rate_window_ms,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateWindowMs
    ),
    analyzeRateUserProjectMax: positiveInt(
      row?.analyze_rate_user_project_max,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateUserProjectMax
    ),
    analyzeRateOrgMax: positiveInt(
      row?.analyze_rate_org_max,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateOrgMax
    ),
    analyzeRateIpMax: positiveInt(row?.analyze_rate_ip_max, DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateIpMax),
    analyzeDedupeTtlSec: positiveInt(
      row?.analyze_dedupe_ttl_sec,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeDedupeTtlSec
    ),
    analyzeDedupeLockTtlSec: positiveInt(
      row?.analyze_dedupe_lock_ttl_sec,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeDedupeLockTtlSec
    ),
    analyzeBackpressureProjectActiveMax: positiveInt(
      row?.analyze_backpressure_project_active_max,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeBackpressureProjectActiveMax
    ),
    analyzeBackpressureOrgActiveMax: positiveInt(
      row?.analyze_backpressure_org_active_max,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeBackpressureOrgActiveMax
    ),
    analyzeBackpressureRetryAfterSec: positiveInt(
      row?.analyze_backpressure_retry_after_sec,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeBackpressureRetryAfterSec
    ),
    analyzeReportTimeoutMs: positiveInt(
      row?.analyze_report_timeout_ms,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeReportTimeoutMs
    ),
    codebaseFileMaxBytes: positiveInt(
      row?.codebase_file_max_bytes,
      DEFAULT_ORG_RUNTIME_SETTINGS.codebaseFileMaxBytes
    ),
    pipelineEnvironments: normalizePipelineEnvironmentDefinitions(
      row?.pipeline_environments ?? DEFAULT_ORG_RUNTIME_SETTINGS.pipelineEnvironments
    ),
  };
}

export async function getOrgRuntimeSettings(orgId: string): Promise<OrgRuntimeSettings> {
  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const row = await queryOne<RuntimeSettingsRow>(
    `select
       analyze_rate_window_ms,
       analyze_rate_user_project_max,
       analyze_rate_org_max,
       analyze_rate_ip_max,
       analyze_dedupe_ttl_sec,
       analyze_dedupe_lock_ttl_sec,
       analyze_backpressure_project_active_max,
       analyze_backpressure_org_active_max,
       analyze_backpressure_retry_after_sec,
       analyze_report_timeout_ms,
       codebase_file_max_bytes,
       pipeline_environments
     from org_runtime_settings
     where org_id = $1`,
    [orgId]
  );

  const value = normalizeSettings(row);
  cache.set(orgId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function invalidateOrgRuntimeSettingsCache(orgId: string) {
  cache.delete(orgId);
}
