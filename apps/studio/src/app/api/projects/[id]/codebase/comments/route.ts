import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import { exec, execTx, query, withTransaction } from '@/lib/db';
import { codebaseService } from '@/services/CodebaseService';
import {
  computeThreadProjection,
  type ThreadAnchorSnapshot,
  type ThreadProjectionStatus,
} from '@/services/codebaseProjection';
import { logger } from '@/services/logger';
import { projectIdSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';
import {
  aliasedColumnList,
  codebaseCommentColumns,
  codebaseCommentColumnList,
  codebaseThreadColumnList,
} from '@/services/sql/projections';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);
const PROJECTION_ALGORITHM_VERSION = 'projection-v1';
const codebaseCommentSelectList = aliasedColumnList(codebaseCommentColumns, 'c');

const createCommentSchema = z.object({
  thread_id: z.string().uuid().optional(),
  ref: z.string().min(1).optional(),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/i, 'commit is required').optional(),
  path: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  line_end: z.number().int().positive().optional(),
  selection_text: z.string().max(2000).optional(),
  assignees: z.array(z.string().uuid()).max(20).optional(),
  body: z.string().min(1).max(5000),
}).refine((data) => (
  Boolean(data.thread_id) ||
  Boolean(data.ref && data.commit && data.path && data.line)
), {
  message: 'thread_id or complete location is required',
  path: ['thread_id'],
}).refine((data) => (
  data.line_end == null ||
  data.line == null ||
  data.line_end >= data.line
), {
  message: 'line_end must be >= line',
  path: ['line_end'],
});

const patchThreadSchema = z.object({
  thread_id: z.string().uuid(),
  status: z.enum(['open', 'resolved']),
});

type ThreadAnchorRow = {
  id: string;
  status: 'open' | 'resolved';
  line: number;
  line_end: number | null;
  ref: string;
  commit_sha: string;
  path: string;
  resolved_by: string | null;
  resolved_at: string | null;
  anchor_commit_sha: string | null;
  anchor_path: string | null;
  anchor_line_start: number | null;
  anchor_line_end: number | null;
  anchor_selection_text: string | null;
  anchor_context_before: string | null;
  anchor_context_after: string | null;
  anchor_blob_sha: string | null;
};

type ThreadProjectionRow = {
  thread_id: string;
  projected_path: string | null;
  projected_line_start: number | null;
  projected_line_end: number | null;
  status: ThreadProjectionStatus;
  confidence: number | null;
  reason_code: string;
};

type ThreadStatus = 'open' | 'resolved';

type CodebaseCommentRow = {
  id: string;
  thread_id: string;
  org_id: string;
  project_id: string;
  repo: string;
  ref: string;
  commit_sha: string;
  path: string;
  line: number;
  line_end: number | null;
  selection_text: string | null;
  author_id: string | null;
  author_email: string | null;
  body: string;
  created_at: string;
};

type CodebaseThreadRow = {
  id: string;
  org_id: string;
  project_id: string;
  repo: string;
  ref: string;
  commit_sha: string;
  path: string;
  line: number;
  line_end: number | null;
  status: ThreadStatus;
  author_id: string | null;
  author_email: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type CommentAssignee = {
  user_id: string;
  email: string | null;
};

type OrgMemberRow = {
  user_id: string;
};

type AuthUserEmailRow = {
  id: string;
  email: string | null;
};

type CodebaseCommentListRow = CodebaseCommentRow & {
  thread_status: ThreadStatus;
  thread_line: number | null;
  thread_line_end: number | null;
  resolved_by: string | null;
  resolved_at: string | null;
  projection_status: ThreadProjectionStatus;
  projection_confidence: number | null;
  projection_reason_code: string;
  projection_target_commit: string;
  anchor_commit_sha: string | null;
  anchor_path: string | null;
  assignees: CommentAssignee[];
};

type CodebaseCommentCreateResponseRow = CodebaseCommentRow & {
  thread_status: ThreadStatus;
  thread_line: number | null;
  thread_line_end: number | null;
  resolved_by: string | null;
  resolved_at: string | null;
  assignees: CommentAssignee[];
};

type ThreadLocation = Pick<
  CodebaseThreadRow,
  'id' | 'org_id' | 'project_id' | 'repo' | 'ref' | 'commit_sha' | 'path' | 'line' | 'line_end'
>;

// List comments for a file (optionally filter by line)
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

    const requestedRefRaw = request.nextUrl.searchParams.get('ref') || project.default_branch;
    const requestedRef = requestedRefRaw?.trim() || undefined;
    const requestedCommit = request.nextUrl.searchParams.get('commit');
    const path = request.nextUrl.searchParams.get('path') || '';
    const lineParam = request.nextUrl.searchParams.get('line');
    const parsedLine = lineParam ? Number(lineParam) : Number.NaN;
    const line = Number.isFinite(parsedLine)
      ? Math.max(1, Math.trunc(parsedLine))
      : null;

    if (!path) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }
    if (requestedCommit && !/^[0-9a-f]{7,40}$/i.test(requestedCommit)) {
      return NextResponse.json({ error: 'Invalid commit' }, { status: 400 });
    }

    const targetCommit = requestedCommit || (
      await codebaseService.resolveRevision({
        orgId: project.org_id,
        projectId,
        repo: project.repo,
        ...(requestedRef ? { ref: requestedRef } : {}),
      })
    ).commit;

    const comments = await withRetry(async () => {
      const threads = await query<ThreadAnchorRow>(
        `select t.id,
                t.status,
                t.line,
                t.line_end,
                t.ref,
                t.commit_sha,
                t.path,
                t.resolved_by,
                t.resolved_at,
                a.anchor_commit_sha,
                a.anchor_path,
                a.anchor_line_start,
                a.anchor_line_end,
                a.anchor_selection_text,
                a.anchor_context_before,
                a.anchor_context_after,
                a.anchor_blob_sha
         from codebase_comment_threads t
         left join codebase_thread_anchors a on a.thread_id = t.id
         where t.project_id = $1
           and t.org_id = $2
           and t.repo = $3`,
        [projectId, project.org_id, project.repo]
      );

      if (threads.length === 0) {
        return [];
      }

      const projections = await ensureThreadProjections({
        projectId,
        projectOrgId: project.org_id,
        projectRepo: project.repo,
        targetCommit,
        threads,
      });

      const visibleThreadIds = threads
        .map((thread) => {
          const projection = projections.get(thread.id);
          if (!projection) return null;
          if (projection.projected_path !== path) return null;
          if (projection.status !== 'exact' && projection.status !== 'shifted') return null;
          if (line != null) {
            const start = projection.projected_line_start;
            const end = projection.projected_line_end;
            if (start == null || end == null) return null;
            if (line < start || line > end) return null;
          }
          return thread.id;
        })
        .filter((id): id is string => Boolean(id));

      if (visibleThreadIds.length === 0) {
        return [];
      }

      return query<CodebaseCommentListRow>(
        `select ${codebaseCommentSelectList},
                t.id as thread_id,
                t.status as thread_status,
                p.projected_line_start as thread_line,
                p.projected_line_end as thread_line_end,
                t.resolved_by,
                t.resolved_at,
                p.status as projection_status,
                p.confidence as projection_confidence,
                p.reason_code as projection_reason_code,
                p.target_commit_sha as projection_target_commit,
                ta.anchor_commit_sha,
                ta.anchor_path,
                coalesce(ca_agg.assignees, '[]'::jsonb) as assignees
         from codebase_comments c
         join codebase_comment_threads t on t.id = c.thread_id
         join codebase_thread_projections p on p.thread_id = t.id and p.target_commit_sha = $5
         left join codebase_thread_anchors ta on ta.thread_id = t.id
         left join lateral (
           select jsonb_agg(
                    jsonb_build_object('user_id', a.user_id, 'email', a.email)
                    order by a.created_at
                  ) as assignees
           from codebase_comment_assignees a
           where a.comment_id = c.id
         ) ca_agg on true
         where t.project_id = $1
           and t.org_id = $2
           and t.repo = $3
           and t.id = any($4::uuid[])
         order by p.projected_line_start asc, c.created_at asc`,
        [projectId, project.org_id, project.repo, visibleThreadIds, targetCommit]
      );
    });

    return NextResponse.json(comments);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get codebase comments failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

// Create a new comment
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
    const validated = createCommentSchema.parse(body);

    logger.setContext({ projectId });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    if (!project.org_id || !project.repo) {
      return NextResponse.json({ error: 'Project is not configured' }, { status: 400 });
    }

    const anchorSnapshot = validated.thread_id
      ? null
      : await buildThreadAnchorSnapshot({
          orgId: project.org_id,
          projectId,
          repo: project.repo,
          input: validated,
        });

    const comment = await withRetry(async () => {
      const selectionText = validated.selection_text?.trim();

      return withTransaction(async (client) => {
        const thread = await resolveOrCreateThread({
          client,
          projectId,
          projectOrgId: project.org_id,
          projectRepo: project.repo,
          userId: user.id,
          userEmail: user.email ?? 'unknown',
          input: validated,
          anchorSnapshot,
        });

        const insertResult = await client.query<CodebaseCommentRow>(
          `insert into codebase_comments
            (thread_id, org_id, project_id, repo, ref, commit_sha, path, line, line_end, selection_text, author_id, author_email, body, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
           returning ${codebaseCommentColumnList}`,
          [
            thread.id,
            thread.org_id,
            thread.project_id,
            thread.repo,
            thread.ref,
            thread.commit_sha,
            thread.path,
            thread.line,
            thread.line_end,
            selectionText || null,
            user.id,
            user.email ?? 'unknown',
            validated.body,
          ]
        );

        const inserted = insertResult.rows[0];
        if (!inserted) {
          throw new Error('Failed to create comment');
        }

        const assigneeIds = Array.from(new Set(validated.assignees ?? []));
        if (assigneeIds.length > 0) {
          const memberResult = await client.query<OrgMemberRow>(
            `select user_id
             from org_members
             where org_id = $1 and user_id = any($2::uuid[])`,
            [project.org_id, assigneeIds]
          );
          const allowedIds = memberResult.rows.map((row) => row.user_id);

          if (allowedIds.length > 0) {
            const userRows = await client.query<AuthUserEmailRow>(
              `select id, email
               from auth_users
               where id = any($1::uuid[])`,
              [allowedIds]
            );
            const emailMap = new Map(
              userRows.rows.map((row) => [row.id, row.email ?? null])
            );

            const values: unknown[] = [];
            const placeholders = allowedIds.map((id, idx) => {
              const base = idx * 3;
              values.push(inserted.id, id, emailMap.get(id) ?? null);
              return `($${base + 1}, $${base + 2}, $${base + 3})`;
            });

            await execTx(client,
              `insert into codebase_comment_assignees (comment_id, user_id, email)
               values ${placeholders.join(', ')}
               on conflict (comment_id, user_id) do nothing`,
              values
            );
          }
        }

        const enrichedResult = await client.query<CodebaseCommentCreateResponseRow>(
          `select ${codebaseCommentSelectList},
                 t.id as thread_id,
                 t.status as thread_status,
                 t.line as thread_line,
                 t.line_end as thread_line_end,
                 t.resolved_by,
                 t.resolved_at,
                 coalesce(
                   jsonb_agg(
                     jsonb_build_object('user_id', a.user_id, 'email', a.email)
                     order by a.created_at
                   ) filter (where a.id is not null),
                   '[]'::jsonb
                 ) as assignees
           from codebase_comments c
           join codebase_comment_threads t on t.id = c.thread_id
           left join codebase_comment_assignees a on a.comment_id = c.id
           where c.id = $1
           group by c.id, t.id`,
          [inserted.id]
        );

        return enrichedResult.rows[0] ?? inserted;
      });
    });

    return NextResponse.json(comment);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Create codebase comment failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

// Update thread status (open/resolved)
export async function PATCH(
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
    const validated = patchThreadSchema.parse(body);

    logger.setContext({ projectId, threadId: validated.thread_id });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    if (!project.org_id || !project.repo) {
      return NextResponse.json({ error: 'Project is not configured' }, { status: 400 });
    }

    const updated = await withRetry(async () => {
      const values: unknown[] = [validated.thread_id, projectId, project.org_id, project.repo];
      const status = validated.status;
      values.push(status);
      const statusIndex = values.length;

      let resolvedFieldsSql = `resolved_by = null, resolved_at = null`;
      if (status === 'resolved') {
        values.push(user.id);
        const resolvedByIndex = values.length;
        resolvedFieldsSql = `resolved_by = $${resolvedByIndex}, resolved_at = now()`;
      }

      const result = await query<CodebaseThreadRow>(
        `update codebase_comment_threads
         set status = $${statusIndex},
             ${resolvedFieldsSql},
             updated_at = now()
         where id = $1
           and project_id = $2
           and org_id = $3
           and repo = $4
         returning ${codebaseThreadColumnList}`,
        values
      );
      return result[0] ?? null;
    });

    if (!updated) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Update codebase comment thread failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

async function ensureThreadProjections(args: {
  projectId: string;
  projectOrgId: string;
  projectRepo: string;
  targetCommit: string;
  threads: ThreadAnchorRow[];
}) {
  const {
    projectId,
    projectOrgId,
    projectRepo,
    targetCommit,
    threads,
  } = args;

  const threadIds = threads.map((thread) => thread.id);
  const existing = await query<ThreadProjectionRow>(
    `select thread_id,
            projected_path,
            projected_line_start,
            projected_line_end,
            status,
            confidence,
            reason_code
     from codebase_thread_projections
     where project_id = $1
       and org_id = $2
       and repo = $3
       and target_commit_sha = $4
       and thread_id = any($5::uuid[])`,
    [projectId, projectOrgId, projectRepo, targetCommit, threadIds]
  );
  const map = new Map(existing.map((row) => [row.thread_id, row]));

  const missing = threads.filter((thread) => !map.has(thread.id));
  if (missing.length === 0) return map;

  await exec(
    `insert into codebase_thread_projection_jobs
      (project_id, org_id, repo, target_commit_sha, status, attempt, created_at, updated_at)
     values ($1,$2,$3,$4,'running',1,now(),now())
     on conflict (project_id, target_commit_sha)
     do update set status = 'running',
                   updated_at = now(),
                   attempt = codebase_thread_projection_jobs.attempt + 1,
                   error_message = null`,
    [projectId, projectOrgId, projectRepo, targetCommit]
  );

  let hasErrors = false;
  let firstErrorMessage: string | null = null;
  for (const thread of missing) {
    const anchor: ThreadAnchorSnapshot = {
      anchorCommitSha: thread.anchor_commit_sha ?? thread.commit_sha,
      anchorPath: thread.anchor_path ?? thread.path,
      anchorLineStart: thread.anchor_line_start ?? thread.line,
      anchorLineEnd: thread.anchor_line_end ?? thread.line_end ?? thread.line,
      anchorSelectionText: thread.anchor_selection_text,
      anchorContextBefore: thread.anchor_context_before,
      anchorContextAfter: thread.anchor_context_after,
      anchorBlobSha: thread.anchor_blob_sha,
    };

    let projection: {
      projectedPath: string | null;
      projectedLineStart: number | null;
      projectedLineEnd: number | null;
      status: ThreadProjectionStatus;
      confidence: number;
      reasonCode: string;
    };

    try {
      projection = await computeThreadProjection({
        orgId: projectOrgId,
        projectId,
        repo: projectRepo,
        targetCommitSha: targetCommit,
        anchor,
      });
    } catch (error) {
      hasErrors = true;
      if (!firstErrorMessage) {
        firstErrorMessage = error instanceof Error ? error.message : 'projection_failed';
      }
      logger.warn('Compute thread projection failed', error instanceof Error ? error : undefined);
      projection = thread.commit_sha === targetCommit
        ? {
            projectedPath: thread.path,
            projectedLineStart: thread.line,
            projectedLineEnd: thread.line_end ?? thread.line,
            status: 'exact',
            confidence: 1,
            reasonCode: 'same_commit',
          }
        : {
            projectedPath: null,
            projectedLineStart: null,
            projectedLineEnd: null,
            status: 'outdated',
            confidence: 0,
            reasonCode: 'no_match',
          };
    }

    await exec(
      `insert into codebase_thread_projections
        (thread_id, org_id, project_id, repo, target_commit_sha, projected_path, projected_line_start, projected_line_end, status, confidence, reason_code, algorithm_version, computed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       on conflict (thread_id, target_commit_sha)
       do update set projected_path = excluded.projected_path,
                     projected_line_start = excluded.projected_line_start,
                     projected_line_end = excluded.projected_line_end,
                     status = excluded.status,
                     confidence = excluded.confidence,
                     reason_code = excluded.reason_code,
                     algorithm_version = excluded.algorithm_version,
                     computed_at = excluded.computed_at`,
      [
        thread.id,
        projectOrgId,
        projectId,
        projectRepo,
        targetCommit,
        projection.projectedPath,
        projection.projectedLineStart,
        projection.projectedLineEnd,
        projection.status,
        projection.confidence,
        projection.reasonCode,
        PROJECTION_ALGORITHM_VERSION,
      ]
    );

    map.set(thread.id, {
      thread_id: thread.id,
      projected_path: projection.projectedPath,
      projected_line_start: projection.projectedLineStart,
      projected_line_end: projection.projectedLineEnd,
      status: projection.status,
      confidence: projection.confidence,
      reason_code: projection.reasonCode,
    });
  }

  await exec(
    `update codebase_thread_projection_jobs
     set status = $3,
         updated_at = now(),
         error_message = $4
     where project_id = $1
       and target_commit_sha = $2`,
    [
      projectId,
      targetCommit,
      hasErrors ? 'failed' : 'completed',
      hasErrors ? firstErrorMessage : null,
    ]
  );

  return map;
}

async function buildThreadAnchorSnapshot(args: {
  orgId: string;
  projectId: string;
  repo: string;
  input: z.infer<typeof createCommentSchema>;
}): Promise<ThreadAnchorSnapshot | null> {
  const { orgId, projectId, repo, input } = args;
  if (!input.commit || !input.path || !input.line) return null;

  const lineStart = input.line;
  const lineEnd = input.line_end && input.line_end >= input.line
    ? input.line_end
    : input.line;
  const selectionText = input.selection_text?.trim() || null;

  let contextBefore: string | null = null;
  let contextAfter: string | null = null;
  let blobSha: string | null = null;

  try {
    const file = await codebaseService.readFile(
      {
        orgId,
        projectId,
        repo,
        ref: input.commit,
      },
      input.path,
      { syncPolicy: 'never' }
    );
    if (!file.isBinary && !file.truncated) {
      const lines = file.content.split('\n');
      const beforeStart = Math.max(0, lineStart - 1 - 2);
      const before = lines.slice(beforeStart, lineStart - 1);
      const after = lines.slice(lineEnd, lineEnd + 2);
      contextBefore = before.length > 0 ? before.join('\n') : null;
      contextAfter = after.length > 0 ? after.join('\n') : null;
    }
  } catch (error) {
    logger.warn('Build thread anchor context failed', error instanceof Error ? error : undefined);
  }

  try {
    blobSha = await codebaseService.getBlobSha(
      {
        orgId,
        projectId,
        repo,
        ref: input.commit,
      },
      input.path,
      { syncPolicy: 'never' }
    );
  } catch (error) {
    logger.warn('Resolve thread anchor blob failed', error instanceof Error ? error : undefined);
  }

  return {
    anchorCommitSha: input.commit,
    anchorPath: input.path,
    anchorLineStart: lineStart,
    anchorLineEnd: lineEnd,
    anchorSelectionText: selectionText,
    anchorContextBefore: contextBefore,
    anchorContextAfter: contextAfter,
    anchorBlobSha: blobSha,
  };
}

async function resolveOrCreateThread(args: {
  client: PoolClient;
  projectId: string;
  projectOrgId: string;
  projectRepo: string;
  userId: string;
  userEmail: string;
  input: z.infer<typeof createCommentSchema>;
  anchorSnapshot: ThreadAnchorSnapshot | null;
}): Promise<ThreadLocation> {
  const {
    client,
    projectId,
    projectOrgId,
    projectRepo,
    userId,
    userEmail,
    input,
    anchorSnapshot,
  } = args;

  if (input.thread_id) {
    const existingResult = await client.query<CodebaseThreadRow>(
      `select ${codebaseThreadColumnList}
       from codebase_comment_threads
       where id = $1
         and project_id = $2
         and org_id = $3
         and repo = $4`,
      [input.thread_id, projectId, projectOrgId, projectRepo]
    );

    const existing = existingResult.rows[0];
    if (!existing) {
      throw new Error('Thread not found');
    }

    if (existing.status === 'resolved') {
      await execTx(client,
        `update codebase_comment_threads
         set status = 'open',
             resolved_by = null,
             resolved_at = null,
             updated_at = now()
         where id = $1`,
        [existing.id]
      );
      existing.status = 'open';
      existing.resolved_by = null;
      existing.resolved_at = null;
    }

    return existing;
  }

  const threadId = randomUUID();
  const line = input.line;
  const ref = input.ref;
  const commit = input.commit;
  const path = input.path;

  if (!line || !ref || !commit || !path) {
    throw new Error('thread location is required');
  }

  const lineEnd = input.line_end && input.line_end >= line
    ? input.line_end
    : null;

  const createdResult = await client.query<CodebaseThreadRow>(
    `insert into codebase_comment_threads
      (id, org_id, project_id, repo, ref, commit_sha, path, line, line_end, status, author_id, author_email, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11,now(),now())
     returning ${codebaseThreadColumnList}`,
    [
      threadId,
      projectOrgId,
      projectId,
      projectRepo,
      ref,
      commit,
      path,
      line,
      lineEnd,
      userId,
      userEmail,
    ]
  );

  const created = createdResult.rows[0];
  if (!created) {
    throw new Error('Failed to create thread');
  }

  const anchor = anchorSnapshot ?? {
    anchorCommitSha: commit,
    anchorPath: path,
    anchorLineStart: line,
    anchorLineEnd: lineEnd ?? line,
    anchorSelectionText: input.selection_text?.trim() || null,
    anchorContextBefore: null,
    anchorContextAfter: null,
    anchorBlobSha: null,
  };

  await execTx(client,
    `insert into codebase_thread_anchors
      (thread_id, org_id, project_id, repo, anchor_commit_sha, anchor_path, anchor_line_start, anchor_line_end, anchor_selection_text, anchor_context_before, anchor_context_after, anchor_blob_sha, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     on conflict (thread_id) do nothing`,
    [
      threadId,
      projectOrgId,
      projectId,
      projectRepo,
      anchor.anchorCommitSha,
      anchor.anchorPath,
      anchor.anchorLineStart,
      anchor.anchorLineEnd,
      anchor.anchorSelectionText,
      anchor.anchorContextBefore,
      anchor.anchorContextAfter,
      anchor.anchorBlobSha,
    ]
  );

  return created;
}
