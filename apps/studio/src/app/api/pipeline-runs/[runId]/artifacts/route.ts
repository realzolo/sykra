import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { query } from '@/lib/db';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

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
    const artifacts = await query<{
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
       where a.run_id = $1 and r.org_id = $2
       order by a.created_at asc`,
      [runId, orgId]
    );

    return NextResponse.json({ artifacts });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
