import { query, queryOne } from '@/lib/db';
import { logger } from '@/services/logger';

type ExpiredReportRow = { id: string };

const REPORT_TIMEOUT_MS = readPositiveIntEnv('ANALYZE_REPORT_TIMEOUT_MS', 20 * 60 * 1000);
const SWEEP_INTERVAL_MS = readPositiveIntEnv('ANALYZE_REPORT_TIMEOUT_SWEEP_INTERVAL_MS', 30 * 1000);
const TIMEOUT_SECONDS = Math.max(1, Math.floor(REPORT_TIMEOUT_MS / 1000));

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
         updated_at = now()
     where status in ('pending', 'analyzing')
       and created_at < now() - make_interval(secs => $1)
     returning id`,
    [TIMEOUT_SECONDS, timeoutMessage()]
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
         updated_at = now()
     where id = $1
       and status in ('pending', 'analyzing')
       and created_at < now() - make_interval(secs => $2)
     returning id`,
    [reportId, TIMEOUT_SECONDS, timeoutMessage()]
  );
  return !!row;
}

function timeoutMessage() {
  const minutes = Math.max(1, Math.ceil(REPORT_TIMEOUT_MS / 60000));
  return `Analysis timed out after ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
