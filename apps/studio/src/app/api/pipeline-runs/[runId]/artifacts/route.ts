import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { query } from '@/lib/db';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { listRunArtifactReleases } from '@/services/artifactRegistry';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { runId } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    // Verify the run belongs to this org
    const [artifacts, releases] = await Promise.all([
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
      [runId, orgId]
      ),
      listRunArtifactReleases(runId, orgId),
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

    return NextResponse.json({ artifacts, releases });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
