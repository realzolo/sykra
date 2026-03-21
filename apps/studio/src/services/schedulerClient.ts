import {
  schedulerCancelPipelineRunResponseSchema,
  schedulerCreatePipelineResponseSchema,
  schedulerCreatePipelineRunResponseSchema,
  schedulerDeletePipelineResponseSchema,
  schedulerGetPipelineResponseSchema,
  schedulerListPipelineRunsResponseSchema,
  schedulerListRunEventsResponseSchema,
  schedulerListPipelinesResponseSchema,
  schedulerPipelineRunDetailSchema,
  schedulerTriggerPipelineRunJobResponseSchema,
  schedulerUpdatePipelineResponseSchema,
  type SchedulerPipelineRunDetail,
  type SchedulerRunEvent,
  type SchedulerCreatePipelineResponse,
  type SchedulerDeletePipelineResponse,
  type SchedulerPipelineRun,
  type SchedulerGetPipelineResponse,
  type SchedulerUpdatePipelineResponse,
  type SchedulerPipeline,
} from '@spec-axis/contracts/scheduler';
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

type SchedulerResponse = { taskId: string };
type CancelAnalyzeResponse = { ok: true; taskId: string };

function schedulerBaseUrl() {
  const baseUrl = process.env.SCHEDULER_BASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('SCHEDULER_BASE_URL is not configured');
  }
  return baseUrl;
}

function schedulerHeaders() {
  const token = process.env.SCHEDULER_TOKEN;
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Scheduler-Token': token } : {}),
  };
}

async function readSchedulerJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Scheduler returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

async function fetchScheduler<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${schedulerBaseUrl()}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Scheduler request failed: ${res.status} ${text}`);
  }
  const json = await readSchedulerJson(res);
  return schema.parse(json);
}

export async function enqueueAnalyze(payload: AnalyzePayload): Promise<SchedulerResponse> {
  const res = await fetch(`${schedulerBaseUrl()}/v1/tasks/analyze`, {
    method: 'POST',
    headers: schedulerHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Scheduler enqueue failed: ${res.status} ${text}`);
  }

  return (await res.json()) as SchedulerResponse;
}

export async function cancelAnalyzeTask(reportId: string): Promise<CancelAnalyzeResponse> {
  const res = await fetch(`${schedulerBaseUrl()}/v1/tasks/analyze/${reportId}/cancel`, {
    method: 'POST',
    headers: schedulerHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Scheduler cancel analyze failed: ${res.status} ${text}`);
  }
  return (await res.json()) as CancelAnalyzeResponse;
}

export async function listPipelines(orgId: string, projectId?: string | null): Promise<SchedulerPipeline[]> {
  const params = new URLSearchParams({ orgId });
  if (projectId) {
    params.set('projectId', projectId);
  }
  return fetchScheduler(
    `/v1/pipelines?${params.toString()}`,
    { headers: schedulerHeaders(), method: 'GET' },
    schedulerListPipelinesResponseSchema
  );
}

export async function createPipeline(payload: unknown): Promise<SchedulerCreatePipelineResponse> {
  return fetchScheduler(
    '/v1/pipelines',
    { method: 'POST', headers: schedulerHeaders(), body: JSON.stringify(payload) },
    schedulerCreatePipelineResponseSchema
  );
}

export async function getPipeline(id: string): Promise<SchedulerGetPipelineResponse> {
  return fetchScheduler(
    `/v1/pipelines/${id}`,
    { method: 'GET', headers: schedulerHeaders() },
    schedulerGetPipelineResponseSchema
  );
}

export async function updatePipeline(id: string, payload: unknown): Promise<SchedulerUpdatePipelineResponse> {
  return fetchScheduler(
    `/v1/pipelines/${id}`,
    { method: 'PUT', headers: schedulerHeaders(), body: JSON.stringify(payload) },
    schedulerUpdatePipelineResponseSchema
  );
}

export async function deletePipeline(id: string): Promise<SchedulerDeletePipelineResponse> {
  return fetchScheduler(
    `/v1/pipelines/${id}`,
    { method: 'DELETE', headers: schedulerHeaders() },
    schedulerDeletePipelineResponseSchema
  );
}

export async function listPipelineRuns(pipelineId: string, limit = 20): Promise<SchedulerPipelineRun[]> {
  return fetchScheduler(
    `/v1/pipelines/${pipelineId}/runs?limit=${limit}`,
    { method: 'GET', headers: schedulerHeaders() },
    schedulerListPipelineRunsResponseSchema
  );
}

export async function createPipelineRun(pipelineId: string, payload: unknown): Promise<SchedulerPipelineRun> {
  return fetchScheduler(
    `/v1/pipelines/${pipelineId}/runs`,
    { method: 'POST', headers: schedulerHeaders(), body: JSON.stringify(payload) },
    schedulerCreatePipelineRunResponseSchema
  );
}

export async function getPipelineRun(runId: string): Promise<SchedulerPipelineRunDetail> {
  return fetchScheduler(
    `/v1/pipeline-runs/${runId}`,
    { method: 'GET', headers: schedulerHeaders() },
    schedulerPipelineRunDetailSchema
  );
}

export async function getPipelineRunEvents(runId: string, after = 0, limit = 200): Promise<SchedulerRunEvent[]> {
  return fetchScheduler(
    `/v1/pipeline-runs/${runId}/events?after=${after}&limit=${limit}`,
    { method: 'GET', headers: schedulerHeaders() },
    schedulerListRunEventsResponseSchema
  );
}

export async function getPipelineStepLog(runId: string, stepId: string, offset = 0, limit = 200000) {
  const res = await fetch(`${schedulerBaseUrl()}/v1/pipeline-runs/${runId}/logs/${stepId}?offset=${offset}&limit=${limit}`, {
    method: 'GET',
    headers: schedulerHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Scheduler get log failed: ${res.status} ${text}`);
  }
  const data = await res.text();
  const nextOffset = Number(res.headers.get('X-Log-Next-Offset') ?? 0);
  return { data, nextOffset };
}

export async function cancelPipelineRun(runId: string) {
  return fetchScheduler(
    `/v1/pipeline-runs/${runId}/cancel`,
    { method: 'POST', headers: schedulerHeaders() },
    schedulerCancelPipelineRunResponseSchema
  );
}

export async function triggerPipelineRunJob(runId: string, jobKey: string) {
  return fetchScheduler(
    `/v1/pipeline-runs/${runId}/jobs/${encodeURIComponent(jobKey)}/trigger`,
    { method: 'POST', headers: schedulerHeaders() },
    schedulerTriggerPipelineRunJobResponseSchema
  );
}
