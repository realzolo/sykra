create extension if not exists "pgcrypto";

create table if not exists pipelines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  current_version_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pipeline_versions (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  version int not null,
  config jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (pipeline_id, version)
);

alter table pipelines
  add constraint pipelines_current_version_fk
  foreign key (current_version_id) references pipeline_versions(id);

create table if not exists pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  version_id uuid not null references pipeline_versions(id),
  org_id uuid not null,
  project_id uuid not null,
  status text not null,
  trigger_type text not null,
  triggered_by uuid,
  idempotency_key text,
  attempt int not null default 1,
  error_code text,
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint pipeline_runs_status_check check (status in ('queued','running','success','failed','canceled','timed_out','skipped')),
  constraint pipeline_runs_trigger_check check (trigger_type in ('manual','push','schedule','webhook'))
);

create unique index if not exists pipeline_runs_idempotency_unique
  on pipeline_runs (pipeline_id, idempotency_key) where idempotency_key is not null;

create table if not exists pipeline_jobs (
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

create table if not exists pipeline_steps (
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

create sequence if not exists run_events_seq;

create table if not exists run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references pipeline_runs(id) on delete cascade,
  seq bigint not null default nextval('run_events_seq'),
  type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now()
);

create table if not exists pipeline_artifacts (
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

create index if not exists pipelines_org_project_idx on pipelines (org_id, project_id);
create index if not exists pipeline_versions_pipeline_idx on pipeline_versions (pipeline_id);
create index if not exists pipeline_runs_pipeline_idx on pipeline_runs (pipeline_id, created_at desc);
create index if not exists pipeline_runs_org_project_idx on pipeline_runs (org_id, project_id, created_at desc);
create index if not exists pipeline_jobs_run_idx on pipeline_jobs (run_id);
create index if not exists pipeline_steps_job_idx on pipeline_steps (job_id);
create index if not exists run_events_run_idx on run_events (run_id, seq);
create index if not exists pipeline_artifacts_run_idx on pipeline_artifacts (run_id);
