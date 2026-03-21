create table if not exists artifact_blobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  storage_path text not null,
  size_bytes bigint not null default 0,
  sha256 text not null,
  created_at timestamptz not null default now(),
  unique (org_id, sha256)
);

create table if not exists artifact_repositories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references code_projects(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table if not exists artifact_versions (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references artifact_repositories(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references code_projects(id) on delete cascade,
  version text not null,
  status text not null default 'published'
    check (status in ('published', 'archived')),
  source_run_id uuid references pipeline_runs(id) on delete set null,
  source_pipeline_id uuid references pipelines(id) on delete set null,
  source_commit_sha text,
  source_branch text,
  manifest jsonb not null default '{}'::jsonb,
  published_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repository_id, version)
);

create table if not exists artifact_files (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references artifact_versions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  blob_id uuid not null references artifact_blobs(id) on delete restrict,
  logical_path text not null,
  file_name text not null,
  created_at timestamptz not null default now(),
  unique (version_id, logical_path)
);

create table if not exists artifact_channels (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references artifact_repositories(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references code_projects(id) on delete cascade,
  name text not null,
  version_id uuid not null references artifact_versions(id) on delete restrict,
  updated_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repository_id, name)
);

create table if not exists artifact_version_usages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references code_projects(id) on delete cascade,
  repository_id uuid not null references artifact_repositories(id) on delete cascade,
  version_id uuid not null references artifact_versions(id) on delete restrict,
  pipeline_run_id uuid references pipeline_runs(id) on delete cascade,
  pipeline_job_id uuid references pipeline_jobs(id) on delete set null,
  environment text,
  channel_name text,
  usage_type text not null check (usage_type in ('deployment', 'download', 'promotion')),
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists artifact_blobs_org_storage_idx
  on artifact_blobs (org_id, storage_path);
create index if not exists artifact_blobs_org_sha_idx
  on artifact_blobs (org_id, sha256);
create index if not exists artifact_repositories_project_idx
  on artifact_repositories (project_id, created_at desc);
create index if not exists artifact_versions_repository_idx
  on artifact_versions (repository_id, created_at desc);
create index if not exists artifact_versions_project_idx
  on artifact_versions (project_id, created_at desc);
create index if not exists artifact_files_version_idx
  on artifact_files (version_id, logical_path);
create index if not exists artifact_channels_repository_idx
  on artifact_channels (repository_id, updated_at desc);
create index if not exists artifact_version_usages_version_idx
  on artifact_version_usages (version_id, created_at desc);
create index if not exists artifact_version_usages_run_idx
  on artifact_version_usages (pipeline_run_id, created_at desc);
