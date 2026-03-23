import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import type { NextRequest } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';

export const dynamic = 'force-dynamic';

interface RecentReportRow {
  id: string;
  commits: Array<{ sha: string }>;
  created_at: string | Date;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await request.json();
  const { projectId, commits, useCache = true } = body;
  const commitShas = Array.isArray(commits)
    ? commits.filter((sha): sha is string => typeof sha === 'string' && sha.trim().length > 0)
    : [];

  if (!projectId || commitShas.length === 0) {
    return NextResponse.json({ error: 'projectId and commits are required' }, { status: 400 });
  }

  await requireProjectAccess(projectId, user.id);

  // Check for recent identical analysis in persistent storage
  const recentReports = await query<RecentReportRow>(
    `select id, commits, created_at
     from analysis_reports
     where project_id = $1
     order by created_at desc
     limit 10`,
    [projectId]
  );

  if (recentReports && useCache) {
    const sortedRequestCommits = [...commitShas].sort();
    for (const report of recentReports) {
      const reportCommits = (report.commits ?? [])
        .map((commit) => commit.sha)
        .filter((sha): sha is string => typeof sha === 'string')
        .sort();

      if (JSON.stringify(reportCommits) === JSON.stringify(sortedRequestCommits)) {
        const age = Date.now() - new Date(report.created_at).getTime();
        if (age < CACHE_TTL) {
          return NextResponse.json({
            reportId: report.id,
            fromCache: true,
            message: 'Used a recent identical analysis result',
          });
        }
      }
    }
  }

  // Proceed with new analysis
  const analyzeRes = await fetch(`${request.url.replace('/analyze-cached', '/analyze')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, commits: commitShas }),
  });

  const result = await analyzeRes.json();

  return NextResponse.json(result);
}
