'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, RefreshCw, Github, ChevronDown, ChevronUp } from 'lucide-react';
import { Button, Select, ListBox, Chip, Spinner } from '@heroui/react';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';

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
const SEV_COLOR: Record<string, 'danger' | 'warning' | 'success'> = {
  error: 'danger', warning: 'warning', info: 'success',
};

function scoreColor(s: number) {
  if (s >= 85) return 'text-success';
  if (s >= 70) return 'text-warning';
  return 'text-danger';
}

function formatDate(d: string, dict: Dictionary) {
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (h < 1) return dict.commits.justNow;
  if (h < 24) return dict.commits.hoursAgo.replace('{{hours}}', String(h));
  if (days < 30) return dict.commits.daysAgo.replace('{{days}}', String(days));
  return new Date(d).toLocaleDateString();
}

function IssueRow({ issue, dict }: { issue: Issue; dict: Dictionary }) {
  const [expanded, setExpanded] = useState(false);
  const sevLabel = dict.rules.severity[issue.severity as keyof typeof dict.rules.severity] ?? issue.severity;
  const catLabel = dict.reports.categories[issue.category as keyof typeof dict.reports.categories] ?? issue.category;
  return (
    <div className="border-b border-border last:border-0">
      <div
        onClick={() => issue.suggestion && setExpanded(e => !e)}
        className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors select-none"
        style={{ cursor: issue.suggestion ? 'pointer' : 'default' }}
      >
        <Chip size="sm" color={SEV_COLOR[issue.severity]} variant="soft" className="mt-0.5 shrink-0">{sevLabel}</Chip>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <code className="text-xs font-mono bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
              {issue.file}{issue.line ? `:${issue.line}` : ''}
            </code>
            <Chip size="sm" variant="soft" color="accent">{catLabel}</Chip>
            <span className="text-xs text-muted-foreground">{issue.rule}</span>
          </div>
          <div className="text-sm leading-relaxed">{issue.message}</div>
        </div>
        {issue.suggestion && (
          <div className="shrink-0 text-muted-foreground mt-1">
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </div>
        )}
      </div>
      {expanded && issue.suggestion && (
        <div className="px-4 pb-3 bg-muted/20">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">{dict.reportDetail.suggestion}</div>
          <div className="text-xs leading-relaxed font-mono whitespace-pre-wrap bg-background border border-border rounded px-3 py-2.5">
            {issue.suggestion}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportDetailClient({ initialReport, dict }: { initialReport: Report; dict: Dictionary }) {
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
    if (!commitShas.length) { toast.error(dict.reportDetail.noCommitsToRetry); return; }
    setRetrying(true);
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: report.project_id, commits: commitShas }),
    });
    const data = await res.json();
    setRetrying(false);
    if (!res.ok) { toast.error(data.error ?? dict.reportDetail.retryFailed); return; }
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

  const SEV_ITEMS = [
    { id: 'all', label: dict.reportDetail.allSeverities },
    { id: 'error', label: dict.rules.severity.error },
    { id: 'warning', label: dict.rules.severity.warning },
    { id: 'info', label: dict.rules.severity.info },
  ];

  const catItems = [
    { id: 'all', label: dict.reportDetail.allCategories },
    ...categories.map(c => ({ id: c, label: dict.reports.categories[c as keyof typeof dict.reports.categories] ?? c })),
  ];

  const statusChip = {
    done:      { color: 'success' as const, label: dict.reports.status.done },
    failed:    { color: 'danger' as const,  label: dict.reports.status.failed },
    pending:   { color: 'default' as const, label: dict.reports.status.pending },
    analyzing: { color: 'accent' as const,  label: dict.reports.status.analyzing },
  }[report.status] ?? { color: 'default' as const, label: report.status };

  const scoreLabel = (s: number) => {
    if (s >= 85) return dict.reportDetail.excellent;
    if (s >= 70) return dict.reportDetail.good;
    return dict.reportDetail.needsImprovement;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 h-14 border-b border-border bg-background shrink-0">
        <Link href="/reports">
          <Button isIconOnly variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{report.projects?.name ?? dict.reportDetail.title}</span>
            <code className="text-xs font-mono text-muted-foreground">#{report.id.slice(0, 8)}</code>
          </div>
        </div>
        {(report.status === 'done' || report.status === 'failed') && (
          <Button variant="outline" size="sm" isDisabled={retrying} onPress={handleRetry} className="gap-1.5">
            <RefreshCw className={['size-3.5', retrying ? 'animate-spin' : ''].join(' ')} />
            {dict.reportDetail.reanalyze}
          </Button>
        )}
        <Chip color={statusChip.color} variant="soft" size="sm">{statusChip.label}</Chip>
      </div>

      {/* Analyzing */}
      {(report.status === 'pending' || report.status === 'analyzing') && (
        <div className="flex-1 flex flex-col items-start justify-center gap-3 px-6">
          <Spinner size="md" />
          <div className="text-sm font-medium">{dict.reportDetail.analyzing}</div>
          <div className="text-xs text-muted-foreground">{dict.reportDetail.analyzingSubtext}</div>
        </div>
      )}

      {/* Failed */}
      {report.status === 'failed' && (
        <div className="flex-1 flex flex-col items-start justify-center gap-3 px-6">
          <AlertCircle className="size-8 text-danger" />
          <div>
            <div className="text-sm font-medium">{dict.reportDetail.analysisFailed}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{report.error_message}</div>
          </div>
          <Button isDisabled={retrying} onPress={handleRetry} size="sm" className="gap-1.5">
            <RefreshCw className="size-3.5" />
            {dict.reportDetail.reanalyze}
          </Button>
        </div>
      )}

      {/* Done */}
      {report.status === 'done' && (
        <div className="flex-1 overflow-auto">
          {/* Score bar */}
          <div className="px-6 py-4 border-b border-border bg-background">
            <div className="flex items-start gap-8">
              <div>
                <div className="text-xs text-muted-foreground mb-1">{dict.reports.overallScore}</div>
                <div className="flex items-baseline gap-1.5">
                  <span className={['text-4xl font-bold', scoreColor(report.score ?? 0)].join(' ')}>{report.score}</span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                  <span className={['text-sm font-medium', scoreColor(report.score ?? 0)].join(' ')}>{scoreLabel(report.score ?? 0)}</span>
                </div>
              </div>
              {report.category_scores && (
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground mb-2">{dict.reports.categoryScores}</div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-2">
                    {Object.entries(report.category_scores).map(([k, v]) => (
                      <div key={k}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">{dict.reports.categories[k as keyof typeof dict.reports.categories] ?? k}</span>
                          <span className={['text-xs font-semibold', scoreColor(v)].join(' ')}>{v}</span>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className={['h-full rounded-full', v >= 85 ? 'bg-success' : v >= 70 ? 'bg-warning' : 'bg-danger'].join(' ')}
                            style={{ width: `${v}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Commit stats */}
          <div className="border-b border-border">
            <div className="flex items-center gap-6 px-6 py-3">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground text-xs">{dict.reportDetail.files}</span>
                <span className="font-medium">{report.total_files ?? 0}</span>
              </div>
              <div className="text-sm font-medium text-success">+{report.total_additions ?? 0}</div>
              <div className="text-sm font-medium text-danger">-{report.total_deletions ?? 0}</div>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground text-xs">{dict.reportDetail.commits}</span>
                <span className="font-medium">{report.commits?.length ?? 0}</span>
              </div>
              <Button variant="ghost" size="sm" onPress={() => setCommitsExpanded(e => !e)} className="ml-auto gap-1 h-7 text-xs">
                {commitsExpanded ? <><ChevronUp className="size-3.5" />{dict.reportDetail.collapseCommits}</> : <><ChevronDown className="size-3.5" />{dict.reportDetail.expandCommits}</>}
              </Button>
            </div>
            {commitsExpanded && (
              <div className="border-t border-border">
                {report.commits.map((c) => (
                  <div key={c.sha} className="flex items-center gap-3 px-6 py-2.5 border-b border-border last:border-0 hover:bg-muted/20">
                    <code className="text-xs font-mono shrink-0 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c.sha.slice(0, 7)}</code>
                    <span className="flex-1 text-sm truncate">{c.message}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{c.author}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(c.date, dict)}</span>
                    {report.projects?.repo && (
                      <a href={`https://github.com/${report.projects.repo}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer"
                        className="text-muted-foreground flex shrink-0 hover:text-foreground" onClick={e => e.stopPropagation()}>
                        <Github className="size-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Issues toolbar */}
          <div className="flex items-center gap-2.5 px-6 py-3 border-b border-border bg-background flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{dict.reportDetail.issues}</span>
              <Chip size="sm" color="danger" variant="soft">{errorCount} {dict.rules.severity.error}</Chip>
              <Chip size="sm" color="warning" variant="soft">{warningCount} {dict.rules.severity.warning}</Chip>
              <Chip size="sm" color="success" variant="soft">{infoCount} {dict.rules.severity.info}</Chip>
            </div>
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
                <Button variant="ghost" size="sm" onPress={() => { setSevFilter('all'); setCatFilter('all'); }}>{dict.reportDetail.clearFilters}</Button>
              )}
            </div>
          </div>

          {/* Issue list */}
          <div className="border-b border-border">
            {filteredIssues.length === 0 ? (
              <div className="px-6 py-10 text-sm text-muted-foreground">{dict.reportDetail.noMatchingIssues}</div>
            ) : (
              filteredIssues.map((issue, idx) => (
                <IssueRow key={`${issue.file}-${issue.line}-${issue.rule}-${idx}`} issue={issue} dict={dict} />
              ))
            )}
          </div>

          {/* Summary */}
          {report.summary && (
            <div className="px-6 py-4">
              <div className="text-xs font-medium text-muted-foreground mb-2">{dict.reportDetail.aiSummary}</div>
              <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{report.summary}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
