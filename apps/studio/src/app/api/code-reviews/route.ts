import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { logger } from '@/services/logger';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';
import { buildReportCommits } from '@/services/analyzeTask';
import { createCodeReviewSchema } from '@/services/validation';
import { createCodeReviewRun, getDefaultCodeReviewProfileVersion, listCodeReviewRuns } from '@/services/codeReviews';
import { enqueueCodeReview } from '@/services/schedulerClient';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const projectId = request.nextUrl.searchParams.get('projectId')?.trim() ?? '';
    const limitRaw = request.nextUrl.searchParams.get('limit')?.trim() ?? '50';
    const parsedLimit = Number.parseInt(limitRaw, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 50;
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const project = await requireProjectAccess(projectId, user.id);
    const runs = await listCodeReviewRuns(project.org_id, projectId, limit);
    return NextResponse.json(runs);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('List code reviews failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const body = await request.json();
    const validated = createCodeReviewSchema.parse(body);
    const project = await requireProjectAccess(validated.projectId, user.id);
    const profile = await getDefaultCodeReviewProfileVersion(project.org_id);

    const commits = validated.scope.commits.length > 0
      ? await buildReportCommits(project.repo, validated.scope.commits, validated.projectId)
      : [];
    const headRef =
      validated.scope.headRef ??
      (validated.scope.commits.length > 0 ? validated.scope.commits[validated.scope.commits.length - 1] : project.default_branch ?? 'HEAD');
    const baseRef =
      validated.scope.baseRef ??
      (validated.scope.commits.length > 1 ? validated.scope.commits[0] : undefined);

    const run = await createCodeReviewRun({
      projectId: validated.projectId,
      orgId: project.org_id,
      profileId: profile.profile_id,
      profileVersionId: profile.profile_version_id,
      scopeMode: validated.scope.mode,
      baseRef: baseRef ?? null,
      headRef: headRef ?? null,
      commits: commits.map((commit) => String((commit as Record<string, unknown>).sha ?? '')).filter(Boolean),
      createdBy: user.id,
    });

    const scheduler = await enqueueCodeReview({
      projectId: validated.projectId,
      runId: String((run as Record<string, unknown>).id),
      repo: project.repo,
      profileId: profile.profile_id,
      profileVersionId: profile.profile_version_id,
      scopeMode: validated.scope.mode,
      ...(baseRef ? { baseRef } : {}),
      ...(headRef ? { headRef } : {}),
      hashes: commits.map((commit) => String((commit as Record<string, unknown>).sha ?? '')).filter(Boolean),
      policy: profile.config,
    });

    return NextResponse.json(
      {
        runId: (run as Record<string, unknown>).id,
        taskId: scheduler.taskId,
        status: 'queued',
      },
      { status: 202 }
    );
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Create code review failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
