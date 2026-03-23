/**
 * AI analysis service - uses the new integration system
 */

import { resolveAIIntegration } from './integrations';
import { detectLanguagesInDiff, getLanguageSpecificRules, LANGUAGE_CONFIGS } from './languages';
import { asJsonObject } from '@/lib/json';
import { DEFAULT_OUTPUT_LANGUAGE, getOutputLanguageLabel, parseOutputLanguage } from '@/lib/outputLanguage';

export interface ReviewResult {
  score: number;
  categoryScores: Record<string, number>;
  issues: Array<{
    file: string;
    line?: number;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    category: string;
    rule: string;
    message: string;
    suggestion?: string;
    codeSnippet?: string;
    fixPatch?: string;
    priority?: number;
    impactScope?: string;
    estimatedEffort?: string;
  }>;
  summary: string;
  complexityMetrics?: {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    averageFunctionLength: number;
    maxFunctionLength: number;
    totalFunctions: number;
  };
  duplicationMetrics?: {
    duplicatedLines: number;
    duplicatedBlocks: number;
    duplicationRate: number;
    duplicatedFiles: string[];
  };
  dependencyMetrics?: {
    totalDependencies: number;
    outdatedDependencies: number;
    circularDependencies: string[];
    unusedDependencies: string[];
  };
  securityFindings?: Array<{
    type: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    file: string;
    line?: number;
    cwe?: string;
  }>;
  performanceFindings?: Array<{
    type: string;
    description: string;
    file: string;
    line?: number;
    impact: string;
  }>;
  aiSuggestions?: Array<{
    type: string;
    title: string;
    description: string;
    priority: number;
    estimatedImpact: string;
  }>;
  codeExplanations?: Array<{
    file: string;
    line?: number;
    complexity: string;
    explanation: string;
    recommendation: string;
  }>;
  contextAnalysis?: {
    changeType: string;
    businessImpact: string;
    riskLevel: string;
    affectedModules: string[];
    breakingChanges: boolean;
  };
}

export interface ReviewIssue {
  file: string;
  line?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  rule: string;
  message: string;
  suggestion?: string;
  codeSnippet?: string;
  fixPatch?: string;
  priority?: number;
  impactScope?: string;
  estimatedEffort?: string;
}

export interface RuleInput {
  category: string;
  name: string;
  prompt: string;
  severity: string;
}

export async function analyzeCode(
  diff: string,
  rules: RuleInput[],
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

  // Detect languages in the diff
  const detectedLanguages = detectLanguagesInDiff(diff);
  const languageInfo = detectedLanguages.length > 0
    ? `\n## Detected Languages\n${detectedLanguages.map(lang => `- ${LANGUAGE_CONFIGS[lang].name}`).join('\n')}\n`
    : '';

  // Add language-specific rules
  const languageSpecificRules = detectedLanguages.flatMap(lang =>
    getLanguageSpecificRules(lang).map((rule) => ({
      category: 'style',
      name: `${LANGUAGE_CONFIGS[lang].name} - ${rule}`,
      prompt: rule,
      severity: 'info',
    }))
  );

  const allRules = [...rules, ...languageSpecificRules];

  const rulesText = allRules
    .map((r, i) => `${i + 1}. [${r.category.toUpperCase()}] ${r.name}: ${r.prompt}`)
    .join('\n');

  const prompt = buildAnalysisPrompt(languageInfo, rulesText, diff, outputLanguageInstruction);

  // Use the generic AI client interface
  const result = await client.analyze(prompt, '');

  return result as ReviewResult;
}

function buildAnalysisPrompt(
  languageInfo: string,
  rulesText: string,
  diff: string,
  outputLanguageInstruction: string
): string {
  return `You are a senior code reviewer. Analyze the following code changes thoroughly and provide structured feedback.
${languageInfo}
## Review Rules
${rulesText}

## Code Changes (Git Diff)
\`\`\`diff
${diff.slice(0, 150000)}
\`\`\`

## Analysis Requirements

### 1. Core Review
- Review each changed file using all applicable rules
- Identify concrete issues with file paths and line numbers
- Score each category (0-100)
- Overall score should be a weighted average of category scores
- Provide specific, actionable fixes

### 2. Multi-dimensional Quality Analysis
**Complexity**
- Compute cyclomatic and cognitive complexity
- Flag overly long functions and deep nesting
- Assess readability

**Duplication**
- Detect duplicated code blocks
- Estimate duplication rate
- Suggest refactoring options

**Dependencies**
- Detect circular dependencies
- Identify unused dependencies
- Assess dependency health

### 3. Issue Prioritization
For each issue, estimate:
- **Priority** (1-5, 5 highest) based on severity and impact
- **Impact scope** (affected modules/features)
- **Estimated effort** (low/medium/high)
- **Code snippet** for context
- **Fix patch** if feasible

### 4. Context Awareness
Describe:
- **Change type** (feature/bug fix/refactor/perf, etc.)
- **Business impact**
- **Risk level** (low/medium/high/critical)
- **Affected modules**
- **Breaking changes** (API/db migrations, etc.)

### 5. Security Scan
Detect:
- OWASP Top 10 issues (SQL injection, XSS, CSRF, etc.)
- Hardcoded secrets (API keys, passwords, tokens)
- Weak cryptography
- Authorization flaws
- Provide CWE identifiers when applicable

### 6. Performance Review
Identify:
- Performance bottlenecks
- Algorithmic complexity issues (O(n^2)+)
- Unnecessary loops or recomputation
- Memory leak risks
- Blocking synchronous operations

### 7. Fix Suggestions
Provide:
- Refactoring ideas (extract functions, simplify logic)
- Performance optimizations
- Architectural improvements
- Best practice recommendations

### 8. Code Explanations
For complex logic:
- Explain intent
- Explain why the current implementation is problematic
- Suggest a better approach

## Output Format
Return ONLY valid JSON (no markdown):
{
  "score": <0-100>,
  "categoryScores": {
    "style": <0-100>,
    "security": <0-100>,
    "architecture": <0-100>,
    "performance": <0-100>,
    "maintainability": <0-100>
  },
  "issues": [
    {
      "file": "path/to/file.ts",
      "line": 123,
      "severity": "critical|high|medium|low|info",
      "category": "category",
      "rule": "rule name",
      "message": "issue description",
      "suggestion": "fix suggestion",
      "codeSnippet": "relevant code",
      "fixPatch": "proposed fix",
      "priority": 1,
      "impactScope": "affected area",
      "estimatedEffort": "low|medium|high"
    }
  ],
  "summary": "2-4 sentence overall summary",
  "complexityMetrics": {
    "cyclomaticComplexity": 0,
    "cognitiveComplexity": 0,
    "averageFunctionLength": 0,
    "maxFunctionLength": 0,
    "totalFunctions": 0
  },
  "duplicationMetrics": {
    "duplicatedLines": 0,
    "duplicatedBlocks": 0,
    "duplicationRate": 0,
    "duplicatedFiles": ["fileA.ts"]
  },
  "dependencyMetrics": {
    "totalDependencies": 0,
    "outdatedDependencies": 0,
    "circularDependencies": ["moduleA -> moduleB -> moduleA"],
    "unusedDependencies": ["unused-package"]
  },
  "securityFindings": [
    {
      "type": "vulnerability type",
      "severity": "critical|high|medium|low",
      "description": "detailed description",
      "file": "path/to/file.ts",
      "line": 42,
      "cwe": "CWE-XXX"
    }
  ],
  "performanceFindings": [
    {
      "type": "performance issue type",
      "description": "detailed description",
      "file": "path/to/file.ts",
      "line": 42,
      "impact": "impact description"
    }
  ],
  "aiSuggestions": [
    {
      "type": "suggestion type",
      "title": "short title",
      "description": "detailed description",
      "priority": 1,
      "estimatedImpact": "expected impact"
    }
  ],
  "codeExplanations": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "complexity": "complexity description",
      "explanation": "code explanation",
      "recommendation": "improvement recommendation"
    }
  ],
  "contextAnalysis": {
    "changeType": "change type",
    "businessImpact": "business impact",
    "riskLevel": "low|medium|high|critical",
    "affectedModules": ["moduleA", "moduleB"],
    "breakingChanges": false
  }
}

All text fields must be in ${outputLanguageInstruction}.`;
}
