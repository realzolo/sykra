export type PipelineConfig = {
  version: 'v1';
  name: string;
  description?: string;
  variables?: Record<string, string>;
  stages: PipelineStage[];
  jobs: PipelineJob[];
};

export type PipelineStage = {
  id: string;
  name: string;
  jobIds: string[];
};

export type PipelineJob = {
  id: string;
  name: string;
  needs?: string[];
  steps: PipelineStep[];
  timeoutSeconds?: number;
  env?: Record<string, string>;
  workingDir?: string;
};

export type PipelineStep = {
  id: string;
  name: string;
  type: 'shell';
  script: string;
  env?: Record<string, string>;
  workingDir?: string;
  timeoutSeconds?: number;
  continueOnError?: boolean;
  artifacts?: string[];
};

export type PipelineSummary = {
  id: string;
  name: string;
  description: string;
  project_id: string;
  org_id: string;
  current_version_id?: string | null;
  latest_version: number;
  created_at: string;
  updated_at: string;
};

export type PipelineVersion = {
  id: string;
  pipeline_id: string;
  version: number;
  config: PipelineConfig;
  created_at: string;
};

export type PipelineRun = {
  id: string;
  pipeline_id: string;
  version_id: string;
  status: string;
  trigger_type: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type PipelineRunDetail = {
  run: PipelineRun;
  jobs: Array<{
    id: string;
    run_id: string;
    job_key: string;
    name: string;
    status: string;
    started_at?: string | null;
    finished_at?: string | null;
  }>;
  steps: Array<{
    id: string;
    job_id: string;
    step_key: string;
    name: string;
    status: string;
    exit_code?: number | null;
    log_path?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
  }>;
};

export function createDefaultPipelineConfig(
  name: string,
  options?: { stageName?: string; jobName?: string; stepName?: string; script?: string }
): PipelineConfig {
  const jobId = newId('job');
  const stageId = newId('stage');
  const stepId = newId('step');
  const stageName = options?.stageName ?? 'Build';
  const jobName = options?.jobName ?? 'Build';
  const stepName = options?.stepName ?? 'Run shell';
  const script = options?.script ?? 'echo "Hello pipeline"';
  return {
    version: 'v1',
    name,
    stages: [{ id: stageId, name: stageName, jobIds: [jobId] }],
    jobs: [
      {
        id: jobId,
        name: jobName,
        steps: [
          {
            id: stepId,
            name: stepName,
            type: 'shell',
            script,
          },
        ],
      },
    ],
  };
}

export function newId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
