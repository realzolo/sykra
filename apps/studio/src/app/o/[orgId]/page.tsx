import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { query, queryOne } from '@/lib/db';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';
import { requireUser } from '@/services/auth';
import { requireOrgAccess } from '@/services/orgs';

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
    activeRunsRow,
    avgScoreRow,
    recentReports,
    recentRuns,
    trendRows,
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
       where r.org_id = $1 and r.status = 'done' and i.status = 'open'`,
      [orgId]
    ),
    queryOne<{ count: string }>(
      `select count(*)::text as count
       from pipeline_runs
       where org_id = $1 and status in ('queued','running')`,
      [orgId]
    ),
    queryOne<{ avg: number | null }>(
      `select avg(score)::float as avg
       from analysis_reports
       where org_id = $1 and status = 'done' and score is not null`,
      [orgId]
    ),
    query<{
      id: string;
      status: 'pending' | 'analyzing' | 'done' | 'failed';
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
       limit 10`,
      [orgId]
    ),
    query<{
      id: string;
      status: 'queued' | 'running' | 'success' | 'failed' | 'canceled' | 'timed_out' | 'skipped';
      created_at: string;
      pipeline_id: string;
      pipeline_name: string;
      project_id: string | null;
      project_name: string | null;
      branch: string | null;
      commit_sha: string | null;
    }>(
      `select r.id, r.status, r.created_at,
              r.pipeline_id, p.name as pipeline_name,
              r.project_id, cp.name as project_name,
              r.branch, r.commit_sha
       from pipeline_runs r
       join pipelines p on p.id = r.pipeline_id
       left join code_projects cp on cp.id = r.project_id
       where r.org_id = $1
       order by r.created_at desc
       limit 5`,
      [orgId]
    ),
    query<{ day: string; avg_score: number }>(
      `select date_trunc('day', created_at)::date::text as day,
              avg(score)::float as avg_score
       from analysis_reports
       where org_id = $1
         and status = 'done'
         and score is not null
         and created_at >= (now() - interval '14 days')
       group by 1
       order by 1 asc`,
      [orgId]
    ),
  ]);

  const totalProjects = Number(projectCountRow?.count ?? 0);
  const openIssues = Number(openIssuesRow?.count ?? 0);
  const activeRuns = Number(activeRunsRow?.count ?? 0);
  const averageScore = Math.round(avgScoreRow?.avg ?? 0);
  const trendValues = trendRows.map(r => Math.round(r.avg_score));

  const dateFmt = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
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

  function runStatusBadgeVariant(status: string): 'success' | 'danger' | 'warning' | 'muted' {
    if (status === 'success') return 'success';
    if (status === 'failed' || status === 'timed_out') return 'danger';
    if (status === 'running') return 'warning';
    return 'muted';
  }

  function sparklinePath(values: number[], width: number, height: number) {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const dx = width / (values.length - 1);
    return values
      .map((v, idx) => {
        const x = idx * dx;
        const t = (v - min) / range;
        const y = height - t * height;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }

  const sparkPath = sparklinePath(trendValues, 220, 42);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-heading-24">{dict.dashboard.overview}</div>
            <div className="text-copy-14 text-muted-foreground">{dict.dashboard.last14Days}</div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/o/${orgId}/projects`} className="text-xs text-muted-foreground hover:text-foreground transition-soft">
              {dict.nav.projects}
            </Link>
            <span className="text-muted-foreground/60">/</span>
            <Link href={`/o/${orgId}/pipelines`} className="text-xs text-muted-foreground hover:text-foreground transition-soft">
              {dict.nav.pipelines}
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-4 shadow-elevation-1 space-y-3">
              <div className="text-sm font-medium">{dict.dashboard.overview}</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">{dict.dashboard.totalProjects}</div>
                  <div className="text-base font-semibold">{totalProjects}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">{dict.dashboard.averageScore}</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={['text-base font-semibold', scoreColor(averageScore)].join(' ')}>{averageScore}</span>
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">{dict.dashboard.openIssues}</div>
                  <div className="text-base font-semibold">{openIssues}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">{dict.dashboard.activeRuns}</div>
                  <div className="text-base font-semibold">{activeRuns}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-elevation-1">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{dict.dashboard.averageScore}</div>
                <Badge variant="muted" size="sm">{dict.dashboard.last14Days}</Badge>
              </div>
              <div className="mt-3">
                {trendValues.length >= 2 ? (
                  <svg viewBox="0 0 220 42" className="w-full h-[54px]" preserveAspectRatio="none" aria-label={dict.dashboard.averageScore}>
                    <path d={sparkPath} fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground/70" />
                  </svg>
                ) : (
                  <div className="text-xs text-muted-foreground">{dict.reports.noReports}</div>
                )}
              </div>
            </div>
          </aside>

          <section className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-4 shadow-elevation-1">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{dict.dashboard.recentReports}</div>
                <Link href={`/o/${orgId}/reports`} className="text-xs text-muted-foreground hover:text-foreground transition-soft">
                  {dict.dashboard.viewAll}
                </Link>
              </div>

              <div className="mt-3 divide-y divide-border">
                {recentReports.length === 0 && (
                  <div className="py-6 text-sm text-muted-foreground">{dict.reports.noReportsDescription}</div>
                )}
                {recentReports.map((r) => (
                  <Link
                    key={r.id}
                    href={`/o/${orgId}/reports/${r.id}`}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-muted/30 rounded-md px-2 -mx-2 transition-soft"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.project_name}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="muted" size="sm">
                        {dict.reports.status[r.status]}
                      </Badge>
                      {r.status === 'done' && r.score != null && (
                        <span className={['text-sm font-semibold tabular-nums', scoreColor(r.score)].join(' ')}>
                          {r.score}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-elevation-1">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{dict.dashboard.recentRuns}</div>
                <Link href={`/o/${orgId}/pipelines`} className="text-xs text-muted-foreground hover:text-foreground transition-soft">
                  {dict.dashboard.viewAll}
                </Link>
              </div>

              <div className="mt-3 divide-y divide-border">
                {recentRuns.length === 0 && (
                  <div className="py-6 text-sm text-muted-foreground">{dict.pipelines.detail.noRuns}</div>
                )}
                {recentRuns.map((run) => (
                  <Link
                    key={run.id}
                    href={`/o/${orgId}/pipelines/${run.pipeline_id}?tab=runs&runId=${run.id}`}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-muted/30 rounded-md px-2 -mx-2 transition-soft"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{run.pipeline_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {(run.project_name ?? dict.reports.unknownProject) + ' · ' + formatDateTime(run.created_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={runStatusBadgeVariant(run.status)} size="sm">
                        {dict.pipelines.status[run.status] ?? run.status}
                      </Badge>
                      {run.branch && (
                        <span className="text-xs text-muted-foreground">{run.branch}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
