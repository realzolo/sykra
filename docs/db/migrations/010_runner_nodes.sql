create table if not exists runner_nodes (
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

create index if not exists runner_nodes_status_idx on runner_nodes (status);
create index if not exists runner_nodes_last_heartbeat_idx on runner_nodes (last_heartbeat_at desc);
