/**
 * VCS Client implementations
 */

import { Octokit } from 'octokit';
import type {
  VCSClient,
  VCSConfigWithSecret,
  Repository,
  Commit,
  VCSProvider,
  ReviewCommentUpsertInput,
  ReviewCommentUpsertResult,
} from './types';

type GitHubRepoLite = {
  owner?: { login?: string } | string;
  name: string;
  full_name?: string;
  default_branch?: string;
  description?: string | null;
  html_url: string;
};

type GitHubAuthenticatedUserLite = {
  login: string;
  name: string | null;
  avatar_url: string;
  public_repos: number;
  total_private_repos?: number;
  html_url: string;
};

type GitLabProjectLite = {
  namespace: { path: string };
  path: string;
  path_with_namespace: string;
  default_branch: string;
  description?: string | null;
  web_url: string;
};

type GitLabCommitLite = {
  id: string;
  message: string;
  author_name: string;
  author_email: string;
  created_at: string;
  web_url: string;
};

type GitLabDiffLite = {
  old_path: string;
  new_path: string;
  diff: string;
};

function requireTextPayload(payload: unknown, context: string): string {
  if (typeof payload !== 'string') {
    throw new Error(`Invalid ${context} response payload`);
  }
  return payload;
}

/**
 * GitHub VCS Client
 */
export class GitHubClient implements VCSClient {
  provider: VCSProvider = 'github';
  private octokit: Octokit;
  private config: VCSConfigWithSecret;

  constructor(config: VCSConfigWithSecret) {
    this.config = config;
    this.octokit = new Octokit({
      auth: config.token,
      baseUrl: config.baseUrl || 'https://api.github.com',
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.octokit.rest.users.getAuthenticated();
      return true;
    } catch (error) {
      console.error('GitHub connection test failed:', error);
      return false;
    }
  }

  async getRepositories(owner?: string): Promise<Repository[]> {
    try {
      const ownerInput = typeof owner === 'string' ? owner.trim() : undefined;
      const configOwner = typeof this.config.org === 'string' ? this.config.org.trim() : undefined;
      const targetOwner = ownerInput || configOwner;

      const mapRepo = (repo: GitHubRepoLite): Repository => {
        const ownerName = (
          typeof repo.owner === 'string' ? repo.owner : repo.owner?.login
        ) ?? repo.full_name?.split('/')[0];
        if (!ownerName) {
          throw new Error(`Invalid GitHub repository payload: missing owner for "${repo.name}"`);
        }

        const mapped: Repository = {
          owner: ownerName,
          name: repo.name,
          fullName: repo.full_name ?? `${ownerName}/${repo.name}`,
          defaultBranch: repo.default_branch || 'main',
          url: repo.html_url,
        };

        if (repo.description) {
          mapped.description = repo.description;
        }

        return mapped;
      };

      const listForUser = async () =>
        this.octokit.paginate(this.octokit.rest.repos.listForAuthenticatedUser, {
          per_page: 100,
          sort: 'updated',
          visibility: 'all',
          affiliation: 'owner,collaborator,organization_member',
        }) as Promise<GitHubRepoLite[]>;

      const listForOrg = async (org: string) =>
        this.octokit.paginate(this.octokit.rest.repos.listForOrg, {
          org,
          per_page: 100,
          sort: 'updated',
          type: 'all',
        }) as Promise<GitHubRepoLite[]>;

      const userRepos = await listForUser();

      if (!targetOwner) {
        return userRepos.map(mapRepo);
      }
      const normalizedTargetOwner = targetOwner.toLowerCase();

      const filteredUserRepos = userRepos.filter((repo) => {
        const repoOwner = typeof repo.owner === 'string' ? repo.owner : repo.owner?.login;
        return repoOwner?.toLowerCase() === normalizedTargetOwner;
      });
      if (filteredUserRepos.length > 0) {
        return filteredUserRepos.map(mapRepo);
      }

      // Fallback for token modes where /user/repos omits organization repositories.
      try {
        const orgRepos = await listForOrg(targetOwner);
        return orgRepos.map(mapRepo);
      } catch (error) {
        console.warn('Failed to list org repositories after /user/repos filtering:', error);
        return [];
      }
    } catch (error) {
      console.error('Failed to get repositories:', error);
      throw new Error('Failed to fetch repositories from GitHub');
    }
  }

  async getCommits(owner: string, repo: string, branch: string, limit = 50): Promise<Commit[]> {
    try {
      const { data } = await this.octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: limit,
      });

      return data.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: {
          name: commit.commit.author?.name || 'Unknown',
          email: commit.commit.author?.email || '',
          date: commit.commit.author?.date || new Date().toISOString(),
        },
        url: commit.html_url,
      }));
    } catch (error) {
      console.error('Failed to get commits:', error);
      throw new Error('Failed to fetch commits from GitHub');
    }
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    try {
      const { data } = await this.octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: sha,
        mediaType: {
          format: 'diff',
        },
      });

      return requireTextPayload(data, 'GitHub commit diff');
    } catch (error) {
      console.error('Failed to get commit diff:', error);
      throw new Error('Failed to fetch commit diff from GitHub');
    }
  }

  async getCompareDiff(owner: string, repo: string, base: string, head: string): Promise<string> {
    try {
      const { data } = await this.octokit.request('GET /repos/{owner}/{repo}/compare/{base}...{head}', {
        owner,
        repo,
        base,
        head,
        mediaType: { format: 'diff' },
      });

      return requireTextPayload(data, 'GitHub compare diff');
    } catch (error) {
      console.error('Failed to get compare diff:', error);
      throw new Error('Failed to fetch compare diff from GitHub');
    }
  }

  async getAuthenticatedUser(): Promise<{
    login: string;
    name: string | null;
    avatar_url: string;
    public_repos: number;
    total_private_repos: number;
    html_url: string;
  }> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    const profile = data as GitHubAuthenticatedUserLite;
    return {
      login: profile.login,
      name: profile.name ?? null,
      avatar_url: profile.avatar_url,
      public_repos: profile.public_repos,
      total_private_repos: profile.total_private_repos ?? 0,
      html_url: profile.html_url,
    };
  }

  async listBranches(owner: string, repo: string): Promise<string[]> {
    const { data } = await this.octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 50,
    });
    return data.map((b) => b.name);
  }

  async upsertReviewComment(input: ReviewCommentUpsertInput): Promise<ReviewCommentUpsertResult> {
    const [owner, repo] = splitRepoFullName(input.repoFullName);
    const existingCommentId = input.commentId?.trim();

    if (existingCommentId) {
      const commentId = Number(existingCommentId);
      if (Number.isFinite(commentId)) {
        const { data } = await this.octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: commentId,
          body: input.body,
        });
        return {
          commentId: String(data.id),
          url: data.html_url,
        };
      }
    }

    const { data } = await this.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: input.pullRequestNumber,
      body: input.body,
    });

    return {
      commentId: String(data.id),
      url: data.html_url,
    };
  }
}

/**
 * GitLab VCS Client
 */
export class GitLabClient implements VCSClient {
  provider: VCSProvider = 'gitlab';
  private config: VCSConfigWithSecret;
  private baseUrl: string;

  constructor(config: VCSConfigWithSecret) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://gitlab.com';
  }

  private async request<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v4${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'PRIVATE-TOKEN': this.config.token,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`GitLab API error: ${response.statusText}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.request('/user');
      return true;
    } catch (error) {
      console.error('GitLab connection test failed:', error);
      return false;
    }
  }

  async getRepositories(owner?: string): Promise<Repository[]> {
    try {
      const endpoint = owner ? `/groups/${owner}/projects` : '/projects';
      const data = await this.request<GitLabProjectLite[]>(`${endpoint}?per_page=100&order_by=updated_at`);

      return data.map((project) => {
        const mapped: Repository = {
          owner: project.namespace.path,
          name: project.path,
          fullName: project.path_with_namespace,
          defaultBranch: project.default_branch,
          url: project.web_url,
        };

        if (project.description) {
          mapped.description = project.description;
        }

        return mapped;
      });
    } catch (error) {
      console.error('Failed to get repositories:', error);
      throw new Error('Failed to fetch repositories from GitLab');
    }
  }

  async getCommits(owner: string, repo: string, branch: string, limit = 50): Promise<Commit[]> {
    try {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const data = await this.request<GitLabCommitLite[]>(
        `/projects/${projectPath}/repository/commits?ref_name=${branch}&per_page=${limit}`
      );

      return data.map((commit) => ({
        sha: commit.id,
        message: commit.message,
        author: {
          name: commit.author_name,
          email: commit.author_email,
          date: commit.created_at,
        },
        url: commit.web_url,
      }));
    } catch (error) {
      console.error('Failed to get commits:', error);
      throw new Error('Failed to fetch commits from GitLab');
    }
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    try {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const data = await this.request<GitLabDiffLite[]>(`/projects/${projectPath}/repository/commits/${sha}/diff`);

      // Convert GitLab diff format to unified diff
      return data
        .map((diff) => {
          return `diff --git a/${diff.old_path} b/${diff.new_path}\n${diff.diff}`;
        })
        .join('\n');
    } catch (error) {
      console.error('Failed to get commit diff:', error);
      throw new Error('Failed to fetch commit diff from GitLab');
    }
  }

  async getCompareDiff(owner: string, repo: string, base: string, head: string): Promise<string> {
    try {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const data = await this.request<{ diffs?: GitLabDiffLite[] }>(
        `/projects/${projectPath}/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}`
      );

      const diffs = data.diffs;
      if (!Array.isArray(diffs)) {
        throw new Error('Invalid GitLab compare response');
      }

      return diffs
        .map((diff) => {
          return `diff --git a/${diff.old_path} b/${diff.new_path}\n${diff.diff}`;
        })
        .join('\n');
    } catch (error) {
      console.error('Failed to get compare diff:', error);
      throw new Error('Failed to fetch compare diff from GitLab');
    }
  }

  async upsertReviewComment(input: ReviewCommentUpsertInput): Promise<ReviewCommentUpsertResult> {
    const projectPath = encodeURIComponent(input.repoFullName);
    const noteId = input.commentId?.trim();

    if (noteId) {
      const data = await this.request<{ id: number; web_url?: string }>(
        `/projects/${projectPath}/merge_requests/${input.pullRequestNumber}/notes/${encodeURIComponent(noteId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ body: input.body }),
        }
      );
      return {
        commentId: String(data.id),
        url: data.web_url ?? null,
      };
    }

    const data = await this.request<{ id: number; web_url?: string }>(
      `/projects/${projectPath}/merge_requests/${input.pullRequestNumber}/notes`,
      {
        method: 'POST',
        body: JSON.stringify({ body: input.body }),
      }
    );

    return {
      commentId: String(data.id),
      url: data.web_url ?? null,
    };
  }
}

/**
 * Generic Git Client (for custom Git services)
 */
export class GenericGitClient implements VCSClient {
  provider: VCSProvider = 'git';
  private config: VCSConfigWithSecret;

  constructor(config: VCSConfigWithSecret) {
    this.config = config;
  }

  async testConnection(): Promise<boolean> {
    // Attempt a lightweight authenticated request to the configured base URL.
    // Fall back to token presence check if no base URL is configured.
    if (!this.config.baseUrl) {
      return !!this.config.token;
    }
    try {
      const response = await fetch(`${this.config.baseUrl}`, {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(5000),
      });
      // Accept any non-5xx response as "reachable"
      return response.status < 500;
    } catch {
      return false;
    }
  }

  async getRepositories(): Promise<Repository[]> {
    throw new Error('Generic Git client does not support repository listing');
  }

  async getCommits(): Promise<Commit[]> {
    throw new Error('Generic Git client requires specific implementation');
  }

  async getCommitDiff(): Promise<string> {
    throw new Error('Generic Git client requires specific implementation');
  }

  async getCompareDiff(): Promise<string> {
    throw new Error('Generic Git client requires specific implementation');
  }

  async upsertReviewComment(input: ReviewCommentUpsertInput): Promise<ReviewCommentUpsertResult> {
    void input;
    throw new Error('Generic Git client does not support PR review comments');
  }
}

function splitRepoFullName(repoFullName: string): [string, string] {
  const [owner, repo, ...rest] = repoFullName.split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid repository name: ${repoFullName}`);
  }
  return [owner, repo];
}
