import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { logger } from '@/services/logger';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { z } from 'zod';
import { requireUser, unauthorized } from '@/services/auth';
import { requireReportAccess } from '@/services/orgs';
import {
  aliasedColumnList,
  analysisIssueColumns,
  analysisIssueColumnList,
  analysisIssueCommentColumns,
  analysisIssueCommentColumnList,
  jsonObjectProjection,
} from '@/services/sql/projections';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

const updateIssueSchema = z.object({
  status: z.enum(['open', 'fixed', 'ignored', 'false_positive', 'planned']).optional(),
  notes: z.string().optional(),
  assigned_to: z.string().optional(),
});

const commentSchema = z.object({
  author: z.string().min(1),
  content: z.string().min(1),
});

const issueSelectColumnList = aliasedColumnList(analysisIssueColumns, 'i');
const issueCommentJsonProjection = jsonObjectProjection(analysisIssueCommentColumns, 'c');

type IssueStatus = 'open' | 'fixed' | 'ignored' | 'false_positive' | 'planned';

type AnalysisIssueRow = {
  id: string;
  report_id: string;
  file: string;
  line: number | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  rule: string;
  message: string;
  suggestion: string | null;
  code_snippet: string | null;
  fix_patch: string | null;
  status: IssueStatus;
  priority: number | null;
  impact_scope: string | null;
  estimated_effort: string | null;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type AnalysisIssueCommentRow = {
  id: string;
  issue_id: string;
  author_id: string | null;
  author: string | null;
  content: string;
  created_at: string;
};

type IssueDetailResponse = AnalysisIssueRow & {
  issue_comments: AnalysisIssueCommentRow[];
};

// Get issue details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; issueId: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id: reportId, issueId } = await params;

    logger.setContext({ issueId });

    const data = await withRetry(async () => {
      await requireReportAccess(reportId, user.id);
      const row = await queryOne<IssueDetailResponse>(
        `select ${issueSelectColumnList},
                coalesce(
                  jsonb_agg(${issueCommentJsonProjection} order by c.created_at) filter (where c.id is not null),
                  '[]'::jsonb
                ) as issue_comments
         from analysis_issues i
         left join analysis_issue_comments c on c.issue_id = i.id
         where i.id = $1 and i.report_id = $2
         group by i.id`,
        [issueId, reportId]
      );

      if (!row) {
        throw new Error('Issue not found');
      }

      return row;
    });

    logger.info(`Issue fetched: ${issueId}`);
    return NextResponse.json(data);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get issue failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

// Update issue status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; issueId: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id: reportId, issueId } = await params;
    const body = await request.json();
    const validated = updateIssueSchema.parse(body);
    const { status, notes, assigned_to } = validated;

    logger.setContext({ issueId });

    const data = await withRetry(async () => {
      await requireReportAccess(reportId, user.id);

      const updateData: Partial<Pick<AnalysisIssueRow, 'updated_at' | 'status' | 'notes' | 'assigned_to'>> = {
        updated_at: new Date().toISOString(),
      };
      if (status) updateData.status = status;
      if (notes !== undefined) updateData.notes = notes;
      if (assigned_to !== undefined) updateData.assigned_to = assigned_to;

      const fields = Object.keys(updateData) as Array<keyof typeof updateData>;
      const assignments = fields.map((field, idx) => `${field} = $${idx + 3}`);
      const values = fields.map((field) => updateData[field]);

      const updated = await queryOne<AnalysisIssueRow>(
        `update analysis_issues
         set ${assignments.join(', ')}
         where id = $1 and report_id = $2
         returning ${analysisIssueColumnList}`,
        [issueId, reportId, ...values]
      );

      if (!updated) {
        throw new Error('Issue not found');
      }

      return updated;
    });

    // Audit log
    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'update',
      entityType: 'issue',
      entityId: issueId,
      changes: { status, notes, assigned_to },
      ...clientInfo,
    });

    logger.info(`Issue updated: ${issueId}`);
    return NextResponse.json(data);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Update issue failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

// Add comment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; issueId: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id: reportId, issueId } = await params;
    const body = await request.json();
    const validated = commentSchema.parse(body);
    const { author, content } = validated;

    logger.setContext({ issueId });

    const data = await withRetry(async () => {
      await requireReportAccess(reportId, user.id);
      const created = await queryOne<AnalysisIssueCommentRow>(
        `insert into analysis_issue_comments
          (issue_id, author_id, author, content, created_at)
         values ($1,$2,$3,$4,now())
         returning ${analysisIssueCommentColumnList}`,
        [issueId, user.id, author, content]
      );

      if (!created) {
        throw new Error('Failed to create comment');
      }

      return created;
    });

    // Audit log
    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'create',
      entityType: 'issue',
      entityId: issueId,
      changes: { author, content },
      ...clientInfo,
    });

    logger.info(`Comment added to issue: ${issueId}`);
    return NextResponse.json(data);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Add comment failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
