'use client';

import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

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

export default function DashboardStats({ projectId }: { projectId?: string }) {
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-16 bg-muted rounded animate-pulse" />
            <div className="h-6 w-10 bg-muted rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const TrendIcon = stats.recentTrend === 'up' ? TrendingUp : stats.recentTrend === 'down' ? TrendingDown : BarChart3;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
      <div>
        <div className="text-xs text-muted-foreground mb-1">总报告数</div>
        <div className="text-2xl font-semibold">{stats.totalReports}</div>
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-1">平均评分</div>
        <div className="flex items-baseline gap-1.5">
          <span className={['text-2xl font-semibold', scoreColor(stats.averageScore)].join(' ')}>{stats.averageScore}</span>
          <span className="text-xs text-muted-foreground">/ 100</span>
          {stats.trendValue !== 0 && (
            <span className={['text-xs font-medium flex items-center gap-0.5', stats.recentTrend === 'up' ? 'text-success' : 'text-danger'].join(' ')}>
              <TrendIcon className="size-3" />{Math.abs(stats.trendValue)}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-1">问题总数</div>
        <div className="text-2xl font-semibold">{stats.totalIssues}</div>
        {stats.criticalIssues > 0 && (
          <div className="text-xs text-danger mt-0.5 flex items-center gap-1">
            <AlertTriangle className="size-3" />{stats.criticalIssues} 严重
          </div>
        )}
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-1">待处理</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold">{stats.pendingReports}</span>
          {stats.pendingReports === 0 && (
            <span className="text-xs text-success flex items-center gap-0.5">
              <CheckCircle className="size-3" />全部完成
            </span>
          )}
          {stats.pendingReports > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-0.5">
              <Clock className="size-3" />进行中
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
