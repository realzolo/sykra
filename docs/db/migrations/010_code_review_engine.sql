create table code_review_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  name text not null,
  description text,
  is_global boolean not null default false,
  is_default boolean not null default false,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint code_review_profiles_org_scope_check
    check (
      (is_global = true and org_id is null) or
      (is_global = false and org_id is not null)
    )
);

create index idx_code_review_profiles_org_id on code_review_profiles(org_id);
create index idx_code_review_profiles_org_default on code_review_profiles(org_id, is_default) where is_default = true;

create or replace function ensure_single_default_code_review_profile()
returns trigger as $$
begin
  if new.is_default = true then
    update code_review_profiles
    set is_default = false
    where coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(new.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and id != new.id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trigger_ensure_single_default_code_review_profile
  after insert or update on code_review_profiles
  for each row
  when (new.is_default = true)
  execute function ensure_single_default_code_review_profile();

create table code_review_profile_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references code_review_profiles(id) on delete cascade,
  version int not null check (version > 0),
  status text not null default 'active' check (status in ('draft','active','archived')),
  config jsonb not null,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (profile_id, version)
);

create index idx_code_review_profile_versions_profile_id on code_review_profile_versions(profile_id, version desc);

create table code_review_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references code_projects(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references code_review_profiles(id) on delete restrict,
  profile_version_id uuid not null references code_review_profile_versions(id) on delete restrict,
  scope_mode text not null check (scope_mode in ('diff','full')),
  base_ref text,
  head_ref text,
  commits jsonb not null default '[]',
  status text not null default 'pending'
    check (status in ('pending','running','completed','partial_failed','failed','canceled')),
  gate_status text not null default 'pending'
    check (gate_status in ('pending','passed','warning','blocked','skipped')),
  score int check (score between 0 and 100),
  risk_level text check (risk_level in ('low','medium','high','critical')),
  summary text,
  result jsonb,
  progress jsonb,
  sse_seq bigint not null default 0,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_code_review_runs_project_id on code_review_runs(project_id, created_at desc);
create index idx_code_review_runs_org_id on code_review_runs(org_id, created_at desc);
create index idx_code_review_runs_status on code_review_runs(status, created_at desc);

create table code_review_stages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references code_review_runs(id) on delete cascade,
  stage text not null
    check (stage in ('prepare','baseline_scan','normalize','ai_review','fusion','gate','finalize')),
  status text not null
    check (status in ('pending','running','completed','failed','canceled','skipped')),
  payload jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (run_id, stage)
);

create index idx_code_review_stages_run_id on code_review_stages(run_id, updated_at desc);

create table code_review_tool_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references code_review_runs(id) on delete cascade,
  tool text not null,
  version text,
  status text not null
    check (status in ('pending','running','completed','failed','skipped')),
  command text,
  exit_code int,
  duration_ms int,
  artifact_path text,
  stdout_excerpt text,
  stderr_excerpt text,
  metadata jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index idx_code_review_tool_runs_run_id on code_review_tool_runs(run_id, tool);

create table code_review_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references code_review_runs(id) on delete cascade,
  stage text not null check (stage in ('baseline_scan','ai_review','fusion')),
  source text not null check (source in ('baseline','ai','fused')),
  tool text,
  rule_id text,
  fingerprint text not null,
  category text not null,
  severity text not null check (severity in ('critical','high','medium','low','info')),
  confidence numeric(5,2),
  title text not null,
  message text not null,
  file text not null,
  line int,
  end_line int,
  suggestion text,
  fix_patch text,
  priority int check (priority between 1 and 5),
  impact_scope text,
  status text not null default 'open' check (status in ('open','fixed','ignored','false_positive','planned')),
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, fingerprint)
);

create index idx_code_review_findings_run_id on code_review_findings(run_id, severity, created_at);
create index idx_code_review_findings_file on code_review_findings(run_id, file, line);

create table code_review_finding_evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references code_review_findings(id) on delete cascade,
  kind text not null check (kind in ('scanner_result','diff_hunk','code_snippet','ai_reasoning')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index idx_code_review_finding_evidence_finding_id on code_review_finding_evidence(finding_id);

create table code_review_conversations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references code_review_runs(id) on delete cascade,
  finding_id uuid references code_review_findings(id) on delete set null,
  title text,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_code_review_conversations_run_id on code_review_conversations(run_id, updated_at desc);

create table code_review_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references code_review_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_code_review_conversation_messages_conversation_id on code_review_conversation_messages(conversation_id, created_at asc);

create table code_review_suppressions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references code_projects(id) on delete cascade,
  rule_id text,
  fingerprint text,
  file_pattern text,
  reason text not null,
  expires_at timestamptz,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint code_review_suppressions_match_check
    check (rule_id is not null or fingerprint is not null or file_pattern is not null)
);

create index idx_code_review_suppressions_project_id on code_review_suppressions(project_id, created_at desc);

create or replace function notify_code_review_run_update() returns trigger as $$
declare
  payload json;
begin
  if TG_TABLE_NAME = 'code_review_runs' then
    payload := json_build_object(
      'runId', NEW.id::text,
      'source', 'code_review_runs'
    );
  elsif TG_TABLE_NAME = 'code_review_stages' then
    payload := json_build_object(
      'runId', NEW.run_id::text,
      'source', 'code_review_stages'
    );
  elsif TG_TABLE_NAME = 'code_review_tool_runs' then
    payload := json_build_object(
      'runId', NEW.run_id::text,
      'source', 'code_review_tool_runs'
    );
  else
    return NEW;
  end if;

  perform pg_notify('code_review_run_updates', payload::text);
  return NEW;
end;
$$ language plpgsql;

create trigger trg_notify_code_review_runs
after insert or update on code_review_runs
for each row execute function notify_code_review_run_update();

create trigger trg_notify_code_review_stages
after insert or update on code_review_stages
for each row execute function notify_code_review_run_update();

create trigger trg_notify_code_review_tool_runs
after insert or update on code_review_tool_runs
for each row execute function notify_code_review_run_update();

insert into code_review_profiles (name, description, is_global, is_default)
values ('Default AI-First Review', 'Unified code review policy combining baseline deterministic checks with AI deep review.', true, true);

insert into code_review_profile_versions (profile_id, version, status, config)
select
  p.id,
  1,
  'active',
  jsonb_build_object(
    'baseline',
    jsonb_build_object(
      'tools',
      jsonb_build_array(
        jsonb_build_object('tool', 'eslint', 'enabled', true),
        jsonb_build_object('tool', 'tsc', 'enabled', true),
        jsonb_build_object('tool', 'semgrep', 'enabled', true),
        jsonb_build_object('tool', 'gitleaks', 'enabled', true),
        jsonb_build_object('tool', 'golangci-lint', 'enabled', true),
        jsonb_build_object('tool', 'go-vet', 'enabled', true)
      )
    ),
    'ai',
    jsonb_build_object(
      'focus', jsonb_build_array('architecture', 'security', 'performance', 'maintainability'),
      'maxHotspotFiles', 12
    ),
    'gate',
    jsonb_build_object(
      'blockOn', jsonb_build_array('critical-baseline', 'high-security', 'secrets', 'type-errors')
    )
  )
from code_review_profiles p
where p.name = 'Default AI-First Review'
  and not exists (
    select 1 from code_review_profile_versions v where v.profile_id = p.id and v.version = 1
  );
