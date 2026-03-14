'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';

type Report = {
  id: string; status: string; score?: number;
  category_scores?: Record<string, number>;
  commits: unknown[]; created_at: string;
  projects?: { name: string; repo: string } | { name: string; repo: string }[];
};

export default function ReportsClient({ initialReports, dict }: { initialReports: Report[]; dict: Dictionary }) {
  const STATUS_CHIP: Record<string, { variant: 'muted' | 'accent' | 'success' | 'danger' | 'warning'; label: string }> = {
    pending:   { variant: 'muted', label: dict.reports.status.pending },
    analyzing: { variant: 'accent',  label: dict.reports.status.analyzing },
    done:      { variant: 'success', label: dict.reports.status.done },
    failed:    { variant: 'danger',  label: dict.reports.status.failed },
  };

  const CAT_LABEL: Record<string, string> = {
    style: dict.reports.categories.style,
    security: dict.reports.categories.security,
    architecture: dict.reports.categories.architecture,
    performance: dict.reports.categories.performance,
    maintainability: dict.reports.categories.maintainability,
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

  const router = useRouter();
  const [reports, setReports] = useState<Report[]>(initialReports);
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const projectNames = useMemo(() => {
    return [...new Set(reports.map(r => {
      const projects = r.projects;
      if (Array.isArray(projects)) return projects[0]?.name;
      return projects?.name;
    }).filter(Boolean))] as string[];
  }, [reports]);

  const filtered = useMemo(() => {
    return reports.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (projectFilter !== 'all') {
        const projects = r.projects;
        const projectName = Array.isArray(projects) ? projects[0]?.name : projects?.name;
        if (projectName !== projectFilter) return false;
      }
      return true;
    });
  }, [reports, statusFilter, projectFilter]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDeletingId(id);
    const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    if (!res.ok) { toast.error(dict.reports.deleteFailed); return; }
    toast.success(dict.reports.reportDeleted);
    setReports(prev => prev.filter(r => r.id !== id));
  }

  const projectItems = useMemo(() => [
    { id: 'all', label: dict.reports.allProjects },
    ...projectNames.map(name => ({ id: name, label: name })),
  ], [projectNames, dict]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold">{dict.reports.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{dict.reports.description}</p>
          </div>
          <span className="text-xs text-muted-foreground">{filtered.length} {dict.reports.issues}</span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)} >
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ITEMS.map(item => (
                <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {projectNames.length > 1 && (
            <Select value={projectFilter} onValueChange={(value) => setProjectFilter(value)} >
              <SelectTrigger className="w-[180px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projectItems.map(item => (
                  <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(statusFilter !== 'all' || projectFilter !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter('all'); setProjectFilter('all'); }}>
              {dict.reports.clearFilters}
            </Button>
          )}
        </div>

        {reports.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-medium">{dict.reports.noReports}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{dict.reports.noReportsDescription}</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20">
            <p className="text-sm text-muted-foreground">{dict.reports.noMatchingReports}</p>
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden bg-card">
            <div className="grid grid-cols-[64px_1fr_160px_auto] items-center px-4 py-2 border-b border-border bg-muted/40 text-[11px] font-medium text-muted-foreground gap-4">
              <div>{dict.reports.score}</div>
              <div>{dict.reports.projectAndTime}</div>
              <div>{dict.reports.categoryScores}</div>
              <div className="w-8" />
            </div>
            {filtered.map(report => {
              const st = STATUS_CHIP[report.status] ?? STATUS_CHIP.pending;
              const projectName = (() => {
                const p = report.projects;
                return Array.isArray(p) ? p[0]?.name : p?.name;
              })();
              return (
                <div
                  key={report.id}
                  className="grid grid-cols-[64px_1fr_160px_auto] items-center px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer gap-4"
                  onClick={() => router.push(`/reports/${report.id}`)}
                >
                  <div className="flex flex-col items-start">
                    <span className={['text-lg font-semibold leading-none', report.score != null ? scoreColor(report.score) : 'text-muted-foreground'].join(' ')}>
                      {report.score ?? '—'}
                    </span>
                    {report.score != null && <span className="text-[10px] text-muted-foreground mt-0.5">/ 100</span>}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{projectName ?? dict.reports.unknownProject}</span>
                      <Badge size="sm" variant={st.variant}>{st.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(report.commits as unknown[])?.length ?? 0} {dict.reports.commit} · {new Date(report.created_at).toLocaleString()}
                    </p>
                  </div>

                  {report.category_scores ? (
                    <div className="flex gap-3">
                      {Object.entries(report.category_scores).slice(0, 3).map(([k, v]) => (
                        <div key={k}>
                          <div className={['text-xs font-semibold', scoreColor(v)].join(' ')}>{v}</div>
                          <div className="text-[10px] text-muted-foreground">{CAT_LABEL[k] ?? k}</div>
                        </div>
                      ))}
                    </div>
                  ) : <div />}

                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={deletingId === report.id}
                    onClick={(e) => handleDelete(report.id, e as unknown as React.MouseEvent)}
                  >
                    {deletingId === report.id ? <Spinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
