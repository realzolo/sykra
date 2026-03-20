'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Bot, Shield, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Dictionary } from '@/i18n';
import { withOrgPrefix } from '@/lib/orgPath';
import { formatLocalDateTime } from '@/lib/dateFormat';

type Finding = {
  id: string;
  source: 'baseline' | 'ai' | 'fused';
  tool: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  message: string;
  file: string;
  line: number | null;
  suggestion: string | null;
};

type Stage = {
  stage: string;
  status: string;
};

type ToolRun = {
  tool: string;
  status: string;
  duration_ms: number | null;
};

type ReviewDetail = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled';
  gate_status: 'pending' | 'passed' | 'warning' | 'blocked' | 'skipped';
  score: number | null;
  risk_level: string | null;
  summary: string | null;
  created_at: string;
  stages: Stage[];
  toolRuns: ToolRun[];
  findings: Finding[];
};

type StatusUpdatePayload = {
  type?: string;
  status?: ReviewDetail['status'];
  gateStatus?: ReviewDetail['gate_status'];
  score?: number | null;
  riskLevel?: string | null;
  summary?: string | null;
  stages?: Stage[];
  toolRuns?: ToolRun[];
};

export default function CodeReviewDetailClient({
  runId,
  projectId,
  dict,
}: {
  runId: string;
  projectId: string;
  dict: Dictionary;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async () => {
    const response = await fetch(`/api/code-reviews/${runId}`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data as ReviewDetail;
  }, [runId]);

  useEffect(() => {
    let alive = true;
    void loadDetail()
      .then((next) => {
        if (!alive) return;
        setDetail(next);
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [loadDetail]);

  const isStreaming = detail?.status === 'pending' || detail?.status === 'running';

  useEffect(() => {
    if (!isStreaming) return;
    let alive = true;
    const eventSource = new EventSource(`/api/code-reviews/${runId}/stream`);

    eventSource.onmessage = (event) => {
      if (!alive) return;
      try {
        const payload = JSON.parse(event.data) as StatusUpdatePayload;
        if (payload.type !== 'status_update') return;
        setDetail((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            status: payload.status ?? previous.status,
            gate_status: payload.gateStatus ?? previous.gate_status,
            score: payload.score ?? previous.score,
            risk_level: payload.riskLevel ?? previous.risk_level,
            summary: payload.summary ?? previous.summary,
            stages: Array.isArray(payload.stages) ? payload.stages : previous.stages,
            toolRuns: Array.isArray(payload.toolRuns) ? payload.toolRuns : previous.toolRuns,
          };
        });

        const nextStatus = payload.status;
        if (nextStatus && ['completed', 'partial_failed', 'failed', 'canceled'].includes(nextStatus)) {
          void loadDetail().then((nextDetail) => {
            if (!alive || !nextDetail) return;
            setDetail(nextDetail);
          });
        }
      } catch {
        // ignore malformed payload
      }
    };

    return () => {
      alive = false;
      eventSource.close();
    };
  }, [isStreaming, loadDetail, runId]);

  const severityCount = useMemo(() => {
    const findingList = detail?.findings ?? [];
    return {
      critical: findingList.filter((finding) => finding.severity === 'critical').length,
      high: findingList.filter((finding) => finding.severity === 'high').length,
      medium: findingList.filter((finding) => finding.severity === 'medium').length,
      low: findingList.filter((finding) => finding.severity === 'low').length,
      info: findingList.filter((finding) => finding.severity === 'info').length,
    };
  }, [detail]);

  function statusLabel(status: ReviewDetail['status']) {
    if (status === 'pending') return dict.codeReviews.status.pending;
    if (status === 'running') return dict.codeReviews.status.running;
    if (status === 'completed') return dict.codeReviews.status.completed;
    if (status === 'partial_failed') return dict.codeReviews.status.partialFailed;
    if (status === 'failed') return dict.codeReviews.status.failed;
    return dict.codeReviews.status.canceled;
  }

  function gateLabel(gateStatus: ReviewDetail['gate_status']) {
    if (gateStatus === 'pending') return dict.codeReviews.gate.pending;
    if (gateStatus === 'passed') return dict.codeReviews.gate.passed;
    if (gateStatus === 'warning') return dict.codeReviews.gate.warning;
    if (gateStatus === 'blocked') return dict.codeReviews.gate.blocked;
    return dict.codeReviews.gate.skipped;
  }

  function sourceLabel(source: Finding['source']) {
    if (source === 'ai') return dict.codeReviews.source.ai;
    if (source === 'fused') return dict.codeReviews.source.fused;
    return dict.codeReviews.source.baseline;
  }

  function severityLabel(severity: Finding['severity']) {
    if (severity === 'critical') return dict.reportDetail.severity.critical;
    if (severity === 'high') return dict.reportDetail.severity.high;
    if (severity === 'medium') return dict.reportDetail.severity.medium;
    if (severity === 'low') return dict.reportDetail.severity.low;
    return dict.reportDetail.severity.info;
  }

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => router.push(withOrgPrefix(pathname, `/projects/${projectId}/code-reviews`))}>
          <ArrowLeft className="mr-2 size-4" />
          {dict.common.back}
        </Button>
        <div className="mt-4 text-[13px] text-[hsl(var(--ds-text-2))]">{dict.codeReviews.notFound}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[hsl(var(--ds-border-1))] bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="mb-2"
              onClick={() => router.push(withOrgPrefix(pathname, `/projects/${projectId}/code-reviews`))}
            >
              <ArrowLeft className="mr-1 size-4" />
              {dict.common.back}
            </Button>
            <div className="text-[16px] font-semibold text-foreground">{detail.id}</div>
            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{formatLocalDateTime(detail.created_at)}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="muted">{statusLabel(detail.status)}</Badge>
            <Badge variant={detail.gate_status === 'blocked' ? 'danger' : detail.gate_status === 'warning' ? 'warning' : 'success'}>
              {gateLabel(detail.gate_status)}
            </Badge>
            <Badge variant="accent">{detail.score ?? '—'}</Badge>
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-5 gap-3 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-6 py-3 text-[12px]">
        <div><span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.severity.critical}:</span> {severityCount.critical}</div>
        <div><span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.severity.high}:</span> {severityCount.high}</div>
        <div><span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.severity.medium}:</span> {severityCount.medium}</div>
        <div><span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.severity.low}:</span> {severityCount.low}</div>
        <div><span className="text-[hsl(var(--ds-text-2))]">{dict.reportDetail.severity.info}:</span> {severityCount.info}</div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {detail.summary && (
          <div className="mb-4 rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4 text-sm text-foreground">
            {detail.summary}
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Wrench className="size-4" /> {dict.codeReviews.toolsTitle}</div>
            <div className="space-y-2 text-[12px]">
              {detail.toolRuns.length === 0 ? (
                <div className="text-[hsl(var(--ds-text-2))]">—</div>
              ) : detail.toolRuns.map((toolRun, index) => (
                <div key={`${toolRun.tool}-${index}`} className="flex items-center justify-between">
                  <span>{toolRun.tool}</span>
                  <span className="text-[hsl(var(--ds-text-2))]">
                    {toolRun.status}
                    {toolRun.duration_ms != null ? ` · ${toolRun.duration_ms}ms` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Shield className="size-4" /> {dict.codeReviews.stagesTitle}</div>
            <div className="space-y-2 text-[12px]">
              {detail.stages.length === 0 ? (
                <div className="text-[hsl(var(--ds-text-2))]">—</div>
              ) : detail.stages.map((stage, index) => (
                <div key={`${stage.stage}-${index}`} className="flex items-center justify-between">
                  <span>{stage.stage}</span>
                  <span className="text-[hsl(var(--ds-text-2))]">{stage.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {detail.findings.map((finding) => (
            <div key={finding.id} className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-card p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{finding.title || finding.message}</div>
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                    {finding.file}{finding.line ? `:${finding.line}` : ''} · {finding.category}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="muted">{severityLabel(finding.severity)}</Badge>
                  <Badge variant={finding.source === 'fused' ? 'success' : finding.source === 'ai' ? 'accent' : 'muted'}>
                    {finding.source === 'ai' ? <Bot className="mr-1 size-3" /> : null}
                    {sourceLabel(finding.source)}
                  </Badge>
                </div>
              </div>
              <div className="text-[13px] text-foreground">{finding.message}</div>
              {finding.suggestion && (
                <div className="mt-2 rounded-[8px] bg-[hsl(var(--ds-surface-1))] p-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                  {dict.reportDetail.suggestion}: {finding.suggestion}
                </div>
              )}
            </div>
          ))}
          {detail.findings.length === 0 && (
            <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-card p-6 text-sm text-[hsl(var(--ds-text-2))]">
              {dict.reportDetail.noMatchingIssues}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
