import { query, queryOne } from '@/lib/db';
import { asJsonObject } from '@/lib/json';
import { issueArtifactDownloadToken } from '@/lib/artifactDownloadToken';
import { listRunArtifactReleases } from '@/services/artifactRegistry';

type QualityEvidenceSummary = {
  tests: {
    artifact_path: string | null;
    report_format: string | null;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration_seconds: number | null;
    timestamp: string | null;
  } | null;
  coverage: {
    artifact_path: string | null;
    report_format: string | null;
    lines_total: number | null;
    lines_covered: number | null;
    line_pct: number | null;
    branch_pct: number | null;
    function_pct: number | null;
    statement_pct: number | null;
    timestamp: string | null;
  } | null;
};

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readInteger(value: unknown): number | null {
  const parsed = readNumber(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildQualityEvidence(rows: Array<{ type: string; payload: unknown }>): QualityEvidenceSummary {
  const summary: QualityEvidenceSummary = {
    tests: null,
    coverage: null,
  };

  for (const row of rows) {
    const payload = asJsonObject(row.payload);
    if (!payload) continue;

    if (row.type === 'quality.test_report_ingested') {
      summary.tests = {
        artifact_path: readString(payload.artifactPath) ?? readString(payload.artifact_path),
        report_format: readString(payload.reportFormat) ?? readString(payload.report_format),
        total: readInteger(payload.total) ?? 0,
        passed: readInteger(payload.passed) ?? 0,
        failed: readInteger(payload.failed) ?? 0,
        skipped: readInteger(payload.skipped) ?? 0,
        duration_seconds: readNumber(payload.durationSeconds) ?? readNumber(payload.duration_seconds),
        timestamp: readString(payload.timestamp),
      };
      continue;
    }

    if (row.type === 'quality.coverage_ingested') {
      summary.coverage = {
        artifact_path: readString(payload.artifactPath) ?? readString(payload.artifact_path),
        report_format: readString(payload.reportFormat) ?? readString(payload.report_format),
        lines_total: readInteger(payload.linesTotal) ?? readInteger(payload.lines_total),
        lines_covered: readInteger(payload.linesCovered) ?? readInteger(payload.lines_covered),
        line_pct: readNumber(payload.linePct) ?? readNumber(payload.line_pct),
        branch_pct: readNumber(payload.branchPct) ?? readNumber(payload.branch_pct),
        function_pct: readNumber(payload.functionPct) ?? readNumber(payload.function_pct),
        statement_pct: readNumber(payload.statementPct) ?? readNumber(payload.statement_pct),
        timestamp: readString(payload.timestamp),
      };
    }
  }

  return summary;
}

export async function listPipelineRunArtifactsForOrg(input: { runId: string; orgId: string }) {
  const [artifacts, releases, qualityRows] = await Promise.all([
    query<{
      id: string;
      job_id: string | null;
      step_id: string | null;
      path: string;
      storage_path: string;
      size_bytes: string;
      sha256: string | null;
      created_at: string;
      expires_at: string | null;
    }>(
      `select a.id, a.job_id, a.step_id, a.path, a.storage_path,
            a.size_bytes::text, a.sha256, a.created_at, a.expires_at
       from pipeline_artifacts a
       join pipeline_runs r on r.id = a.run_id
      where a.run_id = $1
        and r.org_id = $2
        and (a.expires_at is null or a.expires_at > now())
      order by a.created_at asc`,
      [input.runId, input.orgId]
    ),
    listRunArtifactReleases(input.runId, input.orgId),
    query<{ type: string; payload: unknown }>(
      `select x.type, x.payload
         from (
           select distinct on (e.type)
                  e.type,
                  e.payload
             from pipeline_run_events e
             join pipeline_runs r on r.id = e.run_id
            where e.run_id = $1
              and r.org_id = $2
              and e.type in ('quality.test_report_ingested', 'quality.coverage_ingested')
            order by e.type, e.seq desc
         ) x`,
      [input.runId, input.orgId]
    ),
  ]);

  const releasePublisherIds = Array.from(
    new Set(
      releases
        .map((release) => release.published_by)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    )
  );
  if (releasePublisherIds.length > 0) {
    const publishers = await query<{ id: string; email: string | null; display_name: string | null }>(
      `select id, email, display_name
         from auth_users
        where id = any($1::uuid[])`,
      [releasePublisherIds]
    );
    const publisherById = new Map(publishers.map((publisher) => [publisher.id, publisher]));
    for (const release of releases) {
      const publisher = release.published_by ? publisherById.get(release.published_by) : undefined;
      release.published_by_name = publisher?.display_name ?? null;
      release.published_by_email = publisher?.email ?? null;
    }
  }

  return {
    artifacts,
    releases,
    qualityEvidence: buildQualityEvidence(qualityRows),
  };
}

export async function issuePipelineRunArtifactDownloadTokenForOrg(input: {
  runId: string;
  artifactId: string;
  orgId: string;
  userId: string;
}) {
  const artifact = await queryOne<{ id: string }>(
    `select a.id
       from pipeline_artifacts a
       join pipeline_runs r on r.id = a.run_id
      where a.run_id = $1 and a.id = $2 and r.org_id = $3`,
    [input.runId, input.artifactId, input.orgId]
  );
  if (!artifact) {
    throw new Error('Artifact not found');
  }

  const expiresInSeconds = 120;
  const token = issueArtifactDownloadToken({
    orgId: input.orgId,
    userId: input.userId,
    runId: input.runId,
    artifactId: input.artifactId,
    expiresInSeconds,
  });

  return {
    url: `/api/pipeline-runs/${input.runId}/artifacts/${input.artifactId}/download?token=${encodeURIComponent(token)}`,
    expiresInSeconds,
  };
}
