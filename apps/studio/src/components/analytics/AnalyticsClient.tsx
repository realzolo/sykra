'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle } from 'lucide-react';
import { withOrgPrefix, extractOrgFromPath } from '@/lib/orgPath';
import type { Dictionary } from '@/i18n';

type ProjectScore = {
  project_id: string;
  project_name: string;
  report_count: string;
  avg_score: number | null;
  open_issues: string;
};

type CategoryCount = {
  category: string;
  count: string;
};

type PipelineStat = {
  pipeline_id: string;
  pipeline_name: string;
  total: string;
  succeeded: string;
  failed: string;
  avg_duration_s: number | null;
};

type IssueResolution = {
  project_id: string;
  project_name: string;
  total: string;
  resolved: string;
};

type AnalyticsData = {
  days: number;
  projectScores: ProjectScore[];
  issueCategoryBreakdown: CategoryCount[];
  pipelineStats: PipelineStat[];
  issueResolution: IssueResolution[];
};

const DAY_OPTIONS = [7, 30, 90] as const;

function scoreColor(score: number) {
  if (score >= 85) return 'text-success';
  if (score >= 70) return 'text-warning';
  return 'text-danger';
}

function scoreBg(score: number) {
  if (score >= 85) return 'bg-success';
  if (score >= 70) return 'bg-warning';
  return 'bg-danger';
}

function durationLabel(seconds: number | null) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

function pct(a: string, b: string) {
  const total = Number(b);
  if (!total) return 0;
  return Math.round((Number(a) / total) * 100);
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 rounded-full bg-[hsl(var(--ds-surface-2))] overflow-hidden">
        <div className={['h-full rounded-full', scoreBg(score)].join(' ')} style={{ width: `${score}%` }} />
      </div>
      <span className={['text-[13px] font-semibold tabular-nums w-8 text-right', scoreColor(score)].join(' ')}>
        {score}
      </span>
    </div>
  );
}

export default function AnalyticsClient({ dict }: { dict: Dictionary }) {
  const pathname = usePathname();
  const { orgId } = extractOrgFromPath(pathname);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics/overview?days=${d}`);
      if (!res.ok) throw new Error('Failed to load analytics');
      setData(await res.json());
    } catch {
      // keep previous data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(days); }, [days, load]);

  const categoryLabels: Record<string, string> = (dict.reports as any)?.categories ?? {};

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-background shrink-0 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-[hsl(var(--ds-text-2))]" />
          <h1 className="text-[15px] font-semibold">Analytics</h1>
        </div>
        {/* Date range filter */}
        <div className="flex items-center gap-1 rounded-[6px] border border-border p-0.5">
          {DAY_OPTIONS.map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={[
                'px-3 py-1 rounded-[5px] text-[12px] font-medium transition-colors duration-100',
                days === d
                  ? 'bg-foreground text-background'
                  : 'text-[hsl(var(--ds-text-2))] hover:text-foreground',
              ].join(' ')}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-8">

          {loading && !data && (
            <div className="text-[13px] text-[hsl(var(--ds-text-2))] py-10 text-center">Loading…</div>
          )}

          {data && (
            <>
              {/* ── Project Quality Scores ─────────────────────── */}
              <section>
                <h2 className="text-[13px] font-semibold text-foreground mb-3">Project Quality Scores</h2>
                {data.projectScores.length === 0 ? (
                  <p className="text-[13px] text-[hsl(var(--ds-text-2))]">No report data in this period.</p>
                ) : (
                  <div className="rounded-[8px] border border-border overflow-hidden">
                    <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-[hsl(var(--ds-background-2))] text-[11px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wide">
                      <div className="flex-1">Project</div>
                      <div className="w-28 text-right">Avg Score</div>
                      <div className="w-20 text-right">Reports</div>
                      <div className="w-24 text-right">Open Issues</div>
                    </div>
                    {data.projectScores.map(p => (
                      <Link
                        key={p.project_id}
                        href={withOrgPrefix(pathname, `/projects/${p.project_id}/reports`)}
                        className="flex items-center gap-4 px-4 py-3 border-b border-border hover:bg-[hsl(var(--ds-surface-1))] transition-colors duration-100 last:border-0"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-foreground truncate">{p.project_name}</div>
                        </div>
                        <div className="w-28 flex justify-end">
                          {p.avg_score != null
                            ? <ScoreBar score={Math.round(p.avg_score)} />
                            : <span className="text-[13px] text-[hsl(var(--ds-text-2))]">—</span>}
                        </div>
                        <div className="w-20 text-right text-[13px] text-[hsl(var(--ds-text-2))]">
                          {p.report_count}
                        </div>
                        <div className="w-24 text-right text-[13px] font-medium">
                          {Number(p.open_issues) > 0
                            ? <span className="text-danger">{p.open_issues}</span>
                            : <span className="text-[hsl(var(--ds-text-2))]">0</span>}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Two-column: Categories + Resolution ────────── */}
              <div className="grid lg:grid-cols-2 gap-6">

                {/* Top Issue Categories */}
                <section>
                  <h2 className="text-[13px] font-semibold text-foreground mb-3">Top Issue Categories</h2>
                  {data.issueCategoryBreakdown.length === 0 ? (
                    <p className="text-[13px] text-[hsl(var(--ds-text-2))]">No issues in this period.</p>
                  ) : (
                    <div className="rounded-[8px] border border-border overflow-hidden">
                      {data.issueCategoryBreakdown.map((cat, i) => {
                        const maxCount = Number(data.issueCategoryBreakdown[0].count);
                        const widthPct = maxCount > 0 ? Math.round((Number(cat.count) / maxCount) * 100) : 0;
                        const label = categoryLabels[cat.category] ?? cat.category;
                        return (
                          <div key={cat.category} className={['px-4 py-2.5 flex items-center gap-3', i < data.issueCategoryBreakdown.length - 1 ? 'border-b border-border' : ''].join(' ')}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[12px] font-medium text-foreground capitalize">{label}</span>
                                <span className="text-[12px] text-[hsl(var(--ds-text-2))] tabular-nums">{cat.count}</span>
                              </div>
                              <div className="h-1 rounded-full bg-[hsl(var(--ds-surface-2))] overflow-hidden">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${widthPct}%` }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Issue Resolution Rate */}
                <section>
                  <h2 className="text-[13px] font-semibold text-foreground mb-3">Issue Resolution Rate</h2>
                  {data.issueResolution.length === 0 ? (
                    <p className="text-[13px] text-[hsl(var(--ds-text-2))]">No data in this period.</p>
                  ) : (
                    <div className="rounded-[8px] border border-border overflow-hidden">
                      {data.issueResolution.map((ir, i) => {
                        const rate = pct(ir.resolved, ir.total);
                        return (
                          <div key={ir.project_id} className={['px-4 py-2.5', i < data.issueResolution.length - 1 ? 'border-b border-border' : ''].join(' ')}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[12px] font-medium text-foreground truncate max-w-[60%]">{ir.project_name}</span>
                              <span className="text-[12px] text-[hsl(var(--ds-text-2))] tabular-nums">{ir.resolved}/{ir.total}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1 rounded-full bg-[hsl(var(--ds-surface-2))] overflow-hidden">
                                <div className={['h-full rounded-full', rate >= 70 ? 'bg-success' : rate >= 40 ? 'bg-warning' : 'bg-danger'].join(' ')} style={{ width: `${rate}%` }} />
                              </div>
                              <span className={['text-[11px] font-semibold tabular-nums w-8 text-right', rate >= 70 ? 'text-success' : rate >= 40 ? 'text-warning' : 'text-danger'].join(' ')}>
                                {rate}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

              </div>

              {/* ── Pipeline Stats ─────────────────────────────── */}
              <section>
                <h2 className="text-[13px] font-semibold text-foreground mb-3">Pipeline Performance</h2>
                {data.pipelineStats.length === 0 ? (
                  <p className="text-[13px] text-[hsl(var(--ds-text-2))]">No pipeline runs in this period.</p>
                ) : (
                  <div className="rounded-[8px] border border-border overflow-hidden">
                    <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-[hsl(var(--ds-background-2))] text-[11px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wide">
                      <div className="flex-1">Pipeline</div>
                      <div className="w-20 text-right">Runs</div>
                      <div className="w-28 text-right">Success Rate</div>
                      <div className="w-20 text-right">Avg Duration</div>
                    </div>
                    {data.pipelineStats.map(ps => {
                      const successRate = pct(ps.succeeded, ps.total);
                      return (
                        <div key={ps.pipeline_id} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0">
                          <div className="flex-1 min-w-0">
                            <span className="text-[13px] font-medium text-foreground truncate block">{ps.pipeline_name}</span>
                            <div className="flex items-center gap-2 mt-0.5">
                              {Number(ps.succeeded) > 0 && (
                                <span className="flex items-center gap-0.5 text-[11px] text-success">
                                  <CheckCircle2 className="size-3" />{ps.succeeded}
                                </span>
                              )}
                              {Number(ps.failed) > 0 && (
                                <span className="flex items-center gap-0.5 text-[11px] text-danger">
                                  <XCircle className="size-3" />{ps.failed}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="w-20 text-right text-[13px] text-[hsl(var(--ds-text-2))]">{ps.total}</div>
                          <div className="w-28 flex justify-end items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-[hsl(var(--ds-surface-2))] overflow-hidden">
                              <div className={['h-full rounded-full', successRate >= 80 ? 'bg-success' : successRate >= 50 ? 'bg-warning' : 'bg-danger'].join(' ')} style={{ width: `${successRate}%` }} />
                            </div>
                            <span className="text-[12px] tabular-nums w-8 text-right text-[hsl(var(--ds-text-2))]">{successRate}%</span>
                          </div>
                          <div className="w-20 text-right text-[13px] text-[hsl(var(--ds-text-2))] tabular-nums">
                            {durationLabel(ps.avg_duration_s)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

            </>
          )}

        </div>
      </div>
    </div>
  );
}
