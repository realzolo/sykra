-- 013_orchestrator_dag_schema.sql
-- Canonicalize pipeline schema for DAG-first orchestrator design.

begin;

-- Remove duplicated pipeline metadata columns.
alter table pipelines
  drop column if exists environment,
  drop column if exists auto_trigger,
  drop column if exists trigger_branch,
  drop column if exists quality_gate_enabled,
  drop column if exists quality_gate_min_score,
  drop column if exists notify_on_success,
  drop column if exists notify_on_failure;

-- Ensure pipeline job assignment column exists with canonical naming.
alter table pipeline_jobs
  add column if not exists worker_id text;

-- Ensure worker registry table exists with canonical schema.
create table if not exists worker_nodes (
  id text primary key,
  hostname text,
  version text,
  labels jsonb not null default '{}',
  capabilities text[] not null default '{}',
  status text not null default 'online'
    check (status in ('online', 'offline', 'draining')),
  max_concurrency int not null default 1 check (max_concurrency > 0),
  current_load int not null default 0 check (current_load >= 0),
  last_heartbeat_at timestamptz not null default now(),
  connected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists worker_nodes_status_idx on worker_nodes (status);
create index if not exists worker_nodes_last_heartbeat_idx on worker_nodes (last_heartbeat_at desc);

commit;
