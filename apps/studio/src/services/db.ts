import { exec, query, queryOne } from '@/lib/db';
import type { JsonArray, JsonObject } from '@/lib/json';
import type { AnalysisReportStatus } from '@/services/statuses';
import {
  aliasedColumnList,
  analysisReportColumnList,
  analysisReportColumns,
} from '@/services/sql/projections';

const projectColumns = [
  'id',
  'org_id',
  'name',
  'repo',
  'description',
  'default_branch',
  'ruleset_id',
  'ignore_patterns',
  'quality_threshold',
  'artifact_retention_days',
  'auto_analyze',
  'webhook_url',
  'last_analyzed_at',
  'vcs_integration_id',
  'ai_integration_id',
  'user_id',
  'created_at',
  'updated_at',
] as const;
const projectColumnList = projectColumns.join(', ');

const ruleSetColumns = [
  'id',
  'org_id',
  'name',
  'description',
  'is_global',
  'user_id',
  'created_at',
  'updated_at',
] as const;
const ruleSetColumnList = ruleSetColumns.join(', ');

const ruleColumns = [
  'id',
  'ruleset_id',
  'category',
  'name',
  'prompt',
  'weight',
  'severity',
  'is_enabled',
  'sort_order',
  'custom_config',
  'false_positive_patterns',
  'created_at',
  'updated_at',
] as const;
const ruleColumnList = ruleColumns.join(', ');
const ruleJSONProjection = `jsonb_build_object(
  'id', r.id,
  'ruleset_id', r.ruleset_id,
  'category', r.category,
  'name', r.name,
  'prompt', r.prompt,
  'weight', r.weight,
  'severity', r.severity,
  'is_enabled', r.is_enabled,
  'sort_order', r.sort_order,
  'custom_config', r.custom_config,
  'false_positive_patterns', r.false_positive_patterns,
  'created_at', r.created_at,
  'updated_at', r.updated_at
)`;

const reportColumnList = analysisReportColumnList;
const reportSelectList = aliasedColumnList(analysisReportColumns, 'r');

type ProjectRow = {
  id: string;
  org_id: string;
  name: string;
  repo: string;
  description: string | null;
  default_branch: string;
  ruleset_id: string | null;
  ignore_patterns: string[];
  quality_threshold: number | null;
  artifact_retention_days: number | null;
  auto_analyze: boolean;
  webhook_url: string | null;
  last_analyzed_at: string | null;
  vcs_integration_id: string | null;
  ai_integration_id: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

type RuleSetRow = {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  is_global: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

type RuleRow = {
  id: string;
  ruleset_id: string;
  category: 'style' | 'security' | 'architecture' | 'performance' | 'maintainability';
  name: string;
  prompt: string;
  weight: number;
  severity: 'error' | 'warning' | 'info';
  is_enabled: boolean;
  sort_order: number;
  custom_config: JsonObject | null;
  false_positive_patterns: string[] | null;
  created_at: string;
  updated_at: string;
};

type RuleSetWithRulesRow = RuleSetRow & {
  rules: RuleRow[];
};

type AnalysisReportRow = {
  id: string;
  project_id: string;
  org_id: string;
  ruleset_snapshot: JsonArray;
  commits: JsonArray;
  analysis_snapshot: JsonObject;
  status: AnalysisReportStatus;
  score: number | null;
  category_scores: JsonObject | null;
  summary: string | null;
  error_message: string | null;
  analysis_progress: JsonObject | null;
  total_files: number | null;
  total_additions: number | null;
  total_deletions: number | null;
  complexity_metrics: JsonObject | null;
  duplication_metrics: JsonObject | null;
  dependency_metrics: JsonObject | null;
  security_findings: JsonArray | null;
  performance_findings: JsonArray | null;
  ai_suggestions: JsonArray | null;
  code_explanations: JsonArray | null;
  context_analysis: JsonObject | null;
  analysis_duration_ms: number | null;
  tokens_used: number | null;
  token_usage: JsonObject | null;
  model_version: string | null;
  sse_seq: number | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

type ReportListRow = {
  id: string;
  status: AnalysisReportRow['status'];
  score: number | null;
  category_scores: JsonObject | null;
  commits: JsonArray;
  created_at: string;
  name: string;
  repo: string;
};

type ReportDetailRow = AnalysisReportRow & {
  name: string;
  repo: string;
};

// ── Projects ──────────────────────────────────────────────
export async function getProjects(orgId: string) {
  if (!orgId) {
    throw new Error('orgId is required');
  }
  return query<ProjectRow>(
    `select ${projectColumnList}
     from code_projects
     where org_id = $1
     order by created_at desc`,
    [orgId]
  );
}

export async function getProjectById(id: string) {
  const row = await queryOne<ProjectRow>(
    `select ${projectColumnList}
     from code_projects
     where id = $1`,
    [id]
  );
  if (!row) throw new Error('Project not found');
  return row;
}

export async function getProjectByRepo(repo: string, orgId: string) {
  const row = await queryOne<ProjectRow>(
    `select ${projectColumnList}
     from code_projects
     where repo = $1 and org_id = $2`,
    [repo, orgId]
  );
  if (!row) throw new Error('Project not found');
  return row;
}

export async function listProjectsByRepo(repo: string) {
  return query<ProjectRow>(
    `select ${projectColumnList}
     from code_projects
     where repo = $1`,
    [repo]
  );
}

export async function createProject(payload: {
  name: string;
  repo: string;
  description?: string;
  default_branch?: string;
  ruleset_id?: string;
  user_id: string;
  org_id: string;
  vcs_integration_id: string;
  ai_integration_id: string;
}) {
  const row = await queryOne<ProjectRow>(
    `insert into code_projects
      (name, repo, description, default_branch, ruleset_id, user_id, org_id, vcs_integration_id, ai_integration_id, created_at, updated_at)
     values ($1,$2,$3,coalesce($4,'main'),$5,$6,$7,$8,$9,now(),now())
     returning ${projectColumnList}`,
    [
      payload.name,
      payload.repo,
      payload.description ?? null,
      payload.default_branch ?? 'main',
      payload.ruleset_id ?? null,
      payload.user_id,
      payload.org_id,
      payload.vcs_integration_id,
      payload.ai_integration_id,
    ]
  );
  if (!row) throw new Error('Failed to create project');
  return row;
}

export async function updateProject(
  id: string,
  payload: {
    name?: string;
    description?: string;
    ruleset_id?: string | null;
  }
) {
  const row = await queryOne<ProjectRow>(
    `update code_projects
     set name = coalesce($2, name),
         description = coalesce($3, description),
         ruleset_id = $4,
         updated_at = now()
     where id = $1
     returning ${projectColumnList}`,
    [id, payload.name ?? null, payload.description ?? null, payload.ruleset_id ?? null]
  );
  if (!row) throw new Error('Project not found');
  return row;
}

export async function deleteProject(id: string) {
  await exec(`delete from code_projects where id = $1`, [id]);
}

// ── Rule Sets ─────────────────────────────────────────────
export async function getRuleSets(orgId: string) {
  if (!orgId) {
    throw new Error('orgId is required');
  }

  return query<RuleSetWithRulesRow>(
    `select ${ruleSetColumns.map((column) => `rs.${column}`).join(', ')},
            coalesce(
              (
                select jsonb_agg(${ruleJSONProjection} order by r.sort_order, r.created_at)
                from quality_rules r
                where r.ruleset_id = rs.id
              ),
              '[]'::jsonb
            ) as rules
     from quality_rule_sets rs
     where rs.is_global = true or rs.org_id = $1
     order by rs.created_at desc`,
    [orgId]
  );
}

export async function getRuleSetById(id: string) {
  const row = await queryOne<RuleSetWithRulesRow>(
    `select ${ruleSetColumns.map((column) => `rs.${column}`).join(', ')},
            coalesce(
              (
                select jsonb_agg(${ruleJSONProjection} order by r.sort_order, r.created_at)
                from quality_rules r
                where r.ruleset_id = rs.id
              ),
              '[]'::jsonb
            ) as rules
     from quality_rule_sets rs
     where rs.id = $1`,
    [id]
  );
  if (!row) throw new Error('Rule set not found');
  return row;
}

export async function createRuleSet(payload: { name: string; description?: string; org_id: string }) {
  const row = await queryOne<RuleSetRow>(
    `insert into quality_rule_sets (name, description, org_id, is_global, created_at, updated_at)
     values ($1,$2,$3,false,now(),now())
     returning ${ruleSetColumnList}`,
    [payload.name, payload.description ?? null, payload.org_id]
  );
  if (!row) throw new Error('Failed to create rule set');
  return row;
}

export async function getRulesBySetId(rulesetId: string) {
  return query<RuleRow>(
    `select ${ruleColumnList}
     from quality_rules
     where ruleset_id = $1 and is_enabled = true
     order by sort_order`,
    [rulesetId]
  );
}

export async function upsertRule(payload: {
  id?: string;
  ruleset_id: string;
  category: string;
  name: string;
  prompt: string;
  weight?: number;
  severity?: string;
  is_enabled?: boolean;
  sort_order?: number;
}) {
  if (payload.id) {
    const row = await queryOne<RuleRow>(
      `update quality_rules
       set category = $2,
           name = $3,
           prompt = $4,
           weight = coalesce($5, weight),
           severity = coalesce($6, severity),
           is_enabled = coalesce($7, is_enabled),
           sort_order = coalesce($8, sort_order),
           updated_at = now()
       where id = $1
       returning ${ruleColumnList}`,
      [
        payload.id,
        payload.category,
        payload.name,
        payload.prompt,
        payload.weight ?? null,
        payload.severity ?? null,
        payload.is_enabled ?? null,
        payload.sort_order ?? null,
      ]
    );
    if (!row) throw new Error('Rule not found');
    return row;
  }

  const row = await queryOne<RuleRow>(
    `insert into quality_rules
      (ruleset_id, category, name, prompt, weight, severity, is_enabled, sort_order, created_at, updated_at)
     values ($1,$2,$3,$4,coalesce($5,20),coalesce($6,'warning'),coalesce($7,true),coalesce($8,0),now(),now())
     returning ${ruleColumnList}`,
    [
      payload.ruleset_id,
      payload.category,
      payload.name,
      payload.prompt,
      payload.weight ?? null,
      payload.severity ?? null,
      payload.is_enabled ?? null,
      payload.sort_order ?? null,
    ]
  );
  if (!row) throw new Error('Failed to create rule');
  return row;
}

export async function deleteRule(id: string) {
  await exec(`delete from quality_rules where id = $1`, [id]);
}

// ── Reports ───────────────────────────────────────────────
export async function createReport(payload: {
  project_id: string;
  org_id: string;
  ruleset_snapshot: JsonArray;
  commits: JsonArray;
  analysis_snapshot?: JsonObject;
}) {
  const row = await queryOne<AnalysisReportRow>(
    `insert into analysis_reports
      (project_id, org_id, ruleset_snapshot, commits, analysis_snapshot, status, created_at, updated_at)
     values ($1,$2,$3,$4,$5,'pending',now(),now())
     returning ${reportColumnList}`,
    [
      payload.project_id,
      payload.org_id,
      JSON.stringify(payload.ruleset_snapshot),
      JSON.stringify(payload.commits),
      JSON.stringify(payload.analysis_snapshot ?? {}),
    ]
  );
  if (!row) throw new Error('Failed to create report');
  return row;
}

export async function updateReport(id: string, payload: JsonObject) {
  const fields = Object.keys(payload);
  if (fields.length === 0) return;

  const assignments = fields.map((key, idx) => `${key} = $${idx + 2}`);
  const values = fields.map((key) => {
    const value = payload[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return JSON.stringify(value);
    }
    return value;
  });

  await exec(
    `update analysis_reports
     set ${assignments.join(', ')}, updated_at = now()
     where id = $1`,
    [id, ...values]
  );
}

export async function deleteReport(id: string) {
  await exec(`delete from analysis_reports where id = $1`, [id]);
}

export async function getReports(orgId: string, projectId?: string) {
  if (!orgId) {
    throw new Error('orgId is required');
  }
  if (projectId) {
    return query<ReportListRow>(
      `select r.id, r.status, r.score, r.category_scores, r.commits, r.created_at,
              p.name, p.repo
       from analysis_reports r
       join code_projects p on p.id = r.project_id
       where r.org_id = $1
         and r.project_id = $2
       order by r.created_at desc
       limit 50`,
      [orgId, projectId]
    );
  }
  return query<ReportListRow>(
    `select r.id, r.status, r.score, r.category_scores, r.commits, r.created_at,
            p.name, p.repo
     from analysis_reports r
     join code_projects p on p.id = r.project_id
     where r.org_id = $1
     order by r.created_at desc
     limit 50`,
    [orgId]
  );
}

export async function getReportById(id: string) {
  const row = await queryOne<ReportDetailRow>(
    `select ${reportSelectList}, p.name, p.repo
     from analysis_reports r
     join code_projects p on p.id = r.project_id
     where r.id = $1`,
    [id]
  );
  if (!row) throw new Error('Report not found');
  return row;
}
