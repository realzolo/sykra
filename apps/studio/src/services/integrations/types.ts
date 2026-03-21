/**
 * Integration types and base interfaces
 */

export type IntegrationType = 'vcs' | 'ai';

export type VCSProvider = 'github' | 'gitlab' | 'git';
export type AIProvider = 'openai-api';

export type Provider = VCSProvider | AIProvider;

/**
 * Base integration configuration stored in database
 */
export interface Integration {
  id: string;
  user_id: string;
  org_id: string;
  type: IntegrationType;
  provider: Provider;
  name: string;
  is_default: boolean;
  config: IntegrationConfig;
  vault_secret_name: string;
  created_at: string;
  updated_at: string;
}

export type IntegrationConfig =
  | VCSConfig
  | AIConfig;

/**
 * VCS configuration (non-sensitive)
 */
export interface VCSConfig {
  baseUrl?: string; // For self-hosted instances
  org?: string; // Default organization/namespace
}

/**
 * VCS configuration with secret (for internal use)
 */
export interface VCSConfigWithSecret extends VCSConfig {
  token: string;
}

/**
 * AI configuration (non-sensitive)
 */
export interface AIConfig {
  baseUrl?: string; // API endpoint
  apiStyle: 'openai' | 'anthropic';
  model: string; // Model name
  outputLanguage: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

/**
 * AI configuration with secret (for internal use)
 */
export interface AIConfigWithSecret extends AIConfig {
  apiKey: string;
}

/**
 * Repository information
 */
export interface Repository {
  owner: string;
  name: string;
  fullName: string; // owner/name
  defaultBranch: string;
  description?: string;
  url: string;
}

/**
 * Commit information
 */
export interface Commit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  url: string;
}

/**
 * VCS Client interface
 */
export interface VCSClient {
  provider: VCSProvider;

  /**
   * Test connection to VCS
   */
  testConnection(): Promise<boolean>;

  /**
   * Get repositories for an organization/user
   */
  getRepositories(owner?: string): Promise<Repository[]>;

  /**
   * Get commits for a repository
   */
  getCommits(owner: string, repo: string, branch: string, limit?: number): Promise<Commit[]>;

  /**
   * Get diff for a specific commit
   */
  getCommitDiff(owner: string, repo: string, sha: string): Promise<string>;

  /**
   * Get diff between two refs
   */
  getCompareDiff(owner: string, repo: string, base: string, head: string): Promise<string>;

  /**
   * Create or update a PR / MR review comment.
   * The returned comment id is stored so future runs can update the same thread.
   */
  upsertReviewComment(input: ReviewCommentUpsertInput): Promise<ReviewCommentUpsertResult>;
}

export interface ReviewCommentUpsertInput {
  repoFullName: string;
  pullRequestNumber: number;
  body: string;
  commentId?: string | null;
}

export interface ReviewCommentUpsertResult {
  commentId: string;
  url?: string | null;
}

/**
 * AI analysis result
 */
export interface AnalysisResult {
  summary: string;
  score: number;
  categoryScores: Record<string, number>;
  issues: Array<{
    category: string;
    severity: string;
    message: string;
    file?: string;
    line?: number;
  }>;
}

export interface AIConnectionTestResult {
  success: boolean;
  endpoint: string;
  expectedModel: string;
  observedModel?: string;
  checks: {
    protocol: boolean;
    structuredOutput: boolean;
    modelMetadata: boolean;
  };
  warnings: string[];
}

/**
 * AI Client interface
 */
export interface AIClient {
  provider: AIProvider;

  /**
   * Test connection to AI service
   */
  testConnection(): Promise<AIConnectionTestResult>;

  /**
   * Analyze code with AI
   */
  analyze(prompt: string, code: string): Promise<AnalysisResult>;

  /**
   * Stream analysis results
   */
  streamAnalyze(prompt: string, code: string): AsyncGenerator<string>;
}
