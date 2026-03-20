alter table code_projects
  add column if not exists artifact_retention_days int
    check (artifact_retention_days between 1 and 3650);

create table if not exists pipeline_artifact_download_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references code_projects(id) on delete set null,
  run_id uuid not null references pipeline_runs(id) on delete cascade,
  artifact_id uuid not null,
  artifact_path text,
  status text not null check (status in ('success', 'failed')),
  error_category text,
  error_message text,
  duration_ms int not null default 0 check (duration_ms >= 0),
  requester_user_id uuid references auth_users(id) on delete set null,
  requester_ip text,
  requester_user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_artifact_download_events_project_idx
  on pipeline_artifact_download_events (project_id, created_at desc);
create index if not exists pipeline_artifact_download_events_run_idx
  on pipeline_artifact_download_events (run_id, created_at desc);
create index if not exists pipeline_artifact_download_events_artifact_idx
  on pipeline_artifact_download_events (artifact_id, created_at desc);
create index if not exists pipeline_artifact_download_events_status_idx
  on pipeline_artifact_download_events (status, created_at desc);

alter table pipeline_artifact_download_events
  drop constraint if exists pipeline_artifact_download_events_artifact_id_fkey;
