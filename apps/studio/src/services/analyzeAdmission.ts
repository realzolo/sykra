import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { queryOne, withTransaction } from '@/lib/db';
import type { JsonArray, JsonObject } from '@/lib/json';
import { getOrgRuntimeSettings } from '@/services/runtimeSettings';
import { ANALYSIS_ACTIVE_STATUSES_SQL } from '@/services/statuses';
import type { AnalysisReportStatus } from '@/services/statuses';

type AnalyzeAdmissionConfig = {
  rateWindowMs: number;
  rateUserProjectMax: number;
  rateOrgMax: number;
  rateIpMax: number;
  dedupeResultTtlSec: number;
  dedupeLockTtlSec: number;
  backpressureProjectActiveMax: number;
  backpressureOrgActiveMax: number;
  backpressureRetryAfterSec: number;
};

export type AnalyzeFingerprintRule = {
  category: string;
  name: string;
  prompt: string;
  severity: string;
};

export type AnalyzeFingerprintInput = {
  orgId: string;
  projectId: string;
  commits: string[];
  rules: AnalyzeFingerprintRule[];
  forceFullAnalysis: boolean;
  useIncremental: boolean;
};

export type AnalyzeAdmissionResult = {
  reportId: string;
  status: 'queued' | Extract<AnalysisReportStatus, 'running' | 'partial_done' | 'done' | 'partial_failed' | 'failed' | 'canceled'>;
  projectId: string;
  orgId: string;
  incrementalAnalysis: boolean;
  createdAt: number;
  deduplicated: boolean;
};

type AnalyzeRejectResponse = {
  status: number;
  body: JsonObject;
  headers: Record<string, string>;
};

type BucketUsage = {
  count: number;
  remaining: number;
  ttlMs: number;
};

type QueueDepthRow = {
  org_active: string | number;
  project_active: string | number;
};

type AnalyzeReportRow = {
  id: string;
  status: AnalysisReportStatus;
  project_id: string;
  org_id: string;
  created_at: string | Date;
  analysis_snapshot: JsonObject | null;
};

async function getAnalyzeAdmissionConfig(orgId: string): Promise<AnalyzeAdmissionConfig> {
  const settings = await getOrgRuntimeSettings(orgId);
  return {
    rateWindowMs: settings.analyzeRateWindowMs,
    rateUserProjectMax: settings.analyzeRateUserProjectMax,
    rateOrgMax: settings.analyzeRateOrgMax,
    rateIpMax: settings.analyzeRateIpMax,
    dedupeResultTtlSec: settings.analyzeDedupeTtlSec,
    dedupeLockTtlSec: settings.analyzeDedupeLockTtlSec,
    backpressureProjectActiveMax: settings.analyzeBackpressureProjectActiveMax,
    backpressureOrgActiveMax: settings.analyzeBackpressureOrgActiveMax,
    backpressureRetryAfterSec: settings.analyzeBackpressureRetryAfterSec,
  };
}

export function buildAnalyzeFingerprint(input: AnalyzeFingerprintInput): string {
  const normalizedRules = input.rules
    .map((rule) => ({
      category: rule.category,
      name: rule.name,
      prompt: rule.prompt,
      severity: rule.severity,
    }))
    .sort((left, right) => {
      const leftKey = `${left.category}:${left.name}:${left.severity}:${left.prompt}`;
      const rightKey = `${right.category}:${right.name}:${right.severity}:${right.prompt}`;
      return leftKey.localeCompare(rightKey);
    });

  const normalizedCommits = Array.from(new Set(input.commits.map((hash) => hash.trim())))
    .filter((hash) => hash.length > 0)
    .sort((left, right) => left.localeCompare(right));

  const payload = {
    orgId: input.orgId,
    projectId: input.projectId,
    commits: normalizedCommits,
    rules: normalizedRules,
    forceFullAnalysis: input.forceFullAnalysis,
    useIncremental: input.useIncremental,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function enforceAnalyzeRateLimit(
  input: { orgId: string; userId: string; projectId: string; ipAddress?: string | null }
): Promise<AnalyzeRejectResponse | null> {
  const config = await getAnalyzeAdmissionConfig(input.orgId);
  const scopes: Array<{ name: string; key: string; limit: number }> = [
    {
      name: 'user_project',
      key: `rl:analyze:user_project:${input.orgId}:${input.userId}:${input.projectId}`,
      limit: config.rateUserProjectMax,
    },
    {
      name: 'org',
      key: `rl:analyze:org:${input.orgId}`,
      limit: config.rateOrgMax,
    },
  ];

  const normalizedIp = normalizeIp(input.ipAddress);
  if (normalizedIp) {
    const ipFingerprint = createHash('sha1').update(normalizedIp).digest('hex').slice(0, 16);
    scopes.push({
      name: 'ip',
      key: `rl:analyze:ip:${ipFingerprint}`,
      limit: config.rateIpMax,
    });
  }

  for (const scope of scopes) {
    const usage = await consumeRateBucket(scope.key, scope.limit, config.rateWindowMs);
    if (usage.count > scope.limit) {
      const retryAfter = Math.max(1, Math.ceil(usage.ttlMs / 1000));
      const resetAtMs = Date.now() + usage.ttlMs;
      return {
        status: 429,
        body: {
          error: 'Too many requests',
          scope: scope.name,
        },
        headers: {
          ...buildRateLimitHeaders(scope.limit, 0, resetAtMs),
          'Retry-After': retryAfter.toString(),
        },
      };
    }
  }

  return null;
}

export async function checkAnalyzeBackpressure(
  orgId: string,
  projectId: string
): Promise<AnalyzeRejectResponse | null> {
  const config = await getAnalyzeAdmissionConfig(orgId);
  const row = await queryOne<QueueDepthRow>(
    `select
       count(*) filter (where status in (${ANALYSIS_ACTIVE_STATUSES_SQL})) as org_active,
       count(*) filter (where project_id = $2 and status in (${ANALYSIS_ACTIVE_STATUSES_SQL})) as project_active
     from analysis_reports
     where org_id = $1`,
    [orgId, projectId]
  );

  const orgActive = toInt(row?.org_active);
  const projectActive = toInt(row?.project_active);

  if (
    orgActive < config.backpressureOrgActiveMax &&
    projectActive < config.backpressureProjectActiveMax
  ) {
    return null;
  }

  return {
    status: 503,
    body: {
      error: 'Analyze queue is saturated, please retry shortly',
      code: 'ANALYZE_QUEUE_SATURATED',
      orgActive,
      projectActive,
    },
    headers: {
      'Retry-After': config.backpressureRetryAfterSec.toString(),
    },
  };
}

export async function createOrReuseAnalyzeReport(input: {
  orgId: string;
  projectId: string;
  fingerprint: string;
  rulesetSnapshot: JsonArray;
  commits: JsonArray;
  analysisSnapshot: JsonObject;
}): Promise<AnalyzeAdmissionResult> {
  const config = await getAnalyzeAdmissionConfig(input.orgId);

  const lockedResult = await withTransaction(async (client) => {
    const locked = await tryAcquireAnalyzeLock(client, input.fingerprint);
    if (!locked) {
      return null;
    }

    const existing = await findExistingAnalyzeReport(client, input.projectId, input.fingerprint);
    if (existing && isReusableAnalyzeReport(existing, config.dedupeResultTtlSec)) {
      return mapAnalyzeAdmission(existing, true);
    }

    const report = await insertAnalyzeReport(client, {
      projectId: input.projectId,
      orgId: input.orgId,
      rulesetSnapshot: input.rulesetSnapshot,
      commits: input.commits,
      analysisSnapshot: input.analysisSnapshot,
    });
    return mapAnalyzeAdmission(report, false);
  });

  if (lockedResult) {
    return lockedResult;
  }

  const deadline = Date.now() + config.dedupeLockTtlSec * 1000;
  while (Date.now() < deadline) {
    const existing = await findExistingAnalyzeReportByFingerprint(input.projectId, input.fingerprint);
    if (existing && isReusableAnalyzeReport(existing, config.dedupeResultTtlSec)) {
      return mapAnalyzeAdmission(existing, true);
    }
    await sleep(200);
  }

  throw new Error('conflict: identical analysis request is already being processed');
}

async function findExistingAnalyzeReport(
  client: PoolClient,
  projectId: string,
  fingerprint: string
): Promise<AnalyzeReportRow | null> {
  const { rows } = await client.query<AnalyzeReportRow>(
    `select id, status, project_id, org_id, created_at, analysis_snapshot
     from analysis_reports
     where project_id = $1
       and analysis_snapshot->>'fingerprint' = $2
     order by created_at desc
     limit 1`,
    [projectId, fingerprint]
  );
  return rows[0] ?? null;
}

async function findExistingAnalyzeReportByFingerprint(
  projectId: string,
  fingerprint: string
): Promise<AnalyzeReportRow | null> {
  const row = await queryOne<AnalyzeReportRow>(
    `select id, status, project_id, org_id, created_at, analysis_snapshot
     from analysis_reports
     where project_id = $1
       and analysis_snapshot->>'fingerprint' = $2
     order by created_at desc
     limit 1`,
    [projectId, fingerprint]
  );
  return row ?? null;
}

async function insertAnalyzeReport(
  client: PoolClient,
  input: {
    projectId: string;
    orgId: string;
    rulesetSnapshot: JsonArray;
    commits: JsonArray;
    analysisSnapshot: JsonObject;
  }
): Promise<AnalyzeReportRow> {
  const { rows } = await client.query<AnalyzeReportRow>(
    `insert into analysis_reports
      (project_id, org_id, ruleset_snapshot, commits, analysis_snapshot, status, created_at, updated_at)
     values ($1,$2,$3,$4,$5,'pending',now(),now())
     returning id, status, project_id, org_id, created_at, analysis_snapshot`,
    [
      input.projectId,
      input.orgId,
      JSON.stringify(input.rulesetSnapshot),
      JSON.stringify(input.commits),
      JSON.stringify(input.analysisSnapshot),
    ]
  );
  const report = rows[0];
  if (!report) {
    throw new Error('Failed to create report');
  }
  return report;
}

async function tryAcquireAnalyzeLock(client: PoolClient, fingerprint: string): Promise<boolean> {
  const { rows } = await client.query<{ locked: boolean }>(
    `select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as locked`,
    [fingerprint]
  );
  return rows[0]?.locked === true;
}

function mapAnalyzeAdmission(
  report: AnalyzeReportRow,
  deduplicated: boolean
): AnalyzeAdmissionResult {
  const status = report.status === 'pending' ? 'queued' : report.status;
  return {
    reportId: report.id,
    status,
    projectId: report.project_id,
    orgId: report.org_id,
    incrementalAnalysis: Boolean(report.analysis_snapshot?.useIncremental),
    createdAt: new Date(report.created_at).getTime(),
    deduplicated,
  };
}

function isReusableAnalyzeReport(report: AnalyzeReportRow, dedupeTtlSec: number): boolean {
  if (report.status === 'pending' || report.status === 'running') {
    return true;
  }

  if (report.status === 'failed' || report.status === 'canceled') {
    return false;
  }

  if (dedupeTtlSec <= 0) {
    return false;
  }

  const ageMs = Date.now() - new Date(report.created_at).getTime();
  return ageMs <= dedupeTtlSec * 1000;
}

function buildRateLimitHeaders(limit: number, remaining: number, resetAtMs: number) {
  const resetAtSeconds = Math.floor(resetAtMs / 1000);
  return {
    'RateLimit-Limit': limit.toString(),
    'RateLimit-Remaining': remaining.toString(),
    'RateLimit-Reset': resetAtSeconds.toString(),
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': resetAtMs.toString(),
  };
}

async function consumeRateBucket(
  key: string,
  limit: number,
  windowMs: number
): Promise<BucketUsage> {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const windowEnd = new Date(windowStart.getTime() + windowMs);
  const row = await queryOne<{ count: number; ttl_ms: number }>(
    `with upserted as (
       insert into analysis_rate_buckets
         (bucket_key, window_started_at, window_ends_at, request_count, updated_at)
       values ($1, $2, $3, 1, now())
       on conflict (bucket_key, window_started_at)
       do update set
         request_count = analysis_rate_buckets.request_count + 1,
         window_ends_at = excluded.window_ends_at,
         updated_at = now()
       returning request_count, window_ends_at
     )
     select request_count as count,
            greatest(0, floor(extract(epoch from (window_ends_at - now())) * 1000))::int as ttl_ms
     from upserted`,
    [key, windowStart.toISOString(), windowEnd.toISOString()]
  );

  if (!row) {
    throw new Error('Failed consuming rate bucket');
  }

  return {
    count: row.count,
    remaining: Math.max(0, limit - row.count),
    ttlMs: Math.max(0, row.ttl_ms),
  };
}

function normalizeIp(ipAddress?: string | null) {
  if (!ipAddress) return null;
  const first = ipAddress.split(',')[0]?.trim();
  if (!first) return null;
  return first;
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(ms, 0));
  });
}
