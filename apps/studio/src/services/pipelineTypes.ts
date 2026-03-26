export type PipelineEnvironment = string;
export type PipelineEnvironmentDefinition = {
  key: string;
  label: string;
  order: number;
};
export type PipelineProjectKind = 'node' | 'nextjs' | 'react' | 'vite' | 'python' | 'go' | 'java' | 'unknown';
export type PipelineRuntimeKind = 'node' | 'python' | 'go' | 'java' | 'unknown';
export type PipelinePackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
export type PipelineStageKey =
  | 'source'
  | 'after_source'
  | 'review'
  | 'after_review'
  | 'build'
  | 'after_build'
  | 'deploy'
  | 'after_deploy';
export const PIPELINE_STAGE_SEQUENCE: PipelineStageKey[] = [
  'source',
  'after_source',
  'review',
  'after_review',
  'build',
  'after_build',
  'deploy',
  'after_deploy',
];
export type PipelineStageEntryMode = 'auto' | 'manual';
export type PipelineStageDispatchMode = 'parallel' | 'serial';

export type PipelineStageConfig = {
  entryMode?: PipelineStageEntryMode;
  dispatchMode?: PipelineStageDispatchMode;
};

export type PipelineStageSettings = Partial<Record<PipelineStageKey, PipelineStageConfig>>;

export type PipelineStep = {
  id: string;
  name: string;
  script: string;
  artifactPaths?: string[];
  artifactInputs?: string[];
  artifactSource?: 'run' | 'registry';
  registryRepository?: string;
  registryVersion?: string;
  registryChannel?: string;
  type?: 'shell' | 'docker';
  dockerImage?: string;
  continueOnError?: boolean;
  timeoutSeconds?: number | undefined;
  env?: Record<string, string>;
  workingDir?: string;
};

export type PipelineJobType = 'shell' | 'source_checkout' | 'review_gate';

export type PipelineJob = {
  id: string;
  name: string;
  stage?: PipelineStageKey;
  needs?: string[];
  steps: PipelineStep[];
  timeoutSeconds?: number | undefined;
  env?: Record<string, string>;
  workingDir?: string;
  type?: PipelineJobType;
  branch?: string;
  // Built-in review_gate field
  minScore?: number;
};

export type PipelineTrigger = {
  autoTrigger: boolean;
  schedule?: string;
};

export const DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS: ReadonlyArray<PipelineEnvironmentDefinition> = [
  { key: 'development', label: 'Development', order: 1 },
  { key: 'preview', label: 'Preview', order: 2 },
  { key: 'production', label: 'Production', order: 3 },
];
export const DEFAULT_PIPELINE_ENVIRONMENTS = DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map(
  (item) => item.key
) as ReadonlyArray<string>;
const DEFAULT_PIPELINE_ENVIRONMENT = 'production';

export function normalizePipelineEnvironmentKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, 32);
}

export function normalizePipelineEnvironmentLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.slice(0, 32);
}

function derivePipelineEnvironmentLabel(value: string): string {
  const normalized = normalizePipelineEnvironmentKey(value);
  if (!normalized) return 'Custom';
  return normalized
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizePipelineEnvironmentDefinitions(
  values: PipelineEnvironmentDefinition[] | null | undefined
): PipelineEnvironmentDefinition[] {
  const raw = Array.isArray(values) ? values : [];
  const deduped = new Map<string, PipelineEnvironmentDefinition>();
  for (const [index, item] of raw.entries()) {
    const key = normalizePipelineEnvironmentKey(item.key);
    if (!key || deduped.has(key)) {
      continue;
    }
    const label = normalizePipelineEnvironmentLabel(item.label) || derivePipelineEnvironmentLabel(key);
    const order = Number.isFinite(item.order) && item.order > 0 ? Math.round(item.order) : index + 1;
    deduped.set(key, { key, label, order });
  }
  if (deduped.size === 0) {
    return DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map((item) => ({ ...item }));
  }
  return [...deduped.values()]
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    .map((item, index) => ({ ...item, order: index + 1 }));
}

export function normalizePipelineEnvironmentOptions(
  values: PipelineEnvironmentDefinition[] | null | undefined
): PipelineEnvironment[] {
  return normalizePipelineEnvironmentDefinitions(values).map((item) => item.key);
}

export function getPipelineEnvironmentLabel(
  value: string,
  definitions?: PipelineEnvironmentDefinition[] | null
): string {
  const key = normalizePipelineEnvironmentKey(value);
  const options = normalizePipelineEnvironmentDefinitions(definitions ?? null);
  const matched = options.find((item) => item.key === key);
  if (matched) {
    return matched.label;
  }
  return derivePipelineEnvironmentLabel(value);
}

export const PIPELINE_SCHEDULE_PRESET_EXPRESSIONS = {
  hourly: '0 * * * *',
  daily: '0 2 * * *',
  weekdays: '0 2 * * 1-5',
  weekly: '0 2 * * 1',
} as const;

export type PipelineSchedulePreset = keyof typeof PIPELINE_SCHEDULE_PRESET_EXPRESSIONS;
export type PipelineScheduleSelection = PipelineSchedulePreset | 'custom' | null;

export function getPipelineScheduleExpression(preset: PipelineSchedulePreset): string {
  return PIPELINE_SCHEDULE_PRESET_EXPRESSIONS[preset];
}

export function detectPipelineSchedulePreset(schedule?: string | null): PipelineScheduleSelection {
  const normalized = schedule?.trim();
  if (!normalized) return null;
  const entries = Object.entries(PIPELINE_SCHEDULE_PRESET_EXPRESSIONS) as Array<
    [PipelineSchedulePreset, string]
  >;
  const match = entries.find(([, expression]) => expression === normalized);
  return match ? match[0] : 'custom';
}

export type PipelineNotifications = {
  onSuccess: boolean;
  onFailure: boolean;
  channels: Array<'email' | 'inapp'>;
};

export type PipelineConfig = {
  name: string;
  description?: string;
  buildImage?: string;
  variables?: Record<string, string>;
  environment?: PipelineEnvironment;
  trigger: PipelineTrigger;
  notifications: PipelineNotifications;
  stages?: PipelineStageSettings;
  jobs: PipelineJob[];
};

export type PipelineBuildStepTemplate = {
  name: string;
  script: string;
};

export type PipelineConfigDefaults = {
  buildImage?: string;
  buildSteps?: PipelineBuildStepTemplate[];
};

export type PipelineInference = PipelineConfigDefaults & {
  projectKind: PipelineProjectKind;
  runtime: PipelineRuntimeKind;
  packageManager: PipelinePackageManager;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
};

export const DEFAULT_STAGE_SETTINGS: Record<PipelineStageKey, PipelineStageConfig> = {
  source: { entryMode: 'auto', dispatchMode: 'parallel' },
  after_source: { entryMode: 'auto', dispatchMode: 'parallel' },
  review: { entryMode: 'auto', dispatchMode: 'parallel' },
  after_review: { entryMode: 'auto', dispatchMode: 'parallel' },
  build: { entryMode: 'auto', dispatchMode: 'parallel' },
  after_build: { entryMode: 'auto', dispatchMode: 'parallel' },
  deploy: { entryMode: 'auto', dispatchMode: 'parallel' },
  after_deploy: { entryMode: 'auto', dispatchMode: 'parallel' },
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
  run_stats_7d?: {
    total_runs: number;
    success_runs: number;
    failed_runs: number;
    success_rate: number;
    active_runs: number;
    daily_total_runs: number[];
    daily_success_runs: number[];
  };
  concurrency_mode: 'allow' | 'queue' | 'cancel_previous';
  trigger_schedule?: string | null;
  last_scheduled_at?: string | null;
  next_scheduled_at?: string | null;
  source_branch?: string;
  source_branch_source?: 'project_default' | 'custom';
  created_at: string;
  updated_at: string;
};

export type PipelineRunSummary = {
  id: string;
  status: PipelineRunStatus;
  trigger_type: PipelineRunTrigger;
  triggered_by?: string | null;
  triggered_by_email?: string | null;
  triggered_by_name?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  commit_message?: string | null;
  error_message?: string | null;
  rollback_of?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type PipelineRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_manual'
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
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  created_at: string;
};

export type PipelineDetail = PipelineSummary & {
  version?: PipelineVersion;
  versions?: PipelineVersion[];
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
    error_message?: string | null;
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

export type PipelineRunCriticalPathNode = {
  id: string;
  name: string;
  job_key: string;
  stage?: PipelineStageKey;
  status: PipelineRunStatus;
  duration_ms: number;
  started_at?: string | null;
  finished_at?: string | null;
};

export type PipelineRunFailureSummary = {
  job_id: string;
  job_name: string;
  job_key: string;
  step_name?: string | null;
  message?: string | null;
};

export type PipelineRunExecutionSummary = {
  total_duration_ms: number;
  critical_path_duration_ms: number;
  critical_path: PipelineRunCriticalPathNode[];
  failure_summary: PipelineRunFailureSummary | null;
};

export type PipelineConfigChange = {
  path: string[];
  label: string;
  kind: 'added' | 'removed' | 'changed';
  before: string;
  after: string;
};

function humanizePathSegment(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatConfigValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatConfigPath(path: string[]): string {
  if (path.length === 0) {
    return 'Config';
  }
  return path.map((segment) => humanizePathSegment(segment)).join(' / ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasStableIdArrayShape(values: unknown[]): values is Array<Record<string, unknown>> {
  return values.every((item) => isPlainObject(item) && typeof item.id === 'string' && item.id.trim().length > 0);
}

function compareAny(path: string[], previous: unknown, current: unknown, changes: PipelineConfigChange[]) {
  if (previous === current) {
    return;
  }

  if (previous === undefined) {
    changes.push({
      path,
      label: formatConfigPath(path),
      kind: 'added',
      before: '',
      after: formatConfigValue(current),
    });
    return;
  }

  if (current === undefined) {
    changes.push({
      path,
      label: formatConfigPath(path),
      kind: 'removed',
      before: formatConfigValue(previous),
      after: '',
    });
    return;
  }

  if (Array.isArray(previous) && Array.isArray(current)) {
    if (hasStableIdArrayShape(previous) && hasStableIdArrayShape(current)) {
      const previousById = new Map(previous.map((item) => [String(item.id), item]));
      const currentById = new Map(current.map((item) => [String(item.id), item]));
      const ids = new Set<string>([...previousById.keys(), ...currentById.keys()]);
      for (const id of ids) {
        const nextPath = [...path, id];
        const prevItem = previousById.get(id);
        const nextItem = currentById.get(id);
        if (!prevItem) {
          changes.push({
            path: nextPath,
            label: formatConfigPath(nextPath),
            kind: 'added',
            before: '',
            after: formatConfigValue(nextItem),
          });
          continue;
        }
        if (!nextItem) {
          changes.push({
            path: nextPath,
            label: formatConfigPath(nextPath),
            kind: 'removed',
            before: formatConfigValue(prevItem),
            after: '',
          });
          continue;
        }
        compareObject(nextPath, prevItem, nextItem, changes);
      }
      return;
    }
    const previousValue = formatConfigValue(previous);
    const currentValue = formatConfigValue(current);
    if (previousValue !== currentValue) {
      changes.push({
        path,
        label: formatConfigPath(path),
        kind: 'changed',
        before: previousValue,
        after: currentValue,
      });
    }
    return;
  }

  if (isPlainObject(previous) && isPlainObject(current)) {
    compareObject(path, previous, current, changes);
    return;
  }

  const previousValue = formatConfigValue(previous);
  const currentValue = formatConfigValue(current);
  if (previousValue !== currentValue) {
    changes.push({
      path,
      label: formatConfigPath(path),
      kind: 'changed',
      before: previousValue,
      after: currentValue,
    });
  }
}

function compareObject(path: string[], previous: Record<string, unknown>, current: Record<string, unknown>, changes: PipelineConfigChange[]) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const key of keys) {
    compareAny([...path, key], previous[key], current[key], changes);
  }
}

export function diffPipelineConfigs(previous: PipelineConfig, current: PipelineConfig): PipelineConfigChange[] {
  const changes: PipelineConfigChange[] = [];
  compareObject([], previous as unknown as Record<string, unknown>, current as unknown as Record<string, unknown>, changes);
  return changes;
}

function isAutomationStage(stage: PipelineStageKey): boolean {
  return stage.startsWith('after_');
}

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
    stage: 'build',
    type: 'shell',
    needs: [],
    steps: [createDefaultStep('Run command')],
  };
}

function normalizeSourceBranchValue(branch?: string): string {
  const normalized = branch?.trim();
  return normalized && normalized.length > 0 ? normalized : 'main';
}

export function createDefaultPipelineConfig(
  name: string,
  defaultBranch = 'main',
  defaults?: PipelineConfigDefaults
): PipelineConfig {
  const sourceJobId = 'source';
  const reviewJobId = 'review';
  const buildJobId = 'build';
  const sourceBranch = normalizeSourceBranchValue(defaultBranch);
  const buildSteps =
    defaults?.buildSteps?.length
      ? defaults.buildSteps.map((step) => ({
          id: newId('step'),
          name: step.name,
          script: step.script,
        }))
      : [
          { id: newId('step'), name: 'Install dependencies', script: 'npm install' },
          { id: newId('step'), name: 'Build', script: 'npm run build' },
        ];

  return {
    name,
    buildImage: defaults?.buildImage?.trim() ?? '',
    environment: DEFAULT_PIPELINE_ENVIRONMENT,
    trigger: { autoTrigger: false },
    stages: { ...DEFAULT_STAGE_SETTINGS },
    notifications: {
      onSuccess: true,
      onFailure: true,
      channels: ['inapp', 'email'],
    },
    jobs: [
      {
        id: sourceJobId,
        name: 'Source',
        stage: 'source',
        type: 'source_checkout',
        branch: sourceBranch,
        needs: [],
        steps: [{ id: 'checkout', name: 'Checkout', script: '' }],
      },
      {
        id: reviewJobId,
        name: 'Code Review',
        stage: 'review',
        type: 'review_gate',
        minScore: 60,
        needs: [sourceJobId],
        steps: [{ id: 'gate', name: 'Quality Gate', script: '' }],
      },
      {
        id: buildJobId,
        name: 'Build',
        stage: 'build',
        type: 'shell',
        needs: [reviewJobId],
        steps: buildSteps,
      },
      {
        id: 'deploy',
        name: 'Deploy',
        stage: 'deploy',
        type: 'shell',
        needs: [buildJobId],
        steps: [{ id: newId('step'), name: 'Deploy', script: '# add deploy commands here' }],
      },
    ],
  };
}

export function getStageConfig(
  settings: PipelineStageSettings | undefined,
  stage: PipelineStageKey
): PipelineStageConfig {
  return {
    ...DEFAULT_STAGE_SETTINGS[stage],
    ...(settings?.[stage] ?? {}),
  };
}

export function normalizeStageSettings(settings?: PipelineStageSettings): Record<PipelineStageKey, PipelineStageConfig> {
  return {
    source: { entryMode: 'auto', dispatchMode: 'parallel' },
    after_source: { entryMode: 'auto', dispatchMode: 'parallel' },
    review: getStageConfig(settings, 'review'),
    after_review: { entryMode: 'auto', dispatchMode: 'parallel' },
    build: getStageConfig(settings, 'build'),
    after_build: { entryMode: 'auto', dispatchMode: 'parallel' },
    deploy: getStageConfig(settings, 'deploy'),
    after_deploy: { entryMode: 'auto', dispatchMode: 'parallel' },
  };
}

export function enforceProductionDeployManualGate(config: PipelineConfig): PipelineConfig {
  if ((config.environment ?? DEFAULT_PIPELINE_ENVIRONMENT) !== 'production') {
    return config;
  }
  const deployStage = getStageConfig(config.stages, 'deploy');
  if (deployStage.entryMode === 'manual') {
    return config;
  }
  return {
    ...config,
    stages: {
      ...(config.stages ?? {}),
      deploy: {
        ...deployStage,
        entryMode: 'manual',
      },
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

function durationMs(startedAt?: string | null, finishedAt?: string | null, fallback = 0): number {
  if (!startedAt) return fallback;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const value = end - start;
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

export function inferPipelineJobStage(job: PipelineJob, jobs: PipelineJob[]): PipelineStageKey {
  if (job.stage && PIPELINE_STAGE_SEQUENCE.includes(job.stage)) return job.stage;
  if (job.type === 'source_checkout') return 'source';
  if (job.type === 'review_gate') return 'review';

  const normalizedName = `${job.id} ${job.name}`.toLowerCase();
  if (/(deploy|release|publish|rollout|ship)/.test(normalizedName)) return 'deploy';
  if (/(notify|notification|email|slack|webhook|cleanup|archive|sync|tool|automation|script)/.test(normalizedName)) {
    return 'after_deploy';
  }

  const dependencyIds = new Set((job.needs ?? []).filter((dependencyId) => dependencyId !== job.id));
  const dependsOnReview = jobs.some(
    (candidate) =>
      dependencyIds.has(candidate.id) &&
      (candidate.stage === 'review' || candidate.type === 'review_gate')
  );
  if (dependsOnReview) return 'build';

  const dependents = jobs.filter((candidate) => (candidate.needs ?? []).includes(job.id));
  if (dependents.length === 0) return 'deploy';
  return 'build';
}

export function sortJobsByStage(jobs: PipelineJob[]): PipelineJob[] {
  const order = new Map(PIPELINE_STAGE_SEQUENCE.map((stage, index) => [stage, index]));
  return [...jobs].sort((a, b) => {
    const stageOrder = (order.get(inferPipelineJobStage(a, jobs)) ?? 0) - (order.get(inferPipelineJobStage(b, jobs)) ?? 0);
    if (stageOrder !== 0) return stageOrder;
    return 0;
  });
}

export function buildStageJobs(jobs: PipelineJob[]): Record<PipelineStageKey, PipelineJob[]> {
  const grouped: Record<PipelineStageKey, PipelineJob[]> = {
    source: [],
    after_source: [],
    review: [],
    after_review: [],
    build: [],
    after_build: [],
    deploy: [],
    after_deploy: [],
  };
  for (const job of jobs) {
    grouped[inferPipelineJobStage(job, jobs)].push(job);
  }
  return grouped;
}

export function getSourceJob(jobs: PipelineJob[]): PipelineJob | null {
  return jobs.find((job) => (job.type ?? 'shell') === 'source_checkout') ?? null;
}

export function getSourceBranch(jobs: PipelineJob[]): string {
  const sourceJob = getSourceJob(jobs);
  return normalizeSourceBranchValue(sourceJob?.branch);
}

export function createStageJob(
  stage: PipelineStageKey,
  existingIds: string[],
  name?: string,
  sourceBranch = 'main'
): PipelineJob {
  if (stage === 'source') {
    const sourceName = name?.trim() || 'Source';
    return {
      id: createUniqueJobId(sourceName, existingIds),
      name: sourceName,
      stage,
      type: 'source_checkout',
      branch: normalizeSourceBranchValue(sourceBranch),
      needs: [],
      steps: [{ id: 'checkout', name: 'Checkout', script: '' }],
    };
  }
  if (stage === 'review') {
    const reviewName = name?.trim() || 'Code Review';
    return {
      id: createUniqueJobId(reviewName, existingIds),
      name: reviewName,
      stage,
      type: 'review_gate',
      minScore: 60,
      needs: [],
      steps: [{ id: 'gate', name: 'Quality Gate', script: '' }],
    };
  }
  const shellName =
    name?.trim() ||
    (stage === 'build'
      ? 'Build'
      : stage === 'deploy'
      ? 'Deploy'
      : 'Automation');
  return {
    id: createUniqueJobId(shellName, existingIds),
    name: shellName,
    stage,
    type: 'shell',
    needs: [],
    steps: [
      createDefaultStep(
        stage === 'build'
          ? 'Run build command'
          : stage === 'deploy'
          ? 'Run deploy command'
          : 'Run automation task'
      ),
    ],
  };
}

export function normalizePipelineJobs(
  jobs: PipelineJob[],
  stageSettings?: PipelineStageSettings,
  sourceDefaultBranch = 'main'
): PipelineJob[] {
  const validIds = new Set(jobs.map((job) => job.id));
  const grouped = buildStageJobs(jobs);
  let previousStageIds: string[] = [];
  const normalized: PipelineJob[] = [];
  const normalizedStageSettings = normalizeStageSettings(stageSettings);
  const fallbackSourceBranch = normalizeSourceBranchValue(sourceDefaultBranch);

  for (const stage of PIPELINE_STAGE_SEQUENCE) {
    const stageJobs =
      stage === 'source'
        ? grouped[stage].slice(0, 1)
        : [...grouped[stage]];
    if (stageJobs.length === 0) continue;
    const stageIds = stageJobs.map((job) => job.id);
    const stageConfig = normalizedStageSettings[stage];
    const stageDispatch = stageConfig.dispatchMode ?? 'parallel';

    for (const rawJob of stageJobs) {
      const stageIndex = stageJobs.findIndex((job) => job.id === rawJob.id);
      const needs =
        stage === 'source'
          ? []
          : stageDispatch === 'serial' && stageIndex > 0
          ? [stageJobs[stageIndex - 1]!.id]
          : [...previousStageIds];
      if (stage === 'source') {
        normalized.push({
          ...rawJob,
          stage,
          type: 'source_checkout',
          branch: normalizeSourceBranchValue(rawJob.branch ?? fallbackSourceBranch),
          needs,
          steps: rawJob.steps.length > 0 ? rawJob.steps : [{ id: 'checkout', name: 'Checkout', script: '' }],
        });
        continue;
      }
      if (stage === 'review') {
        normalized.push({
          ...rawJob,
          stage,
          type: 'review_gate',
          minScore: Math.min(100, Math.max(0, rawJob.minScore ?? 60)),
          needs,
          steps: rawJob.steps.length > 0 ? rawJob.steps : [{ id: 'gate', name: 'Quality Gate', script: '' }],
        });
        continue;
      }
      normalized.push({
        ...rawJob,
        stage,
        type: 'shell',
        needs: needs.filter((dependencyId) => validIds.has(dependencyId)),
        steps:
          rawJob.steps.length > 0
            ? rawJob.steps
            : [
                createDefaultStep(
                  stage === 'build'
                    ? 'Run build command'
                    : stage === 'deploy'
                    ? 'Run deploy command'
                    : 'Run automation task'
                ),
              ],
      });
    }

    previousStageIds =
      stageDispatch === 'serial'
        ? [stageIds[stageIds.length - 1]!]
        : stageIds;
  }

  return normalized;
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
      level: 'error',
      message: 'Exactly one source job is required.',
    });
  } else if (sourceCheckoutCount > 1) {
    diagnostics.push({ level: 'error', message: 'Only one source job is allowed.' });
  }

  const reviewGateCount = jobs.filter((job) => (job.type ?? 'shell') === 'review_gate').length;
  if (reviewGateCount === 0) {
    diagnostics.push({
      level: 'suggestion',
      message: 'Consider adding a review gate job for automated quality gating.',
    });
  }

  for (const job of jobs) {
    const stage = inferPipelineJobStage(job, jobs);
    if (stage === 'source' && (job.type ?? 'shell') !== 'source_checkout') {
      diagnostics.push({
        level: 'error',
        message: `Source stage only supports source checkout jobs.`,
      });
    }
    if (isAutomationStage(stage) && (job.type ?? 'shell') !== 'shell') {
      diagnostics.push({
        level: 'error',
        message: `Automation stages only support shell jobs.`,
      });
    }
  }

  return diagnostics;
}

export function analyzePipelineConfig(config: PipelineConfig, jobs: PipelineJob[]): PipelineJobDiagnostic[] {
  const diagnostics = analyzePipelineJobs(jobs);
  if (!config.buildImage?.trim()) {
    diagnostics.unshift({
      level: 'error',
      message: 'CI build image is required.',
    });
  }
  let hasCiArtifactOutputs = false;
  for (const job of jobs) {
    const stage = inferPipelineJobStage(job, jobs);
    if (stage !== 'deploy' && stage !== 'after_deploy') {
      for (const step of job.steps) {
        if ((step.artifactPaths ?? []).some((path) => path.trim().length > 0)) {
          hasCiArtifactOutputs = true;
        }
        if ((step.type ?? 'shell') === 'docker') {
          diagnostics.push({
            level: 'error',
            message: `Step "${step.name}" in job "${job.name}" cannot use Docker step mode in CI stages. Set the pipeline build image instead.`,
          });
        }
      }
    }
  }
  if (!hasCiArtifactOutputs) {
    diagnostics.push({
      level: 'warning',
      message: 'No artifact outputs are configured. Build steps need Artifact Paths (for example dist/** or .next/**) to upload artifacts.',
    });
  }
  return diagnostics;
}

export function buildPipelineRunExecutionSummary(
  jobs: PipelineJob[],
  runDetail: PipelineRunDetail | null | undefined
): PipelineRunExecutionSummary | null {
  if (!runDetail || jobs.length === 0) return null;

  const runJobByKey = new Map((runDetail.jobs ?? []).map((job) => [job.job_key, job]));
  const stepsByJobId = new Map<string, PipelineRunDetail['steps']>();
  for (const step of runDetail.steps ?? []) {
    const list = stepsByJobId.get(step.job_id) ?? [];
    list.push(step);
    stepsByJobId.set(step.job_id, list);
  }
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const jobOrder = new Map(jobs.map((job, index) => [job.id, index]));
  const memo = new Map<string, { duration: number; total: number; path: PipelineRunCriticalPathNode[] }>();
  const failureStatusSet = new Set<PipelineRunStatus>(['failed', 'canceled', 'timed_out']);

  function resolve(jobId: string) {
    const cached = memo.get(jobId);
    if (cached) return cached;
    const job = jobById.get(jobId);
    if (!job) {
      const empty = { duration: 0, total: 0, path: [] as PipelineRunCriticalPathNode[] };
      memo.set(jobId, empty);
      return empty;
    }

    const runtimeJob = runJobByKey.get(job.id);
    const duration = runtimeJob
      ? runtimeJob.duration_ms ?? durationMs(runtimeJob.started_at, runtimeJob.finished_at, 0)
      : 0;
    const dependencies = (job.needs ?? []).filter((dependencyId) => jobById.has(dependencyId));
    let best = { duration: 0, total: 0, path: [] as PipelineRunCriticalPathNode[] };
    for (const dep of dependencies) {
      const resolved = resolve(dep);
      const bestTailId = best.path.length > 0 ? best.path[best.path.length - 1]!.id : dep;
      if (resolved.total > best.total) {
        best = resolved;
      } else if (resolved.total === best.total && resolved.path.length > best.path.length) {
        best = resolved;
      } else if (
        resolved.total === best.total &&
        resolved.path.length === best.path.length &&
        (jobOrder.get(dep) ?? 0) > (jobOrder.get(bestTailId) ?? 0)
      ) {
        best = resolved;
      }
    }

    const current: PipelineRunCriticalPathNode = {
      id: job.id,
      name: job.name,
      job_key: job.id,
      status: (runtimeJob?.status as PipelineRunStatus) ?? 'queued',
      duration_ms: duration,
      started_at: runtimeJob?.started_at ?? null,
      finished_at: runtimeJob?.finished_at ?? null,
      ...(job.stage ? { stage: job.stage } : {}),
    };
    const total = best.total + duration;
    const path = [...best.path, current];
    const value = { duration, total, path };
    memo.set(jobId, value);
    return value;
  }

  let criticalPath: PipelineRunCriticalPathNode[] = [];
  let criticalPathDurationMs = 0;
  for (const job of jobs) {
    const resolved = resolve(job.id);
    if (
      resolved.total > criticalPathDurationMs ||
      (resolved.total === criticalPathDurationMs && resolved.path.length > criticalPath.length)
    ) {
      criticalPath = resolved.path;
      criticalPathDurationMs = resolved.total;
    }
  }

  const totalDurationMs = durationMs(
    runDetail.run.started_at ?? null,
    runDetail.run.finished_at ?? null,
    criticalPathDurationMs
  );

  let failureSummary: PipelineRunFailureSummary | null = null;
  for (const job of jobs) {
    const runtimeJob = runJobByKey.get(job.id);
    if (!runtimeJob || !failureStatusSet.has(runtimeJob.status as PipelineRunStatus)) {
      continue;
    }
    const steps = stepsByJobId.get(runtimeJob.id) ?? [];
    const failedStep = steps.find((step) => failureStatusSet.has(step.status as PipelineRunStatus));
    failureSummary = {
      job_id: job.id,
      job_name: job.name,
      job_key: job.id,
      step_name: failedStep?.name ?? null,
      message: failedStep?.error_message ?? runtimeJob.error_message ?? runDetail.run.error_message ?? null,
    };
    break;
  }

  return {
    total_duration_ms: totalDurationMs,
    critical_path_duration_ms: criticalPathDurationMs,
    critical_path: criticalPath,
    failure_summary: failureSummary,
  };
}

export const STATUS_VARIANTS: Record<PipelineRunStatus, 'success' | 'danger' | 'warning' | 'default'> = {
  success: 'success',
  failed: 'danger',
  timed_out: 'danger',
  running: 'warning',
  waiting_manual: 'warning',
  queued: 'default',
  canceled: 'default',
  skipped: 'default',
};
