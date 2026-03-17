'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { withOrgPrefix } from '@/lib/orgPath';


type Report = {
  id: string;
  status: string;
  score?: number;
  category_scores?: Record<string, number>;
  commits: unknown[];
  created_at: string;
  projects?: { name: string; repo: string } | { name: string; repo: string }[];
};

export default function ProjectReportsView({
  projectId,
  dict,
}: {
  projectId: string;
  dict: Dictionary;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const STATUS_CHIP: Record<string, { variant: 'muted' | 'accent' | 'success' | 'danger' | 'warning'; label: string }> = {
    pending:   { variant: 'muted',    label: dict.reports.status.pending },
    analyzing: { variant: 'accent',   label: dict.reports.status.analyzing },
    done:      { variant: 'success',  label: dict.reports.status.done },
    failed:    { variant: 'danger',   label: dict.reports.status.failed },
  };

  function scoreColor(s: number) {
    if (s >= 85) return 'text-success';
    if (s >= 70) return 'text-warning';
    return 'text-danger';
  }

  const STATUS_ITEMS = [
    { id: 'all', label: dict.reports.allStatus },
    { id: 'done', label: dict.reports.status.done },
    { id: 'analyzing', label: dict.reports.status.analyzing },
    { id: 'pending', label: dict.reports.status.pending },
    { id: 'failed', label: dict.reports.status.failed },
  ];

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/reports?projectId=${projectId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (alive) { setReports(Array.isArray(data) ? data : []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  const filtered = useMemo(
    () => statusFilter === 'all' ? reports : reports.filter(r => r.status === statusFilter),
    [reports, statusFilter],
  );

  async function handleDelete(reportId: string) {
    setDeleting(reportId);
    try {
      const res = await fetch(`/api/reports/${reportId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setReports(prev => prev.filter(r => r.id !== reportId));
      toast.success(dict.reports.reportDeleted);
    } catch {
      toast.error(dict.reports.deleteFailed);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[hsl(var(--ds-border-1))] bg-background shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[16px] font-semibold text-foreground">{dict.reports.title}</div>
            <div className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">
              {dict.reports.description ?? 'AI code review reports'}
            </div>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ITEMS.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-6 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] text-[11px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wider gap-4 shrink-0">
        <div className="flex-1">{dict.reports.commit}</div>
        <div className="w-20 text-center">{dict.reports.score}</div>
        <div className="w-24 text-center">{dict.common.status}</div>
        <div className="w-36">{dict.common.createdAt}</div>
        <div className="w-8" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col gap-px">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center px-6 py-3 gap-4 border-b border-[hsl(var(--ds-border-1))]">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-24 rounded-[4px]" />
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-6 py-20">
            <div className="p-3 rounded-[8px] bg-muted">
              <FileText className="size-5 text-[hsl(var(--ds-text-2))]" />
            </div>
            <div className="text-sm font-medium text-foreground">{dict.reports.noReports}</div>
            <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{dict.reports.noReportsDescription}</div>
          </div>
        ) : (
          filtered.map(report => {
            const chip = STATUS_CHIP[report.status] ?? { variant: 'muted' as const, label: report.status };
            const firstCommit = Array.isArray(report.commits) && report.commits.length > 0
              ? (report.commits[0] as { sha?: string; message?: string })
              : null;
            return (
              <div
                key={report.id}
                className="flex items-center px-6 py-3 gap-4 border-b border-[hsl(var(--ds-border-1))] hover:bg-[hsl(var(--ds-surface-1))] cursor-pointer group transition-colors duration-100"
                onClick={() => router.push(withOrgPrefix(pathname, `/projects/${projectId}/reports/${report.id}`))}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-foreground truncate">
                    {firstCommit?.message ?? report.id.slice(0, 8)}
                  </div>
                  {firstCommit?.sha && (
                    <div className="text-[12px] text-[hsl(var(--ds-text-2))] font-mono">
                      {firstCommit.sha.slice(0, 7)}
                    </div>
                  )}
                </div>
                <div className="w-20 text-center">
                  {report.score != null ? (
                    <span className={`text-sm font-semibold tabular-nums ${scoreColor(report.score)}`}>
                      {report.score}
                    </span>
                  ) : (
                    <span className="text-[13px] text-[hsl(var(--ds-text-2))]">—</span>
                  )}
                </div>
                <div className="w-24 flex justify-center">
                  <Badge variant={chip.variant} size="sm">{chip.label}</Badge>
                </div>
                <div className="w-36 text-[12px] text-[hsl(var(--ds-text-2))]">
                  {new Date(report.created_at).toLocaleString()}
                </div>
                <div className="w-8 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={e => { e.stopPropagation(); handleDelete(report.id); }}
                    disabled={deleting === report.id}
                    aria-label={dict.common.delete}
                  >
                    <Trash2 className="size-3.5 text-[hsl(var(--ds-text-2))]" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
