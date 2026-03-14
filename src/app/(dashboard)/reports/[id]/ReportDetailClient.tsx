'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, RefreshCw, Github, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button, Select, ListBox, Chip, Spinner } from '@heroui/react';
import { toast } from 'sonner';

type Issue = {
  file: string; line?: number; severity: 'error' | 'warning' | 'info';
  category: string; rule: string; message: string; suggestion?: string;
};
type CommitMeta = { sha: string; message: string; author: string; date: string };
type Report = {
  id: string; status: string; score?: number;
  category_scores?: Record<string, number>;
  issues?: Issue[]; summary?: string; error_message?: string;
  commits: CommitMeta[];
  total_files?: number; total_additions?: number; total_deletions?: number;
  projects?: { name: string; repo: string };
  project_id: string;
};

const SEV_ORDER = { error: 0, warning: 1, info: 2 };
const SEV_CHIP: Record<string, { color: 'danger' | 'warning' | 'success'; label: string }> = {
  error:   { color: 'danger',  label: '错误' },
  warning: { color: 'warning', label: '警告' },
  info:    { color: 'success', label: '提示' },
};
const CAT_LABEL: Record<string, string> = { style: '风格', security: '安全', architecture: '架构', performance: '性能', maintainability: '可维护性' };

function scoreColor(s: number) {
  if (s >= 85) return 'text-green-600';
  if (s >= 70) return 'text-yellow-600';
  return 'text-red-600';
}

function formatDate(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (h < 1) return '刚刚';
  if (h < 24) return `${h}小时前`;
  if (days < 30) return `${days}天前`;
  return new Date(d).toLocaleDateString('zh-CN');
}

const SEV_ITEMS = [
  { id: 'all', label: '所有严重级别' }, { id: 'error', label: '错误' },
  { id: 'warning', label: '警告' }, { id: 'info', label: '提示' },
];

function IssueRow({ issue }: { issue: Issue }) {
  const [expanded, setExpanded] = useState(false);
  const chip = SEV_CHIP[issue.severity];
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden mb-1.5">
      <div
        onClick={() => issue.suggestion && setExpanded(e => !e)}
        className="flex items-start gap-3 px-4 py-3 select-none"
        style={{ cursor: issue.suggestion ? 'pointer' : 'default' }}
      >
        <Chip size="sm" color={chip.color} variant="soft" className="mt-0.5 shrink-0">{chip.label}</Chip>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <code className="text-xs font-mono bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
              {issue.file}{issue.line ? `:${issue.line}` : ''}
            </code>
            <Chip size="sm" variant="soft" color="accent">{CAT_LABEL[issue.category] ?? issue.category}</Chip>
            <span className="text-xs text-muted-foreground">{issue.rule}</span>
          </div>
          <div className="text-sm leading-relaxed">{issue.message}</div>
        </div>
        {issue.suggestion && (
          <div className="shrink-0 text-muted-foreground mt-0.5">
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </div>
        )}
      </div>
      {expanded && issue.suggestion && (
        <div className="border-t border-border px-4 py-3 bg-muted/30">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">💡 建议</div>
          <div className="text-xs leading-relaxed font-mono whitespace-pre-wrap bg-card border border-border rounded-md px-3.5 py-2.5">
            {issue.suggestion}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportDetailClient({ initialReport }: { initialReport: Report }) {
  const router = useRouter();
  const [report, setReport] = useState<Report>(initialReport);
  const [sevFilter, setSevFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [retrying, setRetrying] = useState(false);
  const [commitsExpanded, setCommitsExpanded] = useState(false);

  const pollReport = useCallback(async () => {
    const res = await fetch(`/api/reports/${report.id}`);
    const data = await res.json();
    setReport(data);
  }, [report.id]);

  useEffect(() => {
    if (report.status !== 'pending' && report.status !== 'analyzing') return;
    const interval = setInterval(pollReport, 2500);
    return () => clearInterval(interval);
  }, [report.status, pollReport]);

  async function handleRetry() {
    const commitShas = report.commits.map(c => c.sha);
    if (!commitShas.length) { toast.error('没有可重新分析的提交'); return; }
    setRetrying(true);
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: report.project_id, commits: commitShas }),
    });
    const data = await res.json();
    setRetrying(false);
    if (!res.ok) { toast.error(data.error ?? '重试失败'); return; }
    router.push(`/reports/${data.reportId}`);
  }

  const allIssues = report.issues ?? [];
  const categories = [...new Set(allIssues.map(i => i.category))];
  const filteredIssues = allIssues
    .filter(i => (sevFilter === 'all' || i.severity === sevFilter) && (catFilter === 'all' || i.category === catFilter))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const errorCount = allIssues.filter(i => i.severity === 'error').length;
  const warningCount = allIssues.filter(i => i.severity === 'warning').length;
  const infoCount = allIssues.filter(i => i.severity === 'info').length;

  const catItems = [{ id: 'all', label: '所有分类' }, ...categories.map(c => ({ id: c, label: CAT_LABEL[c] ?? c }))];

  const statusChip = {
    done:      { color: 'success' as const, label: '已完成' },
    failed:    { color: 'danger' as const,  label: '失败' },
    pending:   { color: 'default' as const, label: '待处理' },
    analyzing: { color: 'accent' as const,  label: '分析中' },
  }[report.status] ?? { color: 'default' as const, label: report.status };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 h-16 border-b border-border bg-card shrink-0">
        <Link href="/reports">
          <Button isIconOnly variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">报告</span>
            <code className="text-xs font-mono text-muted-foreground">#{report.id.slice(0, 8)}</code>
          </div>
          <div className="text-xs text-muted-foreground">{report.projects?.name}</div>
        </div>
        {(report.status === 'done' || report.status === 'failed') && (
          <Button variant="outline" size="sm" isDisabled={retrying} onPress={handleRetry} className="gap-1.5">
            <RefreshCw className={['size-3.5', retrying ? 'animate-spin' : ''].join(' ')} />
            重新分析
          </Button>
        )}
        <Chip color={statusChip.color} variant="soft">{statusChip.label}</Chip>
      </div>

      {/* Analyzing */}
      {(report.status === 'pending' || report.status === 'analyzing') && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Spinner size="lg" />
          <div className="text-sm text-muted-foreground">AI 正在分析您的代码变更…</div>
          <div className="text-xs text-muted-foreground">这可能需要一分钟，页面将自动更新。</div>
        </div>
      )}

      {/* Failed */}
      {report.status === 'failed' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <AlertCircle className="size-12 text-destructive" />
          <div className="text-sm font-semibold">分析失败</div>
          <div className="text-sm text-muted-foreground">{report.error_message}</div>
          <Button isDisabled={retrying} onPress={handleRetry} className="mt-2 gap-1.5">
            <RefreshCw className="size-3.5" />
            重新分析
          </Button>
        </div>
      )}

      {/* Done */}
      {report.status === 'done' && (
        <div className="flex-1 overflow-auto p-6 flex flex-col gap-5">
          {/* Score + categories */}
          <div className="flex gap-4">
            <div className="px-7 py-5 rounded-xl border border-border bg-card text-center shrink-0">
              <div className={['text-5xl font-bold leading-none', scoreColor(report.score ?? 0)].join(' ')}>{report.score}</div>
              <div className="text-xs text-muted-foreground mt-1">/ 100</div>
              <div className={['text-sm font-semibold mt-1.5', scoreColor(report.score ?? 0)].join(' ')}>
                {(report.score ?? 0) >= 85 ? '优秀' : (report.score ?? 0) >= 70 ? '良好' : '需改进'}
              </div>
            </div>
            <div className="flex-1 px-5 py-4 rounded-xl border border-border bg-card flex flex-col gap-2.5">
              {Object.entries(report.category_scores ?? {}).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <div className="w-24 text-sm text-muted-foreground">{CAT_LABEL[k] ?? k}</div>
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div className={['h-2 rounded-full', v >= 85 ? 'bg-green-500' : v >= 70 ? 'bg-yellow-500' : 'bg-red-500'].join(' ')}
                      style={{ width: `${v}%` }} />
                  </div>
                  <div className={['w-8 text-right text-sm font-bold', scoreColor(v)].join(' ')}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Commit stats */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3.5 flex gap-7 flex-wrap items-center border-b border-border/50">
              <div className="text-sm"><span className="text-muted-foreground">变更文件: </span><strong>{report.total_files ?? 0}</strong></div>
              <div className="text-sm text-green-600 font-semibold">+{report.total_additions ?? 0}</div>
              <div className="text-sm text-red-600 font-semibold">-{report.total_deletions ?? 0}</div>
              <div className="text-sm"><span className="text-muted-foreground">提交数: </span><strong>{report.commits?.length ?? 0}</strong></div>
              <Button variant="ghost" size="sm" onPress={() => setCommitsExpanded(e => !e)} className="ml-auto gap-1 h-7">
                {commitsExpanded ? <><ChevronUp className="size-4" />隐藏提交</> : <><ChevronDown className="size-4" />显示提交</>}
              </Button>
            </div>
            {commitsExpanded && (
              <div className="flex flex-col divide-y divide-border">
                {report.commits.map((c, idx) => (
                  <div key={c.sha} className="flex items-center gap-3 px-5 py-2.5">
                    <code className="text-xs font-mono shrink-0 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c.sha.slice(0, 7)}</code>
                    <span className="flex-1 text-sm truncate">{c.message}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{c.author}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(c.date)}</span>
                    {report.projects?.repo && (
                      <a href={`https://github.com/${report.projects.repo}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer"
                        className="text-muted-foreground flex shrink-0" onClick={e => e.stopPropagation()}>
                        <Github className="size-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Issues */}
          <div className="rounded-xl border border-border overflow-hidden bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2.5 flex-wrap">
              <span className="text-sm font-bold">问题</span>
              <Chip size="sm" color="danger" variant="soft">{errorCount} 个错误</Chip>
              <Chip size="sm" color="warning" variant="soft">{warningCount} 个警告</Chip>
              <Chip size="sm" color="success" variant="soft">{infoCount} 个提示</Chip>
              <div className="ml-auto flex gap-2">
                <Select selectedKey={sevFilter} onSelectionChange={(key) => setSevFilter(key as string)} className="w-[140px]">
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover>
                    <ListBox items={SEV_ITEMS}>
                      {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
                    </ListBox>
                  </Select.Popover>
                </Select>
                {categories.length > 1 && (
                  <Select selectedKey={catFilter} onSelectionChange={(key) => setCatFilter(key as string)} className="w-[150px]">
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover>
                      <ListBox items={catItems}>
                        {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                )}
                {(sevFilter !== 'all' || catFilter !== 'all') && (
                  <Button variant="ghost" size="sm" onPress={() => { setSevFilter('all'); setCatFilter('all'); }}>清除</Button>
                )}
              </div>
            </div>
            <div className="p-3 pb-1.5">
              {filteredIssues.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm">没有匹配当前筛选条件的问题</div>
              ) : (
                filteredIssues.map((issue, idx) => (
                  <IssueRow key={`${issue.file}-${issue.line}-${issue.rule}-${idx}`} issue={issue} />
                ))
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="px-5 py-4 rounded-xl border border-border bg-card">
            <div className="text-sm font-bold mb-2.5">AI 总结</div>
            <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{report.summary}</div>
          </div>
        </div>
      )}
    </div>
  );
}
