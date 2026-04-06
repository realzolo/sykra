import type { NextRequest } from 'next/server';
import { getPipelineRun } from '@/services/conductorGateway';
import { hydrateRunActor } from '@/services/pipelineRunHydration';
import { createPipelineRunStreamResponse } from '@/services/pipelineRunStream';

export async function openPipelineRunStreamForOrg(input: {
  request: NextRequest;
  runId: string;
  orgId: string;
}) {
  const initialDetail = await hydrateRunActor(await getPipelineRun(input.runId));
  if (initialDetail.run.org_id && initialDetail.run.org_id !== input.orgId) {
    throw new Error('Forbidden');
  }
  return createPipelineRunStreamResponse(input.request, input.runId, initialDetail);
}
