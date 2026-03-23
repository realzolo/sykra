import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { requireUser, unauthorized } from '@/services/auth';
import { requireReportAccess } from '@/services/orgs';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

// GET /api/reports/[id]/issues — list issues with DB UUIDs for comment threads
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id: reportId } = await params;
    await requireReportAccess(reportId, user.id);

    const issues = await query<{
      id: string;
      file: string;
      line: number | null;
      severity: string;
      category: string;
      rule: string;
      message: string;
      status: string;
      comment_count: string;
    }>(
      `select i.id, i.file, i.line, i.severity, i.category, i.rule, i.message, i.status,
              count(c.id)::text as comment_count
       from analysis_issues i
       left join analysis_issue_comments c on c.issue_id = i.id
       where i.report_id = $1
       group by i.id
       order by i.priority asc nulls last, i.severity desc, i.created_at asc`,
      [reportId]
    );

    return NextResponse.json({ issues });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
