import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { query } from '@/lib/db';
import { logger } from '@/services/logger';
import { projectIdSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

const reviewSchema = z.object({
  commit: z.string().regex(/^[0-9a-f]{7,40}$/i, 'commit is required'),
  path: z.string().min(1),
  line: z.number().int().min(0).optional(),
});

type CommitReviewItemRow = {
  id: string;
  path: string;
  line: number;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const projectId = projectIdSchema.parse(id);

    logger.setContext({ projectId });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    if (!project.org_id || !project.repo) {
      return NextResponse.json({ error: 'Project is not configured' }, { status: 400 });
    }

    const commit = request.nextUrl.searchParams.get('commit');
    const path = request.nextUrl.searchParams.get('path');
    const lineParam = request.nextUrl.searchParams.get('line');
    const line = lineParam ? Number(lineParam) : undefined;

    if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit)) {
      return NextResponse.json({ error: 'commit is required' }, { status: 400 });
    }

    const paramsList: unknown[] = [projectId, project.org_id, commit, user.id];
    let sql = `
      select id, path, line
      from commit_review_items
      where project_id = $1
        and org_id = $2
        and commit_sha = $3
        and reviewer_id = $4
    `;

    if (path) {
      paramsList.push(path);
      sql += ` and path = $${paramsList.length}`;
    }
    if (Number.isFinite(line)) {
      paramsList.push(line);
      sql += ` and line = $${paramsList.length}`;
    }

    sql += ' order by created_at asc';

    const rows = await withRetry(() => query<CommitReviewItemRow>(sql, paramsList));
    return NextResponse.json(rows);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get commit review items failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const projectId = projectIdSchema.parse(id);
    const body = await request.json();
    const validated = reviewSchema.parse(body);

    logger.setContext({ projectId });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    if (!project.org_id || !project.repo) {
      return NextResponse.json({ error: 'Project is not configured' }, { status: 400 });
    }

    const lineValue = validated.line ?? 0;

    const rows = await withRetry(() => query<CommitReviewItemRow>(
      `insert into commit_review_items
        (org_id, project_id, commit_sha, path, line, reviewer_id, created_at)
       values ($1,$2,$3,$4,$5,$6,now())
       on conflict (project_id, commit_sha, path, line, reviewer_id) do nothing
       returning id, path, line`,
      [project.org_id, projectId, validated.commit, validated.path, lineValue, user.id]
    ));

    const inserted = rows[0] ?? { path: validated.path, line: lineValue };
    return NextResponse.json(inserted);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Create commit review item failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const projectId = projectIdSchema.parse(id);
    const body = await request.json();
    const validated = reviewSchema.parse(body);

    logger.setContext({ projectId });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    if (!project.org_id || !project.repo) {
      return NextResponse.json({ error: 'Project is not configured' }, { status: 400 });
    }

    const lineValue = validated.line ?? 0;

    const rows = await withRetry(() => query<CommitReviewItemRow>(
      `delete from commit_review_items
       where project_id = $1
         and org_id = $2
         and commit_sha = $3
         and path = $4
         and line = $5
         and reviewer_id = $6
       returning id, path, line`,
      [projectId, project.org_id, validated.commit, validated.path, lineValue, user.id]
    ));

    return NextResponse.json(rows[0] ?? { ok: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Delete commit review item failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
