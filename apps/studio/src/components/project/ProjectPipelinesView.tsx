'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  CheckCircle,
  XCircle,
  Clock,
  Circle,
  RefreshCw,
  Play,
  GitBranch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { useProject } from '@/lib/projectContext';
import type { PipelineSummary, PipelineRunStatus } from '@/services/pipelineTypes';
import {
  detectPipelineSchedulePreset,
  durationLabel,
  ENV_LABELS,
  STATUS_VARIANTS,
} from '@/services/pipelineTypes';
import { withOrgPrefix } from '@/lib/orgPath';
import CreatePipelineWizard from '@/components/pipeline/CreatePipelineWizard';
import { formatLocalDate, formatLocalDateTime } from '@/lib/dateFormat';

const STATUS_ICONS: Record<PipelineRunStatus, React.ReactNode> = {
  success:   <CheckCircle className="size-3.5 text-success" />,
  failed:    <XCircle className="size-3.5 text-danger" />,
  timed_out: <XCircle className="size-3.5 text-danger" />,
  running:   <RefreshCw className="size-3.5 text-warning animate-spin" />,
  waiting_manual: <Clock className="size-3.5 text-warning" />,
  queued:    <Clock className="size-3.5 text-[hsl(var(--ds-text-2))]" />,
  canceled:  <Circle className="size-3.5 text-[hsl(var(--ds-text-2))]" />,
  skipped:   <Circle className="size-3.5 text-[hsl(var(--ds-text-2))]" />,
};

const ENV_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  production:  'danger',
  staging:     'warning',
  development: 'muted',
};

type ArtifactDownloadStats = {
  days: number;
  summary: {
    totalDownloads: number;
    successfulDownloads: number;
    failedDownloads: number;
    successRate: number;
    p95DurationMs: number;
  };
  topErrors: Array<{ category: string; count: number }>;
  recentFailures: Array<{
    createdAt: string;
    artifactPath: string | null;
    errorCategory: string | null;
    errorMessage: string | null;
    durationMs: number;
  }>;
};

export default function ProjectPipelinesView({
  projectId,
  dict,
}: {
  projectId: string;
  dict: Dictionary;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { project } = useProject();
  const p = dict.pipelines;

  const [pipelines, setPipelines] = useState<PipelineSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [downloadStats, setDownloadStats] = useState<ArtifactDownloadStats | null>(null);
  const [downloadStatsLoading, setDownloadStatsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/pipelines?projectId=${projectId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (alive) { setPipelines(Array.isArray(data) ? data : []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    setDownloadStatsLoading(true);
    fetch(`/api/projects/${projectId}/artifact-download-stats?days=7`)
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!alive) return;
        setDownloadStats(payload as ArtifactDownloadStats | null);
        setDownloadStatsLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setDownloadStats(null);
        setDownloadStatsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  function handleCreated(pipelineId: string) {
    router.push(withOrgPrefix(pathname, `/projects/${projectId}/pipelines/${pipelineId}`));
  }

  async function handleRun(e: React.MouseEvent, pipelineId: string) {
    e.preventDefault();
    e.stopPropagation();
    setRunningIds(prev => new Set(prev).add(pipelineId));
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerType: 'manual' }),
      });
      if (!res.ok) throw new Error();
      router.push(withOrgPrefix(pathname, `/projects/${projectId}/pipelines/${pipelineId}`));
    } catch {
      toast.error(dict.common.error);
    } finally {
      setRunningIds(prev => {
        const next = new Set(prev);
        next.delete(pipelineId);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[hsl(var(--ds-border-1))] bg-background shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[16px] font-semibold text-foreground">{p.title}</div>
            <div className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">
              {p.description}
            </div>
          </div>
          <Button variant="default" size="sm" className="h-9 text-[14px]" onClick={() => setWizardOpen(true)}>
            {p.new}
          </Button>
        </div>
      </div>

      <div className="px-6 py-3 border-b border-[hsl(var(--ds-border-1))] bg-background shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-foreground">{p.artifactAuditTitle}</div>
            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
              {p.artifactAuditDescription}
            </div>
          </div>
          {downloadStats && (
            <Badge variant="muted" size="sm">
              {p.artifactAuditWindow.replace('{{days}}', String(downloadStats.days))}
            </Badge>
          )}
        </div>
        {downloadStatsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <Skeleton className="h-16 rounded-[8px]" />
            <Skeleton className="h-16 rounded-[8px]" />
            <Skeleton className="h-16 rounded-[8px]" />
            <Skeleton className="h-16 rounded-[8px]" />
          </div>
        ) : downloadStats ? (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.artifactAuditTotal}</div>
                <div className="text-[16px] font-semibold text-foreground">{downloadStats.summary.totalDownloads}</div>
              </div>
              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.artifactAuditSuccessRate}</div>
                <div className="text-[16px] font-semibold text-success">{downloadStats.summary.successRate.toFixed(1)}%</div>
              </div>
              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.artifactAuditP95Latency}</div>
                <div className="text-[16px] font-semibold text-foreground">{downloadStats.summary.p95DurationMs} ms</div>
              </div>
              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.artifactAuditFailures}</div>
                <div className="text-[16px] font-semibold text-danger">{downloadStats.summary.failedDownloads}</div>
              </div>
            </div>
            {downloadStats.topErrors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.artifactAuditTopErrors}</span>
                {downloadStats.topErrors.map((item) => (
                  <Badge key={item.category} variant="warning" size="sm">
                    {item.category} · {item.count}
                  </Badge>
                ))}
              </div>
            )}
            {downloadStats.recentFailures.length > 0 && (
              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] overflow-hidden">
                <div className="px-3 py-2 bg-[hsl(var(--ds-surface-1))] text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
                  {p.artifactAuditRecentFailures}
                </div>
                <div className="max-h-28 overflow-auto">
                  {downloadStats.recentFailures.map((item, index) => (
                    <div
                      key={`${item.createdAt}-${item.errorCategory ?? 'unknown'}-${index}`}
                      className="px-3 py-2 border-t border-[hsl(var(--ds-border-1))] text-[12px] text-foreground flex items-center gap-3"
                    >
                      <span className="w-40 shrink-0 text-[hsl(var(--ds-text-2))]">
                        {formatLocalDateTime(item.createdAt)}
                      </span>
                      <span className="flex-1 truncate" title={item.artifactPath ?? 'unknown'}>
                        {item.artifactPath ?? 'unknown'}
                      </span>
                      <Badge variant="danger" size="sm">
                        {item.errorCategory ?? 'unknown'}
                      </Badge>
                      <span className="w-20 text-right text-[hsl(var(--ds-text-2))]">{item.durationMs} ms</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 text-[12px] text-[hsl(var(--ds-text-2))]">{p.artifactAuditEmpty}</div>
        )}
      </div>

      {/* Column headers */}
      <div className="flex items-center px-6 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] text-[12px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wider gap-4 shrink-0">
        <div className="flex-1">{dict.common.name}</div>
        <div className="w-24 text-center">{p.environment}</div>
        <div className="w-20 text-center">{p.list.status}</div>
        <div className="w-28 text-center">{p.lastRun}</div>
        <div className="w-24 text-right">{dict.common.actions}</div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col gap-px">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center px-6 py-4 gap-4 border-b border-[hsl(var(--ds-border-1))]">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-24 rounded-[4px]" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-7 w-16 rounded-[6px]" />
              </div>
            ))}
          </div>
        ) : pipelines.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-6 py-20">
            <div className="p-3 rounded-[8px] bg-muted">
              <GitBranch className="size-5 text-[hsl(var(--ds-text-2))]" />
            </div>
            <div className="text-sm font-medium text-foreground">{p.emptyTitle}</div>
            <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{p.emptyDescription}</div>
            <Button size="sm" onClick={() => setWizardOpen(true)}>
              {p.new}
            </Button>
          </div>
          ) : (
	        pipelines.map(pipeline => {
	            const run = pipeline.last_run;
	            const status = run?.status;
	            const env = pipeline.environment ?? 'production';
	            const sourceBranch = pipeline.source_branch ?? project.default_branch;
	            const sourceBranchSource =
	              pipeline.source_branch_source ?? (sourceBranch === project.default_branch ? 'project_default' : 'custom');
              const schedulePreset = detectPipelineSchedulePreset(pipeline.trigger_schedule);
              const scheduleLabel = schedulePreset
                ? schedulePreset === 'custom'
                  ? p.schedule.customPreset
                  : p.schedule.presets[schedulePreset]
                : null;
	            return (
              <div
                key={pipeline.id}
                className="flex items-center px-6 py-4 gap-4 border-b border-[hsl(var(--ds-border-1))] hover:bg-[hsl(var(--ds-surface-1))] cursor-pointer group transition-colors duration-100"
                onClick={() =>
                  router.push(
                    withOrgPrefix(pathname, `/projects/${projectId}/pipelines/${pipeline.id}`),
                  )
                }
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  router.push(withOrgPrefix(pathname, `/projects/${projectId}/pipelines/${pipeline.id}`));
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground truncate">{pipeline.name}</div>
                  {pipeline.description && (
                    <div className="text-[12px] text-[hsl(var(--ds-text-2))] truncate">{pipeline.description}</div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                    <div className="flex min-w-0 items-center gap-1">
                      <GitBranch className="size-3 shrink-0" />
                      <span className="truncate">{sourceBranch}</span>
                    </div>
                    <Badge
                      variant={sourceBranchSource === 'project_default' ? 'muted' : 'outline'}
                      size="sm"
                    >
                      {sourceBranchSource === 'project_default'
                        ? p.basic.sourceBranchProjectDefault
                        : p.basic.sourceBranchCustom}
                    </Badge>
                    {scheduleLabel && (
                      <Badge variant="outline" size="sm">
                        {scheduleLabel}
                      </Badge>
                    )}
                    {pipeline.next_scheduled_at && (
                      <span className="truncate">
                        {p.detail.nextRun}: {formatLocalDateTime(pipeline.next_scheduled_at)}
                      </span>
                    )}
                  </div>
                </div>
	                <div className="w-24 flex justify-center">
	                  <Badge variant={ENV_BADGE_VARIANT[env] ?? 'muted'} size="sm">
	                    {ENV_LABELS[env]}
	                  </Badge>
	                </div>
                <div className="w-20 flex justify-center">
                  {status ? (
                    <span className="flex items-center gap-1">
                      {STATUS_ICONS[status]}
                      <Badge variant={STATUS_VARIANTS[status]} size="sm">
                        {p.status[status]}
                      </Badge>
                    </span>
                  ) : (
                    <span className="text-[12px] text-[hsl(var(--ds-text-2))]">—</span>
                  )}
                </div>
                <div className="w-28 text-[12px] text-[hsl(var(--ds-text-2))]">
                  {run ? (
                    <div>
                      <div>{formatLocalDate(run.created_at)}</div>
                      <div className="text-[hsl(var(--ds-text-2))]/70">
                        {durationLabel(run.started_at, run.finished_at)}
                      </div>
                    </div>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="w-24 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-[13px] opacity-100 transition-opacity"
                    onClick={e => handleRun(e, pipeline.id)}
                    disabled={runningIds.has(pipeline.id)}
                  >
                    <Play className="size-3" />
                    {p.runs}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <CreatePipelineWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={handleCreated}
        dict={dict}
        projectId={projectId}
      />
    </div>
  );
}
