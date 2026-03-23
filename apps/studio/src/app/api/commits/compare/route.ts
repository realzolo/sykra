import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';
import { getCompareDiff } from '@/services/github';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const repo = searchParams.get('repo');
  const base = searchParams.get('base');
  const head = searchParams.get('head');
  const projectId = searchParams.get('project_id');

  if (!repo) {
    return NextResponse.json({ error: 'repo is required' }, { status: 400 });
  }
  if (!base || !head) {
    return NextResponse.json({ error: 'base and head are required' }, { status: 400 });
  }
  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  }

  await requireProjectAccess(projectId, user.id);

  try {
    const diff = await getCompareDiff(repo, base, head, projectId);
    return NextResponse.json({ diff });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'diff_fetch_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
