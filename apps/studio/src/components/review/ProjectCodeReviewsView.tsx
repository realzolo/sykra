'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { Dictionary } from '@/i18n';
import { withOrgPrefix } from '@/lib/orgPath';
import { formatLocalDateTime } from '@/lib/dateFormat';

type CodeReviewRun = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled';
  gate_status: 'pending' | 'passed' | 'warning' | 'blocked' | 'skipped';
  score: number | null;
  scope_mode: 'diff' | 'full';
  base_ref: string | null;
  head_ref: string | null;
  commits: unknown[];
  created_at: string;
};

export default function ProjectCodeReviewsView({
  projectId,
  dict,
}: {
  projectId: string;
  dict: Dictionary;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [runs, setRuns] = useState<CodeReviewRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    let alive = true;
    fetch(`/api/code-reviews?projectId=${projectId}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        if (!alive) return;
        setRuns(Array.isArray(data) ? data as CodeReviewRun[] : []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const filteredRuns = useMemo(() => {
    if (statusFilter === 'all') return runs;
    return runs.filter((run) => run.status === statusFilter);
  }, [runs, statusFilter]);

  const statusItems = [
    { id: 'all', label: dict.codeReviews.allStatus },
    { id: 'pending', label: dict.codeReviews.status.pending },
    { id: 'running', label: dict.codeReviews.status.running },
    { id: 'completed', label: dict.codeReviews.status.completed },
    { id: 'partial_failed', label: dict.codeReviews.status.partialFailed },
    { id: 'failed', label: dict.codeReviews.status.failed },
    { id: 'canceled', label: dict.codeReviews.status.canceled },
  ];

  const chipMap: Record<string, { variant: 'muted' | 'accent' | 'success' | 'warning' | 'danger'; label: string }> = {
    pending: { variant: 'muted', label: dict.codeReviews.status.pending },
    running: { variant: 'accent', label: dict.codeReviews.status.running },
    completed: { variant: 'success', label: dict.codeReviews.status.completed },
    partial_failed: { variant: 'warning', label: dict.codeReviews.status.partialFailed },
    failed: { variant: 'danger', label: dict.codeReviews.status.failed },
    canceled: { variant: 'muted', label: dict.codeReviews.status.canceled },
  };

  function resolveHead(run: CodeReviewRun) {
    if (run.head_ref) return run.head_ref;
    const lastCommit = Array.isArray(run.commits) ? run.commits[run.commits.length - 1] : null;
    if (typeof lastCommit === 'string') return lastCommit;
    if (lastCommit && typeof lastCommit === 'object') {
      const sha = (lastCommit as { sha?: unknown }).sha;
      if (typeof sha === 'string' && sha) return sha;
    }
    return run.id;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[hsl(var(--ds-border-1))] bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[16px] font-semibold text-foreground">{dict.codeReviews.title}</div>
            <div className="mt-0.5 text-[13px] text-[hsl(var(--ds-text-2))]">{dict.codeReviews.description}</div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-40 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={() => router.push(withOrgPrefix(pathname, `/projects/${projectId}/commits`))}
            >
              {dict.codeReviews.newReview}
            </Button>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-6 py-2 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--ds-text-2))]">
        <div className="flex items-center gap-4">
          <div className="flex-1">{dict.codeReviews.runId}</div>
          <div className="w-28 text-center">{dict.codeReviews.scope}</div>
          <div className="w-24 text-center">{dict.codeReviews.score}</div>
          <div className="w-24 text-center">{dict.common.status}</div>
          <div className="w-36">{dict.common.createdAt}</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col gap-px">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 border-b border-[hsl(var(--ds-border-1))] px-6 py-3">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-24 rounded-[4px]" />
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-6 py-20">
            <div className="rounded-[8px] bg-muted p-3">
              <FileText className="size-5 text-[hsl(var(--ds-text-2))]" />
            </div>
            <div className="text-sm font-medium text-foreground">{dict.codeReviews.emptyTitle}</div>
            <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{dict.codeReviews.emptyDescription}</div>
          </div>
        ) : (
          filteredRuns.map((run) => {
            const chip = chipMap[run.status] ?? { variant: 'muted' as const, label: run.status };
            const head = resolveHead(run);
            const scopeLabel = run.scope_mode === 'full' ? dict.codeReviews.modeFull : dict.codeReviews.modeDiff;
            return (
              <button
                key={run.id}
                type="button"
                className="group flex w-full items-center gap-4 border-b border-[hsl(var(--ds-border-1))] px-6 py-3 text-left transition-colors duration-100 hover:bg-[hsl(var(--ds-surface-1))]"
                onClick={() => router.push(withOrgPrefix(pathname, `/projects/${projectId}/code-reviews/${run.id}`))}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-foreground">{head}</div>
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                    {run.base_ref ? `${run.base_ref} -> ${run.head_ref ?? 'HEAD'}` : dict.codeReviews.scopeNoRange}
                  </div>
                </div>
                <div className="w-28 text-center text-[12px] text-[hsl(var(--ds-text-2))]">{scopeLabel}</div>
                <div className="w-24 text-center">
                  {run.score == null ? (
                    <span className="text-[13px] text-[hsl(var(--ds-text-2))]">—</span>
                  ) : (
                    <span className="text-sm font-semibold tabular-nums">{run.score}</span>
                  )}
                </div>
                <div className="flex w-24 justify-center">
                  <Badge size="sm" variant={chip.variant}>{chip.label}</Badge>
                </div>
                <div className="w-36 text-[12px] text-[hsl(var(--ds-text-2))]">{formatLocalDateTime(run.created_at)}</div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
