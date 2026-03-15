import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getProjectById, getRulesBySetId, createReport } from '@/services/db';
import { shouldUseIncrementalAnalysis } from '@/services/incremental';
import { buildReportCommits } from '@/services/analyzeTask';
import { createClient } from '@/lib/supabase/server';
import { taskQueue } from '@/services/taskQueue';
import { logger } from '@/services/logger';
import { analyzeRequestSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireProjectAccess } from '@/services/orgs';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.analyze);

export async function POST(request: NextRequest) {
  // Rate limit
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) {
    return unauthorized();
  }

  try {
    const body = await request.json();
    const validated = analyzeRequestSchema.parse(body);
    const { projectId, commits: selectedHashes, forceFullAnalysis } = validated;

    logger.setContext({ projectId });

    // Validate project exists
    await withRetry(() => requireProjectAccess(projectId, user.id));
    const project = await withRetry(() => getProjectById(projectId));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!project.org_id) {
      return NextResponse.json({ error: 'Project is not associated with an organization' }, { status: 400 });
    }

    if (!project.ruleset_id) {
      return NextResponse.json({ error: 'Project has no rule set configured' }, { status: 400 });
    }

    // Get rule set
    const rules = await withRetry(() => getRulesBySetId(project.ruleset_id));
    if (!rules.length) {
      return NextResponse.json({ error: 'No enabled rules in rule set' }, { status: 400 });
    }

    // Resolve commits by SHA
    const selectedCommits = await withRetry(() =>
      buildReportCommits(project.repo, selectedHashes, projectId)
    );

    if (selectedCommits.length === 0) {
      return NextResponse.json({ error: 'Specified commits not found' }, { status: 400 });
    }

    // Check whether to use incremental analysis
    const supabase = await createClient();
    const { data: recentReports } = await supabase
      .from('reports')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(1);

    const useIncremental =
      !forceFullAnalysis &&
      shouldUseIncrementalAnalysis(project, selectedHashes, recentReports || []);

    // Create report
    const report = await withRetry(() =>
      createReport({
        project_id: projectId,
        org_id: project.org_id,
        ruleset_snapshot: rules,
        commits: selectedCommits,
      })
    );

    logger.info(`Report created: ${report.id}`);

    // Enqueue analysis task (high priority)
    await taskQueue.enqueue(
      'analyze',
      projectId,
      {
        reportId: report.id,
        repo: project.repo,
        hashes: selectedHashes,
        rules,
        previousReport: useIncremental ? recentReports?.[0] : null,
      } as Record<string, unknown>,
      8, // High priority
      report.id
    );

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'analyze',
      entityType: 'project',
      entityId: projectId,
      changes: { reportId: report.id, commits: selectedHashes.length },
      userId: user.id,
      ...clientInfo,
    });

    return NextResponse.json({
      reportId: report.id,
      incrementalAnalysis: useIncremental,
      status: 'queued',
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Analysis request failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
