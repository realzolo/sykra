import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';
import { getCommitDiff, getCommitBySha } from '@/services/github';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sha: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  const { sha } = await params;
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get('repo');
  const projectId = searchParams.get('project_id');

  if (!repo) {
    return NextResponse.json({ error: 'repo is required' }, { status: 400 });
  }

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  }

  await requireProjectAccess(projectId, user.id);

  try {
    const [commit, diff] = await Promise.all([
      getCommitBySha(repo, sha, projectId),
      getCommitDiff(repo, sha, projectId),
    ]);
    return NextResponse.json({ commit, diff });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'diff_fetch_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
