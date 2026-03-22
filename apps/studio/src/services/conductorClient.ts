import {
  conductorCancelPipelineRunResponseSchema,
  conductorCreatePipelineRequestSchema,
  conductorCreatePipelineResponseSchema,
  conductorCreatePipelineRunResponseSchema,
  conductorDeletePipelineResponseSchema,
  conductorGetPipelineResponseSchema,
  conductorListPipelineRunsResponseSchema,
  conductorListRunEventsResponseSchema,
  conductorListPipelinesResponseSchema,
  conductorPipelineRunDetailSchema,
  conductorRetryPipelineRunJobResponseSchema,
  conductorTriggerPipelineRunJobResponseSchema,
  conductorUpdatePipelineRequestSchema,
  conductorUpdatePipelineResponseSchema,
  type ConductorCreatePipelineRequest,
  type ConductorPipelineRunDetail,
  type ConductorRunEvent,
  type ConductorCreatePipelineResponse,
  type ConductorDeletePipelineResponse,
  type ConductorPipelineRun,
  type ConductorGetPipelineResponse,
  type ConductorRetryPipelineRunJobResponse,
  type ConductorUpdatePipelineRequest,
  type ConductorUpdatePipelineResponse,
  type ConductorPipeline,
} from '@spec-axis/contracts/conductor';
import { z } from 'zod';

function conductorBaseUrl() {
  const baseUrl = process.env.CONDUCTOR_BASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('CONDUCTOR_BASE_URL is not configured');
  }
  return baseUrl;
}

function conductorHeaders() {
  const token = process.env.CONDUCTOR_TOKEN;
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Conductor-Token': token } : {}),
  };
}

async function fetchConductor<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${conductorBaseUrl()}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Conductor request failed: ${res.status} ${text}`);
  }
  const text = await res.text().catch(() => '');
  const json = text ? (JSON.parse(text) as unknown) : null;
  return schema.parse(json);
}

export async function listPipelines(orgId: string, projectId?: string | null): Promise<ConductorPipeline[]> {
  const params = new URLSearchParams({ orgId });
  if (projectId) {
    params.set('projectId', projectId);
  }
  return fetchConductor(
    `/v1/pipelines?${params.toString()}`,
    { headers: conductorHeaders(), method: 'GET' },
    conductorListPipelinesResponseSchema
  );
}

export async function createPipeline(
  payload: ConductorCreatePipelineRequest
): Promise<ConductorCreatePipelineResponse> {
  const validated = conductorCreatePipelineRequestSchema.parse(payload);
  return fetchConductor(
    '/v1/pipelines',
    { method: 'POST', headers: conductorHeaders(), body: JSON.stringify(validated) },
    conductorCreatePipelineResponseSchema
  );
}

export async function getPipeline(id: string): Promise<ConductorGetPipelineResponse> {
  return fetchConductor(
    `/v1/pipelines/${id}`,
    { method: 'GET', headers: conductorHeaders() },
    conductorGetPipelineResponseSchema
  );
}

export async function updatePipeline(
  id: string,
  payload: ConductorUpdatePipelineRequest
): Promise<ConductorUpdatePipelineResponse> {
  const validated = conductorUpdatePipelineRequestSchema.parse(payload);
  return fetchConductor(
    `/v1/pipelines/${id}`,
    { method: 'PUT', headers: conductorHeaders(), body: JSON.stringify(validated) },
    conductorUpdatePipelineResponseSchema
  );
}

export async function deletePipeline(id: string): Promise<ConductorDeletePipelineResponse> {
  return fetchConductor(
    `/v1/pipelines/${id}`,
    { method: 'DELETE', headers: conductorHeaders() },
    conductorDeletePipelineResponseSchema
  );
}

export async function listPipelineRuns(pipelineId: string, limit = 20): Promise<ConductorPipelineRun[]> {
  return fetchConductor(
    `/v1/pipelines/${pipelineId}/runs?limit=${limit}`,
    { method: 'GET', headers: conductorHeaders() },
    conductorListPipelineRunsResponseSchema
  );
}

export async function createPipelineRun(pipelineId: string, payload: unknown): Promise<ConductorPipelineRun> {
  return fetchConductor(
    `/v1/pipelines/${pipelineId}/runs`,
    { method: 'POST', headers: conductorHeaders(), body: JSON.stringify(payload) },
    conductorCreatePipelineRunResponseSchema
  );
}

export async function getPipelineRun(runId: string): Promise<ConductorPipelineRunDetail> {
  return fetchConductor(
    `/v1/pipeline-runs/${runId}`,
    { method: 'GET', headers: conductorHeaders() },
    conductorPipelineRunDetailSchema
  );
}

export async function getPipelineRunEvents(runId: string, after = 0, limit = 200): Promise<ConductorRunEvent[]> {
  return fetchConductor(
    `/v1/pipeline-runs/${runId}/events?after=${after}&limit=${limit}`,
    { method: 'GET', headers: conductorHeaders() },
    conductorListRunEventsResponseSchema
  );
}

export async function getPipelineStepLog(runId: string, stepId: string, offset = 0, limit = 200000) {
  const res = await fetch(`${conductorBaseUrl()}/v1/pipeline-runs/${runId}/logs/${stepId}?offset=${offset}&limit=${limit}`, {
    method: 'GET',
    headers: conductorHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Conductor get log failed: ${res.status} ${text}`);
  }
  const data = await res.text();
  const nextOffset = Number(res.headers.get('X-Log-Next-Offset') ?? 0);
  return { data, nextOffset };
}

export async function openPipelineStepLogStream(
  runId: string,
  stepId: string,
  signal?: AbortSignal,
  offset = 0,
  limit = 200000
): Promise<Response> {
  const init: RequestInit = {
    method: 'GET',
    headers: conductorHeaders(),
  };
  if (signal) {
    init.signal = signal;
  }
  const params = new URLSearchParams();
  if (offset > 0) {
    params.set('offset', String(offset));
  }
  if (limit > 0) {
    params.set('limit', String(limit));
  }
  const query = params.toString();
  const res = await fetch(
    `${conductorBaseUrl()}/v1/pipeline-runs/${runId}/logs/${stepId}/stream${query ? `?${query}` : ''}`,
    init
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Conductor log stream failed: ${res.status} ${text}`);
  }
  return res;
}

export async function cancelPipelineRun(runId: string) {
  return fetchConductor(
    `/v1/pipeline-runs/${runId}/cancel`,
    { method: 'POST', headers: conductorHeaders() },
    conductorCancelPipelineRunResponseSchema
  );
}

export async function triggerPipelineRunJob(runId: string, jobKey: string) {
  return fetchConductor(
    `/v1/pipeline-runs/${runId}/jobs/${encodeURIComponent(jobKey)}/trigger`,
    { method: 'POST', headers: conductorHeaders() },
    conductorTriggerPipelineRunJobResponseSchema
  );
}

export async function retryPipelineRunJob(runId: string, jobKey: string): Promise<ConductorRetryPipelineRunJobResponse> {
  return fetchConductor(
    `/v1/pipeline-runs/${runId}/jobs/${encodeURIComponent(jobKey)}/retry`,
    { method: 'POST', headers: conductorHeaders() },
    conductorRetryPipelineRunJobResponseSchema
  );
}
