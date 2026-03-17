import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);

  const [projectCountRow, openIssuesRow, activeRunsRow] = await Promise.all([
    query<Record<string, any>>(
      `select count(*)::int as count
       from code_projects
       where org_id = $1`,
      [orgId]
    ).then((rows) => rows[0] ?? { count: 0 }),
    query<Record<string, any>>(
      `select count(*)::int as count
       from analysis_issues i
       join analysis_reports r on r.id = i.report_id
       where r.org_id = $1 and r.status = 'done' and i.status = 'open'`,
      [orgId]
    ).then((rows) => rows[0] ?? { count: 0 }),
    query<Record<string, any>>(
      `select count(*)::int as count
       from pipeline_runs
       where org_id = $1 and status in ('queued','running')`,
      [orgId]
    ).then((rows) => rows[0] ?? { count: 0 }),
  ]);

  // Get all reports
  const reports = await query<Record<string, any>>(
    `select status, score, issues, created_at
     from analysis_reports
     where org_id = $1
     order by created_at desc`,
    [orgId]
  );

  if (!reports || reports.length === 0) {
    return NextResponse.json({
      totalProjects: projectCountRow.count ?? 0,
      totalReports: 0,
      averageScore: 0,
      openIssues: openIssuesRow.count ?? 0,
      totalIssues: 0,
      criticalIssues: 0,
      recentTrend: 'stable',
      trendValue: 0,
      pendingReports: 0,
      activePipelineRuns: activeRunsRow.count ?? 0,
    });
  }

  const doneReports = reports.filter(r => r.status === 'done');
  const pendingReports = reports.filter(
    r => r.status === 'pending' || r.status === 'analyzing'
  ).length;

  // Calculate average score
  const scores = doneReports.map(r => r.score).filter(s => s != null);
  const averageScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  // Calculate total issues
  let totalIssues = 0;
  let criticalIssues = 0;
  doneReports.forEach(r => {
    if (r.issues && Array.isArray(r.issues)) {
      totalIssues += r.issues.length;
      criticalIssues += r.issues.filter(
        (i: Record<string, unknown>) => i.severity === 'critical' || i.severity === 'high'
      ).length;
    }
  });

  // Calculate trend
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;

  const recentReports = doneReports.filter(
    r => new Date(r.created_at).getTime() > sevenDaysAgo
  );
  const previousReports = doneReports.filter(
    r =>
      new Date(r.created_at).getTime() > fourteenDaysAgo &&
      new Date(r.created_at).getTime() <= sevenDaysAgo
  );

  const recentAvg = recentReports.length > 0
    ? recentReports.reduce((sum, r) => sum + (r.score || 0), 0) / recentReports.length
    : 0;
  const previousAvg = previousReports.length > 0
    ? previousReports.reduce((sum, r) => sum + (r.score || 0), 0) / previousReports.length
    : 0;

  const trendValue = Math.round(recentAvg - previousAvg);
  const recentTrend = trendValue > 2 ? 'up' : trendValue < -2 ? 'down' : 'stable';

  return NextResponse.json({
    totalProjects: projectCountRow.count ?? 0,
    totalReports: reports.length,
    averageScore,
    openIssues: openIssuesRow.count ?? 0,
    totalIssues,
    criticalIssues,
    recentTrend,
    trendValue,
    pendingReports,
    activePipelineRuns: activeRunsRow.count ?? 0,
  });
}
