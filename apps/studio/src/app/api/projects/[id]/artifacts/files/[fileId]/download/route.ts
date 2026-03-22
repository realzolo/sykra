import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, requireProjectAccess } from '@/services/orgs';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { getProjectArtifactFile } from '@/services/artifactRegistry';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

function conductorBaseUrl() {
  const baseUrl = process.env.CONDUCTOR_BASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('CONDUCTOR_BASE_URL is not configured');
  }
  return baseUrl;
}

function conductorToken() {
  const token = process.env.CONDUCTOR_TOKEN?.trim();
  if (!token) {
    throw new Error('CONDUCTOR_TOKEN is not configured');
  }
  return token;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id, fileId } = await params;
    const project = await requireProjectAccess(id, user.id);
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (project.org_id !== orgId) return unauthorized();

    const file = await getProjectArtifactFile(id, orgId, fileId);
    if (!file) {
      return NextResponse.json({ error: 'Artifact file not found' }, { status: 404 });
    }

    const upstream = await fetch(
      `${conductorBaseUrl()}/v1/artifact-files/${encodeURIComponent(fileId)}/content`,
      {
        method: 'GET',
        headers: {
          'X-Conductor-Token': conductorToken(),
        },
      }
    );

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      return NextResponse.json(
        { error: text || `Conductor download failed: ${upstream.status}` },
        { status: upstream.status || 502 }
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/octet-stream');
    headers.set(
      'Content-Disposition',
      upstream.headers.get('Content-Disposition') || `attachment; filename="${file.file_name}"`
    );
    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
