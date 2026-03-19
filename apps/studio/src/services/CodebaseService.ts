import path from 'path';
import { existsSync, promises as fs } from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

import { logger } from './logger';
import { withRetry } from './retry';
import { resolveVCSIntegration } from './integrations';
import type { Integration, VCSProvider } from './integrations';
import { readSecret } from '@/lib/vault';

export type CodebaseRef = {
  orgId: string;
  projectId: string;
  repo: string; // owner/name, group/subgroup/repo, or full URL
  ref?: string; // branch, tag, or commit SHA
};

export type PrepareWorkspaceOptions = {
  workspaceId?: string;
  forceSync?: boolean;
};

export type PreparedWorkspace = {
  workspaceId: string;
  workspacePath: string;
  mirrorPath: string;
  repo: string;
  ref: string;
  orgId: string;
  projectId: string;
  createdAt: string;
};

export type MirrorStatus = {
  mirrorPath: string;
  lastSyncAt: string | null;
  synced: boolean;
  remoteUrl: string;
};

export type TreeEntry = {
  path: string;
  name: string;
  type: 'tree' | 'blob';
  size?: number;
};

export type ReadFileResult = {
  path: string;
  ref: string;
  commit: string;
  size: number;
  content: string;
  truncated: boolean;
  isBinary: boolean;
};

export type CodebaseServiceOptions = {
  rootDir?: string;
  mirrorsDir?: string;
  workspacesDir?: string;
  syncIntervalMs?: number;
  lockTimeoutMs?: number;
  lockStaleMs?: number;
  workspaceTtlMs?: number;
  fileMaxBytes?: number;
  gitTimeoutMs?: number;
  gitBin?: string;
};

type EnsureMirrorOptions = {
  forceSync?: boolean;
  syncPolicy?: SyncPolicy;
};

type SyncPolicy = 'auto' | 'force' | 'never';

type RunGitOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

type MirrorMeta = {
  orgId: string;
  projectId: string;
  repo: string;
  provider: VCSProvider;
  remoteUrl: string;
  createdAt: string;
  lastSyncAt?: string;
};

type WorkspaceMeta = {
  workspaceId: string;
  orgId: string;
  projectId: string;
  repo: string;
  ref: string;
  mirrorPath: string;
  createdAt: string;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_ROOT = path.join(resolveWorkspaceRoot(), '.cache', 'codebase');
const DEFAULT_SYNC_INTERVAL_MS = 60_000;
const DEFAULT_LOCK_TIMEOUT_MS = 120_000;
const DEFAULT_LOCK_STALE_MS = 300_000;
const DEFAULT_WORKSPACE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_FILE_MAX_BYTES = 256 * 1024;
const DEFAULT_GIT_TIMEOUT_MS = 120_000;
const DEFAULT_CACHE_TTL_MS = 10_000;
const DEFAULT_CACHE_MAX_ENTRIES = 500;

export class CodebaseService {
  private rootDir: string;
  private mirrorsDir: string;
  private workspacesDir: string;
  private syncIntervalMs: number;
  private lockTimeoutMs: number;
  private lockStaleMs: number;
  private workspaceTtlMs: number;
  private fileMaxBytes: number;
  private gitTimeoutMs: number;
  private gitBin: string;
  private cacheTtlMs: number;
  private cacheMaxEntries: number;
  private treeCache = new Map<string, CacheEntry<{ ref: string; commit: string; path: string; entries: TreeEntry[] }>>();
  private fileCache = new Map<string, CacheEntry<ReadFileResult>>();

  constructor(options: CodebaseServiceOptions = {}) {
    // Note: dotenv will set `FOO=` to the empty string. For path settings we treat
    // empty/blank as "unset" to avoid accidentally writing into the project root.
    const rootDir = options.rootDir ?? readNonEmptyStringEnv('CODEBASE_ROOT') ?? DEFAULT_ROOT;
    this.rootDir = path.resolve(rootDir);

    const mirrorsDir =
      options.mirrorsDir ??
      readNonEmptyStringEnv('CODEBASE_MIRRORS_DIR') ??
      path.join(this.rootDir, 'mirrors');
    this.mirrorsDir = path.resolve(mirrorsDir);

    const workspacesDir =
      options.workspacesDir ??
      readNonEmptyStringEnv('CODEBASE_WORKSPACES_DIR') ??
      path.join(this.rootDir, 'workspaces');
    this.workspacesDir = path.resolve(workspacesDir);
    this.syncIntervalMs = readNumberEnv('CODEBASE_SYNC_INTERVAL_MS', options.syncIntervalMs, DEFAULT_SYNC_INTERVAL_MS);
    this.lockTimeoutMs = readNumberEnv('CODEBASE_LOCK_TIMEOUT_MS', options.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
    this.lockStaleMs = readNumberEnv('CODEBASE_LOCK_STALE_MS', options.lockStaleMs, DEFAULT_LOCK_STALE_MS);
    this.workspaceTtlMs = readNumberEnv('CODEBASE_WORKSPACE_TTL_MS', options.workspaceTtlMs, DEFAULT_WORKSPACE_TTL_MS);
    this.fileMaxBytes = readNumberEnv('CODEBASE_FILE_MAX_BYTES', options.fileMaxBytes, DEFAULT_FILE_MAX_BYTES);
    this.gitTimeoutMs = readNumberEnv('CODEBASE_GIT_TIMEOUT_MS', options.gitTimeoutMs, DEFAULT_GIT_TIMEOUT_MS);
    this.gitBin = options.gitBin ?? readNonEmptyStringEnv('CODEBASE_GIT_BIN') ?? 'git';
    this.cacheTtlMs = DEFAULT_CACHE_TTL_MS;
    this.cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES;
  }

  async ensureMirror(ref: CodebaseRef, options: EnsureMirrorOptions = {}): Promise<MirrorStatus> {
    assertNonEmpty(ref.orgId, 'orgId');
    assertNonEmpty(ref.projectId, 'projectId');
    assertNonEmpty(ref.repo, 'repo');

    const syncPolicy = options.syncPolicy ?? (options.forceSync ? 'force' : 'auto');

    const paths = this.getMirrorPaths(ref.orgId, ref.projectId, ref.repo);
    await fs.mkdir(paths.basePath, { recursive: true });

    const release = await this.acquireLock(paths.lockPath);
    try {
      const isRepo = await this.isGitRepo(paths.mirrorPath);

      if (!isRepo) {
        const { integration, token, provider } = await this.resolveIntegration(ref.projectId);
        const remoteUrl = this.buildRemoteUrl(ref.repo, integration, provider);
        const redactedUrl = redactUrl(remoteUrl);
        const auth = this.buildAuthArgs(provider, token, remoteUrl);
        await this.removeDir(paths.mirrorPath);
        logger.info(`Cloning mirror for ${ref.repo}`);
        await withRetry(() =>
          this.runGit([...auth.args, 'clone', '--mirror', remoteUrl, paths.mirrorPath], { env: auth.env })
        );
        const now = new Date().toISOString();
        this.clearCacheForMirror(paths.mirrorPath);
        await this.writeJson<MirrorMeta>(paths.metaPath, {
          orgId: ref.orgId,
          projectId: ref.projectId,
          repo: ref.repo,
          provider,
          remoteUrl: sanitizeUrl(remoteUrl),
          createdAt: now,
          lastSyncAt: now,
        });
        return { mirrorPath: paths.mirrorPath, lastSyncAt: now, synced: true, remoteUrl: redactedUrl };
      }

      const meta = await this.readJson<MirrorMeta>(paths.metaPath);
      if (syncPolicy === 'never' && meta?.remoteUrl) {
        return {
          mirrorPath: paths.mirrorPath,
          lastSyncAt: meta?.lastSyncAt ?? null,
          synced: false,
          remoteUrl: redactUrl(meta.remoteUrl),
        };
      }

      const { integration, token, provider } = await this.resolveIntegration(ref.projectId);
      const remoteUrl = this.buildRemoteUrl(ref.repo, integration, provider);
      const redactedUrl = redactUrl(remoteUrl);
      const auth = this.buildAuthArgs(provider, token, remoteUrl);

      await this.ensureRemoteUrl(paths.mirrorPath, remoteUrl, auth);

      const lastSyncAt = meta?.lastSyncAt ?? null;
      const shouldSync =
        syncPolicy === 'force'
          ? true
          : syncPolicy === 'never'
            ? false
            : !lastSyncAt || isStale(lastSyncAt, this.syncIntervalMs);

      if (shouldSync) {
        logger.info(`Syncing mirror for ${ref.repo}`);
        await withRetry(() =>
          this.runGit(
            [...auth.args, '--git-dir', paths.mirrorPath, 'fetch', '--prune', '--tags', 'origin'],
            { env: auth.env }
          )
        );
        this.clearCacheForMirror(paths.mirrorPath);
      }

      const now = new Date().toISOString();
      const nextLastSyncAt = shouldSync ? now : meta?.lastSyncAt;
      const mirrorMeta: MirrorMeta = {
        orgId: ref.orgId,
        projectId: ref.projectId,
        repo: ref.repo,
        provider,
        remoteUrl: sanitizeUrl(remoteUrl),
        createdAt: meta?.createdAt ?? now,
      };
      if (nextLastSyncAt) {
        mirrorMeta.lastSyncAt = nextLastSyncAt;
      }
      await this.writeJson<MirrorMeta>(paths.metaPath, mirrorMeta);

      return {
        mirrorPath: paths.mirrorPath,
        lastSyncAt: shouldSync ? now : lastSyncAt,
        synced: shouldSync,
        remoteUrl: redactedUrl,
      };
    } finally {
      await release();
    }
  }

  async prepareWorkspace(ref: CodebaseRef, options: PrepareWorkspaceOptions = {}): Promise<PreparedWorkspace> {
    const mirror = await this.ensureMirror(
      ref,
      options.forceSync === undefined ? {} : { forceSync: options.forceSync }
    );
    const workspaceId = options.workspaceId ?? randomUUID();
    const workspacePath = this.getWorkspacePath(ref.orgId, ref.projectId, ref.repo, workspaceId);
    const targetRef = await this.resolveRef(mirror.mirrorPath, ref.ref);

    const releaseWorktree = await this.acquireLock(this.getWorktreeLockPath(mirror.mirrorPath));
    try {
      await this.removeDir(workspacePath);
      await fs.mkdir(path.dirname(workspacePath), { recursive: true });

      try {
        await this.addWorktree(mirror.mirrorPath, workspacePath, targetRef);
      } catch (err) {
        if (!options.forceSync && isRefMissing(err)) {
          await this.ensureMirror(ref, { forceSync: true });
          await this.addWorktree(mirror.mirrorPath, workspacePath, targetRef);
        } else {
          throw err;
        }
      }
    } finally {
      await releaseWorktree();
    }

    const createdAt = new Date().toISOString();
    await this.writeWorkspaceMeta(workspacePath, {
      workspaceId,
      orgId: ref.orgId,
      projectId: ref.projectId,
      repo: ref.repo,
      ref: targetRef,
      mirrorPath: mirror.mirrorPath,
      createdAt,
    });

    logger.info(`Workspace ready: ${workspaceId}`);
    return {
      workspaceId,
      workspacePath,
      mirrorPath: mirror.mirrorPath,
      repo: ref.repo,
      ref: targetRef,
      orgId: ref.orgId,
      projectId: ref.projectId,
      createdAt,
    };
  }

  async cleanupWorkspace(workspace: PreparedWorkspace | { workspacePath: string; mirrorPath?: string }) {
    const workspacePath = workspace.workspacePath;
    let mirrorPath = 'mirrorPath' in workspace ? workspace.mirrorPath : undefined;

    if (!mirrorPath) {
      const meta = await this.readWorkspaceMeta(workspacePath);
      mirrorPath = meta?.mirrorPath;
    }

    if (mirrorPath) {
      const releaseWorktree = await this.acquireLock(this.getWorktreeLockPath(mirrorPath));
      try {
        try {
          await this.runGit(['--git-dir', mirrorPath, 'worktree', 'remove', '--force', workspacePath]);
        } catch (err) {
          logger.warn(`Failed to remove worktree for ${workspacePath}`, err instanceof Error ? err : undefined);
        }
        try {
          await this.runGit(['--git-dir', mirrorPath, 'worktree', 'prune']);
        } catch (err) {
          logger.warn(`Failed to prune worktrees for ${mirrorPath}`, err instanceof Error ? err : undefined);
        }
      } finally {
        await releaseWorktree();
      }
    }

    await this.removeDir(workspacePath);
  }

  async cleanupStaleWorkspaces(maxAgeMs: number = this.workspaceTtlMs): Promise<number> {
    let removed = 0;
    const orgDirs = await this.listDirs(this.workspacesDir);

    for (const orgId of orgDirs) {
      const orgPath = path.join(this.workspacesDir, orgId);
      const projectDirs = await this.listDirs(orgPath);
      for (const projectId of projectDirs) {
        const projectPath = path.join(orgPath, projectId);
        const repoDirs = await this.listDirs(projectPath);
        for (const repoSlug of repoDirs) {
          const repoPath = path.join(projectPath, repoSlug);
          const workspaceDirs = await this.listDirs(repoPath);
          for (const workspaceId of workspaceDirs) {
            const workspacePath = path.join(repoPath, workspaceId);
            const meta = await this.readWorkspaceMeta(workspacePath);
            if (!meta) continue;
            if (isStale(meta.createdAt, maxAgeMs)) {
              await this.cleanupWorkspace({ workspacePath, mirrorPath: meta.mirrorPath });
              removed += 1;
            }
          }
        }
      }
    }

    return removed;
  }

  async listTree(
    ref: CodebaseRef,
    treePath: string = '',
    options: EnsureMirrorOptions = {}
  ): Promise<{ ref: string; commit: string; path: string; entries: TreeEntry[] }> {
    const mirror = await this.ensureMirror(ref, options);
    const targetRef = await this.resolveRef(mirror.mirrorPath, ref.ref);
    const safePath = normalizeRepoFilePath(treePath);
    const treeRef = safePath ? `${targetRef}:${safePath}` : targetRef;
    const cacheKey = `${mirror.mirrorPath}:${targetRef}:${safePath || '.'}:tree`;

    if (options.syncPolicy !== 'force') {
      const cached = this.getCache(this.treeCache, cacheKey);
      if (cached) return cached;
    }

    const commit = await this.resolveCommitSha(mirror.mirrorPath, targetRef);
    const result = await this.runGit(['--git-dir', mirror.mirrorPath, 'ls-tree', '-l', treeRef]);
    const entries = parseLsTree(result.stdout, safePath);

    const payload = { ref: targetRef, commit, path: safePath, entries };
    this.setCache(this.treeCache, cacheKey, payload);
    return payload;
  }

  async readFile(
    ref: CodebaseRef,
    filePath: string,
    options: EnsureMirrorOptions = {}
  ): Promise<ReadFileResult> {
    const mirror = await this.ensureMirror(ref, options);
    const targetRef = await this.resolveRef(mirror.mirrorPath, ref.ref);
    const safePath = normalizeRepoFilePath(filePath);
    if (!safePath) {
      throw new Error('file path is required');
    }
    const cacheKey = `${mirror.mirrorPath}:${targetRef}:${safePath}:file`;

    if (options.syncPolicy !== 'force') {
      const cached = this.getCache(this.fileCache, cacheKey);
      if (cached) return cached;
    }

    const commit = await this.resolveCommitSha(mirror.mirrorPath, targetRef);
    const size = await this.getBlobSize(mirror.mirrorPath, `${targetRef}:${safePath}`);
    if (size > this.fileMaxBytes) {
      const payload = {
        path: safePath,
        ref: targetRef,
        commit,
        size,
        content: '',
        truncated: true,
        isBinary: false,
      };
      this.setCache(this.fileCache, cacheKey, payload);
      return payload;
    }

    const result = await this.runGit(['--git-dir', mirror.mirrorPath, 'show', `${targetRef}:${safePath}`]);
    const content = result.stdout;
    const isBinary = content.includes('\u0000');

    const payload = {
      path: safePath,
      ref: targetRef,
      commit,
      size,
      content: isBinary ? '' : content,
      truncated: false,
      isBinary,
    };
    this.setCache(this.fileCache, cacheKey, payload);
    return payload;
  }

  async listBranches(ref: CodebaseRef, options: EnsureMirrorOptions = {}): Promise<string[]> {
    const mirror = await this.ensureMirror(ref, options);
    const result = await this.runGit([
      '--git-dir',
      mirror.mirrorPath,
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads',
    ]);
    const branches = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    return Array.from(new Set(branches)).sort((a, b) => a.localeCompare(b));
  }

  private async resolveIntegration(projectId: string): Promise<{
    integration: Integration;
    token: string;
    provider: VCSProvider;
  }> {
    const { integration } = await resolveVCSIntegration(projectId);
    if (!integration) {
      throw new Error('No VCS integration configured for project');
    }
    const token = await readSecret(integration.vault_secret_name);
    return { integration, token, provider: integration.provider as VCSProvider };
  }

  private buildRemoteUrl(repo: string, integration: Integration, provider: VCSProvider): string {
    if (isRemoteUrl(repo)) {
      return ensureGitSuffixForUrl(repo);
    }

    const repoPath = normalizeRepoPath(repo);
    if (provider === 'github') {
      const base = normalizeGitHubBaseUrl(integration.config?.baseUrl as string | undefined);
      return `${stripTrailingSlash(base)}/${repoPath}.git`;
    }

    if (provider === 'gitlab') {
      const base = normalizeGitLabBaseUrl(integration.config?.baseUrl as string | undefined);
      return `${stripTrailingSlash(base)}/${repoPath}.git`;
    }

    if (provider === 'git') {
      const baseUrl = (integration.config?.baseUrl as string | undefined) ?? '';
      if (!baseUrl) {
        throw new Error('Generic Git integration requires baseUrl');
      }
      return `${stripTrailingSlash(baseUrl)}/${repoPath}.git`;
    }

    throw new Error(`Unsupported VCS provider: ${provider}`);
  }

  private buildAuthArgs(provider: VCSProvider, token: string, remoteUrl: string) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    };

    if (!token || !isHttpUrl(remoteUrl)) {
      return { args: [] as string[], env };
    }

    const username = provider === 'github' ? 'x-access-token' : provider === 'gitlab' ? 'oauth2' : 'git';
    const basic = Buffer.from(`${username}:${token}`).toString('base64');
    return {
      args: ['-c', `http.extraHeader=Authorization: Basic ${basic}`, '-c', 'credential.helper='],
      env,
    };
  }

  private getMirrorPaths(orgId: string, projectId: string, repo: string) {
    const basePath = path.join(
      this.mirrorsDir,
      safeSegment(orgId, 'orgId'),
      safeSegment(projectId, 'projectId'),
      repoSlug(repo)
    );
    return {
      basePath,
      mirrorPath: path.join(basePath, 'mirror.git'),
      metaPath: path.join(basePath, 'meta.json'),
      lockPath: path.join(basePath, 'lock.json'),
    };
  }

  private getWorktreeLockPath(mirrorPath: string) {
    return path.join(path.dirname(mirrorPath), 'lock.json');
  }

  private getWorkspacePath(orgId: string, projectId: string, repo: string, workspaceId: string) {
    return path.join(
      this.workspacesDir,
      safeSegment(orgId, 'orgId'),
      safeSegment(projectId, 'projectId'),
      repoSlug(repo),
      safeSegment(workspaceId, 'workspaceId')
    );
  }

  private async resolveRef(mirrorPath: string, ref?: string): Promise<string> {
    if (ref) {
      const normalized = normalizeRef(ref);
      await this.ensureRefExists(mirrorPath, normalized);
      return normalized;
    }
    try {
      const result = await this.runGit(['--git-dir', mirrorPath, 'symbolic-ref', '--short', 'HEAD']);
      const resolved = result.stdout.trim();
      if (resolved) {
        const normalized = normalizeRef(resolved);
        await this.ensureRefExists(mirrorPath, normalized);
        return normalized;
      }
    } catch {
      // ignore
    }
    try {
      const head = await this.runGit(['--git-dir', mirrorPath, 'rev-parse', '--verify', '--quiet', 'HEAD']);
      const resolved = head.stdout.trim();
      if (resolved) return resolved;
    } catch {
      // ignore
    }
    await this.ensureRefExists(mirrorPath, 'main');
    return 'main';
  }

  private async addWorktree(mirrorPath: string, workspacePath: string, ref: string) {
    await this.runGit(['--git-dir', mirrorPath, 'worktree', 'prune']);
    await this.runGit(['--git-dir', mirrorPath, 'worktree', 'add', '--force', '--detach', workspacePath, ref]);
  }

  private async resolveCommitSha(mirrorPath: string, ref: string) {
    const commitRef = `${ref}^{commit}`;
    const result = await this.runGit([
      '--git-dir',
      mirrorPath,
      'rev-parse',
      '--verify',
      '--quiet',
      commitRef,
    ]);
    const sha = result.stdout.trim();
    if (!sha) {
      throw new Error('Invalid ref');
    }
    return sha;
  }

  private async getBlobSize(mirrorPath: string, refPath: string): Promise<number> {
    const result = await this.runGit(['--git-dir', mirrorPath, 'cat-file', '-s', refPath]);
    const size = Number(result.stdout.trim());
    if (!Number.isFinite(size)) {
      throw new Error('Failed to resolve file size');
    }
    return size;
  }

  private async ensureRemoteUrl(mirrorPath: string, remoteUrl: string, auth: { args: string[]; env: NodeJS.ProcessEnv }) {
    await this.runGit(
      [...auth.args, '--git-dir', mirrorPath, 'remote', 'set-url', 'origin', remoteUrl],
      { env: auth.env }
    );
  }

  private async isGitRepo(mirrorPath: string) {
    return await this.exists(path.join(mirrorPath, 'HEAD'));
  }

  private async acquireLock(lockPath: string): Promise<() => Promise<void>> {
    const start = Date.now();
    while (Date.now() - start < this.lockTimeoutMs) {
      try {
        const handle = await fs.open(lockPath, 'wx');
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
            hostname: process.env.HOSTNAME ?? undefined,
          })
        );
        await handle.close();
        return async () => {
          await this.removeFile(lockPath);
        };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw err;
        }
        const stale = await this.isStaleLock(lockPath);
        if (stale) {
          await this.removeFile(lockPath);
          continue;
        }
        await delay(200);
      }
    }
    throw new Error('Timed out acquiring codebase lock');
  }

  private async isStaleLock(lockPath: string): Promise<boolean> {
    try {
      const data = await fs.readFile(lockPath, 'utf8');
      const parsed = JSON.parse(data) as { createdAt?: string };
      if (!parsed.createdAt) return true;
      return isStale(parsed.createdAt, this.lockStaleMs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return false;
      return true;
    }
  }

  private async readWorkspaceMeta(workspacePath: string): Promise<WorkspaceMeta | null> {
    return this.readJson<WorkspaceMeta>(path.join(workspacePath, '.codebase', 'workspace.json'));
  }

  private async writeWorkspaceMeta(workspacePath: string, meta: WorkspaceMeta) {
    const metaPath = path.join(workspacePath, '.codebase', 'workspace.json');
    await this.writeJson(metaPath, meta);
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      throw err;
    }
  }

  private async writeJson<T>(filePath: string, data: T) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async listDirs(parent: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(parent, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      throw err;
    }
  }

  private async removeDir(target: string) {
    await fs.rm(target, { recursive: true, force: true });
  }

  private async removeFile(target: string) {
    try {
      await fs.rm(target, { force: true });
    } catch {
      // ignore
    }
  }

  private async exists(target: string) {
    try {
      await fs.stat(target);
      return true;
    } catch {
      return false;
    }
  }

  private async runGit(args: string[], options: RunGitOptions = {}) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(this.gitBin, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
          GIT_TERMINAL_PROMPT: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const timeoutMs = options.timeoutMs ?? this.gitTimeoutMs;
      const timeout = timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGKILL');
          }, timeoutMs)
        : null;

      child.on('error', (err) => {
        if (timeout) clearTimeout(timeout);
        reject(err);
      });

      child.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const error = new Error(
          `git ${args.join(' ')} failed with exit code ${code}: ${stderr.trim() || stdout.trim()}`
        );
        reject(error);
      });
    });
  }

  private getCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
  }

  private setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
    cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
    if (cache.size <= this.cacheMaxEntries) return;
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }

  private clearCacheForMirror(mirrorPath: string) {
    const prefix = `${mirrorPath}:`;
    for (const key of this.treeCache.keys()) {
      if (key.startsWith(prefix)) this.treeCache.delete(key);
    }
    for (const key of this.fileCache.keys()) {
      if (key.startsWith(prefix)) this.fileCache.delete(key);
    }
  }

  private async ensureRefExists(mirrorPath: string, ref: string) {
    const trimmed = ref.trim();
    if (!trimmed) {
      throw new Error('Invalid ref');
    }
    const isSha = /^[0-9a-f]{7,40}$/i.test(trimmed);
    try {
      if (!isSha) {
        const args = trimmed.startsWith('refs/')
          ? ['check-ref-format', '--', trimmed]
          : ['check-ref-format', '--branch', '--', trimmed];
        await this.runGit(args);
      }
      const commitRef = `${trimmed}^{commit}`;
      const result = await this.runGit([
        '--git-dir',
        mirrorPath,
        'rev-parse',
        '--verify',
        '--quiet',
        commitRef,
      ]);
      if (!result.stdout.trim()) {
        throw new Error('Invalid ref');
      }
    } catch {
      throw new Error('Invalid ref');
    }
  }
}

export const codebaseService = new CodebaseService();

function resolveWorkspaceRoot(): string {
  let current = process.cwd();
  while (true) {
    if (
      existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      existsSync(path.join(current, '.git'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

function readNumberEnv(name: string, override: number | undefined, fallback: number) {
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readNonEmptyStringEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function assertNonEmpty(value: string, label: string) {
  if (!value || !value.trim()) {
    throw new Error(`${label} is required`);
  }
}

function safeSegment(value: string, label: string) {
  assertNonEmpty(value, label);
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
}

function repoSlug(repo: string) {
  assertNonEmpty(repo, 'repo');
  const cleaned = repo.trim().replace(/\.git$/, '').replace(/[\/\\:]+/g, '__');
  return cleaned.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function normalizeRepoPath(repo: string) {
  assertNonEmpty(repo, 'repo');
  return repo.trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
}

function normalizeRef(ref: string) {
  return ref.trim().replace(/^refs\/heads\//, '').replace(/^origin\//, '');
}

function normalizeRepoFilePath(input: string) {
  const cleaned = input.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleaned) return '';
  if (cleaned.includes(':')) {
    throw new Error('Invalid path');
  }
  const segments = cleaned.split('/').filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw new Error('Invalid path');
  }
  return segments.join('/');
}

 

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/g, '');
}

function isRemoteUrl(value: string) {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('git@');
}

function isHttpUrl(value: string) {
  return value.startsWith('http://') || value.startsWith('https://');
}

function ensureGitSuffixForUrl(url: string) {
  if (url.endsWith('.git')) return url;
  if (isHttpUrl(url)) {
    try {
      const parsed = new URL(url);
      const pathName = parsed.pathname.replace(/\/+$/g, '');
      parsed.pathname = pathName.endsWith('.git') ? pathName : `${pathName}.git`;
      return parsed.toString();
    } catch {
      return `${url}.git`;
    }
  }
  return `${url}.git`;
}

function normalizeGitHubBaseUrl(baseUrl?: string) {
  const raw = baseUrl?.trim() || 'https://github.com';
  const cleaned = stripTrailingSlash(raw);
  if (cleaned === 'https://api.github.com' || cleaned === 'http://api.github.com') {
    return cleaned.replace('api.', '');
  }
  if (cleaned.endsWith('/api/v3')) {
    return cleaned.replace(/\/api\/v3$/, '');
  }
  return cleaned;
}

function normalizeGitLabBaseUrl(baseUrl?: string) {
  const raw = baseUrl?.trim() || 'https://gitlab.com';
  const cleaned = stripTrailingSlash(raw);
  if (cleaned.endsWith('/api/v4')) {
    return cleaned.replace(/\/api\/v4$/, '');
  }
  return cleaned;
}

function isStale(isoTime: string, thresholdMs: number) {
  const time = new Date(isoTime).getTime();
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > thresholdMs;
}

function isRefMissing(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('unknown revision') ||
    message.includes('bad object') ||
    message.includes('invalid reference') ||
    message.includes('unknown commit')
  );
}

function redactUrl(url: string) {
  if (!isHttpUrl(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function sanitizeUrl(url: string) {
  if (!isHttpUrl(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseLsTree(output: string, basePath: string): TreeEntry[] {
  const lines = output.split('\n').filter(Boolean);
  const entries: TreeEntry[] = [];

  for (const line of lines) {
    const [meta, name] = line.split('\t');
    if (!meta || !name) continue;
    const parts = meta.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const type = parts[1] as 'tree' | 'blob';
    const sizeRaw = parts[3];
    const size = type === 'blob' && sizeRaw && sizeRaw !== '-' ? Number(sizeRaw) : undefined;
    const entryPath = basePath ? `${basePath}/${name}` : name;

    const entry: TreeEntry = {
      name,
      path: entryPath,
      type: type === 'tree' ? 'tree' : 'blob',
    };
    if (typeof size === 'number' && Number.isFinite(size)) {
      entry.size = size;
    }
    entries.push(entry);
  }

  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
