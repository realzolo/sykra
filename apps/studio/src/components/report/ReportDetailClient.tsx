'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, AlertCircle, AlertTriangle, RefreshCw, Github, ChevronDown, ChevronUp, Square,
  TrendingUp, Shield, Zap, Code2, FileCode, MessageCircle, BarChart3, Lightbulb
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import IssueCard from '@/components/report/IssueCard';
import AIChat from '@/components/report/AIChat';
import TrendChart from '@/components/report/TrendChart';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import type { Dictionary } from '@/i18n';
import { withOrgPrefix } from '@/lib/orgPath';
import { Skeleton } from '@/components/ui/skeleton';
import { formatLocalDate } from '@/lib/dateFormat';

type Issue = {
  file: string; line?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string; rule: string; message: string; suggestion?: string;
  codeSnippet?: string; fixPatch?: string; priority?: number;
  impactScope?: string; estimatedEffort?: string;
};
type CommitMeta = { sha: string; message: string; author: string; date: string };
type AnalysisProgress = {
  phase?: string;
  message?: string;
  currentFile?: string;
  filesProcessed?: number;
  filesTotal?: number;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
};
type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};
type Report = {
  id: string; status: string; score?: number;
  category_scores?: Record<string, number>;
  issues?: Issue[]; summary?: string; error_message?: string;
  commits: CommitMeta[];
  total_files?: number; total_additions?: number; total_deletions?: number;
  projects?: { name: string; repo: string };
  project_id: string;
  complexity_metrics?: {
    cyclomaticComplexity: number; cognitiveComplexity: number;
    averageFunctionLength: number; maxFunctionLength: number; totalFunctions: number;
  };
  duplication_metrics?: {
    duplicatedLines: number; duplicatedBlocks: number;
    duplicationRate: number; duplicatedFiles: string[];
  };
  dependency_metrics?: {
    totalDependencies: number; outdatedDependencies: number;
    circularDependencies: string[]; unusedDependencies: string[];
  };
  security_findings?: Array<{
    type: string; severity: string; description: string; file: string; line?: number; cwe?: string;
  }>;
  performance_findings?: Array<{
    type: string; description: string; file: string; line?: number; impact: string;
  }>;
  ai_suggestions?: Array<{
    type: string; title: string; description: string; priority: number; estimatedImpact: string;
  }>;
  code_explanations?: Array<{
    file: string; line?: number; complexity: string; explanation: string; recommendation: string;
  }>;
  context_analysis?: {
    changeType: string; businessImpact: string; riskLevel: string;
    affectedModules: string[]; breakingChanges: boolean;
  };
  analysis_progress?: AnalysisProgress | null;
  token_usage?: TokenUsage | null;
  tokens_used?: number | null;
  analysis_duration_ms?: number | null;
  model_version?: string | null;
};

function scoreColorClass(s: number) {
  if (s >= 85) return 'text-success';
  if (s >= 70) return 'text-warning';
  return 'text-danger';
}
function scoreBarClass(s: number) {
  if (s >= 85) return 'bg-success';
  if (s >= 70) return 'bg-warning';
  return 'bg-danger';
}

function formatDate(d: string, dict: Dictionary) {
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (h < 1) return dict.commits.justNow;
  if (h < 24) return dict.commits.hoursAgo.replace('{{hours}}', String(h));
  if (days < 30) return dict.commits.daysAgo.replace('{{days}}', String(days));
  return formatLocalDate(d);
}

function ReportDetailSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[hsl(var(--ds-border-1))] shrink-0 bg-[hsl(var(--ds-background-2))]">
        <div className="flex items-center gap-3 px-6 h-16 max-w-[1200px] mx-auto w-full">
          <Skeleton className="h-8 w-8 rounded-[6px]" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-7 w-28 rounded-[4px]" />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-6 space-y-3">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="md:col-span-2 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`score-skeleton-${index}`} className="flex items-center gap-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2 w-full rounded-[4px]" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))]">
            <div className="px-6 py-4 flex gap-6 flex-wrap items-center">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-28 rounded-[6px] ml-auto" />
            </div>
            <div className="border-t border-[hsl(var(--ds-border-1))]">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={`commit-row-skeleton-${index}`} className="flex items-center gap-3 px-6 py-3 border-b border-[hsl(var(--ds-border-1))] last:border-0">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-20 ml-auto" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))]">
            <div className="border-b border-[hsl(var(--ds-border-1))] px-2 py-2">
              <div className="flex items-center gap-2 h-11">
                <Skeleton className="h-6 w-24 rounded-[4px]" />
                <Skeleton className="h-6 w-24 rounded-[4px]" />
                <Skeleton className="h-6 w-28 rounded-[4px]" />
              </div>
            </div>
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`issue-skeleton-${index}`} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/10 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-16 rounded-[4px]" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-6 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReportDetailClient({
  reportId,
  initialReport,
  dict,
}: {
  reportId: string;
  initialReport?: Report;
  dict: Dictionary;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [report, setReport] = useState<Report | null>(initialReport ?? null);
  const [loading, setLoading] = useState(!initialReport);
  const [loadError, setLoadError] = useState(false);
  // Map "file:line" → DB issue UUID for comment threads
  const [issueIdMap, setIssueIdMap] = useState<Record<string, string>>({});
  const [sevFilter, setSevFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [retrying, setRetrying] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [commitsExpanded, setCommitsExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatIssueId, setChatIssueId] = useState<string | undefined>();
  const [trendsOpen, setTrendsOpen] = useState(false);

  const pollReport = useCallback(async (id: string) => {
    const res = await fetch(`/api/reports/${id}`);
    const data = await res.json();
    setReport(data);
  }, []);

  useEffect(() => {
    if (initialReport) return;
    let active = true;
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await fetch(`/api/reports/${reportId}`);
        if (!res.ok) throw new Error('report_fetch_failed');
        const data = await res.json();
        if (!active) return;
        setReport(data);
      } catch {
        if (!active) return;
        setLoadError(true);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [initialReport, reportId]);

  // Fetch DB issue UUIDs when report is done, to power comment threads
  useEffect(() => {
    if (!report || report.status !== 'done') return;
    fetch(`/api/reports/${report.id}/issues`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.issues) return;
        const map: Record<string, string> = {};
        for (const issue of data.issues) {
          const key = `${issue.file}:${issue.line ?? ''}:${issue.category}:${issue.rule}`;
          map[key] = issue.id;
        }
        setIssueIdMap(map);
      })
      .catch(() => {
        setIssueIdMap({});
      });
  }, [report]);

  useEffect(() => {
    if (!report) return;
    if (report.status !== 'pending' && report.status !== 'analyzing') return;

    let polling: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (polling) return;
      polling = setInterval(() => pollReport(report.id), 2500);
    };

    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/reports/${report.id}/stream`);
      es.onmessage = (event) => {
        if (!event.data) return;
        try {
          const payload = JSON.parse(event.data);
            if (payload?.type === 'status_update') {
              setReport((prev) => ({
                ...(prev ?? report),
                status: payload.status ?? prev?.status ?? report.status,
                score: payload.score ?? prev?.score ?? report.score,
                error_message: payload.errorMessage ?? prev?.error_message ?? report.error_message,
                analysis_progress: payload.analysisProgress ?? prev?.analysis_progress ?? report.analysis_progress,
                token_usage: payload.tokenUsage ?? prev?.token_usage ?? report.token_usage,
                tokens_used: payload.tokensUsed ?? prev?.tokens_used ?? report.tokens_used,
              }));
              if (payload.status === 'done' || payload.status === 'failed') {
                pollReport(report.id);
                es?.close();
              }
            }
          } catch {
          // ignore parse errors
        }
      };
      es.onerror = () => {
        es?.close();
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      if (es) es.close();
      if (polling) clearInterval(polling);
    };
  }, [report, pollReport]);

  if (loading) {
    return <ReportDetailSkeleton />;
  }

  if (!report || loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{dict.common.error}</div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(withOrgPrefix(pathname, `/projects/${report?.project_id ?? ''}/reports`))}

        >
          {dict.common.back}
        </Button>
      </div>
    );
  }

  async function handleRetry() {
    if (!report) {
      toast.error(dict.reportDetail.retryFailed);
      return;
    }
    const commitShas = report.commits.map(c => c.sha);
    if (!commitShas.length) { toast.error(dict.reportDetail.noCommitsToRetry); return; }
    setRetrying(true);
    const loadingToastId = toast.loading(dict.reportDetail.reanalyzing);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: report.project_id, commits: commitShas }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = (data as { error?: string }).error ?? dict.reportDetail.retryFailed;
        throw new Error(error);
      }

      const nextReportId = (data as { reportId?: string }).reportId;
      if (!nextReportId) {
        throw new Error(dict.reportDetail.retryFailed);
      }

      toast.success(dict.reportDetail.reanalyzeQueued, { id: loadingToastId });

      if (nextReportId === report.id) {
        await pollReport(report.id);
        router.refresh();
        return;
      }
      router.push(withOrgPrefix(pathname, `/projects/${report.project_id}/reports/${nextReportId}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : dict.reportDetail.retryFailed;
      toast.error(message, { id: loadingToastId });
    } finally {
      setRetrying(false);
    }
  }

  async function handleTerminate() {
    if (!report) return;
    setTerminating(true);
    try {
      const res = await fetch(`/api/reports/${report.id}/terminate`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = (data as { error?: string }).error ?? dict.reportDetail.terminateFailed;
        throw new Error(error);
      }

      setReport((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: 'failed',
          error_message: (data as { error_message?: string }).error_message ?? dict.reportDetail.terminatedMessage,
        };
      });
      toast.success(dict.reportDetail.terminateSuccess);

      const warning = (data as { warning?: string }).warning;
      if (warning) {
        toast.warning(warning);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : dict.reportDetail.terminateFailed;
      toast.error(message);
    } finally {
      setTerminating(false);
      setTerminateOpen(false);
    }
  }

  const allIssues = report.issues ?? [];
  const categories = [...new Set(allIssues.map(i => i.category))];
  const filteredIssues = allIssues
    .filter(i => (sevFilter === 'all' || i.severity === sevFilter) && (catFilter === 'all' || i.category === catFilter))
    .sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    });

  const criticalCount = allIssues.filter(i => i.severity === 'critical').length;
  const highCount = allIssues.filter(i => i.severity === 'high').length;
  const mediumCount = allIssues.filter(i => i.severity === 'medium').length;
  const lowCount = allIssues.filter(i => i.severity === 'low').length;
  const infoCount = allIssues.filter(i => i.severity === 'info').length;

  const SEV_ITEMS = [
    { id: 'all', label: dict.reportDetail.allSeverities },
    { id: 'critical', label: dict.reportDetail.severity.critical },
    { id: 'high', label: dict.reportDetail.severity.high },
    { id: 'medium', label: dict.reportDetail.severity.medium },
    { id: 'low', label: dict.reportDetail.severity.low },
    { id: 'info', label: dict.reportDetail.severity.info },
  ];

  const catItems = [
    { id: 'all', label: dict.reportDetail.allCategories },
    ...categories.map(c => ({ id: c, label: dict.reports.categories[c as keyof typeof dict.reports.categories] ?? c })),
  ];

  const statusChip = {
    done:      { variant: 'success' as const, label: dict.reports.status.done },
    failed:    { variant: 'danger' as const,  label: dict.reports.status.failed },
    pending:   { variant: 'muted' as const, label: dict.reports.status.pending },
    analyzing: { variant: 'accent' as const,  label: dict.reports.status.analyzing },
  }[retrying ? 'analyzing' : report.status] ?? { variant: 'muted' as const, label: retrying ? dict.reports.status.analyzing : report.status };

  function openChat(issueFile?: string) {
    setChatIssueId(issueFile);
    setChatOpen(true);
  }

  const projectId = report.project_id;
  const primaryCommitSha = report.commits?.[0]?.sha;

  function codebaseHrefForIssue(issue: Issue) {
    const base = withOrgPrefix(pathname, `/projects/${projectId}`);
    const params = new URLSearchParams();
    params.set('tab', 'codebase');
    if (issue.file) params.set('path', issue.file);
    if (primaryCommitSha) params.set('ref', primaryCommitSha);
    if (issue.line) params.set('line', String(issue.line));
    return `${base}?${params.toString()}`;
  }

  const scoreLabel = (score: number) => {
    if (score >= 85) return dict.reportDetail.excellent;
    if (score >= 70) return dict.reportDetail.good;
    return dict.reportDetail.needsImprovement;
  };

  const progress = report.analysis_progress;
  const tokenUsage = report.token_usage;
  const inputTokens = tokenUsage?.inputTokens ?? 0;
  const outputTokens = tokenUsage?.outputTokens ?? 0;
  const totalTokens = tokenUsage?.totalTokens ?? report.tokens_used ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-[hsl(var(--ds-border-1))] shrink-0 bg-[hsl(var(--ds-background-2))]">
        <div className="flex items-center gap-3 px-6 h-16 max-w-[1200px] mx-auto w-full">
          <Link href={withOrgPrefix(pathname, `/projects/${report.project_id}/reports`)}>
            <Button size="icon" variant="ghost">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{dict.reportDetail.title}</h2>
              <code className="text-xs font-mono text-[hsl(var(--ds-text-2))]">#{report.id.slice(0, 8)}</code>
            </div>
            <div className="text-[12px] text-[hsl(var(--ds-text-2))] truncate">{report.projects?.name}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {report.status === 'done' && (
              <>
                <Button variant="outline" size="sm" onClick={() => setTrendsOpen(true)} className="gap-2">
                  <BarChart3 className="size-4" />{dict.reportDetail.trendAnalysis}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openChat()} className="gap-2">
                  <MessageCircle className="size-4" />{dict.reportDetail.aiChat}
                </Button>
              </>
            )}
            {(report.status === 'done' || report.status === 'failed') && (
              <Button variant="outline" size="sm" disabled={retrying} onClick={handleRetry} className="gap-2">
                <RefreshCw className={retrying ? 'size-3.5 animate-spin' : 'size-3.5'} />
                {retrying ? dict.reportDetail.reanalyzing : dict.reportDetail.reanalyze}
              </Button>
            )}
            {(report.status === 'pending' || report.status === 'analyzing') && (
              <Button
                variant="outline"
                size="sm"
                disabled={terminating}
                onClick={() => setTerminateOpen(true)}
                className="gap-2"
              >
                <Square className="size-3.5" />
                {terminating ? dict.reportDetail.terminating : dict.reportDetail.terminateAction}
              </Button>
            )}
            <Badge variant={statusChip.variant}>{statusChip.label}</Badge>
          </div>
        </div>
      </div>

      {/* Analyzing */}
      {(retrying || report.status === 'pending' || report.status === 'analyzing') && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-3xl rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-6 space-y-5">
            <div>
              <div className="text-base font-semibold">
                {progress?.message ?? dict.reportDetail.analyzing}
              </div>
              <div className="text-[13px] text-[hsl(var(--ds-text-2))] mt-1">
                {dict.reportDetail.analyzingSubtext}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.progressPhase}</div>
                <div className="text-sm font-medium mt-1">{progress?.phase ?? report.status}</div>
              </div>
              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.scannedFiles}</div>
                <div className="text-sm font-medium mt-1">
                  {(progress?.filesProcessed ?? 0)} / {(progress?.filesTotal ?? 0)}
                </div>
              </div>
              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.tokensUsed}</div>
                <div className="text-sm font-medium mt-1">{totalTokens}</div>
              </div>
            </div>
            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3">
              <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.reportDetail.currentFile}</div>
              <code className="text-xs font-mono text-foreground break-all">
                {progress?.currentFile ?? dict.reportDetail.pendingCurrentFile}
              </code>
            </div>
            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
              {dict.reportDetail.tokenBreakdown
                .replace('{{input}}', String(inputTokens))
                .replace('{{output}}', String(outputTokens))
                .replace('{{total}}', String(totalTokens))}
            </div>
          </div>
        </div>
      )}

      {/* Failed */}
      {report.status === 'failed' && !retrying && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <AlertCircle className="size-12 text-danger" />
          <div className="text-sm font-semibold">{dict.reportDetail.analysisFailed}</div>
          <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{report.error_message}</div>
          <Button disabled={retrying} onClick={handleRetry} className="mt-2 gap-2">
            <RefreshCw className={retrying ? 'size-4 animate-spin' : 'size-4'} />
            {retrying ? dict.reportDetail.reanalyzing : dict.reportDetail.reanalyze}
          </Button>
        </div>
      )}

      {/* Done */}
      {report.status === 'done' && !retrying && (
        <div className="flex-1 overflow-auto">
          <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
            <Card>
              <CardContent className="px-6 py-4 flex flex-wrap gap-4">
                <div className="text-sm">
                  <span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.modelLabel}: </span>
                  <strong>{report.model_version ?? '-'}</strong>
                </div>
                <div className="text-sm">
                  <span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.durationLabel}: </span>
                  <strong>{report.analysis_duration_ms ?? 0} ms</strong>
                </div>
                <div className="text-sm">
                  <span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.tokensUsed}: </span>
                  <strong>{totalTokens}</strong>
                </div>
                <div className="text-sm">
                  <span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.tokenInputLabel}: </span>
                  <strong>{inputTokens}</strong>
                </div>
                <div className="text-sm">
                  <span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.tokenOutputLabel}: </span>
                  <strong>{outputTokens}</strong>
                </div>
              </CardContent>
            </Card>

            {/* Score Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-6 text-center">
                  <div className={['text-5xl font-bold', scoreColorClass(report.score ?? 0)].join(' ')}>{report.score}</div>
                  <div className="text-[13px] text-[hsl(var(--ds-text-2))] mt-1">/ 100</div>
                  <div className={['text-sm font-semibold mt-2', scoreColorClass(report.score ?? 0)].join(' ')}>
                    {scoreLabel(report.score ?? 0)}
                  </div>
                </CardContent>
              </Card>
              <Card className="md:col-span-2">
                <CardContent className="p-6 space-y-3">
                  {Object.entries(report.category_scores ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-3">
                      <div className="w-20 text-[13px] text-[hsl(var(--ds-text-2))] shrink-0">{dict.reports.categories[k as keyof typeof dict.reports.categories] ?? k}</div>
                      <div className="flex-1 bg-muted rounded-[4px] h-2">
                        <div className={['h-2 rounded-[4px]', scoreBarClass(v)].join(' ')} style={{ width: `${v}%` }} />
                      </div>
                      <div className={['w-10 text-right text-sm font-bold', scoreColorClass(v)].join(' ')}>{v}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Context Analysis */}
            {report.context_analysis && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="size-4 text-primary" />
                    {dict.reportDetail.contextAnalysis}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div><div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.reportDetail.changeType}</div><div className="text-sm font-medium">{report.context_analysis.changeType}</div></div>
                    <div><div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.reportDetail.riskLevel}</div><div className="text-sm font-medium">{report.context_analysis.riskLevel}</div></div>
                    <div><div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.reportDetail.breakingChanges}</div><div className="text-sm font-medium">{report.context_analysis.breakingChanges ? dict.reportDetail.yes : dict.reportDetail.no}</div></div>
                    <div><div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.reportDetail.affectedModules}</div><div className="text-sm font-medium">{dict.reportDetail.modules.replace('{{count}}', String(report.context_analysis.affectedModules.length))}</div></div>
                  </div>
                  <div className="mt-4">
                    <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.reportDetail.businessImpact}</div>
                    <div className="text-sm">{report.context_analysis.businessImpact}</div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Commit Stats */}
            <Card>
              <CardContent className="p-0">
                <div className="px-6 py-4 flex gap-6 flex-wrap items-center">
                  <div className="text-sm"><span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.changedFiles}: </span><strong>{report.total_files ?? 0}</strong></div>
                  <div className="text-sm text-success font-semibold">+{report.total_additions ?? 0}</div>
                  <div className="text-sm text-danger font-semibold">-{report.total_deletions ?? 0}</div>
                  <div className="text-sm"><span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.commits}: </span><strong>{report.commits?.length ?? 0}</strong></div>
                  <Button variant="ghost" size="sm" onClick={() => setCommitsExpanded(e => !e)} className="ml-auto gap-2">
                    {commitsExpanded ? <><ChevronUp className="size-4" />{dict.reportDetail.hideCommits}</> : <><ChevronDown className="size-4" />{dict.reportDetail.showCommits}</>}
                  </Button>
                </div>
                {commitsExpanded && (
                  <>
                    <Separator />
                    <div>
                      {report.commits.map((c, idx) => (
                        <div key={c.sha}>
                          <div className="flex items-center gap-3 px-6 py-3">
                            <code className="text-xs font-mono shrink-0 px-2 py-0.5 rounded bg-muted text-[hsl(var(--ds-text-2))]">{c.sha.slice(0, 7)}</code>
                            <span className="flex-1 text-sm truncate">{c.message}</span>
                            <span className="text-[12px] text-[hsl(var(--ds-text-2))] shrink-0">{c.author}</span>
                            <span className="text-[12px] text-[hsl(var(--ds-text-2))] shrink-0">{formatDate(c.date, dict)}</span>
                            {report.projects?.repo && (
                              <a href={`https://github.com/${report.projects.repo}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--ds-text-2))] shrink-0">
                                <Github className="size-4" />
                              </a>
                            )}
                          </div>
                          {idx < report.commits.length - 1 && <Separator />}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Tabs */}
            <Card>
              <CardContent className="p-0">
                <Tabs defaultValue="issues">
                  <div className="border-b border-[hsl(var(--ds-border-1))] px-2">
                    <TabsList className="bg-transparent h-11">
                      <TabsTrigger value="issues">
                        <Code2 className="size-4 mr-1.5" />
                        {dict.reportDetail.issueList.replace('{{count}}', String(allIssues.length))}
                      </TabsTrigger>
                      <TabsTrigger value="metrics">
                        <BarChart3 className="size-4 mr-1.5" />
                        {dict.reportDetail.qualityMetrics}
                      </TabsTrigger>
                      {report.security_findings?.length ? (
                        <TabsTrigger value="security">
                          <Shield className="size-4 mr-1.5" />
                          {dict.reportDetail.securityFindings.replace('{{count}}', String(report.security_findings.length))}
                        </TabsTrigger>
                      ) : null}
                      {report.performance_findings?.length ? (
                        <TabsTrigger value="performance">
                          <Zap className="size-4 mr-1.5" />
                          {dict.reportDetail.performanceFindings.replace('{{count}}', String(report.performance_findings.length))}
                        </TabsTrigger>
                      ) : null}
                      {report.ai_suggestions?.length ? (
                        <TabsTrigger value="suggestions">
                          <Lightbulb className="size-4 mr-1.5" />
                          {dict.reportDetail.aiSuggestions.replace('{{count}}', String(report.ai_suggestions.length))}
                        </TabsTrigger>
                      ) : null}
                    </TabsList>
                  </div>

                  <TabsContent value="issues" className="p-6 space-y-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Badge size="sm" variant="danger">{criticalCount} {dict.reportDetail.severity.critical}</Badge>
                        <Badge size="sm" variant="danger">{highCount} {dict.reportDetail.severity.high}</Badge>
                        <Badge size="sm" variant="warning">{mediumCount} {dict.reportDetail.severity.medium}</Badge>
                        <Badge size="sm" variant="muted">{lowCount} {dict.reportDetail.severity.low}</Badge>
                        <Badge size="sm" variant="success">{infoCount} {dict.reportDetail.severity.info}</Badge>
                      </div>
                      <div className="ml-auto flex gap-2">
                        <Select value={sevFilter} onValueChange={(value) => setSevFilter(value)}>
                          <SelectTrigger className="w-[140px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SEV_ITEMS.map(item => (
                              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {categories.length > 1 && (
                          <Select value={catFilter} onValueChange={(value) => setCatFilter(value)}>
                            <SelectTrigger className="w-[150px] h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {catItems.map(item => (
                                <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {(sevFilter !== 'all' || catFilter !== 'all') && (
                          <Button variant="ghost" size="sm" onClick={() => { setSevFilter('all'); setCatFilter('all'); }}>{dict.reportDetail.clearFilters}</Button>
                        )}
                      </div>
                    </div>
                    {filteredIssues.length === 0 ? (
                      <div className="text-center py-12 text-[hsl(var(--ds-text-2))]">{dict.reportDetail.noMatchingIssues}</div>
                    ) : (
                      <div className="space-y-3">
                        {filteredIssues.map((issue, idx) => {
                          const issueId = issueIdMap[`${issue.file}:${issue.line ?? ''}:${issue.category}:${issue.rule}`];
                          return (
                            <IssueCard
                              key={issue.file + '-' + issue.line + '-' + idx}
                              issue={issue}
                              {...(issueId ? { issueId } : {})}
                              reportId={report.id}
                              onChat={() => openChat(issue.file)}
                              codebaseHref={codebaseHrefForIssue(issue)}
                              dict={dict}
                            />
                          );
                        })}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="metrics" className="p-6 space-y-6">
                    {report.complexity_metrics && (
                      <div>
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2"><FileCode className="size-4" />{dict.reportDetail.codeComplexity}</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          {[
                            { label: dict.reportDetail.cyclomaticComplexity, value: report.complexity_metrics.cyclomaticComplexity },
                            { label: dict.reportDetail.cognitiveComplexity, value: report.complexity_metrics.cognitiveComplexity },
                            { label: dict.reportDetail.avgFunctionLength, value: report.complexity_metrics.averageFunctionLength },
                            { label: dict.reportDetail.maxFunctionLength, value: report.complexity_metrics.maxFunctionLength },
                            { label: dict.reportDetail.totalFunctions, value: report.complexity_metrics.totalFunctions },
                          ].map(m => (
                            <Card key={m.label} className="bg-[hsl(var(--ds-surface-1))]">
                              <CardContent className="p-4">
                                <div className="text-2xl font-bold">{m.value}</div>
                                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">{m.label}</div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                    {report.duplication_metrics && (
                      <div>
                        <h4 className="text-sm font-semibold mb-3">{dict.reportDetail.codeDuplication}</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          {[
                            { label: dict.reportDetail.duplicatedLines, value: report.duplication_metrics.duplicatedLines },
                            { label: dict.reportDetail.duplicatedBlocks, value: report.duplication_metrics.duplicatedBlocks },
                            { label: dict.reportDetail.duplicationRate, value: report.duplication_metrics.duplicationRate + '%' },
                          ].map(m => (
                            <Card key={m.label} className="bg-[hsl(var(--ds-surface-1))]">
                              <CardContent className="p-4">
                                <div className="text-2xl font-bold">{m.value}</div>
                                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">{m.label}</div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                        {report.duplication_metrics.duplicatedFiles.length > 0 && (
                          <div className="mt-3">
                            <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-2">{dict.reportDetail.duplicatedFiles}:</div>
                            <div className="space-y-1">{report.duplication_metrics.duplicatedFiles.map(f => <code key={f} className="block text-xs bg-muted px-2 py-1 rounded">{f}</code>)}</div>
                          </div>
                        )}
                      </div>
                    )}
                    {report.dependency_metrics && (
                      <div>
                        <h4 className="text-sm font-semibold mb-3">{dict.reportDetail.dependencyAnalysis}</h4>
                        <div className="grid grid-cols-2 gap-4">
                          {[
                            { label: dict.reportDetail.totalDependencies, value: report.dependency_metrics.totalDependencies },
                            { label: dict.reportDetail.outdatedDependencies, value: report.dependency_metrics.outdatedDependencies },
                          ].map(m => (
                            <Card key={m.label} className="bg-[hsl(var(--ds-surface-1))]">
                              <CardContent className="p-4">
                                <div className="text-2xl font-bold">{m.value}</div>
                                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">{m.label}</div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                        {report.dependency_metrics.circularDependencies.length > 0 && (
                          <div className="mt-3"><div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-2">{dict.reportDetail.circularDependencies}:</div><div className="space-y-1">{report.dependency_metrics.circularDependencies.map((d, i) => <code key={i} className="block text-xs bg-muted px-2 py-1 rounded">{d}</code>)}</div></div>
                        )}
                        {report.dependency_metrics.unusedDependencies.length > 0 && (
                          <div className="mt-3"><div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-2">{dict.reportDetail.unusedDependencies}:</div><div className="space-y-1">{report.dependency_metrics.unusedDependencies.map(d => <code key={d} className="block text-xs bg-muted px-2 py-1 rounded">{d}</code>)}</div></div>
                        )}
                      </div>
                    )}
                    {report.code_explanations && report.code_explanations.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-3">{dict.reportDetail.complexCodeExplanations}</h4>
                        <div className="space-y-3">
                          {report.code_explanations.map((exp, i) => (
                            <Card key={i} className="bg-[hsl(var(--ds-surface-1))]">
                              <CardContent className="p-4">
                                <code className="text-xs font-mono bg-background px-2 py-1 rounded">{exp.file}{exp.line ? ':' + exp.line : ''}</code>
                                <div className="mt-2 text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.complexity}: {exp.complexity}</div>
                                <div className="mt-2 text-sm">{exp.explanation}</div>
                                <div className="mt-2 text-sm text-primary">💡 {exp.recommendation}</div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  {report.security_findings?.length ? (
                    <TabsContent value="security" className="p-6 space-y-3">
                      {report.security_findings.map((finding, i) => (
                        <Card key={i}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <Shield className="size-5 text-danger shrink-0 mt-0.5" />
                              <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold">{finding.type}</span>
                                  <Badge size="sm" variant={finding.severity === 'critical' ? 'danger' : 'warning'}>{finding.severity}</Badge>
                                  {finding.cwe && <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{finding.cwe}</span>}
                                </div>
                                <div className="text-sm">{finding.description}</div>
                                <code className="block text-xs font-mono bg-muted px-2 py-1 rounded">{finding.file}{finding.line ? ':' + finding.line : ''}</code>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </TabsContent>
                  ) : null}

                  {report.performance_findings?.length ? (
                    <TabsContent value="performance" className="p-6 space-y-3">
                      {report.performance_findings.map((finding, i) => (
                        <Card key={i}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <Zap className="size-5 text-warning shrink-0 mt-0.5" />
                              <div className="flex-1 space-y-2">
                                <div className="font-semibold">{finding.type}</div>
                                <div className="text-sm">{finding.description}</div>
                                <code className="block text-xs font-mono bg-muted px-2 py-1 rounded">{finding.file}{finding.line ? ':' + finding.line : ''}</code>
                                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.impact}: {finding.impact}</div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </TabsContent>
                  ) : null}

                  {report.ai_suggestions?.length ? (
                    <TabsContent value="suggestions" className="p-6 space-y-3">
                      {report.ai_suggestions.sort((a, b) => b.priority - a.priority).map((sug, i) => (
                        <Card key={i}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <Lightbulb className="size-5 text-primary shrink-0 mt-0.5" />
                              <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{sug.title}</span>
                                  <Badge size="sm" variant="accent">P{sug.priority}</Badge>
                                  <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{sug.type}</span>
                                </div>
                                <div className="text-sm">{sug.description}</div>
                                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.estimatedImpact}: {sug.estimatedImpact}</div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </TabsContent>
                  ) : null}
                </Tabs>
              </CardContent>
            </Card>

            {/* AI Summary */}
            {report.summary && (
              <Card>
                <CardHeader>
                  <CardTitle>{dict.reportDetail.aiSummary}</CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  <div className="text-[13px] text-[hsl(var(--ds-text-2))] leading-relaxed whitespace-pre-wrap">{report.summary}</div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Chat Modal */}
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-3xl p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{dict.reportDetail.aiReviewer}</DialogTitle>
          </DialogHeader>
          <div className="h-[600px]">
            <AIChat reportId={report.id} {...(chatIssueId ? { issueId: chatIssueId } : {})} dict={dict} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Trends Modal */}
      <Dialog open={trendsOpen} onOpenChange={setTrendsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{dict.reportDetail.qualityTrendAnalysis}</DialogTitle>
          </DialogHeader>
          <TrendChart projectId={report.project_id} dict={dict} />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={terminateOpen}
        onOpenChange={setTerminateOpen}
        title={dict.reportDetail.terminateConfirmTitle}
        description={dict.reportDetail.terminateConfirmDescription}
        confirmLabel={dict.reportDetail.terminateAction}
        cancelLabel={dict.common.cancel}
        onConfirm={() => {
          void handleTerminate();
        }}
        loading={terminating}
        danger
        icon={<AlertTriangle className="size-4 text-warning" />}
      />
    </div>
  );
}
