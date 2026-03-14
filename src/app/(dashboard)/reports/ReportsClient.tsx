'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Trash2 } from 'lucide-react';
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
  if (s >= 85) return 'text-success';
  if (s >= 70) return 'text-warning';
  return 'text-danger';
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-4 max-w-[1200px] mx-auto w-full flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">报告</h1>
            <p className="text-sm text-muted-foreground mt-0.5">代码审查报告与质量评分</p>
          </div>
          <span className="text-sm text-muted-foreground">{filtered.length} 条记录</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-3 max-w-[1200px] mx-auto w-full flex items-center gap-3 flex-wrap">
          <Select selectedKey={statusFilter} onSelectionChange={(key) => setStatusFilter(key as string)} className="w-[140px]">
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox items={STATUS_ITEMS}>
                {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
              </ListBox>
            </Select.Popover>
          </Select>
          {projectNames.length > 1 && (
            <Select selectedKey={projectFilter} onSelectionChange={(key) => setProjectFilter(key as string)} className="w-[180px]">
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover>
                <ListBox items={projectItems}>
                  {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
                </ListBox>
              </Select.Popover>
            </Select>
          )}
          {(statusFilter !== 'all' || projectFilter !== 'all') && (
            <Button variant="ghost" size="sm" onPress={() => { setStatusFilter('all'); setProjectFilter('all'); }}>
              清除筛选
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {reports.length === 0 ? (
          <div className="max-w-[1200px] mx-auto w-full flex flex-col items-start gap-3 px-6 py-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-medium">还没有报告</h3>
              <p className="text-sm text-muted-foreground mt-0.5">从项目页面发起代码审查后，报告会显示在这里</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="max-w-[1200px] mx-auto w-full px-6 py-20">
            <p className="text-sm text-muted-foreground">没有匹配当前筛选条件的报告</p>
          </div>
        ) : (
          <div className="max-w-[1200px] mx-auto w-full px-6 pb-6">
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              {/* Table header */}
              <div className="grid grid-cols-[64px_1fr_160px_auto] items-center px-4 py-2 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground gap-4">
                <div>评分</div>
                <div>项目 / 时间</div>
                <div>分类得分</div>
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
                    className="grid grid-cols-[64px_1fr_160px_auto] items-center px-4 py-3 border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer gap-4"
                    onClick={() => router.push(`/reports/${report.id}`)}
                  >
                    {/* Score */}
                    <div className="flex flex-col items-start">
                      <span className={['text-xl font-bold leading-none', report.score != null ? scoreColor(report.score) : 'text-muted-foreground'].join(' ')}>
                        {report.score ?? '—'}
                      </span>
                      {report.score != null && <span className="text-[10px] text-muted-foreground mt-0.5">/ 100</span>}
                    </div>

                    {/* Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{projectName ?? '未知项目'}</span>
                        <Chip size="sm" color={st.color} variant="soft">{st.label}</Chip>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(report.commits as unknown[])?.length ?? 0} 个提交 · {new Date(report.created_at).toLocaleString('zh-CN')}
                      </p>
                    </div>

                    {/* Category scores */}
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

                    {/* Delete */}
                    <Button
                      isIconOnly variant="ghost" size="sm"
                      isDisabled={deletingId === report.id}
                      onPress={(e) => handleDelete(report.id, e as unknown as React.MouseEvent)}
                    >
                      {deletingId === report.id ? <Spinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
