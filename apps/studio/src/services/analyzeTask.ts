import { analyzeCode } from './claude';
import { analyzeIncremental } from './incremental';
import { getCommitsDiff, getCommitsBySha } from './github';
import { updateReport, getProjectById } from './db';
import { measurePerformance, performanceMonitor } from './performance';
import { syncReportIssues } from './issues';
import { logger } from './logger';
import { exec } from '@/lib/db';
import { resolveAIIntegration } from './integrations';

type AnalyzePayload = {
  reportId: string;
  repo: string;
  hashes: string[];
  rules: Array<{ category: string; name: string; prompt: string; severity: string }>;
  previousReport?: Record<string, unknown> | null;
};

type DiffStats = {
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
};

export async function runAnalyzeTask(projectId: string, payload: AnalyzePayload) {
  const { reportId, repo, hashes, rules, previousReport } = payload;

  if (!reportId || !repo || !hashes || hashes.length === 0) {
    throw new Error('Missing required analysis parameters');
  }

  logger.setContext({ projectId, reportId });

  try {
    await updateReport(reportId, { status: 'analyzing' });

    const project = await getProjectById(projectId);
    const ignorePatterns = Array.isArray(project.ignore_patterns) ? project.ignore_patterns : [];

    const diff = await measurePerformance(reportId, 'get_commits_diff', () =>
      getCommitsDiff(repo, hashes, projectId)
    );

    const filteredDiff = filterDiffByPatterns(diff, ignorePatterns);
    if (!filteredDiff.trim()) {
      throw new Error('No analyzable changes after filtering');
    }

    const diffStats = extractDiffStats(filteredDiff);

    const analysis = await measurePerformance(reportId, 'analyze_code', async () => {
      if (previousReport) {
        return analyzeIncremental(filteredDiff, previousReport, rules, projectId);
      }
      return analyzeCode(filteredDiff, rules, projectId);
    });

    // Resolve integration to get the actual model name used
    const { integration: aiIntegration } = await resolveAIIntegration(projectId).catch(() => ({ integration: null }));
    const modelVersion = aiIntegration?.config?.model ?? 'unknown';

    const issues = analysis.issues ?? [];

    await updateReport(reportId, {
      status: 'done',
      score: analysis.score,
      category_scores: analysis.categoryScores,
      issues,
      summary: analysis.summary,
      complexity_metrics: analysis.complexityMetrics ?? null,
      duplication_metrics: analysis.duplicationMetrics ?? null,
      dependency_metrics: analysis.dependencyMetrics ?? null,
      security_findings: analysis.securityFindings ?? null,
      performance_findings: analysis.performanceFindings ?? null,
      ai_suggestions: analysis.aiSuggestions ?? null,
      code_explanations: analysis.codeExplanations ?? null,
      context_analysis: analysis.contextAnalysis ?? null,
      total_files: diffStats.totalFiles,
      total_additions: diffStats.totalAdditions,
      total_deletions: diffStats.totalDeletions,
      analysis_duration_ms: performanceMonitor.getMetricStats(reportId, 'analyze_code')?.avg ?? null,
      model_version: modelVersion,
      error_message: null,
    });

    await syncReportIssues(reportId, issues);

    await postAnalysisHooks(projectId, reportId, analysis.score, project.quality_threshold, project.webhook_url);

    await exec(`update code_projects set last_analyzed_at = now() where id = $1`, [projectId]);

    await performanceMonitor.saveMetrics(reportId);
  } finally {
    logger.clearContext();
  }
}

export async function buildReportCommits(repo: string, hashes: string[], projectId: string) {
  const commits = await getCommitsBySha(repo, hashes, projectId);
  if (!commits || commits.length === 0) {
    throw new Error('Specified commits not found');
  }
  return commits;
}

function filterDiffByPatterns(diff: string, patterns: string[]): string {
  if (!patterns || patterns.length === 0) return diff;

  const active = patterns
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('#'));

  const blocks = splitDiffBlocks(diff);
  const matched = blocks.filter((block) => {
    const file = block.file;
    if (!file) return true;
    return !isIgnored(file, active);
  });

  return matched.map((b) => b.content).join('');
}

function splitDiffBlocks(diff: string): Array<{ file: string | null; content: string }> {
  const lines = diff.split('\n');
  const blocks: Array<{ file: string | null; content: string }> = [];
  let current: string[] = [];
  let currentFile: string | null = null;

  const flush = () => {
    if (current.length > 0) {
      blocks.push({ file: currentFile, content: current.join('\n') + '\n' });
    }
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = [line];
      const match = line.match(/^diff --git a\/(.+?) b\/.+$/);
      currentFile = match ? match[1] : null;
      continue;
    }
    current.push(line);
  }

  flush();
  return blocks;
}

function isIgnored(file: string, patterns: string[]) {
  return patterns.some((pattern) => matchPattern(file, pattern));
}

function matchPattern(file: string, pattern: string): boolean {
  const normalized = pattern.trim();
  if (!normalized) return false;
  if (normalized === file) return true;

  const regex = globToRegex(normalized);
  return regex.test(file);
}

function globToRegex(pattern: string): RegExp {
  let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  escaped = escaped.replace(/\*\*/g, '.*');
  escaped = escaped.replace(/\*/g, '[^/]*');
  escaped = escaped.replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function extractDiffStats(diff: string): DiffStats {
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;

  diff.split('\n').forEach((line) => {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/.+$/);
      if (match) files.add(match[1]);
      return;
    }
    if (line.startsWith('+++') || line.startsWith('---')) return;
    if (line.startsWith('+')) additions += 1;
    if (line.startsWith('-')) deletions += 1;
  });

  return {
    totalFiles: files.size,
    totalAdditions: additions,
    totalDeletions: deletions,
  };
}

async function postAnalysisHooks(
  projectId: string,
  reportId: string,
  score: number,
  threshold: number | null,
  webhookUrl: string | null
) {
  if (!webhookUrl) return;

  const passed = threshold != null ? score >= threshold : null;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        reportId,
        score,
        threshold,
        passed,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    logger.warn('Failed to post webhook', err instanceof Error ? err : undefined);
  }
}
