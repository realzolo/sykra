import { query, queryOne } from '@/lib/db';
import { logger } from '@/services/logger';
import { DEFAULT_ORG_RUNTIME_SETTINGS } from '@/services/runtimeSettings.shared';
import { ANALYSIS_ACTIVE_STATUSES_SQL } from '@/services/statuses';

type ExpiredReportRow = { id: string };

const SWEEP_INTERVAL_MS = readPositiveIntEnv('ANALYZE_REPORT_TIMEOUT_SWEEP_INTERVAL_MS', 30 * 1000);
const DEFAULT_TIMEOUT_SECONDS = Math.max(
  1,
  Math.floor(DEFAULT_ORG_RUNTIME_SETTINGS.analyzeReportTimeoutMs / 1000)
);

let lastSweepAt = 0;

export async function failTimedOutReports(): Promise<number> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) {
    return 0;
  }
  lastSweepAt = now;

  const rows = await query<ExpiredReportRow>(
    `update analysis_reports
     set status = 'failed',
         error_message = $2,
         sse_seq = sse_seq + 1,
         updated_at = now()
     where id in (
       select r.id
       from analysis_reports r
       left join org_runtime_settings ors on ors.org_id = r.org_id
       where r.status in (${ANALYSIS_ACTIVE_STATUSES_SQL})
         and r.created_at < now() - make_interval(
           secs => greatest(1, floor(coalesce(ors.analyze_report_timeout_ms, $1 * 1000) / 1000.0)::int)
         )
     )
     returning id`,
    [DEFAULT_TIMEOUT_SECONDS, timeoutMessage()]
  );

  if (rows.length > 0) {
    logger.warn(`Marked ${rows.length} timed-out reports as failed`);
  }
  return rows.length;
}

export async function failTimedOutReport(reportId: string): Promise<boolean> {
  const row = await queryOne<ExpiredReportRow>(
    `update analysis_reports
     set status = 'failed',
         error_message = $3,
         sse_seq = sse_seq + 1,
         updated_at = now()
     where id in (
       select r.id
       from analysis_reports r
       left join org_runtime_settings ors on ors.org_id = r.org_id
       where r.id = $1
         and r.status in (${ANALYSIS_ACTIVE_STATUSES_SQL})
         and r.created_at < now() - make_interval(
           secs => greatest(1, floor(coalesce(ors.analyze_report_timeout_ms, $2 * 1000) / 1000.0)::int)
         )
     )
     returning id`,
    [reportId, DEFAULT_TIMEOUT_SECONDS, timeoutMessage()]
  );
  return !!row;
}

function timeoutMessage() {
  return 'Analysis timed out by runtime policy';
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
