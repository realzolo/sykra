import { getPipelineRun } from '@/services/conductorGateway';
import { hydrateRunActor } from '@/services/pipelineRunHydration';

export async function getPipelineRunDetailForOrg(input: { runId: string; orgId: string }) {
  const data = await getPipelineRun(input.runId);
  const run = data.run;
  if (run.org_id && run.org_id !== input.orgId) {
    throw new Error('Forbidden');
  }
  return hydrateRunActor(data);
}
