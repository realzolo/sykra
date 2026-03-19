import { createHash } from 'crypto';
import { queryOne } from '@/lib/db';
import { getRedisClient } from '@/services/redisClient';

const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  ttl = tonumber(ARGV[1])
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local remaining = tonumber(ARGV[2]) - current
if remaining < 0 then
  remaining = 0
end
return {current, remaining, ttl}
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const analyzeAdmissionConfig = {
  rateWindowMs: readPositiveIntEnv('ANALYZE_RATE_LIMIT_WINDOW_MS', 60_000),
  rateUserProjectMax: readPositiveIntEnv('ANALYZE_RATE_LIMIT_USER_PROJECT_MAX', 6),
  rateOrgMax: readPositiveIntEnv('ANALYZE_RATE_LIMIT_ORG_MAX', 60),
  rateIpMax: readPositiveIntEnv('ANALYZE_RATE_LIMIT_IP_MAX', 120),
  dedupeResultTtlSec: readPositiveIntEnv('ANALYZE_DEDUPE_TTL_SEC', 180),
  dedupeLockTtlSec: readPositiveIntEnv('ANALYZE_DEDUPE_LOCK_TTL_SEC', 15),
  backpressureProjectActiveMax: readPositiveIntEnv('ANALYZE_BACKPRESSURE_PROJECT_ACTIVE_MAX', 6),
  backpressureOrgActiveMax: readPositiveIntEnv('ANALYZE_BACKPRESSURE_ORG_ACTIVE_MAX', 60),
  backpressureRetryAfterSec: readPositiveIntEnv('ANALYZE_BACKPRESSURE_RETRY_AFTER_SEC', 15),
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

export type AnalyzeDedupeResult = {
  reportId: string;
  taskId?: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  projectId: string;
  orgId: string;
  incrementalAnalysis: boolean;
  createdAt: number;
};

type AnalyzeRateLimitInput = {
  orgId: string;
  userId: string;
  projectId: string;
  ipAddress?: string | null;
};

type AnalyzeRejectResponse = {
  status: number;
  body: Record<string, unknown>;
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

type RateScope = {
  name: string;
  key: string;
  limit: number;
};

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
  input: AnalyzeRateLimitInput
): Promise<AnalyzeRejectResponse | null> {
  const scopes: RateScope[] = [
    {
      name: 'user_project',
      key: `rl:analyze:user_project:${input.orgId}:${input.userId}:${input.projectId}`,
      limit: analyzeAdmissionConfig.rateUserProjectMax,
    },
    {
      name: 'org',
      key: `rl:analyze:org:${input.orgId}`,
      limit: analyzeAdmissionConfig.rateOrgMax,
    },
  ];

  const normalizedIp = normalizeIp(input.ipAddress);
  if (normalizedIp) {
    const ipFingerprint = createHash('sha1').update(normalizedIp).digest('hex').slice(0, 16);
    scopes.push({
      name: 'ip',
      key: `rl:analyze:ip:${ipFingerprint}`,
      limit: analyzeAdmissionConfig.rateIpMax,
    });
  }

  for (const scope of scopes) {
    const usage = await consumeRateBucket(scope.key, scope.limit, analyzeAdmissionConfig.rateWindowMs);
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
  const row = await queryOne<QueueDepthRow>(
    `select
       count(*) filter (where status in ('pending', 'running')) as org_active,
       count(*) filter (where project_id = $2 and status in ('pending', 'running')) as project_active
     from analysis_reports
     where org_id = $1`,
    [orgId, projectId]
  );

  const orgActive = toInt(row?.org_active);
  const projectActive = toInt(row?.project_active);

  if (
    orgActive < analyzeAdmissionConfig.backpressureOrgActiveMax &&
    projectActive < analyzeAdmissionConfig.backpressureProjectActiveMax
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
      'Retry-After': analyzeAdmissionConfig.backpressureRetryAfterSec.toString(),
    },
  };
}

export async function getAnalyzeDedupeResult(
  fingerprint: string
): Promise<AnalyzeDedupeResult | null> {
  const key = dedupeResultKey(fingerprint);
  cleanupInMemoryIfNeeded();

  const redis = getRedisClient();
  try {
    const raw = await redis.get(key);
    return parseDedupeResult(raw);
  } catch (err) {
    throw new Error(`Failed reading analyze dedupe result from Redis: ${String(err)}`);
  }
}

export async function waitForAnalyzeDedupeResult(
  fingerprint: string,
  waitMs: number,
  intervalMs: number = 200
): Promise<AnalyzeDedupeResult | null> {
  const deadline = Date.now() + Math.max(waitMs, 0);
  while (Date.now() < deadline) {
    const result = await getAnalyzeDedupeResult(fingerprint);
    if (result) {
      return result;
    }
    await sleep(intervalMs);
  }
  return null;
}

export async function claimAnalyzeDedupeLock(
  fingerprint: string,
  owner: string
): Promise<boolean> {
  const key = dedupeLockKey(fingerprint);
  cleanupInMemoryIfNeeded();

  const redis = getRedisClient();
  try {
    const lockResult = await redis.set(
      key,
      owner,
      'EX',
      analyzeAdmissionConfig.dedupeLockTtlSec,
      'NX'
    );
    return lockResult === 'OK';
  } catch (err) {
    throw new Error(`Failed acquiring analyze dedupe lock in Redis: ${String(err)}`);
  }
}

export async function releaseAnalyzeDedupeLock(
  fingerprint: string,
  owner: string
): Promise<void> {
  const key = dedupeLockKey(fingerprint);
  cleanupInMemoryIfNeeded();

  const redis = getRedisClient();
  try {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, owner);
  } catch (err) {
    throw new Error(`Failed releasing analyze dedupe lock in Redis: ${String(err)}`);
  }
}

export async function storeAnalyzeDedupeResult(
  fingerprint: string,
  result: AnalyzeDedupeResult
): Promise<void> {
  const key = dedupeResultKey(fingerprint);
  cleanupInMemoryIfNeeded();

  const redis = getRedisClient();
  try {
    await redis.set(
      key,
      JSON.stringify(result),
      'EX',
      analyzeAdmissionConfig.dedupeResultTtlSec
    );
  } catch (err) {
    throw new Error(`Failed storing analyze dedupe result in Redis: ${String(err)}`);
  }
}

function dedupeResultKey(fingerprint: string) {
  return `analyze:dedupe:result:${fingerprint}`;
}

function dedupeLockKey(fingerprint: string) {
  return `analyze:dedupe:lock:${fingerprint}`;
}

function parseDedupeResult(raw: string | null): AnalyzeDedupeResult | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isAnalyzeDedupeResult(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isAnalyzeDedupeResult(value: unknown): value is AnalyzeDedupeResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const status = record.status;

  if (
    status !== 'queued' &&
    status !== 'running' &&
    status !== 'done' &&
    status !== 'failed'
  ) {
    return false;
  }

  return (
    typeof record.reportId === 'string' &&
    typeof record.projectId === 'string' &&
    typeof record.orgId === 'string' &&
    typeof record.incrementalAnalysis === 'boolean' &&
    typeof record.createdAt === 'number' &&
    (typeof record.taskId === 'undefined' || typeof record.taskId === 'string')
  );
}

async function consumeRateBucket(key: string, limit: number, windowMs: number): Promise<BucketUsage> {
  cleanupInMemoryIfNeeded();

  const redis = getRedisClient();
  try {
    const raw = (await redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      key,
      String(windowMs),
      String(limit)
    )) as unknown;

    if (Array.isArray(raw) && raw.length >= 3) {
      const count = toInt(raw[0]);
      const remaining = toInt(raw[1]);
      const ttlMs = Math.max(toInt(raw[2]), 0);
      return { count, remaining, ttlMs };
    }
    throw new Error('invalid rate-limit script return shape');
  } catch (err) {
    throw new Error(`Failed consuming Redis rate bucket: ${String(err)}`);
  }
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

function normalizeIp(ipAddress?: string | null) {
  if (!ipAddress) return null;
  const first = ipAddress.split(',')[0]?.trim();
  if (!first) return null;
  return first;
}

function cleanupInMemoryIfNeeded() {
  // Redis-only admission control: no in-memory fallback state.
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
