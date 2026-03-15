type AnalyzePayload = {
  projectId: string;
  reportId: string;
  repo: string;
  hashes: string[];
  rules: Array<{ category: string; name: string; prompt: string; severity: string }>;
  previousReport: Record<string, unknown> | null;
  useIncremental: boolean;
};

type RunnerResponse = {
  taskId: string;
};

type RunnerPipelineResponse<T> = T;

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

export async function listPipelines(orgId: string, projectId: string) {
  const res = await fetch(`${runnerBaseUrl()}/v1/pipelines?orgId=${orgId}&projectId=${projectId}`, {
    headers: runnerHeaders(),
    method: 'GET',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner list pipelines failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RunnerPipelineResponse<unknown>;
}

export async function createPipeline(payload: unknown) {
  const res = await fetch(`${runnerBaseUrl()}/v1/pipelines`, {
    method: 'POST',
    headers: runnerHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner create pipeline failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RunnerPipelineResponse<unknown>;
}

export async function getPipeline(id: string) {
  const res = await fetch(`${runnerBaseUrl()}/v1/pipelines/${id}`, {
    method: 'GET',
    headers: runnerHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner get pipeline failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RunnerPipelineResponse<unknown>;
}

export async function updatePipeline(id: string, payload: unknown) {
  const res = await fetch(`${runnerBaseUrl()}/v1/pipelines/${id}`, {
    method: 'PUT',
    headers: runnerHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner update pipeline failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RunnerPipelineResponse<unknown>;
}

export async function listPipelineRuns(pipelineId: string, limit = 20) {
  const res = await fetch(`${runnerBaseUrl()}/v1/pipelines/${pipelineId}/runs?limit=${limit}`, {
    method: 'GET',
    headers: runnerHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner list runs failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RunnerPipelineResponse<unknown>;
}

export async function createPipelineRun(pipelineId: string, payload: unknown) {
  const res = await fetch(`${runnerBaseUrl()}/v1/pipelines/${pipelineId}/runs`, {
    method: 'POST',
    headers: runnerHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner create run failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RunnerPipelineResponse<unknown>;
}

export async function getPipelineRun(runId: string) {
  const res = await fetch(`${runnerBaseUrl()}/v1/pipeline-runs/${runId}`, {
    method: 'GET',
    headers: runnerHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner get run failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RunnerPipelineResponse<unknown>;
}

export async function getPipelineRunEvents(runId: string, after = 0, limit = 200) {
  const res = await fetch(`${runnerBaseUrl()}/v1/pipeline-runs/${runId}/events?after=${after}&limit=${limit}`, {
    method: 'GET',
    headers: runnerHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runner get events failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RunnerPipelineResponse<unknown>;
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
