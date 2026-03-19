import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getRulesBySetId, createReport, updateReport } from '@/services/db';
import { shouldUseIncrementalAnalysis } from '@/services/incremental';
import { buildReportCommits } from '@/services/analyzeTask';
import { query, queryOne } from '@/lib/db';
import { enqueueAnalyze } from '@/services/runnerClient';
import { logger } from '@/services/logger';
import { analyzeRequestSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { requireUser, unauthorized } from '@/services/auth';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireProjectAccess } from '@/services/orgs';
import { resolveAIIntegration, IntegrationResolutionError } from '@/services/integrations';
import {
  buildAnalyzeFingerprint,
  claimAnalyzeDedupeLock,
  checkAnalyzeBackpressure,
  enforceAnalyzeRateLimit,
  getAnalyzeDedupeResult,
  releaseAnalyzeDedupeLock,
  storeAnalyzeDedupeResult,
  waitForAnalyzeDedupeResult,
} from '@/services/analyzeAdmission';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return unauthorized();
  }

  let dedupeLock: { fingerprint: string; owner: string } | null = null;

  try {
    const body = await request.json();
    const validated = analyzeRequestSchema.parse(body);
    const { projectId, commits: selectedHashes, forceFullAnalysis } = validated;

    logger.setContext({ projectId });

    // Validate project exists + org access
    const project = await withRetry(() => requireProjectAccess(projectId, user.id));

    const ruleSetId = project.ruleset_id;
    if (!ruleSetId) {
      return NextResponse.json({ error: 'Project has no rule set configured' }, { status: 400 });
    }

    // Get rule set
    const rules = await withRetry(() => getRulesBySetId(ruleSetId));
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

    // Preflight AI integration decryptability/config validity before creating report/task.
    let aiIntegrationSnapshot: Record<string, unknown> = {};
    try {
      const resolved = await withRetry(() => resolveAIIntegration(projectId));
      const integration = resolved.integration;
      const config =
        integration && typeof integration.config === 'object' && integration.config !== null
          ? integration.config as Record<string, unknown>
          : {};
      aiIntegrationSnapshot = integration
        ? {
            id: integration.id,
            provider: integration.provider,
            name: integration.name,
            model: typeof config.model === 'string' ? config.model : null,
            apiStyle: typeof config.apiStyle === 'string' ? config.apiStyle : null,
            baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : null,
            maxTokens: typeof config.maxTokens === 'number' ? config.maxTokens : null,
            temperature: typeof config.temperature === 'number' ? config.temperature : null,
            reasoningEffort: typeof config.reasoningEffort === 'string' ? config.reasoningEffort : null,
          }
        : {};
    } catch (error) {
      if (error instanceof IntegrationResolutionError) {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
          },
          {
            status: error.code === 'AI_INTEGRATION_REBIND_REQUIRED' ? 409 : 400,
          }
        );
      }
      throw error;
    }

    // Check whether to use incremental analysis
    const recentReports = await query(
      `select *
       from analysis_reports
       where project_id = $1 and status = 'done'
       order by created_at desc
       limit 1`,
      [projectId]
    );

    const useIncremental =
      !forceFullAnalysis &&
      shouldUseIncrementalAnalysis(project, selectedHashes, recentReports || []);

    // Build dedupe fingerprint once all semantic inputs are resolved.
    const analyzeFingerprint = buildAnalyzeFingerprint({
      orgId: project.org_id,
      projectId,
      commits: selectedHashes,
      rules: rules.map((rule) => ({
        category: String(rule.category ?? ''),
        name: String(rule.name ?? ''),
        prompt: String(rule.prompt ?? ''),
        severity: String(rule.severity ?? ''),
      })),
      forceFullAnalysis,
      useIncremental,
    });

    const existingResult = await getAnalyzeDedupeResult(analyzeFingerprint);
    if (existingResult) {
      const reportStatus = await queryOne<{ status: string }>(
        `select status from analysis_reports where id = $1`,
        [existingResult.reportId]
      );
      if (reportStatus && (reportStatus.status === 'pending' || reportStatus.status === 'running')) {
        return NextResponse.json(
          {
            reportId: existingResult.reportId,
            incrementalAnalysis: existingResult.incrementalAnalysis,
            status: reportStatus.status,
            taskId: existingResult.taskId,
            deduplicated: true,
          },
          { status: 202 }
        );
      }
    }

    const lockOwner = randomUUID();
    const lockAcquired = await claimAnalyzeDedupeLock(analyzeFingerprint, lockOwner);

    if (!lockAcquired) {
      const waitResult = await waitForAnalyzeDedupeResult(analyzeFingerprint, 2000, 200);
      if (waitResult) {
        const reportStatus = await queryOne<{ status: string }>(
          `select status from analysis_reports where id = $1`,
          [waitResult.reportId]
        );
        if (reportStatus && (reportStatus.status === 'pending' || reportStatus.status === 'running')) {
          return NextResponse.json(
            {
              reportId: waitResult.reportId,
              incrementalAnalysis: waitResult.incrementalAnalysis,
              status: reportStatus.status,
              taskId: waitResult.taskId,
              deduplicated: true,
            },
            { status: 202 }
          );
        }
      }

      return NextResponse.json(
        {
          error: 'Identical analysis request is already being processed',
          code: 'ANALYZE_DUPLICATE_IN_PROGRESS',
        },
        { status: 409, headers: { 'Retry-After': '2' } }
      );
    }

    dedupeLock = { fingerprint: analyzeFingerprint, owner: lockOwner };

    const clientInfo = extractClientInfo(request);

    const rateLimitResult = await enforceAnalyzeRateLimit({
      orgId: project.org_id,
      userId: user.id,
      projectId,
      ipAddress: clientInfo.ipAddress,
    });
    if (rateLimitResult) {
      return NextResponse.json(rateLimitResult.body, {
        status: rateLimitResult.status,
        headers: rateLimitResult.headers,
      });
    }

    const backpressureResult = await checkAnalyzeBackpressure(project.org_id, projectId);
    if (backpressureResult) {
      return NextResponse.json(backpressureResult.body, {
        status: backpressureResult.status,
        headers: backpressureResult.headers,
      });
    }

    // Create report
    const report = await withRetry(() =>
      createReport({
        project_id: projectId,
        org_id: project.org_id,
        ruleset_snapshot: rules,
        commits: selectedCommits,
        analysis_snapshot: {
          createdAt: new Date().toISOString(),
          repo: project.repo,
          forceFullAnalysis,
          useIncremental,
          selectedHashes,
          selectedCommits: selectedCommits.map((commit) => ({
            sha: typeof commit.sha === 'string' ? commit.sha : '',
            author: typeof commit.author === 'string' ? commit.author : '',
            date: typeof commit.date === 'string' ? commit.date : '',
            message: typeof commit.message === 'string' ? commit.message : '',
          })),
          rules: rules.map((rule) => ({
            id: String(rule.id ?? ''),
            category: String(rule.category ?? ''),
            name: String(rule.name ?? ''),
            prompt: String(rule.prompt ?? ''),
            severity: String(rule.severity ?? ''),
          })),
          aiIntegration: aiIntegrationSnapshot,
        },
      })
    );

    logger.info(`Report created: ${report.id}`);

    // Enqueue analysis task (high priority)
    let taskId: string | undefined;
    try {
      const result = await enqueueAnalyze({
        projectId,
        reportId: report.id,
        repo: project.repo,
        hashes: selectedHashes,
        rules,
        previousReport: useIncremental ? (recentReports?.[0] as Record<string, unknown>) : null,
        useIncremental,
      });
      taskId = result.taskId;
    } catch (err) {
      await updateReport(report.id, {
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Runner enqueue failed',
      });
      throw err;
    }

    await storeAnalyzeDedupeResult(analyzeFingerprint, {
      reportId: report.id,
      taskId,
      status: 'queued',
      projectId,
      orgId: project.org_id,
      incrementalAnalysis: useIncremental,
      createdAt: Date.now(),
    });

    await auditLogger.log({
      action: 'analyze',
      entityType: 'project',
      entityId: projectId,
      changes: { reportId: report.id, commits: selectedHashes.length, taskId },
      userId: user.id,
      ...clientInfo,
    });

    return NextResponse.json({
      reportId: report.id,
      incrementalAnalysis: useIncremental,
      status: 'queued',
      taskId,
    });
  } catch (err) {
    if (err instanceof Error) {
      const message = err.message.toLowerCase();
      if (message.includes('redis') || message.includes('admission control')) {
        logger.error('Analysis admission unavailable', err);
        return NextResponse.json(
          {
            error: 'Analyze admission control is unavailable. Check REDIS_URL and Redis connectivity.',
            code: 'ANALYZE_ADMISSION_UNAVAILABLE',
          },
          { status: 503 }
        );
      }
    }
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Analysis request failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    if (dedupeLock) {
      await releaseAnalyzeDedupeLock(dedupeLock.fingerprint, dedupeLock.owner);
    }
    logger.clearContext();
  }
}
