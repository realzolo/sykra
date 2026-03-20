import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { logger } from '@/services/logger';
import { requireUser, unauthorized } from '@/services/auth';
import { requireOrgAccess } from '@/services/orgs';
import { getCodeReviewRunDetails } from '@/services/codeReviews';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const access = await queryOne<{ id: string; org_id: string }>(
      `select id, org_id
       from code_review_runs
       where id = $1`,
      [id]
    );
    if (!access) {
      return NextResponse.json({ error: 'Code review run not found' }, { status: 404 });
    }
    await requireOrgAccess(access.org_id, user.id);

    const run = await getCodeReviewRunDetails(id);
    return NextResponse.json(run);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get code review failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
