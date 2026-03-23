import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { logger } from '@/services/logger';
import { projectIdSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';
import { ANALYSIS_ACTIVE_STATUSES_SQL, ANALYSIS_RESULT_READY_STATUSES_SQL } from '@/services/statuses';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

interface ReportAggregateRow {
  total_reports: number;
  average_score: number | null;
  pending_reports: number;
  recent_avg: number | string | null;
  previous_avg: number | string | null;
}

interface IssueAggregateRow {
  total_issues: number;
  critical_issues: number;
}

interface StatsResponse {
  totalReports: number;
  averageScore: number;
  totalIssues: number;
  criticalIssues: number;
  recentTrend: 'up' | 'down' | 'stable';
  trendValue: number;
  pendingReports: number;
}

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

    // Validate project ID
    const projectId = projectIdSchema.parse(id);

    logger.setContext({ projectId });

    // Fetch project stats with retry
    const stats = await withRetry(async () => {
      await requireProjectAccess(projectId, user.id);

      const [reportAggregate, issueAggregate] = await Promise.all([
        query<ReportAggregateRow>(
          `select
              count(*)::int as total_reports,
              round(avg(score) filter (where status in (${ANALYSIS_RESULT_READY_STATUSES_SQL}) and score is not null))::int as average_score,
              (count(*) filter (where status in (${ANALYSIS_ACTIVE_STATUSES_SQL})))::int as pending_reports,
              avg(score) filter (
                where status in (${ANALYSIS_RESULT_READY_STATUSES_SQL})
                  and score is not null
                  and created_at > now() - interval '7 days'
              ) as recent_avg,
              avg(score) filter (
                where status in (${ANALYSIS_RESULT_READY_STATUSES_SQL})
                  and score is not null
                  and created_at > now() - interval '14 days'
                  and created_at <= now() - interval '7 days'
              ) as previous_avg
           from analysis_reports
           where project_id = $1`,
          [projectId]
        ).then((rows) => rows[0] ?? {
          total_reports: 0,
          average_score: 0,
          pending_reports: 0,
          recent_avg: 0,
          previous_avg: 0,
        }),
        query<IssueAggregateRow>(
          `select
              count(*)::int as total_issues,
              (count(*) filter (where i.severity in ('critical', 'high')))::int as critical_issues
           from analysis_issues i
           join analysis_reports r on r.id = i.report_id
           where r.project_id = $1
             and r.status in (${ANALYSIS_RESULT_READY_STATUSES_SQL})`,
          [projectId]
        ).then((rows) => rows[0] ?? { total_issues: 0, critical_issues: 0 }),
      ]);

      const recentAvg = Number(reportAggregate.recent_avg ?? 0);
      const previousAvg = Number(reportAggregate.previous_avg ?? 0);
      const trendValue = Math.round(recentAvg - previousAvg);
      const recentTrend: StatsResponse['recentTrend'] =
        trendValue > 2 ? 'up' : trendValue < -2 ? 'down' : 'stable';

      return {
        totalReports: reportAggregate.total_reports ?? 0,
        averageScore: reportAggregate.average_score ?? 0,
        totalIssues: issueAggregate.total_issues ?? 0,
        criticalIssues: issueAggregate.critical_issues ?? 0,
        recentTrend,
        trendValue,
        pendingReports: reportAggregate.pending_reports ?? 0,
      };
    });

    logger.info(`Stats calculated: ${projectId}`);

    return NextResponse.json(stats);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Stats request failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

