import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { query, queryOne } from '@/lib/db';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import { requireUser } from '@/services/auth';
import { requireOrgAccess } from '@/services/orgs';
import { FolderOpen, Settings, TrendingUp, TrendingDown, Minus, Zap, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function OrgRootPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  if (!user) {
    redirect('/login');
  }

  try {
    await requireOrgAccess(orgId, user.id);
  } catch {
    notFound();
  }

  const locale = await getLocale();
  const dict = await getDictionary(locale);

  const [
    projectCountRow,
    openIssuesRow,
    avgScoreRow,
    // Previous 14-day period for trends
    prevOpenIssuesRow,
    prevAvgScoreRow,
    recentReports,
    recentRuns,
    pipelineSuccessRow,
    projectScores,
    firstProjectRow,
  ] = await Promise.all([
    queryOne<{ count: string }>(
      `select count(*)::text as count
       from code_projects
       where org_id = $1`,
      [orgId]
    ),
    queryOne<{ count: string }>(
       `select count(*)::text as count
        from analysis_issues i
        join analysis_reports r on r.id = i.report_id
       where r.org_id = $1 and r.status in ('done', 'partial_failed') and i.status = 'open'`,
      [orgId]
    ),
    queryOne<{ avg: number | null }>(
      `select avg(score)::float as avg
       from analysis_reports
       where org_id = $1 and status in ('done', 'partial_failed') and score is not null
         and created_at >= now() - interval '14 days'`,
      [orgId]
    ),
    // Open issues created in previous 14-day window (14–28 days ago)
    queryOne<{ count: string }>(
       `select count(*)::text as count
        from analysis_issues i
        join analysis_reports r on r.id = i.report_id
       where r.org_id = $1 and r.status in ('done', 'partial_failed') and i.status = 'open'
         and r.created_at >= now() - interval '28 days'
         and r.created_at < now() - interval '14 days'`,
      [orgId]
    ),
    queryOne<{ avg: number | null }>(
      `select avg(score)::float as avg
       from analysis_reports
       where org_id = $1 and status in ('done', 'partial_failed') and score is not null
         and created_at >= now() - interval '28 days'
         and created_at < now() - interval '14 days'`,
      [orgId]
    ),
    query<{
      id: string;
      status: 'pending' | 'running' | 'done' | 'failed';
      score: number | null;
      created_at: string;
      project_id: string;
      project_name: string;
    }>(
      `select r.id, r.status, r.score, r.created_at, p.id as project_id, p.name as project_name
       from analysis_reports r
       join code_projects p on p.id = r.project_id
       where r.org_id = $1
       order by r.created_at desc
       limit 8`,
      [orgId]
    ),
    query<{
      id: string;
      status: 'queued' | 'running' | 'waiting_manual' | 'success' | 'failed' | 'canceled' | 'timed_out' | 'skipped';
      created_at: string;
      pipeline_id: string;
      pipeline_name: string;
      project_id: string | null;
      project_name: string | null;
      branch: string | null;
    }>(
      `select r.id, r.status, r.created_at,
              r.pipeline_id, p.name as pipeline_name,
              r.project_id, cp.name as project_name,
              r.branch
       from pipeline_runs r
       join pipelines p on p.id = r.pipeline_id
       left join code_projects cp on cp.id = r.project_id
       where r.org_id = $1
       order by r.created_at desc
       limit 8`,
      [orgId]
    ),
    // Pipeline success rate last 14 days
    queryOne<{ total: string; success: string }>(
      `select count(*)::text as total,
              count(*) filter (where status = 'success')::text as success
       from pipeline_runs
       where org_id = $1
         and created_at >= now() - interval '14 days'
         and status in ('success', 'failed', 'timed_out', 'canceled')`,
      [orgId]
    ),
    // Per-project latest score
    query<{ project_id: string; project_name: string; score: number; created_at: string }>(
      `select distinct on (r.project_id)
              r.project_id, p.name as project_name, r.score, r.created_at
       from analysis_reports r
       join code_projects p on p.id = r.project_id
       where r.org_id = $1 and r.status in ('done', 'partial_failed') and r.score is not null
         and r.created_at >= now() - interval '14 days'
       order by r.project_id, r.created_at desc`,
      [orgId]
    ),
    queryOne<{ id: string }>(
      `select id
       from code_projects
       where org_id = $1
       order by created_at asc
       limit 1`,
      [orgId]
    ),
  ]);

  const totalProjects = Number(projectCountRow?.count ?? 0);
  const openIssues = Number(openIssuesRow?.count ?? 0);
  const averageScore = Math.round(avgScoreRow?.avg ?? 0);
  const prevOpenIssues = Number(prevOpenIssuesRow?.count ?? 0);
  const prevAvgScore = Math.round(prevAvgScoreRow?.avg ?? 0);

  const pipelineTotal = Number(pipelineSuccessRow?.total ?? 0);
  const pipelineSuccess = Number(pipelineSuccessRow?.success ?? 0);
  const pipelineSuccessRate = pipelineTotal > 0 ? Math.round((pipelineSuccess / pipelineTotal) * 100) : null;
  const createPipelineHref = firstProjectRow?.id
    ? `/o/${orgId}/projects/${firstProjectRow.id}/pipelines`
    : `/o/${orgId}/projects`;

  const dateFmt = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  function formatDateTime(value: string) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return dateFmt.format(d);
  }

  function scoreColor(score: number) {
    if (score >= 85) return 'text-success';
    if (score >= 70) return 'text-warning';
    return 'text-danger';
  }

  function runStatusVariant(status: string): 'success' | 'danger' | 'warning' | 'muted' {
    if (status === 'success') return 'success';
    if (status === 'failed' || status === 'timed_out') return 'danger';
    if (status === 'running' || status === 'waiting_manual') return 'warning';
    return 'muted';
  }

  // Trend: positive delta is good for score, bad for openIssues
  type TrendDir = 'up' | 'down' | 'flat';
  function issueTrend(curr: number, prev: number): { dir: TrendDir; delta: number } {
    if (prev === 0 && curr === 0) return { dir: 'flat', delta: 0 };
    const delta = curr - prev;
    if (delta === 0) return { dir: 'flat', delta: 0 };
    return { dir: delta > 0 ? 'up' : 'down', delta };
  }
  function scoreTrend(curr: number, prev: number): { dir: TrendDir; delta: number } {
    if (prev === 0 && curr === 0) return { dir: 'flat', delta: 0 };
    const delta = curr - prev;
    if (delta === 0) return { dir: 'flat', delta: 0 };
    return { dir: delta > 0 ? 'up' : 'down', delta };
  }

  const issueTrendData = issueTrend(openIssues, prevOpenIssues);
  const scoreTrendData = averageScore > 0 ? scoreTrend(averageScore, prevAvgScore) : null;

  const isEmpty = totalProjects === 0;

  return (
    <div className="flex-1 overflow-auto">
      <div className="dashboard-container py-8 space-y-8">

        {/* Page heading */}
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
            {dict.dashboard.overview}
          </h1>
          <p className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">
            {dict.dashboard.last14Days}
          </p>
        </div>

        {isEmpty ? (
          /* Empty / onboarding state */
          <div className="rounded-[8px] border border-border bg-[hsl(var(--ds-background-2))] px-8 py-12 flex flex-col items-start gap-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-muted">
              <FolderOpen className="size-5 text-[hsl(var(--ds-text-2))]" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-foreground">{dict.dashboard.emptyTitle}</div>
              <div className="text-[13px] text-[hsl(var(--ds-text-2))] mt-1">{dict.dashboard.emptyDescription}</div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link
                href={`/o/${orgId}/projects`}
                className="inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-foreground px-3 text-[14px] font-medium text-background hover:bg-foreground/90 transition-colors"
              >
                {dict.dashboard.emptyCreateProject}
              </Link>
              <Link
                href={`/o/${orgId}/settings/integrations`}
                className="inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-border px-3 text-[14px] font-medium text-foreground hover:bg-[hsl(var(--ds-surface-1))] transition-colors"
              >
                <Settings className="size-3.5" />
                {dict.dashboard.emptySetupIntegration}
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Stat row — 4 cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Total Projects */}
              <div className="rounded-[8px] border border-border bg-[hsl(var(--ds-background-2))] px-4 py-4">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1.5">{dict.dashboard.totalProjects}</div>
                <div className="text-[22px] font-semibold tracking-tight">{totalProjects}</div>
              </div>

              {/* Average Score with trend */}
              <div className="rounded-[8px] border border-border bg-[hsl(var(--ds-background-2))] px-4 py-4">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1.5">{dict.dashboard.averageScore}</div>
                <div className="flex items-baseline gap-1">
                  <span className={['text-[22px] font-semibold tracking-tight', averageScore > 0 ? scoreColor(averageScore) : ''].filter(Boolean).join(' ')}>
                    {averageScore > 0 ? averageScore : '—'}
                  </span>
                  {averageScore > 0 && (
                    <span className="text-[12px] text-[hsl(var(--ds-text-2))]">/ 100</span>
                  )}
                </div>
                {scoreTrendData && scoreTrendData.dir !== 'flat' && (
                  <div className={['flex items-center gap-0.5 mt-1 text-[12px]', scoreTrendData.dir === 'up' ? 'text-success' : 'text-danger'].join(' ')}>
                    {scoreTrendData.dir === 'up'
                      ? <TrendingUp className="size-3" />
                      : <TrendingDown className="size-3" />}
                    <span>{scoreTrendData.delta > 0 ? '+' : ''}{scoreTrendData.delta} pts</span>
                  </div>
                )}
                {scoreTrendData && scoreTrendData.dir === 'flat' && (
                  <div className="flex items-center gap-0.5 mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                    <Minus className="size-3" /><span>{dict.dashboard.noChange}</span>
                  </div>
                )}
              </div>

              {/* Open Issues with trend */}
              <div className="rounded-[8px] border border-border bg-[hsl(var(--ds-background-2))] px-4 py-4">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1.5">{dict.dashboard.openIssues}</div>
                <div className="text-[22px] font-semibold tracking-tight">{openIssues}</div>
                {issueTrendData.dir !== 'flat' && (
                  /* For issues: up (more issues) is bad = danger; down (fewer) is good = success */
                  <div className={['flex items-center gap-0.5 mt-1 text-[12px]', issueTrendData.dir === 'up' ? 'text-danger' : 'text-success'].join(' ')}>
                    {issueTrendData.dir === 'up'
                      ? <TrendingUp className="size-3" />
                      : <TrendingDown className="size-3" />}
                    <span>{issueTrendData.delta > 0 ? '+' : ''}{issueTrendData.delta}</span>
                  </div>
                )}
                {issueTrendData.dir === 'flat' && (
                  <div className="flex items-center gap-0.5 mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                    <Minus className="size-3" /><span>{dict.dashboard.noChange}</span>
                  </div>
                )}
              </div>

              {/* Pipeline Success Rate */}
              <div className="rounded-[8px] border border-border bg-[hsl(var(--ds-background-2))] px-4 py-4">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1.5">{dict.dashboard.pipelineSuccessRate}</div>
                <div className={['text-[22px] font-semibold tracking-tight', pipelineSuccessRate !== null ? (pipelineSuccessRate >= 80 ? 'text-success' : pipelineSuccessRate >= 60 ? 'text-warning' : 'text-danger') : ''].filter(Boolean).join(' ')}>
                  {pipelineSuccessRate !== null ? `${pipelineSuccessRate}%` : '—'}
                </div>
                {pipelineTotal > 0 && (
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">
                    {pipelineSuccess}/{pipelineTotal} runs
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div>
              <div className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wider mb-2">
                {dict.dashboard.quickActions}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Link
                  href={createPipelineHref}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-border px-3 text-[14px] font-medium text-foreground hover:bg-[hsl(var(--ds-surface-1))] transition-colors"
                >
                  <Zap className="size-3.5" />
                  {dict.dashboard.triggerAnalysis}
                </Link>
                <Link
                  href={`/o/${orgId}/projects`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-border px-3 text-[14px] font-medium text-foreground hover:bg-[hsl(var(--ds-surface-1))] transition-colors"
                >
                  <Plus className="size-3.5" />
                  {dict.dashboard.createPipeline}
                </Link>
              </div>
            </div>

            {/* Two-column activity */}
            <div className="grid gap-4 lg:grid-cols-2">

              {/* Recent reports */}
              <div className="rounded-[8px] border border-border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="text-[13px] font-medium text-foreground">{dict.dashboard.recentReports}</span>
                  <Link
                    href={`/o/${orgId}/projects`}
                    className="text-[12px] text-[hsl(var(--ds-text-2))] hover:text-foreground transition-colors duration-100"
                  >
                    {dict.dashboard.viewAll}
                  </Link>
                </div>
                {recentReports.length === 0 ? (
                  <div className="px-4 py-6 text-[13px] text-[hsl(var(--ds-text-2))]">
                    {dict.reports.noReportsDescription}
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {recentReports.map(r => (
                      <Link
                        key={r.id}
                        href={`/o/${orgId}/projects/${r.project_id}/reports/${r.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[hsl(var(--ds-surface-1))] transition-colors duration-100"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-foreground truncate">{r.project_name}</div>
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{formatDateTime(r.created_at)}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="muted" size="sm">
                            {dict.reports.status[r.status]}
                          </Badge>
                          {r.status === 'done' && r.score != null && (
                            <span className={['text-[13px] font-semibold tabular-nums', scoreColor(r.score)].join(' ')}>
                              {r.score}
                            </span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent pipeline runs */}
              <div className="rounded-[8px] border border-border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="text-[13px] font-medium text-foreground">{dict.dashboard.recentRuns}</span>
                  <Link
                    href={`/o/${orgId}/projects`}
                    className="text-[12px] text-[hsl(var(--ds-text-2))] hover:text-foreground transition-colors duration-100"
                  >
                    {dict.dashboard.viewAll}
                  </Link>
                </div>
                {recentRuns.length === 0 ? (
                  <div className="px-4 py-6 text-[13px] text-[hsl(var(--ds-text-2))]">
                    {dict.pipelines.detail.noRuns}
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {recentRuns.map(run => (
                      <Link
                        key={run.id}
                        href={`/o/${orgId}/projects/${run.project_id}/pipelines/${run.pipeline_id}?tab=runs&runId=${run.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[hsl(var(--ds-surface-1))] transition-colors duration-100"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-foreground truncate">{run.pipeline_name}</div>
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] truncate">
                            {(run.project_name ?? dict.reports.unknownProject) + ' · ' + formatDateTime(run.created_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant={runStatusVariant(run.status)} size="sm">
                            {dict.pipelines.status[run.status] ?? run.status}
                          </Badge>
                          {run.branch && (
                            <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{run.branch}</span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Per-project quality scores */}
            {projectScores.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[13px] font-medium text-foreground">{dict.dashboard.projectScores}</div>
                    <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.dashboard.projectScoresDescription}</div>
                  </div>
                </div>
                <div className="rounded-[8px] border border-border overflow-hidden">
                  {projectScores.map(p => (
                    <Link
                      key={p.project_id}
                      href={`/o/${orgId}/projects/${p.project_id}/reports`}
                      className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-border last:border-0 hover:bg-[hsl(var(--ds-surface-1))] transition-colors duration-100"
                    >
                      <div className="text-[13px] font-medium text-foreground truncate">{p.project_name}</div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={['h-full rounded-full', p.score >= 85 ? 'bg-success' : p.score >= 70 ? 'bg-warning' : 'bg-danger'].join(' ')}
                            style={{ width: `${p.score}%` }}
                          />
                        </div>
                        <span className={['text-[13px] font-semibold tabular-nums w-8 text-right', scoreColor(p.score)].join(' ')}>
                          {p.score}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
