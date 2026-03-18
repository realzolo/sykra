import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { query, queryOne } from '@/lib/db';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    const rawDays = request.nextUrl.searchParams.get('days');
    const days = [7, 30, 90].includes(Number(rawDays)) ? Number(rawDays) : 30;
    const interval = `${days} days`;

    const [
      projectScores,
      issueCategoryBreakdown,
      pipelineStats,
      issueResolution,
    ] = await Promise.all([
      // Per-project: avg score, report count, open issues in the period
      query<{
        project_id: string;
        project_name: string;
        report_count: string;
        avg_score: number | null;
        open_issues: string;
      }>(
        `select
           p.id as project_id,
           p.name as project_name,
           count(distinct r.id)::text as report_count,
           avg(r.score)::float as avg_score,
           count(distinct i.id) filter (where i.status = 'open')::text as open_issues
         from code_projects p
         left join analysis_reports r
           on r.project_id = p.id and r.org_id = $1
           and r.status = 'done'
           and r.created_at >= now() - $2::interval
         left join analysis_issues i on i.report_id = r.id
         where p.org_id = $1
         group by p.id, p.name
         order by avg_score desc nulls last`,
        [orgId, interval]
      ),

      // Top recurring issue categories across org
      query<{ category: string; count: string }>(
        `select i.category, count(*)::text as count
         from analysis_issues i
         join analysis_reports r on r.id = i.report_id
         where r.org_id = $1
           and r.status = 'done'
           and r.created_at >= now() - $2::interval
         group by i.category
         order by count desc
         limit 8`,
        [orgId, interval]
      ),

      // Pipeline success rate and avg duration per pipeline
      query<{
        pipeline_id: string;
        pipeline_name: string;
        total: string;
        succeeded: string;
        failed: string;
        avg_duration_s: number | null;
      }>(
        `select
           p.id as pipeline_id,
           p.name as pipeline_name,
           count(r.id)::text as total,
           count(r.id) filter (where r.status = 'success')::text as succeeded,
           count(r.id) filter (where r.status in ('failed','timed_out'))::text as failed,
           avg(extract(epoch from (r.finished_at - r.started_at)))::float as avg_duration_s
         from pipelines p
         left join pipeline_runs r
           on r.pipeline_id = p.id
           and r.created_at >= now() - $2::interval
         where p.org_id = $1
         group by p.id, p.name
         having count(r.id) > 0
         order by total desc
         limit 10`,
        [orgId, interval]
      ),

      // Issue resolution rate per project: resolved vs total in period
      query<{
        project_id: string;
        project_name: string;
        total: string;
        resolved: string;
      }>(
        `select
           p.id as project_id,
           p.name as project_name,
           count(i.id)::text as total,
           count(i.id) filter (where i.status in ('fixed','ignored','false_positive'))::text as resolved
         from code_projects p
         join analysis_reports r on r.project_id = p.id and r.org_id = $1
           and r.status = 'done'
           and r.created_at >= now() - $2::interval
         join analysis_issues i on i.report_id = r.id
         where p.org_id = $1
         group by p.id, p.name
         having count(i.id) > 0
         order by total desc
         limit 10`,
        [orgId, interval]
      ),
    ]);

    return NextResponse.json({
      days,
      projectScores,
      issueCategoryBreakdown,
      pipelineStats,
      issueResolution,
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
