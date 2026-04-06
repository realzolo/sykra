import { listPipelines } from '@/services/conductorGateway';
import { requireProjectAccess } from '@/services/orgs';
import {
  hydratePipelinesWithTelemetry,
  type HydratedPipelineSummary,
} from '@/services/pipelineListTelemetry';

export async function listPipelinesForOrg(input: {
  orgId: string;
  userId: string;
  projectId?: string;
}): Promise<HydratedPipelineSummary[]> {
  const { orgId, userId, projectId } = input;
  if (projectId) {
    await requireProjectAccess(projectId, userId);
  }

  const data = await listPipelines(orgId, projectId);
  const pipelines = projectId ? data.filter((item) => item.project_id === projectId) : data;
  if (pipelines.length === 0) {
    return [];
  }

  return hydratePipelinesWithTelemetry(orgId, pipelines);
}
