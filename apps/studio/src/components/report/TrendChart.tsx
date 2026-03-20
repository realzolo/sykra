'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Dictionary } from '@/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import { formatLocalDate } from '@/lib/dateFormat';

type Snapshot = {
  snapshot_date: string;
  score: number;
  category_scores: Record<string, number>;
  total_issues: number;
  critical_issues: number;
  high_issues: number;
  medium_issues: number;
  low_issues: number;
};

export default function TrendChart({ projectId, dict }: { projectId: string; dict: Dictionary }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/trends?days=${days}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSnapshots(data);
        } else if (Array.isArray(data?.data)) {
          setSnapshots(data.data);
        } else {
          setSnapshots([]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId, days]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-8 w-px" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="grid grid-cols-10 gap-2 h-32 items-end">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={`trend-skeleton-${index}`} className={`w-full ${index % 3 === 0 ? 'h-12' : index % 3 === 1 ? 'h-20' : 'h-28'}`} />
          ))}
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={`trend-pill-${index}`} className="h-8 w-16 rounded-[4px]" />
          ))}
        </div>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.trendNoData}</div>;
  }

  const latest = snapshots[snapshots.length - 1]!;
  const previous = snapshots[snapshots.length - 2];
  const scoreDiff = previous ? latest.score - previous.score : 0;
  const issuesDiff = previous ? latest.total_issues - previous.total_issues : 0;

  const maxScore = Math.max(...snapshots.map(s => s.score));
  const minScore = Math.min(...snapshots.map(s => s.score));
  const scoreRange = maxScore - minScore || 1;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-6">
        <div>
          <div className="text-2xl font-bold">{latest.score}</div>
          <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.currentScore}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {scoreDiff > 0 ? (
            <><TrendingUp className="size-4 text-success" /><span className="text-sm font-semibold text-success">+{scoreDiff}</span></>
          ) : scoreDiff < 0 ? (
            <><TrendingDown className="size-4 text-danger" /><span className="text-sm font-semibold text-danger">{scoreDiff}</span></>
          ) : (
            <><Minus className="size-4 text-[hsl(var(--ds-text-2))]" /><span className="text-[13px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.noChange}</span></>
          )}
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <div className="text-2xl font-bold">{latest.total_issues}</div>
          <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.totalIssues}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {issuesDiff < 0 ? (
            <><TrendingUp className="size-4 text-success" /><span className="text-sm font-semibold text-success">{issuesDiff}</span></>
          ) : issuesDiff > 0 ? (
            <><TrendingDown className="size-4 text-danger" /><span className="text-sm font-semibold text-danger">+{issuesDiff}</span></>
          ) : (
            <><Minus className="size-4 text-[hsl(var(--ds-text-2))]" /><span className="text-[13px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.noChange}</span></>
          )}
        </div>
      </div>

      {/* Simple line chart */}
      <div className="relative h-32 flex items-end gap-1">
        {snapshots.map((snap, idx) => {
          const height = ((snap.score - minScore) / scoreRange) * 100;
          return (
            <div key={snap.snapshot_date} className="flex-1 flex flex-col items-center gap-1 group">
              <div className="relative w-full">
                <div
                  className="w-full bg-primary/20 group-hover:bg-primary/40 transition-colors rounded-t"
                  style={{ height: `${height}%`, minHeight: '4px' }}
                />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold opacity-0 transition-opacity group-hover:opacity-100">
                  {snap.score}
                </div>
              </div>
              {idx % Math.ceil(snapshots.length / 7) === 0 && (
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                  {formatLocalDate(snap.snapshot_date)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Period selector */}
      <div className="flex gap-2">
        {[7, 14, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded-[6px] px-3 py-1.5 text-[13px] transition-colors ${
              days === d ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {dict.reportDetail.periodDays.replace('{{days}}', String(d))}
          </button>
        ))}
      </div>
    </div>
  );
}
