package review

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"spec-axis/scheduler/internal/domain"
	"spec-axis/scheduler/internal/integrations"
	"spec-axis/scheduler/internal/store"
)

type workspaceHandle struct {
	WorkspaceID   string `json:"workspaceId"`
	WorkspacePath string `json:"workspacePath"`
	MirrorPath    string `json:"mirrorPath"`
	Repo          string `json:"repo"`
	Ref           string `json:"ref"`
	OrgID         string `json:"orgId"`
	ProjectID     string `json:"projectId"`
	CreatedAt     string `json:"createdAt"`
}

func RunCodeReviewTask(
	ctx context.Context,
	st *store.Store,
	payload domain.CodeReviewRequest,
	timeout time.Duration,
	studioURL string,
	studioToken string,
) error {
	if payload.ProjectID == "" || payload.RunID == "" || payload.Repo == "" {
		return fmt.Errorf("missing projectId, runId, or repo")
	}

	run, err := st.GetCodeReviewRun(ctx, payload.RunID)
	if err != nil {
		return err
	}
	if run.ProjectID != payload.ProjectID {
		return fmt.Errorf("code review run project mismatch")
	}
	if run.Status != "pending" && run.Status != "running" {
		return store.ErrCodeReviewRunNotRunning
	}

	project, err := st.GetProject(ctx, payload.ProjectID)
	if err != nil {
		return err
	}
	if err := st.MarkCodeReviewRunRunning(ctx, payload.RunID); err != nil {
		return err
	}

	progress := func(stage string, message string, tool *string) error {
		return st.UpdateCodeReviewProgress(ctx, payload.RunID, domain.CodeReviewProgress{
			Stage:       stage,
			Message:     message,
			CurrentTool: tool,
		})
	}
	stage := func(name string, status string, stagePayload any, errMsg *string) error {
		var raw json.RawMessage
		if stagePayload != nil {
			encoded, err := json.Marshal(stagePayload)
			if err != nil {
				return err
			}
			raw = encoded
		}
		var completedAt *time.Time
		if status == "completed" || status == "failed" || status == "canceled" || status == "skipped" {
			now := time.Now().UTC()
			completedAt = &now
		}
		return st.UpsertCodeReviewStage(ctx, store.CodeReviewStageUpsert{
			RunID:        payload.RunID,
			Stage:        name,
			Status:       status,
			Payload:      raw,
			ErrorMessage: errMsg,
			CompletedAt:  completedAt,
		})
	}

	if err := stage("prepare", "running", map[string]any{"scopeMode": payload.ScopeMode}, nil); err != nil {
		return err
	}
	if err := progress("prepare", "Preparing review workspace", nil); err != nil {
		return err
	}

	ref := payload.HeadRef
	if strings.TrimSpace(ref) == "" {
		if len(payload.Hashes) > 0 {
			ref = payload.Hashes[len(payload.Hashes)-1]
		} else {
			ref = "HEAD"
		}
	}
	workspace, err := prepareWorkspace(ctx, studioURL, studioToken, payload.ProjectID, ref)
	if err != nil {
		msg := err.Error()
		_ = stage("prepare", "failed", nil, &msg)
		return err
	}
	defer func() {
		_ = cleanupWorkspace(context.Background(), studioURL, studioToken, workspace.WorkspacePath)
	}()
	if err := stage("prepare", "completed", workspace, nil); err != nil {
		return err
	}

	diff, changedFiles, err := buildDiffSummary(ctx, workspace.WorkspacePath, payload)
	if err != nil {
		msg := err.Error()
		_ = stage("normalize", "failed", nil, &msg)
		return err
	}

	if err := stage("baseline_scan", "running", map[string]any{"workspacePath": workspace.WorkspacePath}, nil); err != nil {
		return err
	}
	if err := progress("baseline_scan", "Running baseline scanners", nil); err != nil {
		return err
	}

	baselineRuns, baselineFindings, err := runBaselineScans(ctx, workspace.WorkspacePath, changedFiles)
	if err != nil {
		msg := err.Error()
		_ = stage("baseline_scan", "failed", nil, &msg)
		return err
	}
	for _, toolRun := range baselineRuns {
		tool := toolRun.Tool
		version := nullableString(toolRun.Version)
		command := nullableString(toolRun.Command)
		artifactPath := nullableString(toolRun.ArtifactPath)
		stdoutExcerpt := nullableString(toolRun.StdoutExcerpt)
		stderrExcerpt := nullableString(toolRun.StderrExcerpt)
		exitCode := toolRun.ExitCode
		durationMs := toolRun.DurationMs
		now := time.Now().UTC()
		if err := st.UpsertCodeReviewToolRun(ctx, store.CodeReviewToolRunUpsert{
			RunID:         payload.RunID,
			Tool:          tool,
			Version:       version,
			Status:        toolRun.Status,
			Command:       command,
			ExitCode:      exitCode,
			DurationMs:    &durationMs,
			ArtifactPath:  artifactPath,
			StdoutExcerpt: stdoutExcerpt,
			StderrExcerpt: stderrExcerpt,
			Metadata:      toolRun.Metadata,
			CompletedAt:   &now,
		}); err != nil {
			return err
		}
	}
	if err := stage("baseline_scan", "completed", map[string]any{
		"toolRuns":      len(baselineRuns),
		"findingCount":  len(baselineFindings),
		"changedFiles":  changedFiles,
		"workspacePath": workspace.WorkspacePath,
	}, nil); err != nil {
		return err
	}

	if err := stage("normalize", "running", map[string]any{"changedFiles": changedFiles}, nil); err != nil {
		return err
	}
	if err := progress("normalize", "Normalizing findings and hotspots", nil); err != nil {
		return err
	}
	hotspotFiles := rankHotspots(changedFiles, baselineFindings)
	if err := stage("normalize", "completed", map[string]any{
		"changedFiles": changedFiles,
		"hotspotFiles": hotspotFiles,
	}, nil); err != nil {
		return err
	}

	if err := stage("ai_review", "running", map[string]any{"hotspotFiles": hotspotFiles}, nil); err != nil {
		return err
	}
	if err := progress("ai_review", "Running AI deep review", nil); err != nil {
		return err
	}
	aiFindings, aiSummary, err := runAIDeepReview(ctx, st, project, payload, diff, baselineFindings, hotspotFiles, timeout)
	if err != nil {
		msg := err.Error()
		_ = stage("ai_review", "failed", nil, &msg)
		return err
	}
	if err := stage("ai_review", "completed", map[string]any{
		"findingCount": len(aiFindings),
		"summary":      aiSummary,
	}, nil); err != nil {
		return err
	}

	if err := stage("fusion", "running", nil, nil); err != nil {
		return err
	}
	if err := progress("fusion", "Merging baseline and AI findings", nil); err != nil {
		return err
	}
	finalFindings := fuseFindings(baselineFindings, aiFindings)
	score, riskLevel, gateStatus := scoreReview(finalFindings)
	summary := buildFinalSummary(finalFindings, aiSummary, changedFiles, hotspotFiles)
	if err := st.ReplaceCodeReviewFindings(ctx, payload.RunID, finalFindings); err != nil {
		return err
	}
	if err := stage("fusion", "completed", map[string]any{
		"findingCount": len(finalFindings),
		"score":        score,
		"riskLevel":    riskLevel,
	}, nil); err != nil {
		return err
	}

	if err := stage("gate", "running", nil, nil); err != nil {
		return err
	}
	if err := progress("gate", "Evaluating review gate", nil); err != nil {
		return err
	}
	if err := stage("gate", "completed", map[string]any{"gateStatus": gateStatus}, nil); err != nil {
		return err
	}

	if err := stage("finalize", "running", nil, nil); err != nil {
		return err
	}
	if err := progress("finalize", "Finalizing unified review result", nil); err != nil {
		return err
	}
	scoreCopy := score
	riskCopy := riskLevel
	summaryCopy := summary
	result := map[string]any{
		"changedFiles":     changedFiles,
		"hotspotFiles":     hotspotFiles,
		"baselineFindings": len(baselineFindings),
		"aiFindings":       len(aiFindings),
		"totalFindings":    len(finalFindings),
	}
	resultJSON, _ := json.Marshal(result)
	progressJSON, _ := json.Marshal(domain.CodeReviewProgress{
		Stage:   "finalize",
		Message: "Code review completed",
	})
	if err := st.FinalizeCodeReviewRun(ctx, payload.RunID, store.CodeReviewRunUpdate{
		Status:     "completed",
		GateStatus: gateStatus,
		Score:      &scoreCopy,
		RiskLevel:  &riskCopy,
		Summary:    &summaryCopy,
		Result:     resultJSON,
		Progress:   progressJSON,
	}); err != nil {
		return err
	}
	return stage("finalize", "completed", map[string]any{
		"score":      score,
		"riskLevel":  riskLevel,
		"gateStatus": gateStatus,
	}, nil)
}

func prepareWorkspace(ctx context.Context, studioURL string, studioToken string, projectID string, ref string) (*workspaceHandle, error) {
	endpoint := strings.TrimRight(studioURL, "/") + "/api/code-reviews/workspaces"
	body, _ := json.Marshal(map[string]string{
		"projectId": projectID,
		"ref":       ref,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token := strings.TrimSpace(studioToken); token != "" {
		req.Header.Set("X-Scheduler-Token", token)
	}
	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("prepare workspace failed: status=%d body=%s", resp.StatusCode, string(raw))
	}
	var workspace workspaceHandle
	if err := json.NewDecoder(resp.Body).Decode(&workspace); err != nil {
		return nil, err
	}
	return &workspace, nil
}

func cleanupWorkspace(ctx context.Context, studioURL string, studioToken string, workspacePath string) error {
	if strings.TrimSpace(workspacePath) == "" {
		return nil
	}
	endpoint := strings.TrimRight(studioURL, "/") + "/api/code-reviews/workspaces?workspacePath=" + url.QueryEscape(workspacePath)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	if token := strings.TrimSpace(studioToken); token != "" {
		req.Header.Set("X-Scheduler-Token", token)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("cleanup workspace failed: status=%d body=%s", resp.StatusCode, string(raw))
	}
	return nil
}

func buildDiffSummary(ctx context.Context, workspacePath string, payload domain.CodeReviewRequest) (string, []string, error) {
	head := strings.TrimSpace(payload.HeadRef)
	base := strings.TrimSpace(payload.BaseRef)
	if head == "" {
		if len(payload.Hashes) > 0 {
			head = payload.Hashes[len(payload.Hashes)-1]
		} else {
			head = "HEAD"
		}
	}
	if base == "" {
		switch {
		case len(payload.Hashes) >= 2:
			base = payload.Hashes[0]
		case len(payload.Hashes) == 1:
			base = payload.Hashes[0] + "^"
		default:
			base = "HEAD^"
		}
	}

	diffCmd := exec.CommandContext(ctx, "git", "-C", workspacePath, "diff", "--find-renames", "--unified=0", "--no-color", base, head)
	diffRaw, err := diffCmd.Output()
	if err != nil {
		return "", nil, err
	}
	filesCmd := exec.CommandContext(ctx, "git", "-C", workspacePath, "diff", "--find-renames", "--name-only", base, head)
	filesRaw, err := filesCmd.Output()
	if err != nil {
		return "", nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(filesRaw)), "\n")
	changedFiles := make([]string, 0, len(lines))
	for _, line := range lines {
		value := strings.TrimSpace(line)
		if value != "" {
			changedFiles = append(changedFiles, filepath.ToSlash(value))
		}
	}
	sort.Strings(changedFiles)
	return string(diffRaw), changedFiles, nil
}

func runAIDeepReview(
	ctx context.Context,
	st *store.Store,
	project *store.Project,
	payload domain.CodeReviewRequest,
	diff string,
	baselineFindings []domain.CodeReviewFinding,
	hotspotFiles []string,
	timeout time.Duration,
) ([]domain.CodeReviewFinding, string, error) {
	client, err := integrations.ResolveAIClient(ctx, st, project)
	if err != nil {
		return nil, "", err
	}

	baselineSnippet := baselineFindingSummary(baselineFindings)
	hotspots := strings.Join(hotspotFiles, ", ")
	prompt := fmt.Sprintf(`You are performing a deep code review after baseline deterministic scanners already ran.

Review scope:
- Mode: %s
- Hotspot files: %s

Baseline findings:
%s

Git diff:
~~~diff
%s
~~~

Focus only on high-value issues that baseline checks cannot fully explain:
- architecture and abstraction flaws
- change-risk and regression risk
- cross-file consistency issues
- maintainability and design debt
- security or performance risks requiring semantic understanding

Return ONLY valid JSON using the existing ReviewResult schema. Keep findings concise and high-signal.`, payload.ScopeMode, hotspots, baselineSnippet, truncate(diff, 160000))

	result, err := client.Analyze(prompt, "", timeout)
	if err != nil {
		return nil, "", err
	}

	findings := make([]domain.CodeReviewFinding, 0, len(result.Issues))
	for _, issue := range result.Issues {
		finding := domain.CodeReviewFinding{
			Stage:       "ai_review",
			Source:      "ai",
			Fingerprint: makeFindingFingerprint("ai", issue.Rule, issue.File, issue.Line, issue.Message),
			Category:    normalizeCategory(issue.Category),
			Severity:    normalizeSeverity(issue.Severity),
			Title:       issue.Rule,
			Message:     issue.Message,
			File:        normalizeFile(issue.File),
			Line:        issue.Line,
			Suggestion:  issue.Suggestion,
			FixPatch:    issue.FixPatch,
			Priority:    issue.Priority,
			ImpactScope: issue.ImpactScope,
		}
		if issue.Rule != "" {
			rule := issue.Rule
			finding.RuleID = &rule
		}
		findings = append(findings, finding)
	}
	return findings, result.Summary, nil
}

func fuseFindings(baseline []domain.CodeReviewFinding, ai []domain.CodeReviewFinding) []domain.CodeReviewFinding {
	merged := make([]domain.CodeReviewFinding, 0, len(baseline)+len(ai))
	index := map[string]int{}
	add := func(item domain.CodeReviewFinding) {
		if existingIndex, ok := index[item.Fingerprint]; ok {
			existing := merged[existingIndex]
			if existing.Source == "baseline" && item.Source == "ai" {
				existing.Source = "fused"
				existing.Stage = "fusion"
				if item.Suggestion != nil {
					existing.Suggestion = item.Suggestion
				}
				if item.FixPatch != nil {
					existing.FixPatch = item.FixPatch
				}
				if item.ImpactScope != nil {
					existing.ImpactScope = item.ImpactScope
				}
				merged[existingIndex] = existing
			}
			return
		}
		index[item.Fingerprint] = len(merged)
		merged = append(merged, item)
	}

	for _, item := range baseline {
		add(item)
	}
	for _, item := range ai {
		add(item)
	}

	sort.SliceStable(merged, func(i int, j int) bool {
		leftPriority := severityWeight(merged[i].Severity)
		rightPriority := severityWeight(merged[j].Severity)
		if leftPriority == rightPriority {
			if merged[i].File == merged[j].File {
				return valueOrZero(merged[i].Line) < valueOrZero(merged[j].Line)
			}
			return merged[i].File < merged[j].File
		}
		return leftPriority > rightPriority
	})
	return merged
}

func scoreReview(findings []domain.CodeReviewFinding) (int, string, string) {
	score := 100
	risk := "low"
	gate := "passed"
	for _, finding := range findings {
		switch normalizeSeverity(finding.Severity) {
		case "critical":
			score -= 18
			risk = "critical"
			if finding.Source != "ai" {
				gate = "blocked"
			}
		case "high":
			score -= 10
			if risk != "critical" {
				risk = "high"
			}
			if gate == "passed" && finding.Source != "ai" && normalizeCategory(finding.Category) == "security" {
				gate = "blocked"
			} else if gate == "passed" {
				gate = "warning"
			}
		case "medium":
			score -= 5
			if risk == "low" {
				risk = "medium"
			}
			if gate == "passed" {
				gate = "warning"
			}
		case "low":
			score -= 2
		}
	}
	if score < 0 {
		score = 0
	}
	return score, risk, gate
}

func buildFinalSummary(findings []domain.CodeReviewFinding, aiSummary string, changedFiles []string, hotspotFiles []string) string {
	if strings.TrimSpace(aiSummary) != "" {
		return aiSummary
	}
	return fmt.Sprintf(
		"Unified code review completed across %d changed files and %d hotspot files. The review produced %d findings after baseline scanning and AI deep review fusion.",
		len(changedFiles),
		len(hotspotFiles),
		len(findings),
	)
}

func baselineFindingSummary(findings []domain.CodeReviewFinding) string {
	if len(findings) == 0 {
		return "No baseline findings."
	}
	lines := make([]string, 0, min(20, len(findings)))
	for i, finding := range findings {
		if i >= 20 {
			break
		}
		location := finding.File
		if finding.Line != nil {
			location = fmt.Sprintf("%s:%d", location, *finding.Line)
		}
		tool := "baseline"
		if finding.Tool != nil && strings.TrimSpace(*finding.Tool) != "" {
			tool = *finding.Tool
		}
		lines = append(lines, fmt.Sprintf("- [%s][%s][%s] %s", tool, finding.Severity, location, finding.Message))
	}
	return strings.Join(lines, "\n")
}

func rankHotspots(changedFiles []string, findings []domain.CodeReviewFinding) []string {
	scores := map[string]int{}
	for _, file := range changedFiles {
		scores[file] = 1
	}
	for _, finding := range findings {
		scores[finding.File] += severityWeight(finding.Severity)
	}
	type item struct {
		file  string
		score int
	}
	items := make([]item, 0, len(scores))
	for file, score := range scores {
		items = append(items, item{file: file, score: score})
	}
	sort.SliceStable(items, func(i int, j int) bool {
		if items[i].score == items[j].score {
			return items[i].file < items[j].file
		}
		return items[i].score > items[j].score
	})
	limit := 12
	if len(items) < limit {
		limit = len(items)
	}
	result := make([]string, 0, limit)
	for i := 0; i < limit; i++ {
		result = append(result, items[i].file)
	}
	return result
}

func makeFindingFingerprint(source string, rule string, file string, line *int, message string) string {
	base := fmt.Sprintf("%s|%s|%s|%d|%s", source, normalizeFile(file), strings.TrimSpace(rule), valueOrZero(line), strings.TrimSpace(message))
	sum := sha1.Sum([]byte(base))
	return hex.EncodeToString(sum[:])
}

func normalizeFile(value string) string {
	trimmed := strings.TrimSpace(filepath.ToSlash(value))
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}

func normalizeCategory(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "style", "security", "architecture", "performance", "maintainability":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "maintainability"
	}
}

func normalizeSeverity(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "critical", "high", "medium", "low", "info":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "medium"
	}
}

func severityWeight(value string) int {
	switch normalizeSeverity(value) {
	case "critical":
		return 5
	case "high":
		return 4
	case "medium":
		return 3
	case "low":
		return 2
	default:
		return 1
	}
}

func truncate(value string, max int) string {
	if max <= 0 || len(value) <= max {
		return value
	}
	return value[:max]
}

func nullableString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func valueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func min(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func commandVersion(name string, args ...string) string {
	path, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	cmd := exec.Command(path, args...)
	raw, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func runCommand(ctx context.Context, dir string, name string, args ...string) (string, string, int, time.Duration, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	started := time.Now()
	if err := cmd.Start(); err != nil {
		return "", "", 1, 0, err
	}
	err := cmd.Wait()
	duration := time.Since(started)
	if err == nil {
		return stdoutBuf.String(), stderrBuf.String(), 0, duration, nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return stdoutBuf.String(), stderrBuf.String(), exitErr.ExitCode(), duration, err
	}
	return stdoutBuf.String(), stderrBuf.String(), 1, duration, err
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
