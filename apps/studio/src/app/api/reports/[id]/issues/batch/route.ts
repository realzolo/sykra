import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exec } from '@/lib/db';
import { logger } from '@/services/logger';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { z } from 'zod';
import { requireUser, unauthorized } from '@/services/auth';
import { requireReportAccess } from '@/services/orgs';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

const batchOperationSchema = z.object({
  action: z.enum(['update_status', 'assign', 'delete']),
  issueIds: z.array(z.string()).min(1),
  status: z.enum(['open', 'fixed', 'ignored', 'false_positive', 'planned']).optional(),
  assigned_to: z.string().optional(),
});

type BatchIssueAction = z.infer<typeof batchOperationSchema>['action'];

type BatchIssueOperationResult = {
  action: BatchIssueAction;
  affected: number;
};

// Batch update issues
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
    const { id: reportId } = await params;
    const body = await request.json();
    const validated = batchOperationSchema.parse(body);
    const { action, issueIds, status, assigned_to } = validated;

    logger.setContext({ reportId, action, count: issueIds.length });

    const result = await withRetry<BatchIssueOperationResult>(async () => {
      await requireReportAccess(reportId, user.id);

      switch (action) {
        case 'update_status': {
          if (!status) {
            throw new Error('Status is required');
          }

          await exec(
            `update analysis_issues
             set status = $1, updated_at = now()
             where report_id = $2 and id = any($3::uuid[])`,
            [status, reportId, issueIds]
          );

          return { action, affected: issueIds.length };
        }

        case 'assign': {
          if (!assigned_to) {
            throw new Error('Assignee is required');
          }

          await exec(
            `update analysis_issues
             set assigned_to = $1, updated_at = now()
             where report_id = $2 and id = any($3::uuid[])`,
            [assigned_to, reportId, issueIds]
          );

          return { action, affected: issueIds.length };
        }

        case 'delete': {
          await exec(
            `delete from analysis_issues
             where report_id = $1 and id = any($2::uuid[])`,
            [reportId, issueIds]
          );

          return { action, affected: issueIds.length };
        }
      }
    });

    // Audit log
    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'update',
      entityType: 'report',
      entityId: reportId,
      changes: { batchAction: action, count: issueIds.length },
      ...clientInfo,
    });

    logger.info(`Batch operation completed: ${action} (${issueIds.length} issues)`);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Batch operation failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
