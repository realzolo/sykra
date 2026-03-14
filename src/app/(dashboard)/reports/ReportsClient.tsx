'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ChevronRight, Trash2 } from 'lucide-react';
import { Button, Select, ListBox, Chip, Spinner } from '@heroui/react';
import { toast } from 'sonner';

type Report = {
  id: string; status: string; score?: number;
  category_scores?: Record<string, number>;
  commits: unknown[]; created_at: string;
  projects?: { name: string; repo: string } | { name: string; repo: string }[];
};

const STATUS_CHIP: Record<string, { color: 'default' | 'accent' | 'success' | 'danger' | 'warning'; label: string }> = {
  pending:   { color: 'default', label: '待处理' },
  analyzing: { color: 'accent',  label: '分析中…' },
  done:      { color: 'success', label: '已完成' },
  failed:    { color: 'danger',  label: '失败' },
};

const CAT_LABEL: Record<string, string> = {
  style: '风格', security: '安全', architecture: '架构',
  performance: '性能', maintainability: '可维护',
};

function scoreColor(s: number) {
  if (s >= 85) return 'text-green-600';
  if (s >= 70) return 'text-yellow-600';
  return 'text-red-600';
}
function scoreBg(s: number) {
  if (s >= 85) return 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900';
  if (s >= 70) return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-900';
  return 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900';
}

const STATUS_ITEMS = [
  { id: 'all', label: '所有状态' }, { id: 'done', label: '已完成' },
  { id: 'analyzing', label: '分析中' }, { id: 'pending', label: '待处理' }, { id: 'failed', label: '失败' },
];

export default function ReportsClient({ initialReports }: { initialReports: Report[] }) {
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
    if (!res.ok) { toast.error('删除失败'); return; }
    toast.success('报告已删除');
    setReports(prev => prev.filter(r => r.id !== id));
  }

  const projectItems = useMemo(() => [
    { id: 'all', label: '所有项目' },
    ...projectNames.map(name => ({ id: name, label: name })),
  ], [projectNames]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex flex-col gap-4 px-8 py-5 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold tracking-tight">报告</h2>
              <span className="inline-flex items-center justify-center rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary">
                {filtered.length}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">查看代码审查报告和质量评分</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select selectedKey={statusFilter} onSelectionChange={(key) => setStatusFilter(key as string)} className="w-[160px]">
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox items={STATUS_ITEMS}>
                {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
              </ListBox>
            </Select.Popover>
          </Select>
          {projectNames.length > 1 && (
            <Select selectedKey={projectFilter} onSelectionChange={(key) => setProjectFilter(key as string)} className="w-[200px]">
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover>
                <ListBox items={projectItems}>
                  {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
                </ListBox>
              </Select.Popover>
            </Select>
          )}
          {(statusFilter !== 'all' || projectFilter !== 'all') && (
            <Button variant="outline" size="sm" onPress={() => { setStatusFilter('all'); setProjectFilter('all'); }}>
              清除筛选
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {reports.length === 0 ? (
          <div className="flex h-[450px] items-center justify-center rounded-xl border border-dashed border-border">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">暂无报告</h3>
              <p className="text-sm text-muted-foreground">从任意项目发起代码审查</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-[450px] items-center justify-center rounded-xl border border-dashed border-border">
            <p className="text-sm text-muted-foreground">没有匹配当前筛选条件的报告</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(report => {
              const st = STATUS_CHIP[report.status] ?? STATUS_CHIP.pending;
              const projectName = (() => {
                const p = report.projects;
                return Array.isArray(p) ? p[0]?.name : p?.name;
              })();
              return (
                <div
                  key={report.id}
                  onClick={() => router.push(`/reports/${report.id}`)}
                  className="flex w-full items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
                >
                  {/* Score */}
                  <div className={['flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-xl border', report.score != null ? scoreBg(report.score) : 'bg-muted border-border'].join(' ')}>
                    <span className={['text-3xl font-bold leading-none', report.score != null ? scoreColor(report.score) : 'text-muted-foreground'].join(' ')}>
                      {report.score ?? '—'}
                    </span>
                    {report.score != null && <span className="mt-1 text-xs text-muted-foreground">/ 100</span>}
                  </div>

                  {/* Info */}
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-semibold leading-none">{projectName ?? '未知'}</p>
                      <Chip size="sm" color={st.color} variant="soft">{st.label}</Chip>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {(report.commits as unknown[])?.length ?? 0} 个提交 · {new Date(report.created_at).toLocaleString('zh-CN')}
                    </p>
                  </div>

                  {/* Category scores */}
                  {report.category_scores && (
                    <div className="flex gap-5 shrink-0">
                      {Object.entries(report.category_scores).map(([k, v]) => (
                        <div key={k} className="text-center">
                          <div className={['text-base font-bold', scoreColor(v)].join(' ')}>{v}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{CAT_LABEL[k] ?? k}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    isIconOnly variant="ghost" size="sm"
                    isDisabled={deletingId === report.id}
                    onPress={(e) => handleDelete(report.id, e as unknown as React.MouseEvent)}
                  >
                    {deletingId === report.id ? <Spinner size="sm" /> : <Trash2 className="h-4 w-4" />}
                  </Button>

                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
