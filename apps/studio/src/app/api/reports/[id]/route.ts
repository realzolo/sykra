import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getReportById, deleteReport } from '@/services/db';
import { query } from '@/lib/db';
import type { JsonObject } from '@/lib/json';
import { logger } from '@/services/logger';
import { reportIdSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireReportAccess } from '@/services/orgs';
import { failTimedOutReport } from '@/services/reportTimeout';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type ReportSectionRow = {
  phase: 'core' | 'quality' | 'security_performance' | 'suggestions' | string;
  attempt: number;
  status: 'pending' | 'running' | 'done' | 'failed' | 'canceled' | string;
  payload: JsonObject | null;
  errorMessage: string | null;
  durationMs: number | null;
  tokensUsed: number | null;
  tokenUsage: JsonObject | null;
  estimatedCostUsd: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
};

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
      query<ReportSectionRow>(
        `select
            s.phase,
            s.attempt,
            s.status,
            s.payload,
            s."errorMessage",
            s."durationMs",
            s."tokensUsed",
            s."tokenUsage",
            s."estimatedCostUsd",
            s."startedAt",
            s."completedAt",
            s."updatedAt"
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
    const issues = await withRetry(() =>
      query<{
        id: string;
        file: string;
        line: number | null;
        severity: string;
        category: string;
        rule: string;
        message: string;
        suggestion: string | null;
        codeSnippet: string | null;
        fixPatch: string | null;
        priority: number | null;
        impactScope: string | null;
        estimatedEffort: string | null;
      }>(
        `select
            i.id,
            i.file,
            i.line,
            i.severity,
            i.category,
            i.rule,
            i.message,
            i.suggestion,
            i.code_snippet as "codeSnippet",
            i.fix_patch as "fixPatch",
            i.priority,
            i.impact_scope as "impactScope",
            i.estimated_effort as "estimatedEffort"
         from analysis_issues i
         where i.report_id = $1
         order by i.priority asc nulls last, i.created_at asc`,
        [reportId]
      )
    );

    logger.info(`Report fetched: ${reportId}`);
    return NextResponse.json({
      ...report,
      ...(issues.length > 0 ? { issues } : {}),
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
