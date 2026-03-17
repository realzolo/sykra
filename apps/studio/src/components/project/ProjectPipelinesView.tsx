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
import type { PipelineSummary, PipelineRunStatus } from '@/services/pipelineTypes';
import { durationLabel, ENV_LABELS, STATUS_VARIANTS } from '@/services/pipelineTypes';
import { withOrgPrefix } from '@/lib/orgPath';
import CreatePipelineWizard from '@/components/pipeline/CreatePipelineWizard';

const STATUS_ICONS: Record<PipelineRunStatus, React.ReactNode> = {
  success:   <CheckCircle className="size-3.5 text-success" />,
  failed:    <XCircle className="size-3.5 text-danger" />,
  timed_out: <XCircle className="size-3.5 text-danger" />,
  running:   <RefreshCw className="size-3.5 text-warning animate-spin" />,
  queued:    <Clock className="size-3.5 text-[hsl(var(--ds-text-2))]" />,
  canceled:  <Circle className="size-3.5 text-[hsl(var(--ds-text-2))]" />,
  skipped:   <Circle className="size-3.5 text-[hsl(var(--ds-text-2))]" />,
};

const ENV_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  production:  'danger',
  staging:     'warning',
  development: 'muted',
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
  const p = dict.pipelines;

  const [pipelines, setPipelines] = useState<PipelineSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetch(`/api/pipelines?projectId=${projectId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (alive) { setPipelines(Array.isArray(data) ? data : []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
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
          <Button variant="default" size="sm" className="h-8 text-[13px]" onClick={() => setWizardOpen(true)}>
            {p.new}
          </Button>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-6 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] text-[11px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wider gap-4 shrink-0">
        <div className="flex-1">{dict.common.name}</div>
        <div className="w-24 text-center">{p.environment}</div>
        <div className="w-20 text-center">{p.stages.source}</div>
        <div className="w-28 text-center">Last Run</div>
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
            return (
              <div
                key={pipeline.id}
                className="flex items-center px-6 py-4 gap-4 border-b border-[hsl(var(--ds-border-1))] hover:bg-[hsl(var(--ds-surface-1))] cursor-pointer group transition-colors duration-100"
                onClick={() =>
                  router.push(
                    withOrgPrefix(pathname, `/projects/${projectId}/pipelines/${pipeline.id}`),
                  )
                }
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground truncate">{pipeline.name}</div>
                  {pipeline.description && (
                    <div className="text-[12px] text-[hsl(var(--ds-text-2))] truncate">{pipeline.description}</div>
                  )}
                </div>
                <div className="w-24 flex justify-center">
                  <Badge variant={ENV_BADGE_VARIANT[pipeline.environment] ?? 'muted'} size="sm">
                    {ENV_LABELS[pipeline.environment]}
                  </Badge>
                </div>
                <div className="w-20 flex justify-center">
                  {status ? (
                    <span className="flex items-center gap-1">
                      {STATUS_ICONS[status]}
                      <Badge variant={STATUS_VARIANTS[status]} size="sm">
                        {status}
                      </Badge>
                    </span>
                  ) : (
                    <span className="text-[12px] text-[hsl(var(--ds-text-2))]">—</span>
                  )}
                </div>
                <div className="w-28 text-[12px] text-[hsl(var(--ds-text-2))]">
                  {run ? (
                    <div>
                      <div>{new Date(run.created_at).toLocaleDateString()}</div>
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
                    className="h-7 gap-1.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => handleRun(e, pipeline.id)}
                    disabled={runningIds.has(pipeline.id)}
                  >
                    <Play className="size-3" />
                    {p.runs ?? 'Run'}
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
