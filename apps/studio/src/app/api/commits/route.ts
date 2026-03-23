import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRepoCommits } from '@/services/github';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';

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
  const branch = searchParams.get('branch') ?? 'main';
  const perPage = Number(searchParams.get('per_page') ?? '30');
  const page = Number(searchParams.get('page') ?? '1');
  const projectId = searchParams.get('project_id');

  if (!repo) {
    return NextResponse.json({ error: 'repo is required' }, { status: 400 });
  }

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  }

  await requireProjectAccess(projectId, user.id);
  const commits = await getRepoCommits(repo, branch, perPage, page, projectId);
  return NextResponse.json(commits);
}
