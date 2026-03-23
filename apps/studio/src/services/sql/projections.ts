export function columnList(columns: readonly string[]): string {
  return columns.join(', ');
}

export function aliasedColumnList(columns: readonly string[], alias: string): string {
  return columns.map((column) => `${alias}.${column}`).join(', ');
}

export function jsonObjectProjection(columns: readonly string[], alias: string): string {
  return `jsonb_build_object(${columns.map((column) => `'${column}', ${alias}.${column}`).join(', ')})`;
}

export const organizationCoreColumns = [
  'id',
  'name',
  'slug',
  'is_personal',
  'owner_id',
] as const;

export const organizationColumns = [
  ...organizationCoreColumns,
  'created_at',
] as const;

export const organizationCoreColumnList = columnList(organizationCoreColumns);
export const organizationColumnList = columnList(organizationColumns);

export const orgInviteColumns = [
  'id',
  'org_id',
  'email',
  'role',
  'token',
  'expires_at',
  'accepted_at',
  'created_at',
  'created_by',
] as const;

export const orgInviteAcceptColumns = [
  'id',
  'org_id',
  'role',
  'email',
  'expires_at',
  'accepted_at',
] as const;

export const orgInviteColumnList = columnList(orgInviteColumns);
export const orgInviteAcceptColumnList = columnList(orgInviteAcceptColumns);

export const orgIntegrationColumns = [
  'id',
  'org_id',
  'user_id',
  'type',
  'provider',
  'name',
  'is_default',
  'config',
  'vault_secret_name',
  'created_at',
  'updated_at',
] as const;

export const orgIntegrationColumnList = columnList(orgIntegrationColumns);

export const analysisReportColumns = [
  'id',
  'project_id',
  'org_id',
  'ruleset_snapshot',
  'commits',
  'analysis_snapshot',
  'status',
  'score',
  'category_scores',
  'summary',
  'error_message',
  'analysis_progress',
  'total_files',
  'total_additions',
  'total_deletions',
  'complexity_metrics',
  'duplication_metrics',
  'dependency_metrics',
  'security_findings',
  'performance_findings',
  'ai_suggestions',
  'code_explanations',
  'context_analysis',
  'analysis_duration_ms',
  'tokens_used',
  'token_usage',
  'model_version',
  'sse_seq',
  'user_id',
  'created_at',
  'updated_at',
] as const;

export const analysisReportColumnList = columnList(analysisReportColumns);

export const analysisIssueColumns = [
  'id',
  'report_id',
  'file',
  'line',
  'severity',
  'category',
  'rule',
  'message',
  'suggestion',
  'code_snippet',
  'fix_patch',
  'status',
  'priority',
  'impact_scope',
  'estimated_effort',
  'assigned_to',
  'notes',
  'created_at',
  'updated_at',
] as const;

export const analysisIssueCommentColumns = [
  'id',
  'issue_id',
  'author_id',
  'author',
  'content',
  'created_at',
] as const;

export const analysisIssueColumnList = columnList(analysisIssueColumns);
export const analysisIssueCommentColumnList = columnList(analysisIssueCommentColumns);

export const projectConfigColumns = [
  'ignore_patterns',
  'quality_threshold',
  'artifact_retention_days',
  'auto_analyze',
  'webhook_url',
  'ai_integration_id',
] as const;

export const projectConfigColumnList = columnList(projectConfigColumns);

export const qualitySnapshotColumns = [
  'id',
  'project_id',
  'report_id',
  'snapshot_date',
  'score',
  'category_scores',
  'total_issues',
  'critical_issues',
  'high_issues',
  'medium_issues',
  'low_issues',
  'tech_debt_score',
  'complexity_score',
  'security_score',
  'performance_score',
  'created_at',
] as const;

export const qualitySnapshotColumnList = columnList(qualitySnapshotColumns);

export const learnedPatternColumns = [
  'id',
  'project_id',
  'pattern_type',
  'pattern_name',
  'pattern_description',
  'detection_regex',
  'severity',
  'confidence_score',
  'occurrence_count',
  'is_enabled',
  'created_at',
  'last_seen',
] as const;

export const codebaseCommentColumns = [
  'id',
  'thread_id',
  'org_id',
  'project_id',
  'repo',
  'ref',
  'commit_sha',
  'path',
  'line',
  'line_end',
  'selection_text',
  'author_id',
  'author_email',
  'body',
  'created_at',
] as const;

export const codebaseThreadColumns = [
  'id',
  'org_id',
  'project_id',
  'repo',
  'ref',
  'commit_sha',
  'path',
  'line',
  'line_end',
  'status',
  'author_id',
  'author_email',
  'resolved_by',
  'resolved_at',
  'created_at',
  'updated_at',
] as const;

export const codebaseCommentColumnList = columnList(codebaseCommentColumns);
export const codebaseThreadColumnList = columnList(codebaseThreadColumns);
