import { basename } from 'node:path';
import type { PoolClient, QueryResultRow } from 'pg';
import { execTx, query, queryOne, withTransaction } from '@/lib/db';
import { asJsonObject, type JsonObject } from '@/lib/json';

export const ARTIFACT_CHANNEL_PRESETS = ['dev', 'preview', 'prod', 'latest'] as const;
export type ArtifactChannelPreset = (typeof ARTIFACT_CHANNEL_PRESETS)[number];

export type ArtifactFileSummary = {
  id: string;
  version_id: string;
  blob_id: string;
  logical_path: string;
  file_name: string;
  size_bytes: number;
  sha256: string | null;
  created_at: string;
};

export type ArtifactVersionSummary = {
  id: string;
  repository_id: string;
  org_id: string;
  project_id: string;
  version: string;
  status: 'published' | 'archived';
  source_run_id: string | null;
  source_pipeline_id: string | null;
  source_commit_sha: string | null;
  source_branch: string | null;
  manifest: JsonObject;
  published_by: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
  total_size_bytes: number;
  files: ArtifactFileSummary[];
};

export type ArtifactChannelSummary = {
  id: string;
  repository_id: string;
  org_id: string;
  project_id: string;
  name: string;
  version_id: string;
  target_version: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RunArtifactReleaseSummary = {
  repository_id: string;
  repository_name: string;
  repository_slug: string;
  version_id: string;
  version: string;
  source_run_id: string | null;
  source_pipeline_id: string | null;
  source_commit_sha: string | null;
  source_branch: string | null;
  published_by: string | null;
  published_by_name?: string | null;
  published_by_email?: string | null;
  published_at: string;
  channel_names: string[];
};

export type ArtifactRepositorySummary = {
  id: string;
  org_id: string;
  project_id: string;
  slug: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version_count: number;
  channel_count: number;
  latest_published_at: string | null;
  versions: ArtifactVersionSummary[];
  channels: ArtifactChannelSummary[];
};

type PublishProjectArtifactsInput = {
  orgId: string;
  projectId: string;
  runId: string;
  artifactIds: string[];
  repositoryName: string;
  repositorySlug?: string;
  repositoryDescription?: string;
  version: string;
  channelNames?: string[];
  publishedBy: string;
};

type PromoteArtifactChannelInput = {
  orgId: string;
  projectId: string;
  repositoryId: string;
  versionId: string;
  channelName: string;
  updatedBy: string;
};

type PublishableRunArtifact = {
  id: string;
  path: string;
  storage_path: string;
  size_bytes: string;
  sha256: string | null;
};

type ArtifactRepositoryRow = Omit<ArtifactRepositorySummary, 'versions' | 'channels'>;
type ArtifactVersionRow = Omit<ArtifactVersionSummary, 'files' | 'total_size_bytes'> & {
  total_size_bytes: string;
};

function queryOneTx<T extends QueryResultRow>(client: PoolClient, text: string, params: unknown[] = []) {
  return client.query<T>(text, params).then((result) => result.rows[0] ?? null);
}

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeArtifactRepositorySlug(value: string) {
  return normalizeIdentifier(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function validateArtifactRepositorySlug(value: string) {
  if (!value) return 'Repository slug is required';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) {
    return 'Use lowercase letters, numbers, and hyphens only';
  }
  return null;
}

export function validateArtifactVersion(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 'Version is required';
  if (trimmed.length > 128) return 'Version must be 128 characters or fewer';
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(trimmed)) {
    return 'Use letters, numbers, dots, underscores, plus signs, or hyphens';
  }
  return null;
}

export function normalizeArtifactChannelNames(values: string[] | undefined) {
  if (!values) return [];
  return Array.from(
    new Set(
      values
        .map((item) => normalizeIdentifier(item).replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, ''))
        .filter(Boolean)
        .slice(0, 16)
    )
  );
}

export async function listProjectArtifactRepositories(projectId: string, orgId: string) {
  const repositories = await query<ArtifactRepositoryRow>(
    `select r.id, r.org_id, r.project_id, r.slug, r.name, r.description, r.created_by,
            r.created_at, r.updated_at,
            coalesce(count(distinct v.id), 0)::int as version_count,
            coalesce(count(distinct c.id), 0)::int as channel_count,
            max(v.created_at) as latest_published_at
       from artifact_repositories r
       left join artifact_versions v on v.repository_id = r.id
       left join artifact_channels c on c.repository_id = r.id
      where r.project_id = $1 and r.org_id = $2
      group by r.id
      order by r.name asc`,
    [projectId, orgId]
  );

  const versions = await query<ArtifactVersionRow>(
    `select v.id, v.repository_id, v.org_id, v.project_id, v.version, v.status,
            v.source_run_id, v.source_pipeline_id, v.source_commit_sha, v.source_branch,
            v.manifest, v.published_by, v.created_at, v.updated_at,
            coalesce(count(f.id), 0)::int as file_count,
            coalesce(sum(b.size_bytes), 0)::text as total_size_bytes
       from artifact_versions v
       left join artifact_files f on f.version_id = v.id
       left join artifact_blobs b on b.id = f.blob_id
      where v.project_id = $1 and v.org_id = $2
      group by v.id
      order by v.created_at desc`,
    [projectId, orgId]
  );

  const files = await query<Omit<ArtifactFileSummary, 'size_bytes'> & { size_bytes: string }>(
    `select f.id, f.version_id, f.blob_id, f.logical_path, f.file_name,
            b.size_bytes::text as size_bytes,
            b.sha256, f.created_at
       from artifact_files f
       join artifact_blobs b on b.id = f.blob_id
       join artifact_versions v on v.id = f.version_id
      where v.project_id = $1 and v.org_id = $2
      order by f.logical_path asc`,
    [projectId, orgId]
  );

  const channels = await query<ArtifactChannelSummary>(
    `select c.id, c.repository_id, c.org_id, c.project_id, c.name, c.version_id,
            v.version as target_version, c.updated_by, c.created_at, c.updated_at
       from artifact_channels c
       join artifact_versions v on v.id = c.version_id
      where c.project_id = $1 and c.org_id = $2
      order by c.name asc`,
    [projectId, orgId]
  );

  const filesByVersion = new Map<string, ArtifactFileSummary[]>();
  for (const file of files) {
    const normalizedFile: ArtifactFileSummary = {
      ...file,
      size_bytes: Number.parseInt(file.size_bytes, 10) || 0,
    };
    const list = filesByVersion.get(file.version_id);
    if (list) {
      list.push(normalizedFile);
    } else {
      filesByVersion.set(file.version_id, [normalizedFile]);
    }
  }

  const versionsByRepository = new Map<string, ArtifactVersionSummary[]>();
  for (const version of versions) {
    const item: ArtifactVersionSummary = {
      ...version,
      manifest: asJsonObject(version.manifest) ?? {},
      total_size_bytes: Number.parseInt(version.total_size_bytes, 10) || 0,
      files: filesByVersion.get(version.id) ?? [],
    };
    const list = versionsByRepository.get(version.repository_id);
    if (list) {
      list.push(item);
    } else {
      versionsByRepository.set(version.repository_id, [item]);
    }
  }

  const channelsByRepository = new Map<string, ArtifactChannelSummary[]>();
  for (const channel of channels) {
    const list = channelsByRepository.get(channel.repository_id);
    if (list) {
      list.push(channel);
    } else {
      channelsByRepository.set(channel.repository_id, [channel]);
    }
  }

  return repositories.map<ArtifactRepositorySummary>((repository) => ({
    ...repository,
    versions: versionsByRepository.get(repository.id) ?? [],
    channels: channelsByRepository.get(repository.id) ?? [],
  }));
}

export async function publishProjectArtifacts(input: PublishProjectArtifactsInput) {
  const repositoryName = input.repositoryName.trim();
  const repositorySlug = normalizeArtifactRepositorySlug(input.repositorySlug?.trim() || repositoryName);
  const version = input.version.trim();
  const channelNames = normalizeArtifactChannelNames(input.channelNames);

  if (!repositoryName) {
    throw new Error('Repository name is required');
  }
  const repositorySlugError = validateArtifactRepositorySlug(repositorySlug);
  if (repositorySlugError) {
    throw new Error(repositorySlugError);
  }
  const versionError = validateArtifactVersion(version);
  if (versionError) {
    throw new Error(versionError);
  }
  if (input.artifactIds.length === 0) {
    throw new Error('Select at least one run artifact to publish');
  }

  return withTransaction(async (client) => {
    const run = await queryOneTx<{
      id: string;
      org_id: string;
      project_id: string | null;
      pipeline_id: string;
      commit_sha: string | null;
      branch: string | null;
    }>(
      client,
      `select id, org_id, project_id, pipeline_id, commit_sha, branch
         from pipeline_runs
        where id = $1 and org_id = $2 and project_id = $3`,
      [input.runId, input.orgId, input.projectId]
    );
    if (!run) {
      throw new Error('Pipeline run not found');
    }

    const artifacts = await client.query<PublishableRunArtifact>(
      `select id, path, storage_path, size_bytes::text, sha256
         from pipeline_artifacts
        where run_id = $1 and id = any($2::uuid[])
        order by created_at asc`,
      [input.runId, input.artifactIds]
    );
    if (artifacts.rows.length !== input.artifactIds.length) {
      throw new Error('One or more run artifacts no longer exist');
    }

    let repository = await queryOneTx<{ id: string }>(
      client,
      `select id
         from artifact_repositories
        where project_id = $1 and slug = $2`,
      [input.projectId, repositorySlug]
    );
    if (!repository) {
      repository = await queryOneTx<{ id: string }>(
        client,
        `insert into artifact_repositories
           (org_id, project_id, slug, name, description, created_by, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, now(), now())
         returning id`,
        [
          input.orgId,
          input.projectId,
          repositorySlug,
          repositoryName,
          input.repositoryDescription?.trim() || null,
          input.publishedBy,
        ]
      );
    } else {
      await execTx(client,
        `update artifact_repositories
            set name = $2,
                description = $3,
                updated_at = now()
          where id = $1`,
        [repository.id, repositoryName, input.repositoryDescription?.trim() || null]
      );
    }
    if (!repository) {
      throw new Error('Failed to create artifact repository');
    }

    const existingVersion = await queryOneTx<{ id: string }>(
      client,
      `select id
         from artifact_versions
        where repository_id = $1 and version = $2`,
      [repository.id, version]
    );
    if (existingVersion) {
      throw new Error('This repository version already exists');
    }

    let totalSizeBytes = 0;
    for (const artifact of artifacts.rows) {
      totalSizeBytes += Number.parseInt(artifact.size_bytes, 10) || 0;
    }
    const manifest = {
      source: 'pipeline_run',
      fileCount: artifacts.rows.length,
      totalSizeBytes,
    };

    const createdVersion = await queryOneTx<{ id: string }>(
      client,
      `insert into artifact_versions
         (repository_id, org_id, project_id, version, status, source_run_id, source_pipeline_id,
          source_commit_sha, source_branch, manifest, published_by, created_at, updated_at)
       values ($1, $2, $3, $4, 'published', $5, $6, $7, $8, $9::jsonb, $10, now(), now())
       returning id`,
      [
        repository.id,
        input.orgId,
        input.projectId,
        version,
        input.runId,
        run.pipeline_id,
        run.commit_sha,
        run.branch,
        JSON.stringify(manifest),
        input.publishedBy,
      ]
    );
    if (!createdVersion) {
      throw new Error('Failed to create artifact version');
    }

    for (const artifact of artifacts.rows) {
      if (!artifact.sha256) {
        throw new Error(`Run artifact ${artifact.path} is missing sha256`);
      }

      const blob = await queryOneTx<{ id: string }>(
        client,
        `insert into artifact_blobs (org_id, storage_path, size_bytes, sha256, created_at)
         values ($1, $2, $3, $4, now())
         on conflict (org_id, sha256)
         do update
           set size_bytes = excluded.size_bytes
         returning id`,
        [
          input.orgId,
          artifact.storage_path,
          Number.parseInt(artifact.size_bytes, 10) || 0,
          artifact.sha256,
        ]
      );
      if (!blob) {
        throw new Error('Failed to store artifact blob');
      }

      await execTx(client,
        `insert into artifact_files
           (version_id, org_id, blob_id, logical_path, file_name, created_at)
         values ($1, $2, $3, $4, $5, now())`,
        [
          createdVersion.id,
          input.orgId,
          blob.id,
          artifact.path,
          basename(artifact.path),
        ]
      );
    }

    for (const channelName of channelNames) {
      await execTx(client,
        `insert into artifact_channels
           (repository_id, org_id, project_id, name, version_id, updated_by, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, now(), now())
         on conflict (repository_id, name)
         do update
           set version_id = excluded.version_id,
               updated_by = excluded.updated_by,
               updated_at = now()`,
        [repository.id, input.orgId, input.projectId, channelName, createdVersion.id, input.publishedBy]
      );
    }

    return {
      repositoryId: repository.id,
      versionId: createdVersion.id,
    };
  });
}

export async function listRunArtifactReleases(runId: string, orgId: string) {
  return query<RunArtifactReleaseSummary>(
    `select v.repository_id, r.name as repository_name, r.slug as repository_slug,
            v.id as version_id, v.version,
            v.source_run_id, v.source_pipeline_id, v.source_commit_sha, v.source_branch,
            v.published_by, v.created_at as published_at,
            coalesce(array_agg(c.name order by c.name) filter (where c.name is not null), '{}'::text[]) as channel_names
       from artifact_versions v
       join artifact_repositories r on r.id = v.repository_id
       join pipeline_runs pr on pr.id = v.source_run_id and pr.org_id = $2
       left join artifact_channels c on c.version_id = v.id
      where v.source_run_id = $1
        and v.org_id = $2
        and v.status = 'published'
      group by v.id, r.id, pr.id
      order by v.created_at asc`,
    [runId, orgId]
  );
}

export async function promoteProjectArtifactChannel(input: PromoteArtifactChannelInput) {
  const channelName = normalizeArtifactChannelNames([input.channelName])[0];
  if (!channelName) {
    throw new Error('Channel name is required');
  }

  return withTransaction(async (client) => {
    const version = await queryOneTx<{
      repository_id: string;
    }>(
      client,
      `select repository_id
         from artifact_versions
        where id = $1 and repository_id = $2 and org_id = $3 and project_id = $4`,
      [input.versionId, input.repositoryId, input.orgId, input.projectId]
    );
    if (!version) {
      throw new Error('Artifact version not found');
    }

    const channel = await queryOneTx<ArtifactChannelSummary>(
      client,
      `insert into artifact_channels
         (repository_id, org_id, project_id, name, version_id, updated_by, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, now(), now())
       on conflict (repository_id, name)
       do update
         set version_id = excluded.version_id,
             updated_by = excluded.updated_by,
             updated_at = now()
       returning id, repository_id, org_id, project_id, name, version_id,
                 ''::text as target_version, updated_by, created_at, updated_at`,
      [input.repositoryId, input.orgId, input.projectId, channelName, input.versionId, input.updatedBy]
    );
    if (!channel) {
      throw new Error('Failed to update artifact channel');
    }

    const hydrated = await queryOne<ArtifactChannelSummary>(
      `select c.id, c.repository_id, c.org_id, c.project_id, c.name, c.version_id,
              v.version as target_version, c.updated_by, c.created_at, c.updated_at
         from artifact_channels c
         join artifact_versions v on v.id = c.version_id
        where c.id = $1`,
      [channel.id]
    );
    if (!hydrated) {
      throw new Error('Updated artifact channel could not be loaded');
    }
    return hydrated;
  });
}

export async function getProjectArtifactFile(projectId: string, orgId: string, fileId: string) {
  return queryOne<{
    id: string;
    org_id: string;
    project_id: string;
    repository_id: string;
    version_id: string;
    logical_path: string;
    file_name: string;
    storage_path: string;
    size_bytes: string;
    sha256: string | null;
  }>(
    `select f.id, f.org_id, v.project_id, v.repository_id, f.version_id, f.logical_path, f.file_name,
            b.storage_path, b.size_bytes::text, b.sha256
       from artifact_files f
       join artifact_versions v on v.id = f.version_id
       join artifact_blobs b on b.id = f.blob_id
      where f.id = $1 and f.org_id = $2 and v.project_id = $3`,
    [fileId, orgId, projectId]
  );
}
