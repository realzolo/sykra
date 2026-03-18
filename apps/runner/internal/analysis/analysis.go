package analysis

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"spec-axis/runner/internal/domain"
	"spec-axis/runner/internal/events"
	"spec-axis/runner/internal/integrations"
	"spec-axis/runner/internal/store"
)

func RunAnalyzeTask(
	ctx context.Context,
	st *store.Store,
	publisher *events.Publisher,
	payload domain.AnalyzeRequest,
	timeout time.Duration,
) error {
	if payload.ReportID == "" || payload.ProjectID == "" {
		return fmt.Errorf("missing reportId or projectId")
	}
	if payload.Repo == "" || len(payload.Hashes) == 0 {
		return fmt.Errorf("missing repo or commit hashes")
	}

	report, err := st.GetReport(ctx, payload.ReportID)
	if err != nil {
		return err
	}
	if report.ProjectID != "" && report.ProjectID != payload.ProjectID {
		return fmt.Errorf("report project mismatch")
	}
	if report.Status != "pending" && report.Status != "analyzing" {
		return store.ErrReportNotAnalyzing
	}

	project, err := st.GetProject(ctx, payload.ProjectID)
	if err != nil {
		return err
	}

	if err := st.MarkReportAnalyzing(ctx, payload.ReportID); err != nil {
		return err
	}
	tracker := newProgressTracker(ctx, st, payload.ReportID)
	if err := tracker.Update("preparing", "Preparing analysis environment", nil, 0, 0, false); err != nil {
		return err
	}
	if publisher != nil {
		publisher.ReportStatus(payload.ReportID, "analyzing", nil)
	}

	if err := tracker.Update("resolving_integrations", "Resolving project integrations", nil, 0, 0, false); err != nil {
		return err
	}
	vcsClient, err := integrations.ResolveVCSClient(ctx, st, project)
	if err != nil {
		return err
	}

	repo := payload.Repo
	if project.Repo != "" {
		repo = project.Repo
	}

	if err := tracker.Update("fetching_diff", "Fetching commit diffs", nil, 0, 0, false); err != nil {
		return err
	}
	diff, err := getCommitsDiff(vcsClient, repo, payload.Hashes, func(index int, total int, sha string) {
		if index == 1 || index == total || index%2 == 0 {
			message := fmt.Sprintf("Fetching commit diff (%d/%d)", index, total)
			current := sha
			_ = tracker.Update("fetching_diff", message, &current, 0, 0, false)
		}
	})
	if err != nil {
		return err
	}

	filtered := filterDiffByPatterns(diff, project.IgnorePatterns)
	if strings.TrimSpace(filtered) == "" {
		return fmt.Errorf("no analyzable changes after filtering")
	}

	stats := extractDiffStats(filtered)
	changedFiles := extractChangedFiles(filtered)

	if len(changedFiles) > 0 {
		for idx, file := range changedFiles {
			processed := idx + 1
			if shouldEmitFileProgress(processed, len(changedFiles)) {
				current := file
				message := fmt.Sprintf("Scanning changed files (%d/%d)", processed, len(changedFiles))
				if err := tracker.Update("scanning_files", message, &current, processed, len(changedFiles), false); err != nil {
					return err
				}
			}
		}
	}

	aiClient, err := integrations.ResolveAIClient(ctx, st, project)
	if err != nil {
		return err
	}

	analyzingMessage := fmt.Sprintf("Analyzing changes with model %s", aiClient.Model())
	if err := tracker.Update("analyzing", analyzingMessage, nil, 0, len(changedFiles), false); err != nil {
		return err
	}
	start := time.Now()
	var result domain.ReviewResult
	if payload.UseIncremental {
		result, err = analyzeIncremental(payload, filtered, aiClient, timeout)
	} else {
		result, err = analyzeFull(payload, filtered, aiClient, timeout)
	}
	if err != nil {
		return err
	}
	durationMs := int(time.Since(start).Milliseconds())
	tokenUsageJSON, tokensUsed := marshalTokenUsage(result.TokenUsage)

	if result.CategoryScores == nil {
		result.CategoryScores = map[string]float64{}
	}

	issuesJSON, _ := json.Marshal(result.Issues)
	categoryScoresJSON, _ := json.Marshal(result.CategoryScores)
	progressDone := tracker.Complete("completed", "Analysis completed", stats.TotalFiles, stats.TotalFiles)
	progressDoneJSON, _ := json.Marshal(progressDone)

	update := store.ReportAnalysisUpdate{
		Status:              "done",
		Score:               result.Score,
		CategoryScores:      categoryScoresJSON,
		Issues:              issuesJSON,
		Summary:             result.Summary,
		ComplexityMetrics:   result.ComplexityMetrics,
		DuplicationMetrics:  result.DuplicationMetrics,
		DependencyMetrics:   result.DependencyMetrics,
		SecurityFindings:    result.SecurityFindings,
		PerformanceFindings: result.PerformanceFindings,
		AISuggestions:       result.AISuggestions,
		CodeExplanations:    result.CodeExplanations,
		ContextAnalysis:     result.ContextAnalysis,
		TotalFiles:          stats.TotalFiles,
		TotalAdditions:      stats.TotalAdditions,
		TotalDeletions:      stats.TotalDeletions,
		AnalysisDurationMs:  durationMs,
		ModelVersion:        aiClient.Model(),
		TokensUsed:          tokensUsed,
		TokenUsage:          tokenUsageJSON,
		AnalysisProgress:    progressDoneJSON,
	}

	if err := tracker.Update("finalizing", "Saving analysis result", nil, stats.TotalFiles, stats.TotalFiles, false); err != nil {
		return err
	}
	if err := st.UpdateReportAnalysis(ctx, payload.ReportID, update); err != nil {
		return err
	}

	if err := st.ReplaceReportIssues(ctx, payload.ReportID, result.Issues); err != nil {
		return err
	}

	_ = st.UpdateProjectLastAnalyzedAt(ctx, payload.ProjectID)

	if project.WebhookURL != nil && *project.WebhookURL != "" {
		_ = postWebhook(*project.WebhookURL, payload.ProjectID, payload.ReportID, result.Score, project.QualityThreshold)
	}

	if publisher != nil {
		score := result.Score
		publisher.ReportStatus(payload.ReportID, "done", &score)
	}

	// Optional: notify Studio so it can send user-facing notifications (email, etc.).
	postStudioReportEvent(ctx, payload.ReportID)

	return nil
}

func postStudioReportEvent(ctx context.Context, reportID string) {
	studioURL := strings.TrimSpace(os.Getenv("STUDIO_URL"))
	token := strings.TrimSpace(os.Getenv("STUDIO_TOKEN"))
	if studioURL == "" || token == "" {
		return
	}

	url := strings.TrimRight(studioURL, "/") + "/api/runner/events"
	raw, err := json.Marshal(map[string]any{
		"type":     "report.done",
		"reportId": reportID,
	})
	if err != nil {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Runner-Token", token)
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return
	}
	_ = res.Body.Close()
}

func analyzeFull(
	payload domain.AnalyzeRequest,
	diff string,
	client integrations.AIClient,
	timeout time.Duration,
) (domain.ReviewResult, error) {
	prompt := buildAnalysisPrompt(payload.Rules, diff)
	return client.Analyze(prompt, "", timeout)
}

func analyzeIncremental(
	payload domain.AnalyzeRequest,
	diff string,
	client integrations.AIClient,
	timeout time.Duration,
) (domain.ReviewResult, error) {
	previousIssues := extractPreviousIssues(payload.PreviousReport)
	changedFiles := extractChangedFiles(diff)
	filtered := filterIssuesByFiles(previousIssues, changedFiles)
	prompt := buildIncrementalPrompt(payload.Rules, diff, filtered)
	return client.Analyze(prompt, "", timeout)
}

func extractPreviousIssues(raw json.RawMessage) []domain.ReviewIssue {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil
	}
	issuesRaw, ok := data["issues"].([]any)
	if !ok {
		return nil
	}
	issues := make([]domain.ReviewIssue, 0, len(issuesRaw))
	for _, item := range issuesRaw {
		if issueMap, ok := item.(map[string]any); ok {
			issues = append(issues, parseIssue(issueMap))
		}
	}
	return issues
}

func parseIssue(raw map[string]any) domain.ReviewIssue {
	issue := domain.ReviewIssue{}
	if v, ok := raw["file"].(string); ok {
		issue.File = v
	}
	if v, ok := raw["line"].(float64); ok {
		line := int(v)
		issue.Line = &line
	}
	if v, ok := raw["severity"].(string); ok {
		issue.Severity = v
	}
	if v, ok := raw["category"].(string); ok {
		issue.Category = v
	}
	if v, ok := raw["rule"].(string); ok {
		issue.Rule = v
	}
	if v, ok := raw["message"].(string); ok {
		issue.Message = v
	}
	if v, ok := raw["suggestion"].(string); ok {
		issue.Suggestion = &v
	}
	if v, ok := raw["codeSnippet"].(string); ok {
		issue.CodeSnippet = &v
	}
	if v, ok := raw["fixPatch"].(string); ok {
		issue.FixPatch = &v
	}
	if v, ok := raw["priority"].(float64); ok {
		priority := int(v)
		issue.Priority = &priority
	}
	if v, ok := raw["impactScope"].(string); ok {
		issue.ImpactScope = &v
	}
	if v, ok := raw["estimatedEffort"].(string); ok {
		issue.EstimatedEffort = &v
	}
	return issue
}

func filterIssuesByFiles(issues []domain.ReviewIssue, files []string) []domain.ReviewIssue {
	if len(issues) == 0 || len(files) == 0 {
		return issues
	}
	allowed := map[string]bool{}
	for _, file := range files {
		allowed[file] = true
	}
	filtered := make([]domain.ReviewIssue, 0, len(issues))
	for _, issue := range issues {
		if allowed[issue.File] {
			filtered = append(filtered, issue)
		}
	}
	return filtered
}

func buildAnalysisPrompt(rules []domain.Rule, diff string) string {
	diff = truncateDiff(diff, 150000)
	detected := detectLanguagesInDiff(diff)
	languageInfo := ""
	if len(detected) > 0 {
		lines := make([]string, 0, len(detected))
		for _, lang := range detected {
			if config, ok := languageConfigs[lang]; ok {
				lines = append(lines, "- "+config.name)
			}
		}
		if len(lines) > 0 {
			languageInfo = "\n## Detected Languages\n" + strings.Join(lines, "\n") + "\n"
		}
	}

	allRules := append([]domain.Rule{}, rules...)
	for _, lang := range detected {
		if config, ok := languageConfigs[lang]; ok {
			for _, rule := range config.rules {
				allRules = append(allRules, domain.Rule{
					Category: "style",
					Name:     config.name + " - " + rule,
					Prompt:   rule,
					Severity: "info",
				})
			}
		}
	}

	rulesText := buildRulesText(allRules)
	diffBlock := "```diff\n" + diff + "\n```"

	return fmt.Sprintf(`You are a senior code reviewer. Analyze the following code changes thoroughly and provide structured feedback.
%s
## Review Rules
%s

## Code Changes (Git Diff)
%s

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

All text fields must be in English.`, languageInfo, rulesText, diffBlock)
}

func buildIncrementalPrompt(rules []domain.Rule, diff string, previousIssues []domain.ReviewIssue) string {
	diff = truncateDiff(diff, 150000)
	rulesText := buildRulesText(rules)
	diffBlock := "```diff\n" + diff + "\n```"
	previousJSON := "None"
	if len(previousIssues) > 0 {
		raw, _ := json.MarshalIndent(previousIssues, "", "  ")
		previousJSON = string(raw)
	}
	isNewLabel := "`isNew`"
	wasFixedLabel := "`wasFixed`"

	return fmt.Sprintf(`You are a senior code reviewer. This is an **incremental analysis**, focus on changed files.

## Review Rules
%s

## Code Changes (Git Diff)
%s

## Previous Issues (changed files only)
%s

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
- %s: true/false
- %s: true/false

All text fields must be in English.`, rulesText, diffBlock, previousJSON, isNewLabel, wasFixedLabel)
}

func buildRulesText(rules []domain.Rule) string {
	lines := make([]string, 0, len(rules))
	for i, r := range rules {
		lines = append(lines, fmt.Sprintf("%d. [%s] %s: %s", i+1, strings.ToUpper(r.Category), r.Name, r.Prompt))
	}
	return strings.Join(lines, "\n")
}

func truncateDiff(diff string, max int) string {
	if max <= 0 || len(diff) <= max {
		return diff
	}
	return diff[:max]
}

func getCommitsDiff(
	client integrations.VCSClient,
	repo string,
	hashes []string,
	onCommit func(index int, total int, sha string),
) (string, error) {
	var builder strings.Builder
	for i, sha := range hashes {
		if onCommit != nil {
			onCommit(i+1, len(hashes), sha)
		}
		diff, err := client.GetCommitDiff(repo, sha)
		if err != nil {
			return "", err
		}
		builder.WriteString("\n\n### Commit: ")
		builder.WriteString(sha)
		builder.WriteString("\n")
		builder.WriteString(diff)
	}
	return builder.String(), nil
}

func marshalTokenUsage(usage *domain.TokenUsage) (json.RawMessage, *int) {
	if usage == nil {
		return nil, nil
	}
	raw, err := json.Marshal(usage)
	if err != nil {
		return nil, nil
	}
	total := usage.TotalTokens
	return raw, &total
}

func shouldEmitFileProgress(processed int, total int) bool {
	if processed <= 1 || processed == total {
		return true
	}
	if total <= 20 {
		return true
	}
	return processed%5 == 0
}

type progressTracker struct {
	ctx      context.Context
	store    *store.Store
	reportID string
	started  time.Time
}

func newProgressTracker(ctx context.Context, st *store.Store, reportID string) *progressTracker {
	return &progressTracker{
		ctx:      ctx,
		store:    st,
		reportID: reportID,
		started:  time.Now().UTC(),
	}
}

func (p *progressTracker) Update(
	phase string,
	message string,
	currentFile *string,
	filesProcessed int,
	filesTotal int,
	completed bool,
) error {
	progress := domain.AnalysisProgress{
		Phase:          phase,
		Message:        message,
		CurrentFile:    currentFile,
		FilesProcessed: filesProcessed,
		FilesTotal:     filesTotal,
		StartedAt:      p.started,
		UpdatedAt:      time.Now().UTC(),
	}
	if completed {
		now := time.Now().UTC()
		progress.CompletedAt = &now
	}
	return p.store.UpdateReportProgress(p.ctx, p.reportID, progress)
}

func (p *progressTracker) Complete(phase string, message string, filesProcessed int, filesTotal int) domain.AnalysisProgress {
	now := time.Now().UTC()
	return domain.AnalysisProgress{
		Phase:          phase,
		Message:        message,
		FilesProcessed: filesProcessed,
		FilesTotal:     filesTotal,
		StartedAt:      p.started,
		UpdatedAt:      now,
		CompletedAt:    &now,
	}
}

func filterDiffByPatterns(diff string, patterns []string) string {
	if len(patterns) == 0 {
		return diff
	}

	active := make([]string, 0, len(patterns))
	for _, p := range patterns {
		p = strings.TrimSpace(p)
		if p == "" || strings.HasPrefix(p, "#") {
			continue
		}
		active = append(active, p)
	}
	if len(active) == 0 {
		return diff
	}

	blocks := splitDiffBlocks(diff)
	filtered := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if block.file == "" || !isIgnored(block.file, active) {
			filtered = append(filtered, block.content)
		}
	}
	return strings.Join(filtered, "")
}

type diffBlock struct {
	file    string
	content string
}

func splitDiffBlocks(diff string) []diffBlock {
	lines := strings.Split(diff, "\n")
	blocks := []diffBlock{}
	current := []string{}
	currentFile := ""

	flush := func() {
		if len(current) > 0 {
			blocks = append(blocks, diffBlock{file: currentFile, content: strings.Join(current, "\n") + "\n"})
		}
	}

	for _, line := range lines {
		if strings.HasPrefix(line, "diff --git ") {
			flush()
			current = []string{line}
			currentFile = ""
			if match := diffFilePattern.FindStringSubmatch(line); len(match) > 1 {
				currentFile = match[1]
			}
			continue
		}
		current = append(current, line)
	}
	flush()
	return blocks
}

func isIgnored(file string, patterns []string) bool {
	for _, pattern := range patterns {
		if matchPattern(file, pattern) {
			return true
		}
	}
	return false
}

func matchPattern(file string, pattern string) bool {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return false
	}
	if pattern == file {
		return true
	}
	regex := globToRegex(pattern)
	return regex.MatchString(file)
}

func globToRegex(pattern string) *regexp.Regexp {
	escaped := regexp.QuoteMeta(pattern)
	escaped = strings.ReplaceAll(escaped, "\\*\\*", ".*")
	escaped = strings.ReplaceAll(escaped, "\\*", "[^/]*")
	escaped = strings.ReplaceAll(escaped, "\\?", ".")
	return regexp.MustCompile("^" + escaped + "$")
}

var diffFilePattern = regexp.MustCompile(`^diff --git a\/(.+?) b\/.+$`)

func extractDiffStats(diff string) domain.DiffStats {
	files := map[string]struct{}{}
	additions := 0
	deletions := 0

	for _, line := range strings.Split(diff, "\n") {
		if strings.HasPrefix(line, "diff --git ") {
			if match := diffFilePattern.FindStringSubmatch(line); len(match) > 1 {
				files[match[1]] = struct{}{}
			}
			continue
		}
		if strings.HasPrefix(line, "+++") || strings.HasPrefix(line, "---") {
			continue
		}
		if strings.HasPrefix(line, "+") {
			additions++
		}
		if strings.HasPrefix(line, "-") {
			deletions++
		}
	}

	return domain.DiffStats{
		TotalFiles:     len(files),
		TotalAdditions: additions,
		TotalDeletions: deletions,
	}
}

func extractChangedFiles(diff string) []string {
	matches := diffFilePattern.FindAllStringSubmatch(diff, -1)
	files := map[string]struct{}{}
	for _, match := range matches {
		if len(match) > 1 {
			files[match[1]] = struct{}{}
		}
	}
	result := make([]string, 0, len(files))
	for file := range files {
		result = append(result, file)
	}
	return result
}

type languageConfig struct {
	name       string
	extensions []string
	rules      []string
}

var languageConfigs = map[string]languageConfig{
	"javascript": {
		name:       "JavaScript",
		extensions: []string{".js", ".jsx", ".mjs", ".cjs"},
		rules: []string{
			"Avoid magic numbers",
			"Keep functions small and focused",
			"Avoid deep nesting",
			"Use meaningful variable names",
			"Prefer const and let over var",
			"Avoid ==; use ===",
			"Use arrow functions to preserve this context",
			"Avoid callback hell; use Promise or async/await",
		},
	},
	"typescript": {
		name:       "TypeScript",
		extensions: []string{".ts", ".tsx"},
		rules: []string{
			"Avoid magic numbers",
			"Keep functions small and focused",
			"Avoid deep nesting",
			"Use meaningful variable names",
			"Add type annotations for function parameters and return values",
			"Use interfaces to define object shapes",
			"Avoid the any type",
			"Use enums instead of magic strings",
		},
	},
	"python": {
		name:       "Python",
		extensions: []string{".py", ".pyw"},
		rules: []string{
			"Avoid magic numbers",
			"Keep functions small and focused",
			"Avoid deep nesting",
			"Use meaningful variable names",
			"Follow PEP 8 style guidelines",
			"Use list comprehensions where appropriate",
			"Use context managers for resource handling",
			"Avoid mutable default arguments",
		},
	},
	"java": {
		name:       "Java",
		extensions: []string{".java"},
		rules: []string{
			"Avoid magic numbers",
			"Keep functions small and focused",
			"Avoid deep nesting",
			"Use meaningful variable names",
			"Follow Java naming conventions",
			"Prefer interfaces over concrete classes",
			"Handle exceptions properly",
			"Use StringBuilder for string concatenation",
		},
	},
	"go": {
		name:       "Go",
		extensions: []string{".go"},
		rules: []string{
			"Avoid magic numbers",
			"Keep functions small and focused",
			"Avoid deep nesting",
			"Use meaningful variable names",
			"Follow Go style guidelines",
			"Handle errors properly",
			"Use defer for cleanup",
			"Avoid goroutine leaks",
		},
	},
	"rust": {
		name:       "Rust",
		extensions: []string{".rs"},
		rules: []string{
			"Avoid magic numbers",
			"Keep functions small and focused",
			"Avoid deep nesting",
			"Use meaningful variable names",
			"Use ownership and borrowing correctly",
			"Avoid unnecessary cloning",
			"Use Result and Option for error handling",
			"Follow Rust naming conventions",
		},
	},
	"php": {
		name:       "PHP",
		extensions: []string{".php"},
		rules: []string{
			"Avoid magic numbers",
			"Keep functions small and focused",
			"Avoid deep nesting",
			"Use meaningful variable names",
			"Use type declarations",
			"Avoid global variables",
			"Use PDO for database access",
			"Follow PSR standards",
		},
	},
	"ruby": {
		name:       "Ruby",
		extensions: []string{".rb"},
		rules: []string{
			"Avoid magic numbers",
			"Keep functions small and focused",
			"Avoid deep nesting",
			"Use meaningful variable names",
			"Follow the Ruby style guide",
			"Use symbols instead of strings for hash keys",
			"Use blocks and iterators",
			"Avoid global variables",
		},
	},
	"csharp": {
		name:       "C#",
		extensions: []string{".cs"},
		rules: []string{
			"Avoid magic numbers",
			"Keep functions small and focused",
			"Avoid deep nesting",
			"Use meaningful variable names",
			"Follow C# naming conventions",
			"Use LINQ for collections",
			"Implement IDisposable correctly",
			"Use async programming patterns",
		},
	},
}

func detectLanguagesInDiff(diff string) []string {
	matches := diffFilePattern.FindAllStringSubmatch(diff, -1)
	found := map[string]struct{}{}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		file := match[1]
		for lang, config := range languageConfigs {
			for _, ext := range config.extensions {
				if strings.HasSuffix(strings.ToLower(file), ext) {
					found[lang] = struct{}{}
					break
				}
			}
		}
	}

	result := make([]string, 0, len(found))
	for lang := range found {
		result = append(result, lang)
	}
	return result
}

func postWebhook(webhookURL string, projectID string, reportID string, score int, threshold *int) error {
	passed := any(nil)
	if threshold != nil {
		value := score >= *threshold
		passed = value
	}

	payload := map[string]any{
		"projectId": projectID,
		"reportId":  reportID,
		"score":     score,
		"threshold": threshold,
		"passed":    passed,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	raw, _ := json.Marshal(payload)
	resp, _ := httpPostJSON(webhookURL, raw)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	return nil
}

func httpPostJSON(url string, payload []byte) (*http.Response, error) {
	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	return client.Do(req)
}
