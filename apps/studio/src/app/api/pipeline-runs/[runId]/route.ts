import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { getPipelineRun } from '@/services/conductorGateway';
import { queryOne } from '@/lib/db';

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
    if (!run.triggered_by) {
      return NextResponse.json(data);
    }
    const actor = await queryOne<{ email: string | null; display_name: string | null }>(
      `select email, display_name
         from auth_users
        where id = $1`,
      [run.triggered_by]
    );
    return NextResponse.json({
      ...data,
      run: {
        ...run,
        triggered_by_email: actor?.email ?? null,
        triggered_by_name: actor?.display_name ?? null,
      },
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
