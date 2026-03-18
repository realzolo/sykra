-- spec-axis unified init schema (PostgreSQL)
-- This script initializes all core tables for Studio + Runner.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ============================================================
-- Auth
-- ============================================================
create table auth_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text,
  avatar_url text,
  status text not null default 'active' check (status in ('active','disabled','pending')),
  email_verified_at timestamptz,
  failed_login_count int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth_credentials (
  user_id uuid primary key references auth_users(id) on delete cascade,
  password_hash text not null,
  password_updated_at timestamptz not null default now()
);

create table auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade,
  provider text not null,
  provider_user_id text,
  email citext,
  profile jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade,
  session_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table auth_email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table auth_password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table auth_login_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth_users(id) on delete set null,
  email citext,
  ip_address text,
  user_agent text,
  success boolean not null,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index idx_auth_sessions_user_id on auth_sessions(user_id);
create index idx_auth_sessions_expires_at on auth_sessions(expires_at);
create unique index idx_auth_sessions_token_hash on auth_sessions(session_token_hash);
create index idx_auth_identities_user_id on auth_identities(user_id);
create index idx_auth_login_attempts_email on auth_login_attempts(email);
create index idx_auth_login_attempts_user_id on auth_login_attempts(user_id);
create index idx_auth_login_attempts_created_at on auth_login_attempts(created_at desc);

-- ============================================================
-- Organizations
-- ============================================================
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_personal boolean not null default false,
  owner_id uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth_users(id) on delete cascade,
  role text not null check (role in ('owner','admin','reviewer','member')),
  status text not null default 'active' check (status in ('active','invited','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email citext not null,
  role text not null check (role in ('owner','admin','reviewer','member')),
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth_users(id) on delete set null
);

create index idx_org_members_user_id on org_members(user_id);
create index idx_org_members_org_id on org_members(org_id);
create index idx_org_invites_org_id on org_invites(org_id);
create index idx_org_invites_email on org_invites(email);

-- ============================================================
-- API tokens
-- ============================================================
create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint api_tokens_scopes_check check (
    scopes <@ array['read','write','pipeline:trigger']::text[]
  )
);

create index api_tokens_user_idx on api_tokens(user_id);
create index api_tokens_org_idx on api_tokens(org_id);
create index api_tokens_hash_idx on api_tokens(token_hash);

-- ============================================================
-- Integrations
-- ============================================================
create table org_integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth_users(id) on delete cascade,
  type text not null check (type in ('vcs','ai')),
  provider text not null check (provider in ('github','gitlab','git','openai-api')),
  name text not null,
  is_default boolean not null default false,
  config jsonb not null default '{}',
  vault_secret_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, type, name)
);

create index idx_org_integrations_org_type on org_integrations(org_id, type);
create index idx_org_integrations_org_default on org_integrations(org_id, type, is_default) where is_default = true;

create or replace function ensure_single_default_integration()
returns trigger as $$
begin
  if new.is_default = true then
    update org_integrations
    set is_default = false
    where org_id = new.org_id
      and type = new.type
      and id != new.id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trigger_ensure_single_default_integration
  after insert or update on org_integrations
  for each row
  when (new.is_default = true)
  execute function ensure_single_default_integration();

-- ============================================================
-- Rule sets & projects
-- ============================================================
create table quality_rule_sets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  name text not null,
  description text,
  is_global boolean not null default false,
  user_id uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_rule_sets_org_scope_check
    check (
      (is_global = true and org_id is null) or
      (is_global = false and org_id is not null)
    )
);

create table code_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  repo text not null,
  description text,
  default_branch text not null default 'main',
  ruleset_id uuid references quality_rule_sets(id) on delete set null,
  ignore_patterns text[] not null default '{}',
  quality_threshold int check (quality_threshold between 0 and 100),
  auto_analyze boolean not null default false,
  webhook_url text,
  last_analyzed_at timestamptz,
  vcs_integration_id uuid references org_integrations(id) on delete set null,
  ai_integration_id uuid references org_integrations(id) on delete set null,
  user_id uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint code_projects_org_repo_key unique (org_id, repo)
);

create table quality_rules (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null references quality_rule_sets(id) on delete cascade,
  category text not null check (category in ('style','security','architecture','performance','maintainability')),
  name text not null,
  prompt text not null,
  weight int not null default 20 check (weight between 0 and 100),
  severity text not null default 'warning' check (severity in ('error','warning','info')),
  is_enabled boolean not null default true,
  sort_order int not null default 0,
  custom_config jsonb,
  false_positive_patterns text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_code_projects_org_id on code_projects(org_id);
create index idx_code_projects_user_id on code_projects(user_id);
create index idx_quality_rules_ruleset_id on quality_rules(ruleset_id);
create index idx_quality_rules_ruleset_id_enabled on quality_rules(ruleset_id, is_enabled);
create index idx_quality_rule_sets_org_id on quality_rule_sets(org_id);
create index idx_quality_rule_sets_user_id on quality_rule_sets(user_id);

-- ============================================================
-- Reports & analysis
-- ============================================================
create table analysis_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references code_projects(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  ruleset_snapshot jsonb not null default '[]',
  commits jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending','analyzing','done','failed')),
  score int check (score between 0 and 100),
  category_scores jsonb,
  issues jsonb,
  summary text,
  error_message text,
  analysis_progress jsonb,
  total_files int,
  total_additions int,
  total_deletions int,
  complexity_metrics jsonb,
  duplication_metrics jsonb,
  dependency_metrics jsonb,
  security_findings jsonb,
  performance_findings jsonb,
  ai_suggestions jsonb,
  code_explanations jsonb,
  priority_issues jsonb,
  context_analysis jsonb,
  analysis_duration_ms int,
  tokens_used int,
  token_usage jsonb,
  model_version text,
  user_id uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_analysis_reports_project_id on analysis_reports(project_id);
create index idx_analysis_reports_org_id on analysis_reports(org_id);
create index idx_analysis_reports_project_id_status on analysis_reports(project_id, status);
create index idx_analysis_reports_created_at on analysis_reports(created_at desc);
create index idx_analysis_reports_user_id on analysis_reports(user_id);

create table analysis_issues (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references analysis_reports(id) on delete cascade,
  file text not null,
  line int,
  severity text not null check (severity in ('critical','high','medium','low','info')),
  category text not null,
  rule text not null,
  message text not null,
  suggestion text,
  code_snippet text,
  fix_patch text,
  status text not null default 'open' check (status in ('open','fixed','ignored','false_positive','planned')),
  priority int check (priority between 1 and 5),
  impact_scope text,
  estimated_effort text,
  assigned_to uuid references auth_users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_analysis_issues_report_id on analysis_issues(report_id);
create index idx_analysis_issues_status on analysis_issues(status);
create index idx_analysis_issues_severity on analysis_issues(severity);
create index idx_analysis_issues_priority on analysis_issues(priority desc);

create table analysis_issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references analysis_issues(id) on delete cascade,
  author_id uuid references auth_users(id) on delete set null,
  author text,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_analysis_issue_comments_issue_id on analysis_issue_comments(issue_id);

create table analysis_quality_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references code_projects(id) on delete cascade,
  report_id uuid references analysis_reports(id) on delete set null,
  snapshot_date date not null default current_date,
  score int check (score between 0 and 100),
  category_scores jsonb,
  total_issues int,
  critical_issues int,
  high_issues int,
  medium_issues int,
  low_issues int,
  tech_debt_score int,
  complexity_score int,
  security_score int,
  performance_score int,
  created_at timestamptz not null default now(),
  unique (project_id, snapshot_date)
);

create index idx_analysis_quality_snapshots_project_id on analysis_quality_snapshots(project_id);
create index idx_analysis_quality_snapshots_date on analysis_quality_snapshots(snapshot_date desc);

create table analysis_conversations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references analysis_reports(id) on delete cascade,
  issue_id uuid references analysis_issues(id) on delete set null,
  messages jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_analysis_conversations_report_id on analysis_conversations(report_id);

create table analysis_saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade,
  name text not null,
  filter_config jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_analysis_saved_filters_user_id on analysis_saved_filters(user_id);

create table notification_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade unique,
  email_enabled boolean not null default true,
  slack_webhook text,
  notify_on_complete boolean not null default true,
  notify_on_critical boolean not null default true,
  notify_on_threshold int check (notify_on_threshold between 0 and 100),
  daily_digest boolean not null default false,
  weekly_digest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Task queue, metrics, audit
-- ============================================================
create table analysis_tasks (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('analyze','export','learn')),
  project_id uuid not null references code_projects(id) on delete cascade,
  report_id uuid references analysis_reports(id) on delete set null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  priority int not null default 5 check (priority between 1 and 10),
  attempts int not null default 0,
  max_attempts int not null default 3,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index idx_analysis_tasks_status on analysis_tasks(status);
create index idx_analysis_tasks_project_id on analysis_tasks(project_id);
create index idx_analysis_tasks_priority on analysis_tasks(priority desc, created_at asc);
create index idx_analysis_tasks_created_at on analysis_tasks(created_at desc);

create table analysis_metrics (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references analysis_reports(id) on delete cascade,
  metric_name text not null,
  metric_value float not null,
  unit text,
  recorded_at timestamptz not null default now()
);

create index idx_analysis_metrics_report_id on analysis_metrics(report_id);
create index idx_analysis_metrics_metric_name on analysis_metrics(metric_name);
create index idx_analysis_metrics_recorded_at on analysis_metrics(recorded_at desc);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  user_id uuid references auth_users(id) on delete set null,
  changes jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_entity_type on audit_logs(entity_type);
create index idx_audit_logs_user_id on audit_logs(user_id);
create index idx_audit_logs_created_at on audit_logs(created_at desc);

-- ============================================================
-- Review runs
-- ============================================================
create table pull_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references code_projects(id) on delete set null,
  provider text not null check (provider in ('github','gitlab')),
  repo_full_name text not null,
  number int not null,
  title text,
  author text,
  url text,
  base_sha text,
  head_sha text,
  status text not null default 'open' check (status in ('open','closed','merged')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, repo_full_name, number)
);

create index idx_pull_requests_project_id on pull_requests(project_id);
create index idx_pull_requests_repo on pull_requests(repo_full_name);

create table review_runs (
  id uuid primary key default gen_random_uuid(),
  pull_request_id uuid references pull_requests(id) on delete cascade,
  project_id uuid references code_projects(id) on delete set null,
  report_id uuid references analysis_reports(id) on delete set null,
  trigger text not null check (trigger in ('webhook','manual','scheduled')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  model text,
  tokens_used int,
  cost numeric(12,4),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_review_runs_pull_request_id on review_runs(pull_request_id);
create index idx_review_runs_project_id on review_runs(project_id);
create index idx_review_runs_report_id on review_runs(report_id);

create table review_comments (
  id uuid primary key default gen_random_uuid(),
  review_run_id uuid references review_runs(id) on delete cascade,
  file text,
  line int,
  severity text,
  body text,
  external_id text,
  created_at timestamptz not null default now()
);

create index idx_review_comments_review_run_id on review_comments(review_run_id);

-- ============================================================
-- Codebase comments
-- ============================================================
create table codebase_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references code_projects(id) on delete cascade,
  repo text not null,
  ref text not null,
  commit_sha text not null check (commit_sha ~* '^[0-9a-f]{7,40}$'),
  path text not null,
  line int not null check (line > 0),
  line_end int,
  selection_text text,
  author_id uuid references auth_users(id) on delete set null,
  author_email citext,
  body text not null,
  created_at timestamptz not null default now(),
  constraint codebase_comments_line_end_check
    check (line_end is null or line_end >= line)
);

create index idx_codebase_comments_project on codebase_comments(project_id);
create index idx_codebase_comments_file on codebase_comments(project_id, ref, path);
create index idx_codebase_comments_line on codebase_comments(project_id, ref, path, line);
create index idx_codebase_comments_line_end on codebase_comments(project_id, ref, path, line_end);
create index idx_codebase_comments_commit on codebase_comments(project_id, commit_sha, path);
create index idx_codebase_comments_commit_line on codebase_comments(project_id, commit_sha, path, line);

create table codebase_comment_assignees (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references codebase_comments(id) on delete cascade,
  user_id uuid not null references auth_users(id) on delete cascade,
  email citext,
  created_at timestamptz not null default now()
);

create unique index uniq_codebase_comment_assignees
  on codebase_comment_assignees(comment_id, user_id);
create index idx_codebase_comment_assignees_comment
  on codebase_comment_assignees(comment_id);
create index idx_codebase_comment_assignees_user
  on codebase_comment_assignees(user_id);

-- ============================================================
-- Rule learning
-- ============================================================
create table quality_rule_feedback (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references quality_rules(id) on delete cascade,
  report_id uuid not null references analysis_reports(id) on delete cascade,
  issue_file text not null,
  issue_line int,
  feedback_type text not null check (feedback_type in ('helpful','not_helpful','false_positive','too_strict','too_lenient')),
  user_id uuid not null references auth_users(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_quality_rule_feedback_rule_id on quality_rule_feedback(rule_id);
create index idx_quality_rule_feedback_report_id on quality_rule_feedback(report_id);

create table quality_rule_stats (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references quality_rules(id) on delete cascade unique,
  total_triggers int not null default 0,
  helpful_count int not null default 0,
  not_helpful_count int not null default 0,
  false_positive_count int not null default 0,
  accuracy_score decimal(5,2),
  last_updated timestamptz not null default now()
);

create table quality_rule_weights (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references code_projects(id) on delete cascade,
  rule_id uuid not null references quality_rules(id) on delete cascade,
  original_weight int not null,
  adjusted_weight int not null,
  adjustment_reason text,
  last_adjusted timestamptz not null default now(),
  unique (project_id, rule_id)
);

create index idx_quality_rule_weights_project on quality_rule_weights(project_id);
create index idx_quality_rule_weights_rule on quality_rule_weights(rule_id);

create table quality_learned_patterns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references code_projects(id) on delete cascade,
  pattern_type text not null check (pattern_type in ('anti_pattern','best_practice','code_smell','optimization')),
  pattern_name text not null,
  pattern_description text not null,
  detection_regex text,
  severity text not null check (severity in ('critical','high','medium','low','info')),
  confidence_score decimal(5,2) not null,
  occurrence_count int not null default 1,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index idx_quality_learned_patterns_project on quality_learned_patterns(project_id);
create index idx_quality_learned_patterns_enabled on quality_learned_patterns(is_enabled);

-- ============================================================
-- Pipeline engine (Runner)
-- ============================================================
create table pipelines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references code_projects(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  current_version_id uuid,
  concurrency_mode text not null default 'allow'
    check (concurrency_mode in ('allow', 'queue', 'cancel_previous')),
  -- Pipeline execution fields
  environment text not null default 'production'
    check (environment in ('development', 'staging', 'production')),
  auto_trigger boolean not null default false,
  trigger_branch text not null default 'main',
  quality_gate_enabled boolean not null default false,
  quality_gate_min_score int not null default 60
    check (quality_gate_min_score between 0 and 100),
  notify_on_success boolean not null default true,
  notify_on_failure boolean not null default true,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pipeline_versions (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  version int not null,
  config jsonb not null,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (pipeline_id, version)
);

alter table pipelines
  add constraint pipelines_current_version_fk
  foreign key (current_version_id) references pipeline_versions(id);

create table pipeline_secrets (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  value_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, name)
);

create index pipeline_secrets_org_pipeline_idx on pipeline_secrets (org_id, pipeline_id);

create table pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  version_id uuid not null references pipeline_versions(id),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references code_projects(id) on delete cascade,
  status text not null,
  trigger_type text not null,
  triggered_by uuid references auth_users(id) on delete set null,
  idempotency_key text,
  attempt int not null default 1,
  error_code text,
  error_message text,
  -- rollback: points to the run being rolled back
  rollback_of uuid references pipeline_runs(id) on delete set null,
  -- commit info captured at trigger time
  commit_sha text,
  commit_message text,
  branch text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint pipeline_runs_status_check check (status in ('queued','running','success','failed','canceled','timed_out','skipped')),
  constraint pipeline_runs_trigger_check check (trigger_type in ('manual','push','schedule','webhook','rollback'))
);

create unique index pipeline_runs_idempotency_unique
  on pipeline_runs (pipeline_id, idempotency_key) where idempotency_key is not null;

create table pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references pipeline_runs(id) on delete cascade,
  job_key text not null,
  name text not null,
  status text not null,
  attempt int not null default 1,
  runner_id text,
  error_message text,
  duration_ms int,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint pipeline_jobs_status_check check (status in ('queued','running','success','failed','canceled','timed_out','skipped')),
  unique (run_id, job_key)
);

create table pipeline_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references pipeline_jobs(id) on delete cascade,
  step_key text not null,
  name text not null,
  status text not null,
  exit_code int,
  timeout_ms int,
  duration_ms int,
  error_message text,
  log_path text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint pipeline_steps_status_check check (status in ('queued','running','success','failed','canceled','timed_out','skipped')),
  unique (job_id, step_key)
);

create sequence pipeline_run_events_seq;

create table pipeline_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references pipeline_runs(id) on delete cascade,
  seq bigint not null default nextval('pipeline_run_events_seq'),
  type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now()
);

create table pipeline_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references pipeline_runs(id) on delete cascade,
  job_id uuid references pipeline_jobs(id) on delete set null,
  step_id uuid references pipeline_steps(id) on delete set null,
  path text not null,
  storage_path text not null,
  size_bytes bigint not null default 0,
  sha256 text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index pipelines_org_project_idx on pipelines (org_id, project_id);
create index pipeline_versions_pipeline_idx on pipeline_versions (pipeline_id);
create index pipeline_runs_pipeline_idx on pipeline_runs (pipeline_id, created_at desc);
create index pipeline_runs_org_project_idx on pipeline_runs (org_id, project_id, created_at desc);
create index pipeline_jobs_run_idx on pipeline_jobs (run_id);
create index pipeline_steps_job_idx on pipeline_steps (job_id);
create index pipeline_run_events_run_idx on pipeline_run_events (run_id, seq);
create index pipeline_artifacts_run_idx on pipeline_artifacts (run_id);

-- ============================================================
-- Functions & triggers
-- ============================================================
create or replace function create_quality_snapshot()
returns trigger as $$
begin
  if new.status = 'done' and old.status != 'done' then
    insert into analysis_quality_snapshots (
      project_id,
      report_id,
      score,
      category_scores,
      total_issues,
      critical_issues,
      high_issues,
      medium_issues,
      low_issues
    )
    values (
      new.project_id,
      new.id,
      new.score,
      new.category_scores,
      (select count(*) from jsonb_array_elements(coalesce(new.issues, '[]'::jsonb))),
      (select count(*) from jsonb_array_elements(coalesce(new.issues, '[]'::jsonb)) where (value->>'severity')::text = 'critical'),
      (select count(*) from jsonb_array_elements(coalesce(new.issues, '[]'::jsonb)) where (value->>'severity')::text = 'high'),
      (select count(*) from jsonb_array_elements(coalesce(new.issues, '[]'::jsonb)) where (value->>'severity')::text = 'medium'),
      (select count(*) from jsonb_array_elements(coalesce(new.issues, '[]'::jsonb)) where (value->>'severity')::text = 'low')
    )
    on conflict (project_id, snapshot_date) do update
    set
      report_id = excluded.report_id,
      score = excluded.score,
      category_scores = excluded.category_scores,
      total_issues = excluded.total_issues,
      critical_issues = excluded.critical_issues,
      high_issues = excluded.high_issues,
      medium_issues = excluded.medium_issues,
      low_issues = excluded.low_issues;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trigger_create_quality_snapshot
after update on analysis_reports
for each row
execute function create_quality_snapshot();

create or replace function update_rule_statistics()
returns trigger as $$
begin
  insert into quality_rule_stats (rule_id, total_triggers)
  values (new.rule_id, 1)
  on conflict (rule_id) do update
  set
    total_triggers = quality_rule_stats.total_triggers + 1,
    helpful_count = quality_rule_stats.helpful_count + case when new.feedback_type = 'helpful' then 1 else 0 end,
    not_helpful_count = quality_rule_stats.not_helpful_count + case when new.feedback_type = 'not_helpful' then 1 else 0 end,
    false_positive_count = quality_rule_stats.false_positive_count + case when new.feedback_type = 'false_positive' then 1 else 0 end,
    accuracy_score = case
      when quality_rule_stats.total_triggers + 1 > 0 then
        ((quality_rule_stats.helpful_count + case when new.feedback_type = 'helpful' then 1 else 0 end)::decimal /
         (quality_rule_stats.total_triggers + 1)::decimal) * 100
      else 0
    end,
    last_updated = now();
  return new;
end;
$$ language plpgsql;

create trigger trigger_update_rule_statistics
after insert on quality_rule_feedback
for each row
execute function update_rule_statistics();

create or replace function auto_adjust_rule_weights(p_org_id uuid)
returns void as $$
declare
  r record;
  new_weight int;
begin
  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  for r in
    select
      rs.rule_id,
      ru.weight as original_weight,
      rs.accuracy_score,
      rs.false_positive_count,
      rs.total_triggers
    from quality_rule_stats rs
    join quality_rules ru on ru.id = rs.rule_id
    join quality_rule_sets rset on rset.id = ru.ruleset_id
    where rset.is_global = false
      and rset.org_id = p_org_id
      and rs.total_triggers >= 10
  loop
    if r.accuracy_score < 50 then
      new_weight := greatest(r.original_weight - 20, 0);
    elsif r.accuracy_score < 70 then
      new_weight := greatest(r.original_weight - 10, 0);
    elsif r.accuracy_score > 90 then
      new_weight := least(r.original_weight + 10, 100);
    else
      new_weight := r.original_weight;
    end if;

    if r.false_positive_count::decimal / r.total_triggers::decimal > 0.3 then
      new_weight := greatest(new_weight - 15, 0);
    end if;

    if new_weight != r.original_weight then
      update quality_rules
      set weight = new_weight
      where id = r.rule_id;
    end if;
  end loop;
end;
$$ language plpgsql;

-- ============================================================
-- Seed data
-- ============================================================
do $$
declare
  v_ruleset_id uuid;
begin
  insert into quality_rule_sets (name, description, is_global)
  values ('General Rules', 'General code quality rules applicable to all projects', true)
  returning id into v_ruleset_id;

  insert into quality_rules (ruleset_id, category, name, prompt, severity, sort_order) values
  (v_ruleset_id, 'style', 'Consistent Quotes', 'All strings must use single quotes. Flag any double-quoted strings in JS/TS code.', 'warning', 10),
  (v_ruleset_id, 'style', 'Semicolons Required', 'All statements must end with a semicolon. Flag missing semicolons.', 'warning', 20),
  (v_ruleset_id, 'style', 'Indentation', 'Code must use 2-space indentation. Flag tab indentation or 4-space indentation.', 'warning', 30),
  (v_ruleset_id, 'style', 'No Unused Variables', 'Flag any imported modules or declared variables that are never used.', 'error', 40),
  (v_ruleset_id, 'style', 'English Logs Only', 'All console.log/error/warn messages must be in English. Flag any non-English log messages.', 'warning', 50);

  insert into quality_rules (ruleset_id, category, name, prompt, severity, sort_order) values
  (v_ruleset_id, 'security', 'No Hardcoded Secrets', 'Flag any hardcoded API keys, tokens, passwords, or secrets in the code.', 'error', 10),
  (v_ruleset_id, 'security', 'No SQL Concatenation', 'Flag any SQL queries built with string concatenation. Parameterized queries must be used.', 'error', 20),
  (v_ruleset_id, 'security', 'XSS Prevention', 'Flag direct use of innerHTML or v-html without sanitization.', 'error', 30);

  insert into quality_rules (ruleset_id, category, name, prompt, severity, sort_order) values
  (v_ruleset_id, 'architecture', 'API Response Format', 'Server API responses must follow the format: { success, code, data } for success and { success, code, message } for errors. Flag direct returns without this structure.', 'error', 10),
  (v_ruleset_id, 'architecture', 'No User Info in Request Params', 'User identity (userId, email) must never be passed via request body or query params. It must be extracted from the auth context/token server-side.', 'error', 20),
  (v_ruleset_id, 'architecture', 'Error Handling', 'Business errors should be returned, not thrown, from API handlers. Flag throw statements in API route handlers where a return would be appropriate.', 'warning', 30);

  insert into quality_rules (ruleset_id, category, name, prompt, severity, sort_order) values
  (v_ruleset_id, 'performance', 'No N+1 Queries', 'Flag database queries inside loops. Batch queries or joins should be used instead.', 'error', 10),
  (v_ruleset_id, 'performance', 'Avoid Redundant API Calls', 'Flag duplicate or redundant API calls that could be cached or deduplicated.', 'warning', 20);

  insert into quality_rules (ruleset_id, category, name, prompt, severity, sort_order) values
  (v_ruleset_id, 'maintainability', 'Function Length', 'Flag functions exceeding 60 lines. Large functions should be broken into smaller, focused units.', 'warning', 10),
  (v_ruleset_id, 'maintainability', 'Meaningful Names', 'Flag single-letter variables (except loop counters), or vague names like "data", "info", "temp" used as top-level identifiers.', 'info', 20),
  (v_ruleset_id, 'maintainability', 'No Magic Numbers', 'Flag unexplained numeric literals. Constants should be named and defined separately.', 'info', 30);
end $$;
