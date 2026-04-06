import { query, queryOne } from '@/lib/db';
import { asJsonObject } from '@/lib/json';
import type { ConductorPipelineRunDetail } from '@sykra/contracts/conductor';

type HydratedFailureSignature = {
  code: string;
  title: string;
  summary: string;
  severity: string;
  fingerprint: string | null;
  occurrences_in_run: number;
  occurrences_7d: number;
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
};

export type HydratedPipelineRunDetail = Omit<ConductorPipelineRunDetail, 'run'> & {
  run: ConductorPipelineRunDetail['run'] & {
    triggered_by_email?: string | null;
    triggered_by_name?: string | null;
    failure_signature?: HydratedFailureSignature | null;
    failure_signatures?: HydratedFailureSignature[];
  };
};

function parseString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFailureSignature(payloadRaw: unknown, occurredAt: string | null): HydratedFailureSignature | null {
  const payload = asJsonObject(payloadRaw);
  const signatureObject = asJsonObject(payload?.signature);
  if (!signatureObject) {
    return null;
  }
  const code = parseString(signatureObject.code);
  if (!code) {
    return null;
  }

  const runbookObject = asJsonObject(payload?.runbook);
  const actionsRaw = runbookObject?.actions;
  const actions = Array.isArray(actionsRaw)
    ? actionsRaw
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    : [];

  const runbook =
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
      : null;

  return {
    code,
    title: parseString(signatureObject.title) ?? 'Unknown failure',
    summary: parseString(signatureObject.summary) ?? 'No summary available.',
    severity: parseString(signatureObject.severity) ?? 'medium',
    fingerprint: parseString(signatureObject.fingerprint),
    occurrences_in_run: 1,
    occurrences_7d: 1,
    scope: parseString(payload?.scope) ?? 'run',
    message: typeof payload?.message === 'string' ? payload.message : '',
    job_id: parseString(payload?.jobId),
    job_key: parseString(payload?.jobKey),
    step_id: parseString(payload?.stepId),
    step_key: parseString(payload?.stepKey),
    detected_at: parseString(payload?.detectedAt) ?? parseString(occurredAt),
    runbook,
  };
}

export async function hydrateRunActor(detail: ConductorPipelineRunDetail): Promise<HydratedPipelineRunDetail> {
  const run = detail.run;
  const [actor, failureSignatureRows] = await Promise.all([
    run.triggered_by
      ? queryOne<{ email: string | null; display_name: string | null }>(
          `select email, display_name
             from auth_users
            where id = $1`,
          [run.triggered_by]
        )
      : Promise.resolve(null),
    query<{ payload: unknown; occurred_at: string }>(
      `select e.payload, e.occurred_at::text as occurred_at
         from pipeline_run_events e
        where e.run_id = $1
          and e.type = 'run.failure_signature'
        order by e.seq asc
        limit 20`,
      [run.id]
    ),
  ]);

  const failureSignatures = failureSignatureRows
    .map((row) => parseFailureSignature(row.payload, row.occurred_at))
    .filter((item): item is HydratedFailureSignature => item !== null);
  const fingerprintCountsInRun = new Map<string, number>();
  for (const item of failureSignatures) {
    if (!item.fingerprint) {
      continue;
    }
    fingerprintCountsInRun.set(item.fingerprint, (fingerprintCountsInRun.get(item.fingerprint) ?? 0) + 1);
  }
  const fingerprints = Array.from(fingerprintCountsInRun.keys());
  const fingerprintCounts7d = new Map<string, number>();
  if (fingerprints.length > 0) {
    const rows = await query<{ fingerprint: string; total_7d: string }>(
      `select
         e.payload->'signature'->>'fingerprint' as fingerprint,
         count(*)::text as total_7d
       from pipeline_run_events e
       join pipeline_runs r on r.id = e.run_id
       where r.org_id = $1
         and r.pipeline_id = $2
         and e.type = 'run.failure_signature'
         and e.occurred_at >= now() - interval '7 days'
         and e.payload->'signature'->>'fingerprint' = any($3::text[])
       group by e.payload->'signature'->>'fingerprint'`,
      [run.org_id, run.pipeline_id, fingerprints]
    );
    for (const row of rows) {
      const parsed = Number.parseInt(row.total_7d, 10);
      fingerprintCounts7d.set(row.fingerprint, Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    }
  }

  const enrichedFailureSignatures = failureSignatures.map((item) => {
    if (!item.fingerprint) {
      return item;
    }
    const countInRun = fingerprintCountsInRun.get(item.fingerprint) ?? 1;
    const count7d = fingerprintCounts7d.get(item.fingerprint) ?? countInRun;
    return {
      ...item,
      occurrences_in_run: countInRun,
      occurrences_7d: count7d,
    };
  });
  const failureSignature = enrichedFailureSignatures[0] ?? null;

  if (!actor && enrichedFailureSignatures.length === 0) {
    return detail as HydratedPipelineRunDetail;
  }

  return {
    ...detail,
    run: {
      ...run,
      triggered_by_email: actor?.email ?? null,
      triggered_by_name: actor?.display_name ?? null,
      failure_signature: failureSignature,
      failure_signatures: enrichedFailureSignatures,
    },
  };
}
