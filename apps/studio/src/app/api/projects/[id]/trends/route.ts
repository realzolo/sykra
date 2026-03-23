import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { logger } from '@/services/logger';
import { projectIdSchema, dateRangeSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';
import { qualitySnapshotColumnList } from '@/services/sql/projections';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type QualitySnapshotRow = {
  id: string;
  project_id: string;
  report_id: string | null;
  snapshot_date: string;
  score: number | null;
  category_scores: unknown;
  total_issues: number | null;
  critical_issues: number | null;
  high_issues: number | null;
  medium_issues: number | null;
  low_issues: number | null;
  tech_debt_score: number | null;
  complexity_score: number | null;
  security_score: number | null;
  performance_score: number | null;
  created_at: string;
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
    const { searchParams } = new URL(request.url);

    // Validate project ID
    const projectId = projectIdSchema.parse(id);

    // Validate query params
    const validated = dateRangeSchema.parse({
      days: searchParams.get('days') ?? '30',
    });
    const { days } = validated;

    logger.setContext({ projectId });

    // Calculate date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Query trend data with retry
    const data = await withRetry(async () => {
      await requireProjectAccess(projectId, user.id);
      return query<QualitySnapshotRow>(
        `select ${qualitySnapshotColumnList}
         from analysis_quality_snapshots
         where project_id = $1 and snapshot_date >= $2
         order by snapshot_date asc`,
        [projectId, startDateStr]
      );
    });

    logger.info(`Trends fetched: ${projectId} (${data.length} snapshots)`);

    return NextResponse.json(data ?? []);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Trends request failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
