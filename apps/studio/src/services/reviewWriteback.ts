import { exec, query, queryOne } from '@/lib/db';
import { absoluteStudioUrl } from '@/services/email';
import { resolveVCSIntegration } from '@/services/integrations/factory';

type ReviewReportRow = {
  id: string;
  org_id: string;
  project_id: string;
  score: number | null;
  status: string;
  summary: string | null;
  commits: Array<{ sha?: string } | string> | null;
  project_name: string;
  project_repo: string;
};

type ReviewRunRow = {
  id: string;
  comment_id: string | null;
};

type PullRequestRow = {
  id: string;
  provider: 'github' | 'gitlab';
  repo_full_name: string;
  number: number;
  title: string | null;
  url: string | null;
};

type ReviewIssueRow = {
  file: string | null;
  line: number | null;
  severity: string;
  category: string;
  message: string;
  priority: number | null;
};

const ISSUE_LIMIT = 5;

export async function writeBackReviewRun(reportId: string): Promise<void> {
  const report = await queryOne<ReviewReportRow>(
    `select r.id, r.org_id, r.project_id, r.score, r.status, r.summary, r.commits,
            p.name as project_name, p.repo as project_repo
     from analysis_reports r
     join code_projects p on p.id = r.project_id
     where r.id = $1`,
    [reportId]
  );

  if (!report) return;
  if (report.status !== 'done' && report.status !== 'partial_failed') return;

  const reviewRun = await queryOne<ReviewRunRow>(
    `select id, comment_id
     from review_runs
     where report_id = $1
     order by created_at desc
     limit 1`,
    [reportId]
  );
  if (!reviewRun) return;

  const pullRequest = await queryOne<PullRequestRow>(
    `select pr.id, pr.provider, pr.repo_full_name, pr.number, pr.title, pr.url
     from review_runs rr
     join pull_requests pr on pr.id = rr.pull_request_id
     where rr.id = $1`,
    [reviewRun.id]
  );
  if (!pullRequest) return;

  const issues = await query<ReviewIssueRow>(
    `select file, line, severity, category, message, priority
     from analysis_issues
     where report_id = $1
     order by priority asc nulls last, created_at asc
     limit $2`,
    [reportId, ISSUE_LIMIT]
  );

  const totalIssueCountRow = await queryOne<{ count: string }>(
    `select count(*)::text as count
     from analysis_issues
     where report_id = $1`,
    [reportId]
  );
  const totalIssueCount = Number(totalIssueCountRow?.count ?? '0');

  const commitSha = extractPrimaryCommitSha(report.commits);
  const commentBody = buildReviewCommentBody({
    report,
    pullRequest,
    issues,
    totalIssueCount,
    commitSha,
  });

  await exec(
    `update review_runs
     set status = 'completed',
         completed_at = coalesce(completed_at, now())
     where id = $1`,
    [reviewRun.id]
  );

  const { client } = await resolveVCSIntegration(report.project_id);
  const writeback = await client.upsertReviewComment({
    repoFullName: pullRequest.repo_full_name,
    pullRequestNumber: pullRequest.number,
    body: commentBody,
    commentId: reviewRun.comment_id,
  });

  await exec(
    `update review_runs
     set comment_id = $2
     where id = $1`,
    [reviewRun.id, writeback.commentId]
  );
}

function buildReviewCommentBody(input: {
  report: ReviewReportRow;
  pullRequest: PullRequestRow;
  issues: ReviewIssueRow[];
  totalIssueCount: number;
  commitSha: string | null;
}) {
  const { report, pullRequest, issues, totalIssueCount, commitSha } = input;
  const link = absoluteStudioUrl(`/o/${report.org_id}/reports/${report.id}`);
  const statusLabel = report.status === 'partial_failed' ? 'partial_failed' : report.status;
  const scoreLabel = report.score == null ? 'N/A' : `${report.score}/100`;
  const lines = [
    '### Spec-Axis Review Summary',
    '',
    `- **Project:** ${report.project_name}`,
    `- **PR:** #${pullRequest.number}${pullRequest.title ? ` ${pullRequest.title}` : ''}`,
    `- **Status:** ${statusLabel}`,
    `- **Quality score:** ${scoreLabel}`,
    `- **Issues:** ${totalIssueCount}`,
  ];

  if (commitSha) {
    lines.push(`- **Commit:** ${commitSha.slice(0, 7)}`);
  }

  if (link) {
    lines.push(`- **Full report:** ${link}`);
  }

  if (report.summary?.trim()) {
    lines.push('');
    lines.push(report.summary.trim());
  }

  lines.push('');
  lines.push('#### Top issues');

  if (issues.length === 0) {
    lines.push('- No issues were found in this report.');
  } else {
    for (const issue of issues) {
      const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ''}` : 'Unknown location';
      lines.push(`- **${formatSeverity(issue.severity)}** ${location} - ${issue.message}`);
    }
    if (totalIssueCount > issues.length) {
      lines.push(`- ...and ${totalIssueCount - issues.length} more`);
    }
  }

  return lines.join('\n');
}

function extractPrimaryCommitSha(commits: ReviewReportRow['commits']): string | null {
  if (!Array.isArray(commits) || commits.length === 0) {
    return null;
  }

  const first = commits[0];
  if (typeof first === 'string') {
    return isCommitSha(first) ? first : null;
  }

  if (first && typeof first === 'object') {
    const sha = 'sha' in first ? first.sha : undefined;
    return typeof sha === 'string' && isCommitSha(sha) ? sha : null;
  }

  return null;
}

function formatSeverity(severity: string) {
  switch (severity) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      return 'Info';
  }
}

function isCommitSha(value: string) {
  return /^[0-9a-f]{7,40}$/i.test(value.trim());
}
