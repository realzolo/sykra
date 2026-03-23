import { resolveAIIntegration } from './integrations';
import { ReviewResult, ReviewIssue } from './aiReviewService';
import { asJsonObject } from '@/lib/json';
import { DEFAULT_OUTPUT_LANGUAGE, getOutputLanguageLabel, parseOutputLanguage } from '@/lib/outputLanguage';

export interface IncrementalAnalysisResult {
  changedFiles: string[];
  unchangedFiles: string[];
  newIssues: ReviewIssue[];
  resolvedIssues: ReviewIssue[];
  persistentIssues: ReviewIssue[];
  incrementalScore: number;
}

export interface PreviousReport {
  issues?: ReviewIssue[];
  created_at?: string;
}

export interface RuleConfig {
  category: string;
  name: string;
  prompt: string;
  severity: string;
}

export async function analyzeIncremental(
  currentDiff: string,
  previousReport: PreviousReport | null,
  rules: RuleConfig[],
  projectId: string
): Promise<ReviewResult> {
  // Get AI client for the project
  const { client, integration } = await resolveAIIntegration(projectId);
  let outputLanguageCode = DEFAULT_OUTPUT_LANGUAGE;
  try {
    const config = integration ? asJsonObject(integration.config) ?? {} : {};
    outputLanguageCode = parseOutputLanguage(config.outputLanguage);
  } catch {
    outputLanguageCode = DEFAULT_OUTPUT_LANGUAGE;
  }
  const outputLanguageInstruction = `${getOutputLanguageLabel(outputLanguageCode)} (${outputLanguageCode})`;

  // Extract changed files from diff
  const changedFiles = extractChangedFiles(currentDiff);
  const previousIssues = previousReport?.issues || [];

  // Filter previous issues to only those in changed files
  const relevantPreviousIssues = previousIssues.filter((issue: ReviewIssue) =>
    changedFiles.includes(issue.file)
  );

  const rulesText = rules
    .map((r, i) => `${i + 1}. [${r.category.toUpperCase()}] ${r.name}: ${r.prompt}`)
    .join('\n');

  const prompt = `You are a senior code reviewer. This is an **incremental analysis**, focus on changed files.

## Review Rules
${rulesText}

## Code Changes (Git Diff)
\`\`\`diff
${currentDiff.slice(0, 150000)}
\`\`\`

## Previous Issues (changed files only)
${relevantPreviousIssues.length > 0 ? JSON.stringify(relevantPreviousIssues, null, 2) : 'None'}

## Incremental Analysis Requirements

1. **Focus on changed files**: deeply analyze only files changed in this diff
2. **Compare with previous results**:
   - Mark issues that are fixed
   - Mark issues that still exist
   - Mark newly introduced issues
3. **Scoring strategy**:
   - Add points if issues were fixed
   - Subtract points if new issues were introduced
   - Score the change quality, not the overall codebase

## Output Format
Return the standard ReviewResult JSON. In the issues array, include:
- \`isNew\`: true/false
- \`wasFixed\`: true/false

All text fields must be in ${outputLanguageInstruction}.`;

  // Use the generic AI client interface
  const result = await client.analyze(prompt, '') as ReviewResult;

  // Add metadata about incremental analysis
  const resultWithMetadata = result as ReviewResult & {
    incrementalAnalysis?: {
      changedFiles: string[];
      previousIssuesCount: number;
      newIssuesCount: number;
      fixedIssuesCount: number;
    };
  };
  resultWithMetadata.incrementalAnalysis = {
    changedFiles,
    previousIssuesCount: relevantPreviousIssues.length,
    newIssuesCount: result.issues.filter((i: ReviewIssue) => (i as ReviewIssue & { isNew?: boolean }).isNew).length,
    fixedIssuesCount: result.issues.filter((i: ReviewIssue) => (i as ReviewIssue & { wasFixed?: boolean }).wasFixed).length,
  };

  return result;
}

function extractChangedFiles(diff: string): string[] {
  const filePattern = /^diff --git a\/(.+?) b\/.+$/gm;
  const files = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = filePattern.exec(diff)) !== null) {
    const file = match[1];
    if (file) {
      files.add(file);
    }
  }

  return Array.from(files);
}

export function shouldUseIncrementalAnalysis(
  commits: string[],
  recentReports: PreviousReport[]
): boolean {
  // Use incremental analysis if:
  // 1. There's a recent report (within 7 days)
  // 2. The commit count is small (< 5)
  // 3. Project has recent report snapshot to compare against

  if (!recentReports || recentReports.length === 0) return false;
  if (commits.length >= 5) return false;

  const latestReport = recentReports.at(0);
  if (!latestReport?.created_at) return false;

  const age = Date.now() - new Date(latestReport.created_at).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  return age < sevenDays;
}
