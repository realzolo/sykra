import { createCodeReviewSSEResponse, watchCodeReviewRun } from '@/services/codeReviewSse';
import { queryOne } from '@/lib/db';
import { requireUser, unauthorized } from '@/services/auth';
import { requireOrgAccess } from '@/services/orgs';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { id: runId } = await params;
  const run = await queryOne<{ id: string; org_id: string }>(
    `select id, org_id
     from code_review_runs
     where id = $1`,
    [runId]
  );
  if (!run) {
    return new Response('Not Found', { status: 404 });
  }
  await requireOrgAccess(run.org_id, user.id);

  void watchCodeReviewRun(runId);
  return createCodeReviewSSEResponse(runId);
}
