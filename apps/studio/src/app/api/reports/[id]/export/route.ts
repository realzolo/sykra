import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { asJsonObject } from '@/lib/json';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireReportAccess } from '@/services/orgs';
import { aliasedColumnList, analysisReportColumns } from '@/services/sql/projections';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);
const analysisReportProjectionColumnList = aliasedColumnList(analysisReportColumns, 'r');

type ExportReportRow = {
  id: string;
  project_id: string;
  org_id: string;
  ruleset_snapshot: unknown;
  commits: unknown;
  analysis_snapshot: unknown;
  status: string;
  score: number | null;
  category_scores: unknown;
  summary: string | null;
  error_message: string | null;
  analysis_progress: unknown;
  total_files: number | null;
  total_additions: number | null;
  total_deletions: number | null;
  complexity_metrics: unknown;
  duplication_metrics: unknown;
  dependency_metrics: unknown;
  security_findings: unknown;
  performance_findings: unknown;
  ai_suggestions: unknown;
  code_explanations: unknown;
  context_analysis: unknown;
  analysis_duration_ms: number | null;
  tokens_used: number | null;
  token_usage: unknown;
  model_version: string | null;
  sse_seq: number;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  project_name: string;
  project_repo: string;
};

type ExportIssueRow = {
  id: string;
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

type ExportReportPayload = Omit<ExportReportRow, 'project_name' | 'project_repo'> & {
  issues: ExportIssueRow[];
  projects: {
    name: string;
    repo: string;
  };
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

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'json';

  await requireReportAccess(id, user.id);
  const reportRow = await queryOne<ExportReportRow>(
    `select ${analysisReportProjectionColumnList},
            p.name as project_name,
            p.repo as project_repo
     from analysis_reports r
     join code_projects p on p.id = r.project_id
     where r.id = $1`,
    [id]
  );

  if (!reportRow) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  const issues = await query<ExportIssueRow>(
    `select
        i.id,
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
    [id]
  );

  const { project_name: projectName, project_repo: projectRepo, ...reportData } = reportRow;
  const report: ExportReportPayload = {
    ...reportData,
    issues,
    projects: {
      name: projectName,
      repo: projectRepo,
    },
  };

  if (format === 'markdown') {
    const markdown = generateMarkdown(report);
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown',
        'Content-Disposition': `attachment; filename="report-${id.slice(0, 8)}.md"`,
      },
    });
  }

  if (format === 'csv') {
    const csv = generateCSV(report);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="report-${id.slice(0, 8)}.csv"`,
      },
    });
  }

  // Default: JSON
  return NextResponse.json(report);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function generateMarkdown(report: ExportReportPayload): string {
  const lines: string[] = [];

  lines.push(`# Code Review Report`);
  lines.push('');
  lines.push(`**Project**: ${report.projects.name || 'Unknown'}`);
  lines.push(`**Repository**: ${report.projects.repo || 'Unknown'}`);
  lines.push(`**Report ID**: ${report.id}`);
  lines.push(`**Created At**: ${new Date(report.created_at).toLocaleString()}`);
  lines.push(`**Status**: ${report.status}`);
  lines.push('');

  if (report.status === 'done') {
    lines.push(`## Overall Score: ${report.score}/100`);
    lines.push('');

    lines.push('### Category Scores');
    lines.push('');
    const categoryScores = asJsonObject(report.category_scores);
    if (categoryScores) {
      Object.entries(categoryScores).forEach(([cat, score]) => {
        lines.push(`- **${cat}**: ${asNumber(score) ?? score}/100`);
      });
    }
    lines.push('');

    lines.push('### Change Summary');
    lines.push('');
    lines.push(`- Files changed: ${report.total_files || 0}`);
    lines.push(`- Additions: ${report.total_additions || 0}`);
    lines.push(`- Deletions: ${report.total_deletions || 0}`);
    lines.push(`- Commits: ${Array.isArray(report.commits) ? report.commits.length : 0}`);
    lines.push('');

    if (report.issues.length > 0) {
      lines.push(`## Issues (${report.issues.length})`);
      lines.push('');

      const severityGroups: Record<string, ExportIssueRow[]> = {};
      report.issues.forEach((issue) => {
        const severity = issue.severity;
        if (!severityGroups[severity]) {
          severityGroups[severity] = [];
        }
        severityGroups[severity].push(issue);
      });

      ['critical', 'high', 'medium', 'low', 'info'].forEach(sev => {
        const issues = severityGroups[sev];
        if (issues && issues.length > 0) {
          lines.push(`### ${sev.toUpperCase()} (${issues.length})`);
          lines.push('');
          issues.forEach((issue, idx) => {
            lines.push(`#### ${idx + 1}. ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
            lines.push('');
            lines.push(`**Rule**: ${issue.rule}`);
            lines.push(`**Category**: ${issue.category}`);
            lines.push(`**Issue**: ${issue.message}`);
            if (issue.suggestion) {
              lines.push('');
              lines.push(`**Suggestion**: ${issue.suggestion}`);
            }
            if (issue.priority) {
              lines.push(`**Priority**: P${issue.priority}`);
            }
            lines.push('');
          });
        }
      });
    }

    if (report.summary) {
      lines.push('## AI Summary');
      lines.push('');
      lines.push(report.summary);
      lines.push('');
    }

    const contextAnalysis = asJsonObject(report.context_analysis);
    if (contextAnalysis) {
      lines.push('## Context Analysis');
      lines.push('');
      lines.push(`- **Change type**: ${contextAnalysis.changeType ?? 'unknown'}`);
      lines.push(`- **Risk level**: ${contextAnalysis.riskLevel ?? 'unknown'}`);
      lines.push(`- **Business impact**: ${contextAnalysis.businessImpact ?? 'unknown'}`);
      lines.push(`- **Breaking changes**: ${contextAnalysis.breakingChanges ? 'Yes' : 'No'}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generateCSV(report: ExportReportPayload): string {
  const lines: string[] = [];

  // Header
  lines.push('File,Line,Severity,Category,Rule,Issue,Suggestion,Priority');

  // Issues
  if (report.issues.length > 0) {
    report.issues.forEach((issue) => {
      const row = [
        issue.file,
        issue.line || '',
        issue.severity,
        issue.category,
        issue.rule,
        `"${issue.message.replace(/"/g, '""')}"`,
        issue.suggestion ? `"${issue.suggestion.replace(/"/g, '""')}"` : '',
        issue.priority || '',
      ];
      lines.push(row.join(','));
    });
  }

  return lines.join('\n');
}
