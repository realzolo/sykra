export type PipelineEnvironment = 'development' | 'staging' | 'production';

export type PipelineStep = {
  id: string;
  name: string;
  script: string;
  artifactPaths?: string[];
  artifactInputs?: string[];
  type?: 'shell' | 'docker';
  dockerImage?: string;
  continueOnError?: boolean;
  timeoutSeconds?: number;
  env?: Record<string, string>;
  workingDir?: string;
};

export type PipelineJobType = 'shell' | 'source_checkout' | 'review_gate';

export type PipelineJob = {
  id: string;
  name: string;
  needs?: string[];
  steps: PipelineStep[];
  timeoutSeconds?: number;
  env?: Record<string, string>;
  workingDir?: string;
  type?: PipelineJobType;
  // Built-in source_checkout fields
  branch?: string;
  // Built-in review_gate field
  minScore?: number;
};

export type PipelineTrigger = {
  branch: string;
  autoTrigger: boolean;
};

export type PipelineNotifications = {
  onSuccess: boolean;
  onFailure: boolean;
  channels: Array<'email' | 'inapp'>;
};

export type PipelineConfig = {
  name: string;
  description?: string;
  variables?: Record<string, string>;
  environment?: PipelineEnvironment;
  trigger: PipelineTrigger;
  notifications: PipelineNotifications;
  jobs: PipelineJob[];
};

// ─────────────────────────────────────────────
// API response shapes
// ─────────────────────────────────────────────

export type PipelineSummary = {
  id: string;
  org_id: string;
  project_id?: string | null;
  name: string;
  description: string;
  environment?: PipelineEnvironment;
  is_active: boolean;
  current_version_id?: string | null;
  latest_version: number;
  last_run?: PipelineRunSummary | null;
  concurrency_mode: 'allow' | 'queue' | 'cancel_previous';
  created_at: string;
  updated_at: string;
};

export type PipelineRunSummary = {
  id: string;
  status: PipelineRunStatus;
  trigger_type: PipelineRunTrigger;
  branch?: string | null;
  commit_sha?: string | null;
  commit_message?: string | null;
  rollback_of?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type PipelineRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'canceled'
  | 'timed_out'
  | 'skipped';

export type PipelineRunTrigger =
  | 'manual'
  | 'push'
  | 'schedule'
  | 'webhook'
  | 'rollback';

export type PipelineVersion = {
  id: string;
  pipeline_id: string;
  version: number;
  config: PipelineConfig;
  created_at: string;
};

export type PipelineDetail = PipelineSummary & {
  version?: PipelineVersion;
};

export type PipelineRunDetail = {
  run: PipelineRunSummary & {
    pipeline_id: string;
    version_id: string;
    org_id: string;
    project_id?: string | null;
    attempt: number;
    error_code?: string | null;
    error_message?: string | null;
  };
  jobs: Array<{
    id: string;
    run_id: string;
    job_key: string;
    name: string;
    status: PipelineRunStatus;
    started_at?: string | null;
    finished_at?: string | null;
    duration_ms?: number | null;
    error_message?: string | null;
  }>;
  steps: Array<{
    id: string;
    job_id: string;
    step_key: string;
    name: string;
    status: PipelineRunStatus;
    exit_code?: number | null;
    log_path?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
    duration_ms?: number | null;
  }>;
};

export type PipelineJobDiagnostic = {
  level: 'error' | 'warning' | 'suggestion';
  message: string;
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultStep(name = 'New Step'): PipelineStep {
  return {
    id: newId('step'),
    name,
    script: '',
  };
}

export function toJobIdCandidate(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized;
}

export function createUniqueJobId(name: string, existingIds: string[]): string {
  const base = toJobIdCandidate(name) || 'job';
  const used = new Set(existingIds);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export function renameJobId(jobs: PipelineJob[], oldId: string, newIdRaw: string): PipelineJob[] {
  const existing = jobs.filter((job) => job.id !== oldId).map((job) => job.id);
  const newId = createUniqueJobId(newIdRaw, existing);
  if (!newId || oldId === newId) return jobs;
  return jobs.map((job) => {
    const nextNeeds = (job.needs ?? []).map((need) => (need === oldId ? newId : need));
    if (job.id === oldId) {
      return { ...job, id: newId, needs: nextNeeds };
    }
    return { ...job, needs: nextNeeds };
  });
}

export function createDefaultJob(name = 'New Job', existingIds: string[] = []): PipelineJob {
  const id = createUniqueJobId(name, existingIds);
  return {
    id,
    name,
    type: 'shell',
    needs: [],
    steps: [createDefaultStep('Run command')],
  };
}

export function createDefaultPipelineConfig(name: string): PipelineConfig {
  const sourceJobId = 'source';
  const reviewJobId = 'review';
  const buildJobId = 'build';

  return {
    name,
    environment: 'production',
    trigger: { branch: 'main', autoTrigger: false },
    notifications: {
      onSuccess: true,
      onFailure: true,
      channels: ['inapp', 'email'],
    },
    jobs: [
      {
        id: sourceJobId,
        name: 'Source',
        type: 'source_checkout',
        branch: 'main',
        needs: [],
        steps: [{ id: 'checkout', name: 'Checkout', script: '' }],
      },
      {
        id: reviewJobId,
        name: 'Code Review',
        type: 'review_gate',
        minScore: 60,
        needs: [sourceJobId],
        steps: [{ id: 'gate', name: 'Quality Gate', script: '' }],
      },
      {
        id: buildJobId,
        name: 'Build',
        type: 'shell',
        needs: [reviewJobId],
        steps: [
          { id: newId('step'), name: 'Install dependencies', script: 'npm install' },
          { id: newId('step'), name: 'Build', script: 'npm run build' },
        ],
      },
      {
        id: 'deploy',
        name: 'Deploy',
        type: 'shell',
        needs: [buildJobId],
        steps: [{ id: newId('step'), name: 'Deploy', script: '# add deploy commands here' }],
      },
    ],
  };
}

export function durationLabel(startedAt?: string | null, finishedAt?: string | null): string {
  if (!startedAt) return '';
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function hasCycle(jobs: PipelineJob[]): boolean {
  const map = new Map<string, PipelineJob>();
  jobs.forEach((job) => {
    if (!map.has(job.id)) map.set(job.id, job);
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = map.get(id);
    if (node) {
      for (const dep of node.needs ?? []) {
        if (!map.has(dep)) continue;
        if (dfs(dep)) return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of map.keys()) {
    if (dfs(id)) return true;
  }
  return false;
}

export function analyzePipelineJobs(jobs: PipelineJob[]): PipelineJobDiagnostic[] {
  const diagnostics: PipelineJobDiagnostic[] = [];
  if (jobs.length === 0) {
    diagnostics.push({ level: 'error', message: 'No jobs configured.' });
    return diagnostics;
  }

  const ids = jobs.map((job) => job.id.trim()).filter((id) => id.length > 0);
  if (ids.length !== jobs.length) {
    diagnostics.push({ level: 'error', message: 'Every job must have a non-empty ID.' });
  }

  const counts = new Map<string, number>();
  ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const duplicated = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicated.length > 0) {
    diagnostics.push({
      level: 'error',
      message: `Duplicate job IDs: ${duplicated.join(', ')}.`,
    });
  }

  const idSet = new Set(ids);
  let sourceCheckoutCount = 0;
  for (const job of jobs) {
    if ((job.type ?? 'shell') === 'source_checkout') sourceCheckoutCount += 1;
    if ((job.needs ?? []).includes(job.id)) {
      diagnostics.push({
        level: 'error',
        message: `Job "${job.id}" cannot depend on itself.`,
      });
    }
    for (const dep of job.needs ?? []) {
      if (!idSet.has(dep)) {
        diagnostics.push({
          level: 'error',
          message: `Job "${job.id}" depends on unknown job "${dep}".`,
        });
      }
    }
  }

  if (hasCycle(jobs)) {
    diagnostics.push({
      level: 'error',
      message: 'A cycle exists in job dependencies.',
    });
  }

  const roots = jobs.filter((job) => (job.needs ?? []).length === 0);
  if (roots.length === 0) {
    diagnostics.push({
      level: 'warning',
      message: 'No root job found (every job depends on another job).',
    });
  }

  if (sourceCheckoutCount === 0) {
    diagnostics.push({
      level: 'suggestion',
      message: 'Consider adding a source checkout job as the DAG entry point.',
    });
  } else if (sourceCheckoutCount > 1) {
    diagnostics.push({
      level: 'warning',
      message: 'Multiple source checkout jobs detected. Confirm this is intentional.',
    });
  }

  const reviewGateCount = jobs.filter((job) => (job.type ?? 'shell') === 'review_gate').length;
  if (reviewGateCount === 0) {
    diagnostics.push({
      level: 'suggestion',
      message: 'Consider adding a review gate job for automated quality gating.',
    });
  }

  return diagnostics;
}

export const ENV_LABELS: Record<PipelineEnvironment, string> = {
  development: 'Dev',
  staging: 'Staging',
  production: 'Prod',
};

export const STATUS_VARIANTS: Record<PipelineRunStatus, 'success' | 'danger' | 'warning' | 'default'> = {
  success: 'success',
  failed: 'danger',
  timed_out: 'danger',
  running: 'warning',
  queued: 'default',
  canceled: 'default',
  skipped: 'default',
};
