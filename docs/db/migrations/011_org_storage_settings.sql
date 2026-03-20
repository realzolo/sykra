create table if not exists org_storage_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  provider text not null check (provider in ('local', 's3')),
  config jsonb not null default '{}',
  updated_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_storage_settings_provider_idx on org_storage_settings (provider);
