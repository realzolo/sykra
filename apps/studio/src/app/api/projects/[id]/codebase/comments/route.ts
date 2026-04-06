import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { execTx, query, withTransaction } from '@/lib/db';
import { codebaseService } from '@/services/CodebaseService';
import type { ThreadProjectionStatus } from '@/services/codebaseProjection';
import { logger } from '@/services/logger';
import { projectIdSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';
import {
  buildThreadAnchorSnapshot,
  ensureThreadProjections,
  resolveOrCreateThread,
  type ThreadAnchorRow,
} from '@/services/codebaseCommentThreads';
import {
  aliasedColumnList,
  codebaseCommentColumns,
  codebaseCommentColumnList,
  codebaseThreadColumnList,
} from '@/services/sql/projections';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);
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
