import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getReports } from '@/services/db';
import { logger } from '@/services/logger';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { isRunnerAuthorized } from '@/services/runnerAuth';
import { projectIdSchema } from '@/services/validation';
import { query } from '@/lib/db';
import { failTimedOutReports } from '@/services/reportTimeout';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    // Runner: review gate fetches latest report score without a user session.
    if (isRunnerAuthorized(request)) {
      const rawProjectId = request.nextUrl.searchParams.get('projectId');
      if (!rawProjectId) {
        return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
      }
      const projectId = projectIdSchema.parse(rawProjectId);
      const limitRaw = request.nextUrl.searchParams.get('limit') ?? '';
      const parsedLimit = Number(limitRaw);
      const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, Math.trunc(parsedLimit))) : 20;

      const rows = await withRetry(() =>
        query<Record<string, unknown>>(
          `select id, status, score, created_at
           from analysis_reports
           where project_id = $1
             and status = 'done'
             and score is not null
           order by created_at desc
           limit $2`,
          [projectId, limit]
        )
      );
      return NextResponse.json(rows);
    }

    const user = await requireUser();
    if (!user) return unauthorized();

    await failTimedOutReports();

    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const data = await withRetry(() => getReports(orgId));
    logger.info(`Reports fetched: ${data.length} reports`);
    return NextResponse.json(data);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get reports failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
