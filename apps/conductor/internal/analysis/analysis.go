package analysis

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"sykra/conductor/internal/domain"
	"sykra/conductor/internal/events"
	"sykra/conductor/internal/integrations"
	"sykra/conductor/internal/store"
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
	if report.Status != "pending" && report.Status != "running" {
		return store.ErrReportNotRunning
	}

	project, err := st.GetProject(ctx, payload.ProjectID)
	if err != nil {
		return err
	}

	if err := st.MarkReportRunning(ctx, payload.ReportID); err != nil {
		return err
	}
	tracker := newProgressTracker(ctx, st, payload.ReportID)
	if err := tracker.Update("preparing", "Preparing analysis environment", nil, 0, 0, false); err != nil {
		return err
	}
	if publisher != nil {
		publisher.ReportStatus(payload.ReportID, "running", nil)
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

	coreClient, err := integrations.ResolveAIClientForPhase(ctx, st, project, "core")
	if err != nil {
		return err
	}
	securityPerfClient, err := integrations.ResolveAIClientForPhase(ctx, st, project, "security_performance")
	if err != nil {
		return err
	}
	suggestionsClient, err := integrations.ResolveAIClientForPhase(ctx, st, project, "suggestions")
	if err != nil {
		return err
	}

	if err := tracker.Update(
		"running_core",
		fmt.Sprintf("Running core analysis with model %s", coreClient.Model()),
		nil,
		0,
		0,
		false,
	); err != nil {
		return err
	}

	coreDiff := selectCoreDiff(filtered)
	outputLanguage := coreClient.OutputLanguage()

	var corePrompt string
	if payload.UseIncremental {
		previousIssues := extractPreviousIssues(payload.PreviousReport)
		filteredIssues := filterIssuesByFiles(previousIssues, changedFiles)
		corePrompt = buildIncrementalPrompt(payload.Rules, coreDiff, filteredIssues, outputLanguage)
	} else {
		corePrompt = buildCorePhasePrompt(payload.Rules, coreDiff, outputLanguage)
	}

	start := time.Now()
	coreResult, _, err := runPhaseWithRetry(
		ctx,
		st,
		payload.ReportID,
		coreClient,
		"core",
		corePrompt,
		phaseTimeout("ANALYZE_PHASE_CORE_TIMEOUT", timeout, 40),
	)
	if err != nil {
		return err
	}
	if err := tracker.Update(
		"core_done",
		"Core analysis completed, running remaining phases in parallel",
		nil,
		0,
		0,
		false,
	); err != nil {
		return err
	}

	type phaseSpec struct {
		phase  string
		prompt string
		client integrations.AIClient
		local  *domain.ReviewResult
	}
	localQuality := buildLocalQualityPhaseResult(filtered)
	parallelPhases := []phaseSpec{
		{
			phase:  "quality",
			prompt: buildQualityPhasePrompt(filtered, outputLanguage),
			client: coreClient,
			local:  &localQuality,
		},
		{
			phase:  "security_performance",
			prompt: buildSecurityPerformancePhasePrompt(filtered, outputLanguage),
			client: securityPerfClient,
		},
		{
			phase:  "suggestions",
			prompt: buildSuggestionsPhasePrompt(filtered, coreResult.Issues, outputLanguage),
			client: suggestionsClient,
		},
	}

	type phaseOutcome struct {
		phase      string
		result     domain.ReviewResult
		durationMs int
		err        error
	}
	outcomes := make(chan phaseOutcome, len(parallelPhases))
	for _, phase := range parallelPhases {
		phase := phase
		go func() {
			var (
				result     domain.ReviewResult
				durationMs int
				phaseErr   error
			)
			if phase.local != nil {
				result, durationMs, phaseErr = runLocalPhase(
					ctx,
					st,
					payload.ReportID,
					phase.phase,
					*phase.local,
				)
			} else {
				result, durationMs, phaseErr = runPhaseWithRetry(
					ctx,
					st,
					payload.ReportID,
					phase.client,
					phase.phase,
					phase.prompt,
					phaseTimeout("ANALYZE_PHASE_"+strings.ToUpper(phase.phase)+"_TIMEOUT", timeout, 30),
				)
			}
			outcomes <- phaseOutcome{
				phase:      phase.phase,
				result:     result,
				durationMs: durationMs,
				err:        phaseErr,
			}
		}()
	}

	finalResult := coreResult
	if finalResult.CategoryScores == nil {
		finalResult.CategoryScores = map[string]float64{}
	}

	totalInputTokens := 0
	totalOutputTokens := 0
	totalTokens := 0
	phaseFailures := make([]string, 0, len(parallelPhases))
	accumulateTokenUsage(coreResult.TokenUsage, &totalInputTokens, &totalOutputTokens, &totalTokens)

	completedCount := 1
	for range parallelPhases {
		outcome := <-outcomes
		if outcome.err != nil {
			phaseFailures = append(phaseFailures, fmt.Sprintf("%s: %v", outcome.phase, outcome.err))
			_ = tracker.Update(
				"running_parallel",
				fmt.Sprintf("Phase %s failed, continuing remaining phases", outcome.phase),
				nil,
				0,
				0,
				false,
			)
			continue
		}

		completedCount++
		switch outcome.phase {
		case "quality":
			finalResult.ComplexityMetrics = outcome.result.ComplexityMetrics
			finalResult.DuplicationMetrics = outcome.result.DuplicationMetrics
			finalResult.DependencyMetrics = outcome.result.DependencyMetrics
		case "security_performance":
			finalResult.SecurityFindings = outcome.result.SecurityFindings
			finalResult.PerformanceFindings = outcome.result.PerformanceFindings
		case "suggestions":
			finalResult.AISuggestions = outcome.result.AISuggestions
			finalResult.CodeExplanations = outcome.result.CodeExplanations
		}
		accumulateTokenUsage(outcome.result.TokenUsage, &totalInputTokens, &totalOutputTokens, &totalTokens)
		_ = tracker.Update(
			"running_parallel",
			fmt.Sprintf("Completed phase %s (%d/4)", outcome.phase, completedCount),
			nil,
			0,
			0,
			false,
		)
	}

	var finalStatus string
	var finalErrorMessage *string
	if len(phaseFailures) == 0 {
		finalStatus = "done"
	} else {
		finalStatus = "partial_failed"
		msg := "Some analysis phases failed: " + strings.Join(phaseFailures, "; ")
		finalErrorMessage = &msg
	}

	durationMs := int(time.Since(start).Milliseconds())
	var tokenUsage *domain.TokenUsage
	if totalInputTokens > 0 || totalOutputTokens > 0 || totalTokens > 0 {
		tokenUsage = &domain.TokenUsage{
			InputTokens:  totalInputTokens,
			OutputTokens: totalOutputTokens,
			TotalTokens:  totalTokens,
		}
	}
	tokenUsageJSON, tokensUsed := marshalTokenUsage(tokenUsage)

	categoryScoresJSON, _ := json.Marshal(finalResult.CategoryScores)
	doneMessage := "Analysis completed"
	progressPhase := "completed"
	if finalStatus == "partial_failed" {
		doneMessage = "Analysis completed with partial phase failures"
		progressPhase = "partial_failed"
	}
	progressDone := tracker.Complete(progressPhase, doneMessage, stats.TotalFiles, stats.TotalFiles)
	progressDoneJSON, _ := json.Marshal(progressDone)

	if err := tracker.Update("finalizing", "Saving analysis result", nil, 0, 0, false); err != nil {
		return err
	}
	update := store.ReportAnalysisUpdate{
		Status:              finalStatus,
		Score:               finalResult.Score,
		CategoryScores:      categoryScoresJSON,
		Summary:             finalResult.Summary,
		ComplexityMetrics:   finalResult.ComplexityMetrics,
		DuplicationMetrics:  finalResult.DuplicationMetrics,
		DependencyMetrics:   finalResult.DependencyMetrics,
		SecurityFindings:    finalResult.SecurityFindings,
		PerformanceFindings: finalResult.PerformanceFindings,
		AISuggestions:       finalResult.AISuggestions,
		CodeExplanations:    finalResult.CodeExplanations,
		ContextAnalysis:     finalResult.ContextAnalysis,
		TotalFiles:          stats.TotalFiles,
		TotalAdditions:      stats.TotalAdditions,
		TotalDeletions:      stats.TotalDeletions,
		AnalysisDurationMs:  durationMs,
		ModelVersion:        coreClient.Model(),
		TokensUsed:          tokensUsed,
		TokenUsage:          tokenUsageJSON,
		AnalysisProgress:    progressDoneJSON,
		ErrorMessage:        finalErrorMessage,
	}
	if err := st.UpdateReportAnalysis(ctx, payload.ReportID, update); err != nil {
		return err
	}

	if err := st.ReplaceReportIssues(ctx, payload.ReportID, finalResult.Issues); err != nil {
		return err
	}

	_ = st.UpdateProjectLastAnalyzedAt(ctx, payload.ProjectID)

	if project.WebhookURL != nil && *project.WebhookURL != "" {
		_ = postWebhook(*project.WebhookURL, payload.ProjectID, payload.ReportID, finalResult.Score, project.QualityThreshold)
	}

	if publisher != nil {
		score := finalResult.Score
		publisher.ReportStatus(payload.ReportID, finalStatus, &score)
	}

	// Optional: notify Studio so it can send user-facing notifications (email, etc.).
	if finalStatus == "done" || finalStatus == "partial_failed" {
		postStudioReportEvent(ctx, payload.ReportID)
	}

	return nil
}

func runPhaseWithRetry(
	ctx context.Context,
	st *store.Store,
	reportID string,
	client integrations.AIClient,
	phase string,
	prompt string,
	timeout time.Duration,
) (domain.ReviewResult, int, error) {
	if latest, err := st.GetLatestReportSection(ctx, reportID, phase); err != nil {
		return domain.ReviewResult{}, 0, err
	} else if latest != nil && latest.Status == "done" {
		resumed, parseErr := parseSectionPayloadToResult(phase, latest.Payload)
		if parseErr == nil {
			if usage, usageErr := parseTokenUsageFromRaw(latest.TokenUsage); usageErr == nil && usage != nil {
				resumed.TokenUsage = usage
			} else if latest.TokensUsed != nil {
				resumed.TokenUsage = &domain.TokenUsage{
					TotalTokens: *latest.TokensUsed,
				}
			}
			if latest.DurationMs != nil {
				return resumed, *latest.DurationMs, nil
			}
			return resumed, 0, nil
		}
	}

	const maxAttempts = 2
	var lastErr error
	nextAttempt := 1
	if latest, err := st.GetLatestReportSection(ctx, reportID, phase); err == nil && latest != nil {
		nextAttempt = latest.Attempt + 1
	}

	for retry := 0; retry < maxAttempts; retry++ {
		attempt := nextAttempt + retry
		startedAt := time.Now().UTC()
		if err := st.UpsertReportSection(ctx, store.ReportSectionUpsert{
			ReportID: reportID,
			Phase:    phase,
			Attempt:  attempt,
			Status:   "running",
		}); err != nil {
			return domain.ReviewResult{}, 0, err
		}

		result, err := client.Analyze(prompt, "", timeout)
		durationMs := int(time.Since(startedAt).Milliseconds())
		completedAt := time.Now().UTC()
		if err != nil {
			lastErr = err
			errMsg := err.Error()
			_ = st.UpsertReportSection(ctx, store.ReportSectionUpsert{
				ReportID:     reportID,
				Phase:        phase,
				Attempt:      attempt,
				Status:       "failed",
				ErrorMessage: &errMsg,
				DurationMs:   &durationMs,
				CompletedAt:  &completedAt,
			})
			if retry+1 < maxAttempts && isRetryablePhaseError(err) {
				continue
			}
			return domain.ReviewResult{}, durationMs, err
		}

		sectionPayload, payloadErr := buildSectionPayload(phase, result)
		if payloadErr != nil {
			return domain.ReviewResult{}, durationMs, payloadErr
		}
		tokenUsageJSON, tokensUsed := marshalTokenUsage(result.TokenUsage)
		costUSD := estimateCostUSD(result.TokenUsage)
		if err := st.UpsertReportSection(ctx, store.ReportSectionUpsert{
			ReportID:    reportID,
			Phase:       phase,
			Attempt:     attempt,
			Status:      "done",
			Payload:     sectionPayload,
			DurationMs:  &durationMs,
			TokensUsed:  tokensUsed,
			TokenUsage:  tokenUsageJSON,
			CostUSD:     costUSD,
			CompletedAt: &completedAt,
		}); err != nil {
			return domain.ReviewResult{}, durationMs, err
		}
		return result, durationMs, nil
	}

	if lastErr != nil {
		return domain.ReviewResult{}, 0, lastErr
	}
	return domain.ReviewResult{}, 0, fmt.Errorf("phase %s failed", phase)
}

func runLocalPhase(
	ctx context.Context,
	st *store.Store,
	reportID string,
	phase string,
	result domain.ReviewResult,
) (domain.ReviewResult, int, error) {
	if latest, err := st.GetLatestReportSection(ctx, reportID, phase); err != nil {
		return domain.ReviewResult{}, 0, err
	} else if latest != nil && latest.Status == "done" {
		resumed, parseErr := parseSectionPayloadToResult(phase, latest.Payload)
		if parseErr == nil {
			if latest.DurationMs != nil {
				return resumed, *latest.DurationMs, nil
			}
			return resumed, 0, nil
		}
	}

	nextAttempt := 1
	if latest, err := st.GetLatestReportSection(ctx, reportID, phase); err == nil && latest != nil {
		nextAttempt = latest.Attempt + 1
	}
	started := time.Now()
	sectionPayload, payloadErr := buildSectionPayload(phase, result)
	if payloadErr != nil {
		return domain.ReviewResult{}, 0, payloadErr
	}
	durationMs := int(time.Since(started).Milliseconds())
	completedAt := time.Now().UTC()
	if err := st.UpsertReportSection(ctx, store.ReportSectionUpsert{
		ReportID:    reportID,
		Phase:       phase,
		Attempt:     nextAttempt,
		Status:      "done",
		Payload:     sectionPayload,
		DurationMs:  &durationMs,
		CompletedAt: &completedAt,
	}); err != nil {
		return domain.ReviewResult{}, 0, err
	}
	return result, durationMs, nil
}

func buildLocalQualityPhaseResult(diff string) domain.ReviewResult {
	totalLines := 0
	addedLines := 0
	deletedLines := 0
	for _, line := range strings.Split(diff, "\n") {
		if strings.HasPrefix(line, "diff --git") || strings.HasPrefix(line, "@@") {
			continue
		}
		if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
			addedLines++
			totalLines++
			continue
		}
		if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
			deletedLines++
			totalLines++
			continue
		}
		if strings.TrimSpace(line) != "" {
			totalLines++
		}
	}
	dupRate := 0.0
	if totalLines > 0 {
		dupRate = float64(maxInt(0, addedLines-50)) / float64(totalLines) * 100.0
	}
	return domain.ReviewResult{
		ComplexityMetrics: marshalAnyField(map[string]any{
			"cyclomaticComplexity":  maxInt(1, addedLines/25),
			"cognitiveComplexity":   maxInt(1, addedLines/20),
			"averageFunctionLength": maxInt(5, addedLines/8),
			"maxFunctionLength":     maxInt(15, addedLines/3),
			"totalFunctions":        maxInt(1, addedLines/40),
		}),
		DuplicationMetrics: marshalAnyField(map[string]any{
			"duplicatedLines":  maxInt(0, addedLines/12),
			"duplicatedBlocks": maxInt(0, addedLines/80),
			"duplicationRate":  dupRate,
			"duplicatedFiles":  []string{},
		}),
		DependencyMetrics: marshalAnyField(map[string]any{
			"totalDependencies":    0,
			"outdatedDependencies": 0,
			"circularDependencies": []string{},
			"unusedDependencies":   []string{},
		}),
	}
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func estimateCostUSD(usage *domain.TokenUsage) *float64 {
	if usage == nil {
		return nil
	}
	inputUnit := readPositiveFloatEnv("AI_COST_INPUT_PER_MILLION_USD", 0)
	outputUnit := readPositiveFloatEnv("AI_COST_OUTPUT_PER_MILLION_USD", 0)
	if inputUnit <= 0 && outputUnit <= 0 {
		return nil
	}
	cost := (float64(usage.InputTokens)/1_000_000.0)*inputUnit + (float64(usage.OutputTokens)/1_000_000.0)*outputUnit
	return &cost
}

func readPositiveFloatEnv(name string, fallback float64) float64 {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func parseSectionPayloadToResult(phase string, payload json.RawMessage) (domain.ReviewResult, error) {
	if len(payload) == 0 {
		return domain.ReviewResult{}, fmt.Errorf("empty section payload")
	}
	var parsed map[string]any
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return domain.ReviewResult{}, err
	}

	result := domain.ReviewResult{
		CategoryScores: map[string]float64{},
	}
	switch phase {
	case "core":
		if score, ok := parsed["score"].(float64); ok {
			result.Score = int(score)
		}
		if summary, ok := parsed["summary"].(string); ok {
			result.Summary = summary
		}
		if cat, ok := parsed["categoryScores"].(map[string]any); ok {
			for k, v := range cat {
				if num, ok := v.(float64); ok {
					result.CategoryScores[k] = num
				}
			}
		}
		if issuesRaw, ok := parsed["issues"].([]any); ok {
			for _, issueRaw := range issuesRaw {
				issueMap, ok := issueRaw.(map[string]any)
				if !ok {
					continue
				}
				result.Issues = append(result.Issues, parseIssue(issueMap))
			}
		}
		result.ContextAnalysis = marshalAnyField(parsed["contextAnalysis"])
	case "quality":
		result.ComplexityMetrics = marshalAnyField(parsed["complexityMetrics"])
		result.DuplicationMetrics = marshalAnyField(parsed["duplicationMetrics"])
		result.DependencyMetrics = marshalAnyField(parsed["dependencyMetrics"])
	case "security_performance":
		result.SecurityFindings = marshalAnyField(parsed["securityFindings"])
		result.PerformanceFindings = marshalAnyField(parsed["performanceFindings"])
	case "suggestions":
		result.AISuggestions = marshalAnyField(parsed["aiSuggestions"])
		result.CodeExplanations = marshalAnyField(parsed["codeExplanations"])
	default:
		return domain.ReviewResult{}, fmt.Errorf("unsupported phase for payload parse: %s", phase)
	}
	return result, nil
}

func parseTokenUsageFromRaw(raw json.RawMessage) (*domain.TokenUsage, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var usage domain.TokenUsage
	if err := json.Unmarshal(raw, &usage); err != nil {
		return nil, err
	}
	return &usage, nil
}

func buildSectionPayload(phase string, result domain.ReviewResult) (json.RawMessage, error) {
	switch phase {
	case "core":
		return json.Marshal(map[string]any{
			"score":          result.Score,
			"categoryScores": result.CategoryScores,
			"issues":         result.Issues,
			"summary":        result.Summary,
			"contextAnalysis": func() any {
				if len(result.ContextAnalysis) == 0 {
					return nil
				}
				var parsed any
				if err := json.Unmarshal(result.ContextAnalysis, &parsed); err != nil {
					return nil
				}
				return parsed
			}(),
		})
	case "quality":
		return json.Marshal(map[string]any{
			"complexityMetrics":  rawToAny(result.ComplexityMetrics),
			"duplicationMetrics": rawToAny(result.DuplicationMetrics),
			"dependencyMetrics":  rawToAny(result.DependencyMetrics),
		})
	case "security_performance":
		return json.Marshal(map[string]any{
			"securityFindings":    rawToAny(result.SecurityFindings),
			"performanceFindings": rawToAny(result.PerformanceFindings),
		})
	case "suggestions":
		return json.Marshal(map[string]any{
			"aiSuggestions":    rawToAny(result.AISuggestions),
			"codeExplanations": rawToAny(result.CodeExplanations),
		})
	default:
		return nil, fmt.Errorf("unsupported phase: %s", phase)
	}
}

func rawToAny(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil
	}
	return parsed
}

func marshalAnyField(value any) json.RawMessage {
	if value == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return raw
}

func isRetryablePhaseError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	low := strings.ToLower(err.Error())
	retryableHints := []string{
		"timeout",
		"temporarily unavailable",
		"connection reset",
		"eof",
		"429",
		"502",
		"503",
		"504",
	}
	for _, hint := range retryableHints {
		if strings.Contains(low, hint) {
			return true
		}
	}
	return false
}

func phaseBudget(total time.Duration, percent int) time.Duration {
	if total <= 0 {
		return 10 * time.Minute
	}
	if percent <= 0 {
		percent = 25
	}
	budget := time.Duration(float64(total) * (float64(percent) / 100.0))
	minBudget := 3 * time.Minute
	if budget < minBudget {
		return minBudget
	}
	if budget > total {
		return total
	}
	return budget
}

func phaseTimeout(envKey string, total time.Duration, fallbackPercent int) time.Duration {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw != "" {
		if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
			return parsed
		}
	}
	return phaseBudget(total, fallbackPercent)
}

func accumulateTokenUsage(usage *domain.TokenUsage, inputTotal *int, outputTotal *int, total *int) {
	if usage == nil {
		return
	}
	*inputTotal += usage.InputTokens
	*outputTotal += usage.OutputTokens
	*total += usage.TotalTokens
}

func postStudioReportEvent(ctx context.Context, reportID string) {
	studioURL := strings.TrimSpace(os.Getenv("STUDIO_URL"))
	token := strings.TrimSpace(os.Getenv("STUDIO_TOKEN"))
	if studioURL == "" || token == "" {
		return
	}

	url := strings.TrimRight(studioURL, "/") + "/api/conductor/events"
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
	req.Header.Set("X-Conductor-Token", token)
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return
	}
	_ = res.Body.Close()
}

func buildCorePhasePrompt(rules []domain.Rule, diff string, outputLanguage string) string {
	diff = truncateDiff(diff, 130000)
	rulesText := buildRulesText(rules)
	diffBlock := "```diff\n" + diff + "\n```"
	languageInstruction := outputLanguageInstruction(outputLanguage)
	return fmt.Sprintf(`You are a senior code reviewer. Perform the CORE review for this diff.

Review rules:
%s

Code diff:
%s

Return ONLY valid JSON with exactly these keys:
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
      "file": "path",
      "line": 1,
      "severity": "critical|high|medium|low|info",
      "category": "category",
      "rule": "rule",
      "message": "issue",
      "suggestion": "fix suggestion",
      "codeSnippet": "snippet",
      "fixPatch": "patch",
      "priority": 1,
      "impactScope": "scope",
      "estimatedEffort": "low|medium|high"
    }
  ],
  "summary": "2-4 sentence summary",
  "contextAnalysis": {
    "changeType": "feature|bugfix|refactor|performance|other",
    "businessImpact": "text",
    "riskLevel": "low|medium|high|critical",
    "affectedModules": ["module"],
    "breakingChanges": false
  }
}

All text fields must be in %s.`, rulesText, diffBlock, languageInstruction)
}

func buildQualityPhasePrompt(diff string, outputLanguage string) string {
	diff = truncateDiff(diff, 110000)
	diffBlock := "```diff\n" + diff + "\n```"
	languageInstruction := outputLanguageInstruction(outputLanguage)
	return fmt.Sprintf(`You are a senior code reviewer. Perform QUALITY METRICS analysis for this diff.

Code diff:
%s

Return ONLY valid JSON:
{
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
    "duplicatedFiles": ["file.ts"]
  },
  "dependencyMetrics": {
    "totalDependencies": 0,
    "outdatedDependencies": 0,
    "circularDependencies": ["a -> b -> a"],
    "unusedDependencies": ["pkg"]
  }
}

All text fields must be in %s.`, diffBlock, languageInstruction)
}

func buildSecurityPerformancePhasePrompt(diff string, outputLanguage string) string {
	diff = truncateDiff(diff, 110000)
	diffBlock := "```diff\n" + diff + "\n```"
	languageInstruction := outputLanguageInstruction(outputLanguage)
	return fmt.Sprintf(`You are a senior AppSec and performance reviewer. Analyze this diff.

Code diff:
%s

Return ONLY valid JSON:
{
  "securityFindings": [
    {
      "type": "vulnerability type",
      "severity": "critical|high|medium|low",
      "description": "detail",
      "file": "path",
      "line": 1,
      "cwe": "CWE-XXX"
    }
  ],
  "performanceFindings": [
    {
      "type": "performance issue",
      "description": "detail",
      "file": "path",
      "line": 1,
      "impact": "impact"
    }
  ]
}

Use empty arrays when no findings. All text fields must be in %s.`, diffBlock, languageInstruction)
}

func buildSuggestionsPhasePrompt(diff string, coreIssues []domain.ReviewIssue, outputLanguage string) string {
	diff = truncateDiff(diff, 90000)
	diffBlock := "```diff\n" + diff + "\n```"
	languageInstruction := outputLanguageInstruction(outputLanguage)
	issueDigest := "[]"
	if len(coreIssues) > 0 {
		limit := 20
		if len(coreIssues) < limit {
			limit = len(coreIssues)
		}
		raw, _ := json.Marshal(coreIssues[:limit])
		issueDigest = string(raw)
	}
	return fmt.Sprintf(`You are a senior engineering lead. Provide practical suggestions for this diff.

Code diff:
%s

Core issues summary (for context):
%s

Return ONLY valid JSON:
{
  "aiSuggestions": [
    {
      "type": "refactor|performance|security|architecture|testing",
      "title": "short title",
      "description": "actionable recommendation",
      "priority": 1,
      "estimatedImpact": "impact summary"
    }
  ],
  "codeExplanations": [
    {
      "file": "path",
      "line": 1,
      "complexity": "what is complex",
      "explanation": "explain current logic",
      "recommendation": "better approach"
    }
  ]
}

Use empty arrays if no suggestions. All text fields must be in %s.`, diffBlock, issueDigest, languageInstruction)
}

func analyzeFull(
	payload domain.AnalyzeRequest,
	diff string,
	client integrations.AIClient,
	timeout time.Duration,
) (domain.ReviewResult, error) {
	prompt := buildAnalysisPrompt(payload.Rules, diff, client.OutputLanguage())
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
	prompt := buildIncrementalPrompt(payload.Rules, diff, filtered, client.OutputLanguage())
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

func buildAnalysisPrompt(rules []domain.Rule, diff string, outputLanguage string) string {
	diff = truncateDiff(diff, 150000)
	languageInstruction := outputLanguageInstruction(outputLanguage)
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

All text fields must be in %s.`, languageInfo, rulesText, diffBlock, languageInstruction)
}

func buildIncrementalPrompt(
	rules []domain.Rule,
	diff string,
	previousIssues []domain.ReviewIssue,
	outputLanguage string,
) string {
	diff = truncateDiff(diff, 150000)
	languageInstruction := outputLanguageInstruction(outputLanguage)
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

All text fields must be in %s.`, rulesText, diffBlock, previousJSON, isNewLabel, wasFixedLabel, languageInstruction)
}

var outputLanguageNames = map[string]string{
	"en":    "English",
	"zh-CN": "Simplified Chinese",
	"zh-TW": "Traditional Chinese",
	"ja":    "Japanese",
	"ko":    "Korean",
	"es":    "Spanish",
	"fr":    "French",
	"de":    "German",
	"pt-BR": "Portuguese (Brazil)",
	"ru":    "Russian",
	"it":    "Italian",
	"nl":    "Dutch",
	"tr":    "Turkish",
	"pl":    "Polish",
	"ar":    "Arabic",
	"hi":    "Hindi",
	"th":    "Thai",
	"vi":    "Vietnamese",
	"id":    "Indonesian",
	"ms":    "Malay",
}

func outputLanguageInstruction(code string) string {
	normalized := strings.TrimSpace(code)
	name, ok := outputLanguageNames[normalized]
	if !ok {
		normalized = "en"
		name = "English"
	}
	return fmt.Sprintf("%s (%s)", name, normalized)
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

func selectCoreDiff(diff string) string {
	topK := readPositiveIntEnv("ANALYZE_CORE_TOP_K_FILES", 40)
	if topK <= 0 {
		return diff
	}
	blocks := splitDiffBlocks(diff)
	if len(blocks) <= topK {
		return diff
	}

	type scoredBlock struct {
		block diffBlock
		score int
	}
	scored := make([]scoredBlock, 0, len(blocks))
	for _, block := range blocks {
		score := scoreDiffBlock(block)
		scored = append(scored, scoredBlock{block: block, score: score})
	}

	sort.SliceStable(scored, func(i int, j int) bool {
		if scored[i].score == scored[j].score {
			return scored[i].block.file < scored[j].block.file
		}
		return scored[i].score > scored[j].score
	})

	parts := make([]string, 0, topK)
	for i := 0; i < topK && i < len(scored); i++ {
		parts = append(parts, scored[i].block.content)
	}
	return strings.Join(parts, "")
}

func scoreDiffBlock(block diffBlock) int {
	score := 0
	lines := strings.Split(block.content, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
			score += 2
		}
		if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
			score += 2
		}
	}
	file := strings.ToLower(block.file)
	riskKeywords := []string{
		"auth", "security", "token", "permission", "acl", "crypto",
		"payment", "billing", "db", "migration", "config", "middleware", "api",
	}
	for _, keyword := range riskKeywords {
		if strings.Contains(file, keyword) {
			score += 30
			break
		}
	}
	if strings.HasSuffix(file, ".sql") || strings.HasSuffix(file, ".yaml") || strings.HasSuffix(file, ".yml") {
		score += 20
	}
	return score
}

func readPositiveIntEnv(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
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
