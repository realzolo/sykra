import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { codebaseService } from '@/services/CodebaseService';
import { logger } from '@/services/logger';
import {
  computeThreadProjection,
  type ThreadAnchorSnapshot,
  type ThreadProjectionStatus,
} from '@/services/codebaseProjection';
import { exec, execTx, query } from '@/lib/db';
import { codebaseThreadColumnList } from '@/services/sql/projections';

const PROJECTION_ALGORITHM_VERSION = 'projection-v1';

export type ThreadStatus = 'open' | 'resolved';

export type ThreadAnchorRow = {
  id: string;
  status: ThreadStatus;
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

export type ThreadLocation = Pick<
  CodebaseThreadRow,
  'id' | 'org_id' | 'project_id' | 'repo' | 'ref' | 'commit_sha' | 'path' | 'line' | 'line_end'
>;

export type CreateCommentLocationInput = {
  thread_id?: string | undefined;
  ref?: string | undefined;
  commit?: string | undefined;
  path?: string | undefined;
  line?: number | undefined;
  line_end?: number | undefined;
  selection_text?: string | undefined;
};

export async function ensureThreadProjections(args: {
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
      // Keep comments queryable even when projection computation fails:
      // same-commit threads can still be treated as exact, others degrade to outdated.
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

export async function buildThreadAnchorSnapshot(args: {
  orgId: string;
  projectId: string;
  repo: string;
  input: CreateCommentLocationInput;
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
      // Persist a small context window around the anchor so projection can
      // recover after surrounding edits.
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

export async function resolveOrCreateThread(args: {
  client: PoolClient;
  projectId: string;
  projectOrgId: string;
  projectRepo: string;
  userId: string;
  userEmail: string;
  input: CreateCommentLocationInput;
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
