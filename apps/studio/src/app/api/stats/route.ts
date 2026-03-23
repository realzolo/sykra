import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import {
  ANALYSIS_ACTIVE_STATUSES_SQL,
  ANALYSIS_RESULT_READY_STATUSES_SQL,
  PIPELINE_RUNNING_STATUSES_SQL,
} from '@/services/statuses';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type CountRow = {
  count: number;
};

type ReportAggregateRow = {
  total_reports: number;
  average_score: number | null;
  pending_reports: number;
  recent_avg: number | string | null;
  previous_avg: number | string | null;
};

type IssueAggregateRow = {
  total_issues: number;
  critical_issues: number;
  open_issues: number;
};

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);

  const [projectCountRow, activeRunsRow, reportAggregateRow, issueAggregateRow] = await Promise.all([
    query<CountRow>(
      `select count(*)::int as count
       from code_projects
       where org_id = $1`,
      [orgId]
    ).then((rows) => rows[0] ?? { count: 0 }),
    query<CountRow>(
      `select count(*)::int as count
       from pipeline_runs
       where org_id = $1 and status in (${PIPELINE_RUNNING_STATUSES_SQL})`,
      [orgId]
    ).then((rows) => rows[0] ?? { count: 0 }),
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
       where org_id = $1`,
      [orgId]
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
          (count(*) filter (where i.severity in ('critical', 'high')))::int as critical_issues,
          (count(*) filter (where i.status = 'open'))::int as open_issues
       from analysis_issues i
       join analysis_reports r on r.id = i.report_id
       where r.org_id = $1
         and r.status in (${ANALYSIS_RESULT_READY_STATUSES_SQL})`,
      [orgId]
    ).then((rows) => rows[0] ?? { total_issues: 0, critical_issues: 0, open_issues: 0 }),
  ]);

  const totalReports = reportAggregateRow.total_reports ?? 0;
  if (totalReports <= 0) {
    return NextResponse.json({
      totalProjects: projectCountRow.count ?? 0,
      totalReports: 0,
      averageScore: 0,
      openIssues: 0,
      totalIssues: 0,
      criticalIssues: 0,
      recentTrend: 'stable',
      trendValue: 0,
      pendingReports: 0,
      activePipelineRuns: activeRunsRow.count ?? 0,
    });
  }

  const averageScore = reportAggregateRow.average_score ?? 0;
  const totalIssues = issueAggregateRow.total_issues ?? 0;
  const criticalIssues = issueAggregateRow.critical_issues ?? 0;
  const openIssues = issueAggregateRow.open_issues ?? 0;
  const pendingReports = reportAggregateRow.pending_reports ?? 0;
  const recentAvg = Number(reportAggregateRow.recent_avg ?? 0);
  const previousAvg = Number(reportAggregateRow.previous_avg ?? 0);
  const trendValue = Math.round(recentAvg - previousAvg);
  const recentTrend = trendValue > 2 ? 'up' : trendValue < -2 ? 'down' : 'stable';

  return NextResponse.json({
    totalProjects: projectCountRow.count ?? 0,
    totalReports,
    averageScore,
    openIssues,
    totalIssues,
    criticalIssues,
    recentTrend,
    trendValue,
    pendingReports,
    activePipelineRuns: activeRunsRow.count ?? 0,
  });
}
