import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getReportById, deleteReport } from '@/services/db';
import { query } from '@/lib/db';
import { logger } from '@/services/logger';
import { reportIdSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireReportAccess } from '@/services/orgs';
import { failTimedOutReport } from '@/services/reportTimeout';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(
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
    await failTimedOutReport(reportId);
    const report = await withRetry(() => getReportById(reportId));
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    const sections = await withRetry(() =>
      query<Record<string, unknown>>(
        `select *
           from (
             select distinct on (phase)
                    phase,
                    attempt,
                    status,
                    payload,
                    error_message as "errorMessage",
                    duration_ms as "durationMs",
                    tokens_used as "tokensUsed",
                    token_usage as "tokenUsage",
                    estimated_cost_usd as "estimatedCostUsd",
                    started_at as "startedAt",
                    completed_at as "completedAt",
                    updated_at as "updatedAt"
               from analysis_report_sections
              where report_id = $1
              order by phase, attempt desc
           ) s
          order by case s.phase
            when 'core' then 1
            when 'quality' then 2
            when 'security_performance' then 3
            when 'suggestions' then 4
            else 99
          end`,
        [reportId]
      )
    );

    logger.info(`Report fetched: ${reportId}`);
    return NextResponse.json({
      ...report,
      sections,
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get report failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

export async function DELETE(
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
    await withRetry(() => deleteReport(reportId));

    // Audit log
    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'delete',
      entityType: 'report',
      entityId: reportId,
      ...clientInfo,
    });

    logger.info(`Report deleted: ${reportId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Delete report failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
