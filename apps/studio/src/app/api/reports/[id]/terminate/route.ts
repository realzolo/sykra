import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { logger } from '@/services/logger';
import { reportIdSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireReportAccess } from '@/services/orgs';
import { ANALYSIS_ACTIVE_STATUSES_SQL } from '@/services/statuses';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type ReportStatusRow = {
  id: string;
  status: string;
  project_id: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const reportId = reportIdSchema.parse(id);

    logger.setContext({ reportId });

    await withRetry(() => requireReportAccess(reportId, user.id));
    const report = await withRetry(() =>
      queryOne<ReportStatusRow>(
        `select id, status, project_id
         from analysis_reports
         where id = $1`,
        [reportId]
      )
    );

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (report.status !== 'pending' && report.status !== 'running') {
      return NextResponse.json(
        { error: `Report cannot be terminated in status: ${report.status}` },
        { status: 409 }
      );
    }

    const terminationMessage = 'Analysis canceled by user';
    const terminated = await withRetry(() =>
      queryOne<ReportStatusRow>(
        `update analysis_reports
         set status = 'canceled',
             error_message = $2,
             sse_seq = sse_seq + 1,
             updated_at = now()
         where id = $1
           and status in (${ANALYSIS_ACTIVE_STATUSES_SQL})
         returning id, status, project_id`,
        [reportId, terminationMessage]
      )
    );
    if (!terminated) {
      const latest = await withRetry(() =>
        queryOne<{ status: string }>(
          `select status from analysis_reports where id = $1`,
          [reportId]
        )
      );
      return NextResponse.json(
        { error: `Report cannot be terminated in status: ${latest?.status ?? 'unknown'}` },
        { status: 409 }
      );
    }

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'update',
      entityType: 'report',
      entityId: reportId,
      userId: user.id,
      changes: { status: 'canceled', reason: 'terminated_by_user', projectId: terminated.project_id },
      ...clientInfo,
    });

    return NextResponse.json({
      success: true,
      reportId,
      status: 'canceled',
      error_message: terminationMessage,
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Terminate report failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
