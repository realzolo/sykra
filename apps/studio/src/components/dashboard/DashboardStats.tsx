'use client';

import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import type { Dictionary } from '@/i18n';
import { Skeleton } from '@/components/ui/skeleton';

type DashboardStats = {
  totalReports: number;
  averageScore: number;
  totalIssues: number;
  criticalIssues: number;
  recentTrend: 'up' | 'down' | 'stable';
  trendValue: number;
  pendingReports: number;
};

function scoreColor(s: number) {
  if (s >= 85) return 'text-success';
  if (s >= 70) return 'text-warning';
  return 'text-danger';
}

export default function DashboardStats({ projectId, dict }: { projectId?: string; dict: Dictionary }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = projectId ? `/api/projects/${projectId}/stats` : '/api/stats';
    fetch(url)
      .then(r => r.json())
      .then(data => { setStats(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const TrendIcon = stats.recentTrend === 'up' ? TrendingUp : stats.recentTrend === 'down' ? TrendingDown : BarChart3;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.dashboard.totalReports}</div>
        <div className="text-base font-semibold">{stats.totalReports}</div>
      </div>

      <div>
        <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.dashboard.averageScore}</div>
        <div className="flex items-baseline gap-1.5">
          <span className={['text-base font-semibold', scoreColor(stats.averageScore)].join(' ')}>{stats.averageScore}</span>
          <span className="text-[12px] text-[hsl(var(--ds-text-2))]">/ 100</span>
          {stats.trendValue !== 0 && (
            <span className={['text-[12px] font-medium flex items-center gap-0.5', stats.recentTrend === 'up' ? 'text-success' : 'text-danger'].join(' ')}>
              <TrendIcon className="size-3" />{Math.abs(stats.trendValue)}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.dashboard.totalIssues}</div>
        <div className="text-base font-semibold">{stats.totalIssues}</div>
        {stats.criticalIssues > 0 && (
          <div className="text-[12px] text-danger mt-0.5 flex items-center gap-1">
            <AlertTriangle className="size-3" />{stats.criticalIssues} {dict.dashboard.critical}
          </div>
        )}
      </div>

      <div>
        <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.dashboard.pending}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-semibold">{stats.pendingReports}</span>
          {stats.pendingReports === 0 && (
            <span className="text-[12px] text-success flex items-center gap-0.5">
              <CheckCircle className="size-3" />{dict.dashboard.allCompleted}
            </span>
          )}
          {stats.pendingReports > 0 && (
            <span className="text-[12px] text-[hsl(var(--ds-text-2))] flex items-center gap-0.5">
              <Clock className="size-3" />{dict.dashboard.inProgress}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
