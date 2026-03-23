import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRulesBySetId } from '@/services/db';
import { shouldUseIncrementalAnalysis } from '@/services/incremental';
import { buildReportCommits } from '@/services/analyzeTask';
import { query } from '@/lib/db';
import { asJsonObject, type JsonObject } from '@/lib/json';
import { logger } from '@/services/logger';
import { analyzeRequestSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { requireUser, unauthorized } from '@/services/auth';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireProjectAccess } from '@/services/orgs';
import { resolveAIIntegration, IntegrationResolutionError } from '@/services/integrations';
import {
  buildAnalyzeFingerprint,
  checkAnalyzeBackpressure,
  enforceAnalyzeRateLimit,
  createOrReuseAnalyzeReport,
} from '@/services/analyzeAdmission';

export const dynamic = 'force-dynamic';

type RecentDoneReportRow = {
  id: string;
  created_at: string;
  status: string;
  score: number | null;
  summary: string | null;
};

type PreviousIssueRow = {
  file: string;
  line: number | null;
  severity: string;
  category: string;
  rule: string;
  message: string;
  suggestion: string | null;
  codeSnippet: string | null;
  fixPatch: string | null;
  priority: number | null;
  impactScope: string | null;
  estimatedEffort: string | null;
};

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return unauthorized();
  }

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
    let aiIntegrationSnapshot: JsonObject = {};
    try {
      const resolved = await withRetry(() => resolveAIIntegration(projectId));
      const integration = resolved.integration;
      const config = integration ? asJsonObject(integration.config) ?? {} : {};
      aiIntegrationSnapshot = integration
        ? {
            id: integration.id,
            provider: integration.provider,
            name: integration.name,
            model: typeof config.model === 'string' ? config.model : null,
            apiStyle: typeof config.apiStyle === 'string' ? config.apiStyle : null,
            baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : null,
            outputLanguage: typeof config.outputLanguage === 'string' ? config.outputLanguage : 'en',
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
    const recentDoneReports = await query<RecentDoneReportRow>(
      `select id, created_at, status, score, summary
       from analysis_reports
       where project_id = $1 and status = 'done'
       order by created_at desc
       limit 1`,
      [projectId]
    );
    const latestDoneReport = recentDoneReports[0] ?? null;

    const useIncremental =
      !forceFullAnalysis &&
      shouldUseIncrementalAnalysis(selectedHashes, latestDoneReport ? [latestDoneReport] : []);

    let previousReportSnapshot: JsonObject | null = null;
    if (useIncremental && latestDoneReport) {
      const previousIssues = await query<PreviousIssueRow>(
        `select
            i.file,
            i.line,
            i.severity,
            i.category,
            i.rule,
            i.message,
            i.suggestion,
            i.code_snippet as "codeSnippet",
            i.fix_patch as "fixPatch",
            i.priority,
            i.impact_scope as "impactScope",
            i.estimated_effort as "estimatedEffort"
         from analysis_issues i
         where i.report_id = $1
         order by i.priority asc nulls last, i.created_at asc`,
        [latestDoneReport.id]
      );
      previousReportSnapshot = {
        id: latestDoneReport.id,
        created_at: latestDoneReport.created_at,
        status: latestDoneReport.status,
        score: latestDoneReport.score,
        summary: latestDoneReport.summary,
        issues: previousIssues,
      };
    }

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

    const reportAdmission = await withRetry(() =>
      createOrReuseAnalyzeReport({
        orgId: project.org_id,
        projectId,
        fingerprint: analyzeFingerprint,
        rulesetSnapshot: rules.map((rule) => ({
          category: String(rule.category ?? ''),
          name: String(rule.name ?? ''),
          prompt: String(rule.prompt ?? ''),
          severity: String(rule.severity ?? ''),
        })),
        commits: selectedCommits,
        analysisSnapshot: {
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
          previousReport: previousReportSnapshot,
          fingerprint: analyzeFingerprint,
        },
      })
    );

    logger.info(`Report admitted: ${reportAdmission.reportId}`);

    await auditLogger.log({
      action: 'analyze',
      entityType: 'project',
      entityId: projectId,
      changes: {
        reportId: reportAdmission.reportId,
        commits: selectedHashes.length,
        status: reportAdmission.status,
        deduplicated: reportAdmission.deduplicated,
      },
      userId: user.id,
      ...clientInfo,
    });

    return NextResponse.json(
      {
        reportId: reportAdmission.reportId,
        incrementalAnalysis: reportAdmission.incrementalAnalysis,
        status: reportAdmission.status,
        deduplicated: reportAdmission.deduplicated,
      },
      { status: reportAdmission.status === 'queued' || reportAdmission.status === 'running' ? 202 : 200 }
    );
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Analysis request failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
