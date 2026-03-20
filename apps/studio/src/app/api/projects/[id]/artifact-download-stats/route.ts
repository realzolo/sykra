import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { query, queryOne } from '@/lib/db';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

type StatsRow = {
  total_count: string;
  success_count: string;
  failed_count: string;
  success_rate: string;
  p95_duration_ms: string;
};

type DailyRow = {
  day: string;
  total_count: string;
  success_count: string;
};

type ErrorRow = {
  category: string;
  count: string;
};

type FailureRow = {
  created_at: string;
  artifact_path: string | null;
  error_category: string | null;
  error_message: string | null;
  duration_ms: string;
};

function parseWindowDays(value: string | null): number {
  if (!value) return DEFAULT_DAYS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_DAYS;
  return Math.min(parsed, MAX_DAYS);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id: projectId } = await params;
    const project = await requireProjectAccess(projectId, user.id);

    const days = parseWindowDays(request.nextUrl.searchParams.get('days'));
    const stats = await queryOne<StatsRow>(
      `select
         count(*)::text as total_count,
         count(*) filter (where status = 'success')::text as success_count,
         count(*) filter (where status = 'failed')::text as failed_count,
         coalesce(round((count(*) filter (where status = 'success')) * 100.0 / nullif(count(*), 0), 2), 0)::text as success_rate,
         coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::int::text as p95_duration_ms
      from pipeline_artifact_download_events
       where org_id = $1
         and project_id = $2
         and created_at >= now() - make_interval(days => $3)`,
      [project.org_id, projectId, days]
    );

    const trends = await query<DailyRow>(
      `select
         date_trunc('day', created_at)::date::text as day,
         count(*)::text as total_count,
         count(*) filter (where status = 'success')::text as success_count
       from pipeline_artifact_download_events
       where org_id = $1
         and project_id = $2
         and created_at >= now() - make_interval(days => $3)
       group by 1
       order by 1 asc`,
      [project.org_id, projectId, days]
    );

    const topErrors = await query<ErrorRow>(
      `select
         coalesce(error_category, 'unknown') as category,
         count(*)::text as count
       from pipeline_artifact_download_events
       where org_id = $1
         and project_id = $2
         and status = 'failed'
         and created_at >= now() - make_interval(days => $3)
       group by 1
       order by count(*) desc
       limit 5`,
      [project.org_id, projectId, days]
    );

    const recentFailures = await query<FailureRow>(
      `select created_at, artifact_path, error_category, error_message, duration_ms::text
       from pipeline_artifact_download_events
       where org_id = $1
         and project_id = $2
         and status = 'failed'
         and created_at >= now() - make_interval(days => $3)
       order by created_at desc
       limit 10`,
      [project.org_id, projectId, days]
    );

    return NextResponse.json({
      days,
      summary: {
        totalDownloads: Number.parseInt(stats?.total_count ?? '0', 10),
        successfulDownloads: Number.parseInt(stats?.success_count ?? '0', 10),
        failedDownloads: Number.parseInt(stats?.failed_count ?? '0', 10),
        successRate: Number.parseFloat(stats?.success_rate ?? '0'),
        p95DurationMs: Number.parseInt(stats?.p95_duration_ms ?? '0', 10),
      },
      trends: trends.map((item) => ({
        day: item.day,
        totalDownloads: Number.parseInt(item.total_count, 10),
        successfulDownloads: Number.parseInt(item.success_count, 10),
      })),
      topErrors: topErrors.map((item) => ({
        category: item.category,
        count: Number.parseInt(item.count, 10),
      })),
      recentFailures: recentFailures.map((item) => ({
        createdAt: item.created_at,
        artifactPath: item.artifact_path,
        errorCategory: item.error_category,
        errorMessage: item.error_message,
        durationMs: Number.parseInt(item.duration_ms, 10),
      })),
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
