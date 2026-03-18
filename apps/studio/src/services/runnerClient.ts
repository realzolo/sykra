import {
  runnerCancelPipelineRunResponseSchema,
  runnerCreatePipelineResponseSchema,
  runnerCreatePipelineRunResponseSchema,
  runnerGetPipelineResponseSchema,
  runnerListPipelineRunsResponseSchema,
  runnerListRunEventsResponseSchema,
  runnerListPipelinesResponseSchema,
  runnerPipelineRunDetailSchema,
  runnerUpdatePipelineResponseSchema,
  type RunnerPipelineRunDetail,
  type RunnerRunEvent,
  type RunnerCreatePipelineResponse,
  type RunnerPipelineRun,
  type RunnerGetPipelineResponse,
  type RunnerUpdatePipelineResponse,
  type RunnerPipeline,
} from '@spec-axis/contracts/runner';
import { z } from 'zod';

type AnalyzePayload = {
  projectId: string;
  reportId: string;
  repo: string;
  hashes: string[];
  rules: Array<{ category: string; name: string; prompt: string; severity: string }>;
  previousReport: Record<string, unknown> | null;
  useIncremental: boolean;
};

type RunnerResponse = { taskId: string };
type CancelAnalyzeResponse = { ok: true; taskId: string };

function runnerBaseUrl() {
  const baseUrl = process.env.RUNNER_BASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('RUNNER_BASE_URL is not configured');
  }
  return baseUrl;
}

function runnerHeaders() {
  const token = process.env.RUNNER_TOKEN;
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Runner-Token': token } : {}),
  };
}

async function readRunnerJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Runner returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

async function fetchRunner<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${runnerBaseUrl()}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner request failed: ${res.status} ${text}`);
  }
  const json = await readRunnerJson(res);
  return schema.parse(json);
}

export async function enqueueAnalyze(payload: AnalyzePayload): Promise<RunnerResponse> {
  const res = await fetch(`${runnerBaseUrl()}/v1/tasks/analyze`, {
    method: 'POST',
    headers: runnerHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner enqueue failed: ${res.status} ${text}`);
  }

  return (await res.json()) as RunnerResponse;
}

export async function cancelAnalyzeTask(reportId: string): Promise<CancelAnalyzeResponse> {
  const res = await fetch(`${runnerBaseUrl()}/v1/tasks/analyze/${reportId}/cancel`, {
    method: 'POST',
    headers: runnerHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner cancel analyze failed: ${res.status} ${text}`);
  }
  return (await res.json()) as CancelAnalyzeResponse;
}

export async function listPipelines(orgId: string, projectId?: string | null): Promise<RunnerPipeline[]> {
  const params = new URLSearchParams({ orgId });
  if (projectId) {
    params.set('projectId', projectId);
  }
  return fetchRunner(
    `/v1/pipelines?${params.toString()}`,
    { headers: runnerHeaders(), method: 'GET' },
    runnerListPipelinesResponseSchema
  );
}

export async function createPipeline(payload: unknown): Promise<RunnerCreatePipelineResponse> {
  return fetchRunner(
    '/v1/pipelines',
    { method: 'POST', headers: runnerHeaders(), body: JSON.stringify(payload) },
    runnerCreatePipelineResponseSchema
  );
}

export async function getPipeline(id: string): Promise<RunnerGetPipelineResponse> {
  return fetchRunner(
    `/v1/pipelines/${id}`,
    { method: 'GET', headers: runnerHeaders() },
    runnerGetPipelineResponseSchema
  );
}

export async function updatePipeline(id: string, payload: unknown): Promise<RunnerUpdatePipelineResponse> {
  return fetchRunner(
    `/v1/pipelines/${id}`,
    { method: 'PUT', headers: runnerHeaders(), body: JSON.stringify(payload) },
    runnerUpdatePipelineResponseSchema
  );
}

export async function listPipelineRuns(pipelineId: string, limit = 20): Promise<RunnerPipelineRun[]> {
  return fetchRunner(
    `/v1/pipelines/${pipelineId}/runs?limit=${limit}`,
    { method: 'GET', headers: runnerHeaders() },
    runnerListPipelineRunsResponseSchema
  );
}

export async function createPipelineRun(pipelineId: string, payload: unknown): Promise<RunnerPipelineRun> {
  return fetchRunner(
    `/v1/pipelines/${pipelineId}/runs`,
    { method: 'POST', headers: runnerHeaders(), body: JSON.stringify(payload) },
    runnerCreatePipelineRunResponseSchema
  );
}

export async function getPipelineRun(runId: string): Promise<RunnerPipelineRunDetail> {
  return fetchRunner(
    `/v1/pipeline-runs/${runId}`,
    { method: 'GET', headers: runnerHeaders() },
    runnerPipelineRunDetailSchema
  );
}

export async function getPipelineRunEvents(runId: string, after = 0, limit = 200): Promise<RunnerRunEvent[]> {
  return fetchRunner(
    `/v1/pipeline-runs/${runId}/events?after=${after}&limit=${limit}`,
    { method: 'GET', headers: runnerHeaders() },
    runnerListRunEventsResponseSchema
  );
}

export async function getPipelineStepLog(runId: string, stepId: string, offset = 0, limit = 200000) {
  const res = await fetch(`${runnerBaseUrl()}/v1/pipeline-runs/${runId}/logs/${stepId}?offset=${offset}&limit=${limit}`, {
    method: 'GET',
    headers: runnerHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner get log failed: ${res.status} ${text}`);
  }
  const data = await res.text();
  const nextOffset = Number(res.headers.get('X-Log-Next-Offset') ?? 0);
  return { data, nextOffset };
}

export async function cancelPipelineRun(runId: string) {
  return fetchRunner(
    `/v1/pipeline-runs/${runId}/cancel`,
    { method: 'POST', headers: runnerHeaders() },
    runnerCancelPipelineRunResponseSchema
  );
}
