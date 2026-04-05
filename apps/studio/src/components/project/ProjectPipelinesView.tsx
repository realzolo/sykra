'use client';

import { useEffect, useMemo, useState } from 'react';
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
import type {
  PipelineEnvironmentDefinition,
  PipelineSummary,
  PipelineRunStatus,
} from '@/services/pipelineTypes';
import {
  DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS,
  detectPipelineSchedulePreset,
  durationLabel,
  getPipelineEnvironmentLabel,
  normalizePipelineEnvironmentDefinitions,
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
  preview:     'warning',
  development: 'muted',
};

function getRunActorLabel(run: PipelineSummary['last_run'], fallbackLabel: string): string {
  if (!run) return fallbackLabel;
  if (run.triggered_by_name?.trim()) return run.triggered_by_name;
  if (run.triggered_by_email?.trim()) return run.triggered_by_email;
  if (run.triggered_by?.trim()) return run.triggered_by.slice(0, 8);
  return fallbackLabel;
}

function formatOperationalDurationMs(ms: number | null | undefined): string {
  if (!Number.isFinite(ms) || ms === null || ms === undefined || ms <= 0) return '—';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) {
    const minutes = Math.round(ms / 60_000);
    return `${minutes}m`;
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatOperationalDurationSeconds(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds) || seconds === null || seconds === undefined || seconds <= 0) return '—';
  return formatOperationalDurationMs(seconds * 1000);
}

function medianValue(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) return null;
  return Math.round((left + right) / 2);
}

function getPipelineRiskScore(pipeline: PipelineSummary): number {
  const stats = pipeline.run_stats_7d;
  if (!stats) return 0;

  let score = 0;
  if (stats.active_runs > 0) score += 1;
  if ((stats.oldest_active_run_age_seconds ?? 0) >= 1800) score += 2;
  if (stats.total_runs >= 3 && stats.success_rate < 80) score += 2;
  if (stats.failed_runs >= 2) score += 1;
  if ((stats.median_first_failure_ms ?? 0) >= 10 * 60 * 1000) score += 1;
  if ((stats.waiting_manual_dwell_p50_ms ?? 0) >= 15 * 60 * 1000) score += 1;
  if ((stats.policy_rejections ?? 0) > 0) score += 1;
  return score;
}

function getPipelineRiskBadge(
  pipeline: PipelineSummary,
  dict: Dictionary['pipelines']['list']
): { label: string; variant: 'success' | 'warning' | 'danger' } {
  const score = getPipelineRiskScore(pipeline);
  if (score >= 4) {
    return { label: dict.riskHigh, variant: 'danger' };
  }
  if (score >= 2) {
    return { label: dict.riskWatch, variant: 'warning' };
  }
  return { label: dict.riskHealthy, variant: 'success' };
}

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
  const [environmentOptions, setEnvironmentOptions] = useState<PipelineEnvironmentDefinition[]>(
    DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map((item) => ({ ...item }))
  );
  const runStatsSummary = useMemo(() => {
    const oldestActiveAges: number[] = [];
    const medianFirstFailures: number[] = [];
    const waitingManualDwells: number[] = [];
    const totals = pipelines.reduce(
      (acc, pipeline) => {
        const stats = pipeline.run_stats_7d;
        acc.totalRuns += stats?.total_runs ?? 0;
        acc.successRuns += stats?.success_runs ?? 0;
        acc.failedRuns += stats?.failed_runs ?? 0;
        acc.activeRuns += stats?.active_runs ?? 0;
        acc.policyRejections += stats?.policy_rejections ?? 0;
        if ((stats?.oldest_active_run_age_seconds ?? 0) > 0) {
          oldestActiveAges.push(stats!.oldest_active_run_age_seconds!);
        }
        if ((stats?.median_first_failure_ms ?? 0) > 0) {
          medianFirstFailures.push(stats!.median_first_failure_ms!);
        }
        if ((stats?.waiting_manual_dwell_p50_ms ?? 0) > 0) {
          waitingManualDwells.push(stats!.waiting_manual_dwell_p50_ms!);
        }
        return acc;
      },
      { totalRuns: 0, successRuns: 0, failedRuns: 0, activeRuns: 0, policyRejections: 0 }
    );
    const successRate = totals.totalRuns > 0 ? Math.round((totals.successRuns * 1000) / totals.totalRuns) / 10 : 0;
    return {
      ...totals,
      successRate,
      oldestActiveRunAgeSeconds: oldestActiveAges.length > 0 ? Math.max(...oldestActiveAges) : null,
      medianFirstFailureMs: medianValue(medianFirstFailures),
      waitingManualDwellP50Ms: medianValue(waitingManualDwells),
    };
  }, [pipelines]);
  const sortedPipelines = useMemo(() => {
    return [...pipelines].sort((left, right) => {
      const riskDelta = getPipelineRiskScore(right) - getPipelineRiskScore(left);
      if (riskDelta !== 0) return riskDelta;
      const activeDelta = (right.run_stats_7d?.active_runs ?? 0) - (left.run_stats_7d?.active_runs ?? 0);
      if (activeDelta !== 0) return activeDelta;
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  }, [pipelines]);

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
    const controller = new AbortController();
    fetch('/api/runtime-settings', { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!alive || !payload) return;
        setEnvironmentOptions(normalizePipelineEnvironmentDefinitions(payload?.settings?.pipelineEnvironments));
      })
      .catch(() => {
        if (!alive) return;
        setEnvironmentOptions(DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map((item) => ({ ...item })));
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

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
        <div className="grid grid-cols-2 lg:grid-cols-8 gap-3">
          {loading ? (
            <>
              <Skeleton className="h-16 rounded-[10px]" />
              <Skeleton className="h-16 rounded-[10px]" />
              <Skeleton className="h-16 rounded-[10px]" />
              <Skeleton className="h-16 rounded-[10px]" />
              <Skeleton className="h-16 rounded-[10px]" />
              <Skeleton className="h-16 rounded-[10px]" />
              <Skeleton className="h-16 rounded-[10px]" />
              <Skeleton className="h-16 rounded-[10px]" />
            </>
          ) : (
            <>
              <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.list.totalRuns7d}</div>
                <div className="text-[16px] font-semibold text-foreground">{runStatsSummary.totalRuns}</div>
              </div>
              <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.list.successRate7d}</div>
                <div className="text-[16px] font-semibold text-success">{runStatsSummary.successRate.toFixed(1)}%</div>
              </div>
              <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.list.failedRuns7d}</div>
                <div className="text-[16px] font-semibold text-danger">{runStatsSummary.failedRuns}</div>
              </div>
              <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.list.activeRuns}</div>
                <div className="text-[16px] font-semibold text-foreground">{runStatsSummary.activeRuns}</div>
              </div>
              <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.list.policyRejections7d}</div>
                <div className="text-[16px] font-semibold text-warning">{runStatsSummary.policyRejections}</div>
              </div>
              <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.list.oldestActiveRun}</div>
                <div className="text-[16px] font-semibold text-foreground">
                  {formatOperationalDurationSeconds(runStatsSummary.oldestActiveRunAgeSeconds)}
                </div>
              </div>
              <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.list.medianFirstFailure}</div>
                <div className="text-[16px] font-semibold text-foreground">
                  {formatOperationalDurationMs(runStatsSummary.medianFirstFailureMs)}
                </div>
              </div>
              <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.list.waitingManualDwell}</div>
                <div className="text-[16px] font-semibold text-foreground">
                  {formatOperationalDurationMs(runStatsSummary.waitingManualDwellP50Ms)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-6 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] text-[12px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wider gap-4 shrink-0">
        <div className="flex-1">{dict.common.name}</div>
        <div className="w-24 text-center">{p.environment}</div>
        <div className="w-20 text-center">{p.list.status}</div>
        <div className="w-28 text-center">{p.list.trend}</div>
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
          sortedPipelines.map((pipeline) => {
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
            const stats = pipeline.run_stats_7d;
            const failedReason = run?.status && ['failed', 'timed_out', 'canceled'].includes(run.status)
              ? run.error_message ?? null
              : null;
            const riskBadge = getPipelineRiskBadge(pipeline, p.list);
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
                    {run && (
                      <span className="truncate">
                        {p.detail.triggeredBy}: {getRunActorLabel(run, 'system')}
                      </span>
                    )}
                    <span className="truncate">
                      {p.list.statsRuns7d
                        .replace('{{count}}', String(stats?.total_runs ?? 0))
                        .replace('{{rate}}', (stats?.success_rate ?? 0).toFixed(1))}
                    </span>
                    <Badge variant={riskBadge.variant} size="sm">
                      {p.list.operationalRisk}: {riskBadge.label}
                    </Badge>
                    {(stats?.oldest_active_run_age_seconds ?? 0) > 0 && (
                      <Badge variant="outline" size="sm">
                        {p.list.healthOldest.replace(
                          '{{duration}}',
                          formatOperationalDurationSeconds(stats?.oldest_active_run_age_seconds ?? null)
                        )}
                      </Badge>
                    )}
                    {(stats?.median_first_failure_ms ?? 0) > 0 && (
                      <Badge variant="outline" size="sm">
                        {p.list.healthMedianFailure.replace(
                          '{{duration}}',
                          formatOperationalDurationMs(stats?.median_first_failure_ms ?? null)
                        )}
                      </Badge>
                    )}
                    {(stats?.waiting_manual_dwell_p50_ms ?? 0) > 0 && (
                      <Badge variant="outline" size="sm">
                        {p.list.healthManualDwell.replace(
                          '{{duration}}',
                          formatOperationalDurationMs(stats?.waiting_manual_dwell_p50_ms ?? null)
                        )}
                      </Badge>
                    )}
                    {(stats?.policy_rejections ?? 0) > 0 && (
                      <Badge variant="warning" size="sm">
                        {p.list.policyRejectionsBadge
                          .replace('{{count}}', String(stats?.policy_rejections ?? 0))}
                      </Badge>
                    )}
                    {failedReason && (
                      <span className="max-w-[24rem] truncate text-danger" title={failedReason}>
                        {failedReason}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-24 flex justify-center">
                  <Badge variant={ENV_BADGE_VARIANT[env] ?? 'muted'} size="sm">
                    {getPipelineEnvironmentLabel(env, environmentOptions)}
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
                <div className="w-28 flex justify-center">
                  <PipelineTrendSparkline
                    totalRuns={stats?.daily_total_runs ?? []}
                    successRuns={stats?.daily_success_runs ?? []}
                  />
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

function PipelineTrendSparkline({
  totalRuns,
  successRuns,
}: {
  totalRuns: number[];
  successRuns: number[];
}) {
  const width = 84;
  const height = 24;
  const points = totalRuns.length > 0 ? totalRuns : [0];
  const maxValue = Math.max(...points, 1);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const path = points
    .map((value, index) => {
      const x = Math.round(index * step * 10) / 10;
      const y = Math.round((height - (value / maxValue) * (height - 2)) * 10) / 10;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
  const total = totalRuns.reduce((acc, value) => acc + value, 0);
  const success = successRuns.reduce((acc, value) => acc + value, 0);
  const rate = total > 0 ? Math.round((success * 1000) / total) / 10 : 0;

  return (
    <div className="flex items-center gap-2">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="text-[hsl(var(--ds-text-2))]">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{rate.toFixed(0)}%</span>
    </div>
  );
}
