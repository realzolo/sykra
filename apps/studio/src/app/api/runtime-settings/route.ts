import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { exec } from '@/lib/db';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { formatErrorResponse } from '@/services/retry';
import { DEFAULT_ORG_RUNTIME_SETTINGS } from '@/services/runtimeSettings.shared';
import {
  getOrgRuntimeSettings,
  invalidateOrgRuntimeSettingsCache,
} from '@/services/runtimeSettings';
import { runtimeSettingsSchema, validateRequest } from '@/services/validation';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

async function ensureRow(orgId: string) {
  await exec(
    `insert into org_runtime_settings (
       org_id,
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
       pipeline_environments,
       created_at,
       updated_at
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now(),now())
     on conflict (org_id) do nothing`,
    [
      orgId,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateWindowMs,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateUserProjectMax,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateOrgMax,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateIpMax,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeDedupeTtlSec,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeDedupeLockTtlSec,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeBackpressureProjectActiveMax,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeBackpressureOrgActiveMax,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeBackpressureRetryAfterSec,
      DEFAULT_ORG_RUNTIME_SETTINGS.analyzeReportTimeoutMs,
      DEFAULT_ORG_RUNTIME_SETTINGS.codebaseFileMaxBytes,
      JSON.stringify(DEFAULT_ORG_RUNTIME_SETTINGS.pipelineEnvironments),
    ]
  );
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    await ensureRow(orgId);
    const settings = await getOrgRuntimeSettings(orgId);
    return NextResponse.json({ settings });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function PUT(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const validated = validateRequest(runtimeSettingsSchema, body);

    await ensureRow(orgId);
    await exec(
      `update org_runtime_settings
       set
         analyze_rate_window_ms = $2,
         analyze_rate_user_project_max = $3,
         analyze_rate_org_max = $4,
         analyze_rate_ip_max = $5,
         analyze_dedupe_ttl_sec = $6,
         analyze_dedupe_lock_ttl_sec = $7,
         analyze_backpressure_project_active_max = $8,
         analyze_backpressure_org_active_max = $9,
         analyze_backpressure_retry_after_sec = $10,
         analyze_report_timeout_ms = $11,
         codebase_file_max_bytes = $12,
         pipeline_environments = $13::jsonb,
         updated_at = now()
       where org_id = $1`,
      [
        orgId,
        validated.analyzeRateWindowMs,
        validated.analyzeRateUserProjectMax,
        validated.analyzeRateOrgMax,
        validated.analyzeRateIpMax,
        validated.analyzeDedupeTtlSec,
        validated.analyzeDedupeLockTtlSec,
        validated.analyzeBackpressureProjectActiveMax,
        validated.analyzeBackpressureOrgActiveMax,
        validated.analyzeBackpressureRetryAfterSec,
        validated.analyzeReportTimeoutMs,
        validated.codebaseFileMaxBytes,
        JSON.stringify(validated.pipelineEnvironments),
      ]
    );

    invalidateOrgRuntimeSettingsCache(orgId);
    await auditLogger.log({
      action: 'update',
      entityType: 'org',
      entityId: orgId,
      userId: user.id,
      changes: {
        scope: 'runtime_settings',
        ...validated,
      },
      ...extractClientInfo(request),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
