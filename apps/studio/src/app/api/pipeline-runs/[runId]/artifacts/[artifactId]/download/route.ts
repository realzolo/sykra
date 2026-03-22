import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { exec, queryOne } from '@/lib/db';
import { verifyArtifactDownloadToken } from '@/lib/artifactDownloadToken';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

type DownloadEventStatus = 'success' | 'failed';

type DownloadEventInput = {
  orgId: string;
  projectId: string | null;
  runId: string;
  artifactId: string;
  artifactPath: string | null;
  status: DownloadEventStatus;
  errorCategory: string | null;
  errorMessage: string | null;
  durationMs: number;
  requesterUserId: string;
  requesterIp: string | null;
  requesterUserAgent: string | null;
};

function classifyDownloadError(statusCode: number): string {
  if (statusCode === 401 || statusCode === 403) return 'upstream_auth';
  if (statusCode === 404) return 'artifact_not_found';
  if (statusCode >= 400 && statusCode < 500) return 'upstream_client';
  if (statusCode >= 500) return 'upstream_server';
  return 'upstream_unknown';
}

function extractRequesterIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp || null;
}

function trimErrorMessage(input: string | null): string | null {
  if (!input) return null;
  if (input.length <= 1000) return input;
  return `${input.slice(0, 997)}...`;
}

async function insertDownloadEvent(input: DownloadEventInput): Promise<void> {
  // Download audit is non-critical telemetry and must never block serving the artifact stream.
  await exec(
    `insert into pipeline_artifact_download_events
      (org_id, project_id, run_id, artifact_id, artifact_path, status, error_category, error_message, duration_ms, requester_user_id, requester_ip, requester_user_agent, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
    [
      input.orgId,
      input.projectId,
      input.runId,
      input.artifactId,
      input.artifactPath,
      input.status,
      input.errorCategory,
      trimErrorMessage(input.errorMessage),
      input.durationMs,
      input.requesterUserId,
      input.requesterIp,
      input.requesterUserAgent,
    ]
  ).catch(() => undefined);
}

function conductorBaseUrl(): string {
  const baseUrl = process.env.CONDUCTOR_BASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('CONDUCTOR_BASE_URL is not configured');
  }
  return baseUrl;
}

function conductorToken(): string {
  const token = process.env.CONDUCTOR_TOKEN?.trim();
  if (!token) {
    throw new Error('CONDUCTOR_TOKEN is not configured');
  }
  return token;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; artifactId: string }> }
) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const startedAt = Date.now();
  let eventContext:
    | {
        orgId: string;
        userId: string;
        runId: string;
        artifactId: string;
        projectId: string | null;
        artifactPath: string | null;
      }
    | undefined;
  try {
    const { runId, artifactId } = await params;
    const token = request.nextUrl.searchParams.get('token') ?? '';
    const payload = verifyArtifactDownloadToken(token);
    if (payload.runId !== runId || payload.artifactId !== artifactId) {
      return NextResponse.json({ error: 'Invalid download token target' }, { status: 400 });
    }

    const artifact = await queryOne<{ id: string; path: string; project_id: string | null }>(
      `select a.id, a.path, r.project_id::text
       from pipeline_artifacts a
       join pipeline_runs r on r.id = a.run_id
       where a.run_id = $1
         and a.id = $2
         and r.org_id = $3
         and (a.expires_at is null or a.expires_at > now())`,
      [runId, artifactId, payload.orgId]
    );
    if (!artifact) {
      return NextResponse.json({ error: 'Artifact not found or expired' }, { status: 404 });
    }
    eventContext = {
      orgId: payload.orgId,
      userId: payload.userId,
      runId,
      artifactId,
      projectId: artifact.project_id,
      artifactPath: artifact.path,
    };

    const upstream = await fetch(
      `${conductorBaseUrl()}/v1/pipeline-runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
      {
        method: 'GET',
        headers: {
          'X-Conductor-Token': conductorToken(),
        },
      }
    );
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      await insertDownloadEvent({
        orgId: eventContext.orgId,
        projectId: eventContext.projectId,
        runId: eventContext.runId,
        artifactId: eventContext.artifactId,
        artifactPath: eventContext.artifactPath,
        status: 'failed',
        errorCategory: classifyDownloadError(upstream.status),
        errorMessage: text || `Conductor download failed: ${upstream.status}`,
        durationMs: Date.now() - startedAt,
        requesterUserId: eventContext.userId,
        requesterIp: extractRequesterIp(request),
        requesterUserAgent: request.headers.get('user-agent'),
      });
      return NextResponse.json(
        { error: text || `Conductor download failed: ${upstream.status}` },
        { status: upstream.status >= 400 ? upstream.status : 502 }
      );
    }

    await insertDownloadEvent({
      orgId: eventContext.orgId,
      projectId: eventContext.projectId,
      runId: eventContext.runId,
      artifactId: eventContext.artifactId,
      artifactPath: eventContext.artifactPath,
      status: 'success',
      errorCategory: null,
      errorMessage: null,
      durationMs: Date.now() - startedAt,
      requesterUserId: eventContext.userId,
      requesterIp: extractRequesterIp(request),
      requesterUserAgent: request.headers.get('user-agent'),
    });

    const headers = new Headers();
    headers.set('Cache-Control', 'no-store');
    const contentType = upstream.headers.get('content-type');
    const contentDisposition = upstream.headers.get('content-disposition');
    const contentLength = upstream.headers.get('content-length');
    if (contentType) headers.set('Content-Type', contentType);
    if (contentDisposition) headers.set('Content-Disposition', contentDisposition);
    if (contentLength) headers.set('Content-Length', contentLength);

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    if (eventContext) {
      await insertDownloadEvent({
        orgId: eventContext.orgId,
        projectId: eventContext.projectId,
        runId: eventContext.runId,
        artifactId: eventContext.artifactId,
        artifactPath: eventContext.artifactPath,
        status: 'failed',
        errorCategory: 'internal_error',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - startedAt,
        requesterUserId: eventContext.userId,
        requesterIp: extractRequesterIp(request),
        requesterUserAgent: request.headers.get('user-agent'),
      });
    }
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
