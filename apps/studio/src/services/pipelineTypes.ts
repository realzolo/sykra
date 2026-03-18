// ─────────────────────────────────────────────
// Pipeline — Fixed four-stage config schema
// Source → Review → Build → Deploy
// ─────────────────────────────────────────────

export type PipelineEnvironment = 'development' | 'staging' | 'production';

export type PipelineStep = {
  id: string;
  name: string;
  script: string;
  type?: 'shell' | 'docker';
  dockerImage?: string;
  continueOnError?: boolean;
  timeoutSeconds?: number;
  env?: Record<string, string>;
  workingDir?: string;
};

export type PipelineSourceStage = {
  // project is stored on the pipeline record itself, not in config
  branch: string;
  autoTrigger: boolean;
};

export type PipelineReviewStage = {
  enabled: boolean;
  qualityGateEnabled: boolean;
  qualityGateMinScore: number; // 0-100
};

export type PipelineBuildStage = {
  enabled: boolean;
  steps: PipelineStep[];
  artifactPaths?: string[];   // paths to preserve between build → deploy
  cacheEnabled?: boolean;
};

export type PipelineDeployStage = {
  enabled: boolean;
  steps: PipelineStep[];
  rollbackEnabled: boolean;
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
  source: PipelineSourceStage;
  review: PipelineReviewStage;
  build: PipelineBuildStage;
  deploy: PipelineDeployStage;
  notifications: PipelineNotifications;
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
  environment: PipelineEnvironment;
  auto_trigger: boolean;
  trigger_branch: string;
  quality_gate_enabled: boolean;
  quality_gate_min_score: number;
  notify_on_success: boolean;
  notify_on_failure: boolean;
  is_active: boolean;
  current_version_id?: string | null;
  latest_version: number;
  last_run?: PipelineRunSummary | null;
  concurrency_mode?: 'allow' | 'queue' | 'cancel_previous';
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

export function createDefaultPipelineConfig(name: string): PipelineConfig {
  return {
    name,
    source: {
      branch: 'main',
      autoTrigger: false,
    },
    review: {
      enabled: true,
      qualityGateEnabled: false,
      qualityGateMinScore: 60,
    },
    build: {
      enabled: true,
      steps: [
        { id: newId('step'), name: 'Install dependencies', script: 'npm install' },
        { id: newId('step'), name: 'Build', script: 'npm run build' },
      ],
    },
    deploy: {
      enabled: true,
      steps: [
        { id: newId('step'), name: 'Deploy', script: '# add deploy commands here' },
      ],
      rollbackEnabled: true,
    },
    notifications: {
      onSuccess: true,
      onFailure: true,
      channels: ['inapp', 'email'],
    },
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
