import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { queryOne } from '@/lib/db';
import { issueArtifactDownloadToken } from '@/lib/artifactDownloadToken';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; artifactId: string }> }
) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { runId, artifactId } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    const artifact = await queryOne<{ id: string }>(
      `select a.id
       from pipeline_artifacts a
       join pipeline_runs r on r.id = a.run_id
       where a.run_id = $1 and a.id = $2 and r.org_id = $3`,
      [runId, artifactId, orgId]
    );
    if (!artifact) {
      return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
    }

    const token = issueArtifactDownloadToken({
      orgId,
      userId: user.id,
      runId,
      artifactId,
      expiresInSeconds: 120,
    });

    return NextResponse.json({
      url: `/api/pipeline-runs/${runId}/artifacts/${artifactId}/download?token=${encodeURIComponent(token)}`,
      expiresInSeconds: 120,
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
