import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { getPipelineRun } from '@/services/conductorGateway';
import { queryOne } from '@/lib/db';
import { asJsonObject } from '@/lib/json';
import type { ConductorPipelineRunDetail } from '@sykra/contracts/conductor';

type HydratedPipelineRunDetail = Omit<ConductorPipelineRunDetail, 'run'> & {
  run: ConductorPipelineRunDetail['run'] & {
    triggered_by_email?: string | null;
    triggered_by_name?: string | null;
    failure_signature?: {
      code: string;
      title: string;
      summary: string;
      severity: string;
      scope: string;
      message: string;
      job_id: string | null;
      job_key: string | null;
      step_id: string | null;
      step_key: string | null;
      detected_at: string | null;
      runbook: {
        id: string;
        title: string;
        doc_path: string;
        actions: string[];
      } | null;
    } | null;
  };
};

async function hydrateRunActor(detail: ConductorPipelineRunDetail): Promise<HydratedPipelineRunDetail> {
  const run = detail.run;
  const [actor, failureSignatureRow] = await Promise.all([
    run.triggered_by
      ? queryOne<{ email: string | null; display_name: string | null }>(
          `select email, display_name
             from auth_users
            where id = $1`,
          [run.triggered_by]
        )
      : Promise.resolve(null),
    queryOne<{ payload: unknown }>(
      `select e.payload
         from pipeline_run_events e
        where e.run_id = $1
          and e.type = 'run.failure_signature'
        order by e.seq asc
        limit 1`,
      [run.id]
    ),
  ]);

  const payload = asJsonObject(failureSignatureRow?.payload);
  const signatureObject = asJsonObject(payload?.signature);
  const runbookObject = asJsonObject(payload?.runbook);
  const actionsRaw = runbookObject?.actions;
  const actions = Array.isArray(actionsRaw)
    ? actionsRaw
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    : [];
  const failureSignature =
    signatureObject && typeof signatureObject.code === 'string' && signatureObject.code.trim().length > 0
      ? {
          code: signatureObject.code.trim(),
          title:
            typeof signatureObject.title === 'string' && signatureObject.title.trim().length > 0
              ? signatureObject.title.trim()
              : 'Unknown failure',
          summary:
            typeof signatureObject.summary === 'string' && signatureObject.summary.trim().length > 0
              ? signatureObject.summary.trim()
              : 'No summary available.',
          severity:
            typeof signatureObject.severity === 'string' && signatureObject.severity.trim().length > 0
              ? signatureObject.severity.trim()
              : 'medium',
          scope: typeof payload?.scope === 'string' && payload.scope.trim().length > 0 ? payload.scope.trim() : 'run',
          message: typeof payload?.message === 'string' ? payload.message : '',
          job_id: typeof payload?.jobId === 'string' && payload.jobId.trim().length > 0 ? payload.jobId.trim() : null,
          job_key: typeof payload?.jobKey === 'string' && payload.jobKey.trim().length > 0 ? payload.jobKey.trim() : null,
          step_id:
            typeof payload?.stepId === 'string' && payload.stepId.trim().length > 0 ? payload.stepId.trim() : null,
          step_key:
            typeof payload?.stepKey === 'string' && payload.stepKey.trim().length > 0 ? payload.stepKey.trim() : null,
          detected_at:
            typeof payload?.detectedAt === 'string' && payload.detectedAt.trim().length > 0
              ? payload.detectedAt.trim()
              : null,
          runbook:
            runbookObject &&
            typeof runbookObject.id === 'string' &&
            runbookObject.id.trim().length > 0 &&
            typeof runbookObject.title === 'string' &&
            runbookObject.title.trim().length > 0 &&
            typeof runbookObject.docPath === 'string' &&
            runbookObject.docPath.trim().length > 0
              ? {
                  id: runbookObject.id.trim(),
                  title: runbookObject.title.trim(),
                  doc_path: runbookObject.docPath.trim(),
                  actions,
                }
              : null,
        }
      : null;

  if (!actor && !failureSignature) {
    return detail as HydratedPipelineRunDetail;
  }

  return {
    ...detail,
    run: {
      ...run,
      triggered_by_email: actor?.email ?? null,
      triggered_by_name: actor?.display_name ?? null,
      failure_signature: failureSignature,
    },
  };
}

export { hydrateRunActor };


export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { runId } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();
    const data = await getPipelineRun(runId);
    const run = data.run;
    if (run.org_id && run.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(await hydrateRunActor(data));
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
