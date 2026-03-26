'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Download, GitBranch, GitCommit, Package, Tag } from 'lucide-react';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { useOrgRole } from '@/lib/useOrgRole';
import { formatLocalDateTime } from '@/lib/dateFormat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageLoading } from '@/components/ui/page-loading';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ArtifactRepositorySummary } from '@/services/artifactRegistry';

function formatBytes(value: number) {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export default function ProjectArtifactsView({
  projectId,
  dict,
}: {
  projectId: string;
  dict: Dictionary;
}) {
  const { isAdmin } = useOrgRole();
  const a = dict.artifacts;

  const [repositories, setRepositories] = useState<ArtifactRepositorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteRepositoryId, setPromoteRepositoryId] = useState<string | null>(null);
  const [promoteVersionId, setPromoteVersionId] = useState<string | null>(null);
  const [promoteChannel, setPromoteChannel] = useState('preview');
  const [promoting, setPromoting] = useState(false);

  const loadRepositories = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/artifacts`, { cache: 'no-store' });
      const payload = response.ok ? await response.json() : null;
      setRepositories(Array.isArray(payload?.repositories) ? payload.repositories : []);
    } catch {
      setRepositories([]);
      toast.error(a.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [a.loadFailed, projectId]);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  const summary = useMemo(() => {
    let versionCount = 0;
    let fileCount = 0;
    let totalBytes = 0;
    for (const repository of repositories) {
      versionCount += repository.versions.length;
      for (const version of repository.versions) {
        fileCount += version.file_count;
        totalBytes += version.total_size_bytes;
      }
    }
    return {
      repositoryCount: repositories.length,
      versionCount,
      fileCount,
      totalBytes,
    };
  }, [repositories]);

  async function downloadFile(fileId: string) {
    window.location.href = `/api/projects/${projectId}/artifacts/files/${fileId}/download`;
  }

  async function submitPromote() {
    if (!promoteRepositoryId || !promoteVersionId || !promoteChannel.trim()) return;
    setPromoting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/artifacts/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repositoryId: promoteRepositoryId,
          versionId: promoteVersionId,
          channelName: promoteChannel.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || a.promoteFailed);
      }
      setPromoteOpen(false);
      setPromoteRepositoryId(null);
      setPromoteVersionId(null);
      setPromoteChannel('preview');
      await loadRepositories();
      toast.success(a.promoteSuccess);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : a.promoteFailed);
    } finally {
      setPromoting(false);
    }
  }

  if (loading) {
    return <PageLoading label={a.title} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[hsl(var(--ds-border-1))] bg-background px-6 py-4 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold text-foreground">{a.title}</div>
            <div className="mt-0.5 text-[13px] text-[hsl(var(--ds-text-2))]">
              {a.description}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-[hsl(var(--ds-text-2))]">
            <Badge variant="muted" size="sm">{a.summaryRepositories.replace('{{count}}', String(summary.repositoryCount))}</Badge>
            <Badge variant="muted" size="sm">{a.summaryVersions.replace('{{count}}', String(summary.versionCount))}</Badge>
            <Badge variant="muted" size="sm">{a.summaryFiles.replace('{{count}}', String(summary.fileCount))}</Badge>
          </div>
        </div>
      </div>

      <div className="border-b border-[hsl(var(--ds-border-1))] bg-background px-6 py-3 shrink-0">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{a.summaryRepositoriesLabel}</div>
            <div className="mt-1 text-[16px] font-semibold text-foreground">{summary.repositoryCount}</div>
          </div>
          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{a.summaryVersionsLabel}</div>
            <div className="mt-1 text-[16px] font-semibold text-foreground">{summary.versionCount}</div>
          </div>
          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{a.summaryFilesLabel}</div>
            <div className="mt-1 text-[16px] font-semibold text-foreground">{summary.fileCount}</div>
          </div>
          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{a.summaryStorageLabel}</div>
            <div className="mt-1 text-[16px] font-semibold text-foreground">{formatBytes(summary.totalBytes)}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {repositories.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-6 py-20">
            <div className="rounded-[10px] bg-[hsl(var(--ds-surface-1))] p-3">
              <Boxes className="size-5 text-[hsl(var(--ds-text-2))]" />
            </div>
            <div className="text-[14px] font-medium text-foreground">{a.emptyTitle}</div>
            <div className="max-w-xl text-[13px] text-[hsl(var(--ds-text-2))]">{a.emptyDescription}</div>
          </div>
        ) : (
          <div className="space-y-6 px-6 py-6">
            {repositories.map((repository) => (
              <section key={repository.id} className="overflow-hidden rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-background">
                <div className="border-b border-[hsl(var(--ds-border-1))] px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="rounded-[8px] bg-[hsl(var(--ds-surface-1))] p-2">
                          <Package className="size-4 text-[hsl(var(--ds-text-2))]" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-semibold text-foreground">{repository.name}</div>
                          <div className="truncate text-[12px] text-[hsl(var(--ds-text-2))]">{repository.slug}</div>
                        </div>
                      </div>
                      {repository.description && (
                        <div className="mt-3 text-[13px] text-[hsl(var(--ds-text-2))]">{repository.description}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {repository.channels.length === 0 ? (
                        <Badge variant="muted" size="sm">{a.noChannels}</Badge>
                      ) : (
                        repository.channels.map((channel) => (
                          <Badge key={channel.id} variant="accent" size="sm">
                            {channel.name} → {channel.target_version}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-[hsl(var(--ds-border-1))]">
                  {repository.versions.map((version) => (
                    <div key={version.id}>
                      <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[14px] font-semibold text-foreground">{version.version}</span>
                            <Badge variant="muted" size="sm">{a.filesCount.replace('{{count}}', String(version.file_count))}</Badge>
                            <Badge variant="muted" size="sm">{formatBytes(version.total_size_bytes)}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                            <span className="inline-flex items-center gap-1.5">
                              <GitBranch className="size-3.5" />
                              {version.source_branch || a.unknownBranch}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <GitCommit className="size-3.5" />
                              {version.source_commit_sha ? version.source_commit_sha.slice(0, 12) : a.unknownCommit}
                            </span>
                            <span>{formatLocalDateTime(version.created_at)}</span>
                          </div>
                        </div>
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => {
                              setPromoteRepositoryId(repository.id);
                              setPromoteVersionId(version.id);
                              setPromoteChannel(repository.channels[0]?.name || 'preview');
                              setPromoteOpen(true);
                            }}
                          >
                            {a.promoteAction}
                          </Button>
                        )}
                      </div>

                      <div className="border-t border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]/40">
                        {version.files.map((file) => (
                          <div key={file.id} className="flex items-center gap-3 px-5 py-3">
                            <Tag className="size-3.5 shrink-0 text-[hsl(var(--ds-text-2))]" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium text-foreground">{file.file_name}</div>
                              <div className="truncate text-[12px] text-[hsl(var(--ds-text-2))]">{file.logical_path}</div>
                            </div>
                            <div className="shrink-0 text-[12px] text-[hsl(var(--ds-text-2))]">
                              {formatBytes(file.size_bytes)}
                            </div>
                            <Button type="button" variant="secondary" size="sm" onClick={() => downloadFile(file.id)}>
                              <Download className="size-3.5" />
                              {a.downloadAction}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <Dialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{a.promoteTitle}</DialogTitle>
            <DialogDescription>{a.promoteDescription}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">{a.channelLabel}</label>
              <Input
                value={promoteChannel}
                onChange={(event) => setPromoteChannel(event.target.value)}
                placeholder={a.channelPlaceholder}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {['dev', 'preview', 'prod', 'latest'].map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={promoteChannel === value ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setPromoteChannel(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPromoteOpen(false)} disabled={promoting}>
              {dict.common.cancel}
            </Button>
            <Button type="button" onClick={submitPromote} disabled={promoting || !promoteChannel.trim()}>
              {promoting ? dict.common.loading : a.promoteConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
