package review

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"spec-axis/scheduler/internal/domain"
)

type toolSpec struct {
	name       string
	binary     string
	applicable func(workspacePath string) bool
	run        func(ctx context.Context, workspacePath string) domain.BaselineToolRun
}

func runBaselineScans(ctx context.Context, workspacePath string, changedFiles []string) ([]domain.BaselineToolRun, []domain.CodeReviewFinding, error) {
	specs := []toolSpec{
		{
			name:   "eslint",
			binary: "pnpm",
			applicable: func(workspacePath string) bool {
				return fileExists(filepath.Join(workspacePath, "package.json"))
			},
			run: runESLint,
		},
		{
			name:   "tsc",
			binary: "pnpm",
			applicable: func(workspacePath string) bool {
				return fileExists(filepath.Join(workspacePath, "tsconfig.json")) || fileExists(filepath.Join(workspacePath, "package.json"))
			},
			run: runTypeScript,
		},
		{
			name:   "semgrep",
			binary: "semgrep",
			applicable: func(_ string) bool {
				return true
			},
			run: runSemgrep,
		},
		{
			name:   "gitleaks",
			binary: "gitleaks",
			applicable: func(_ string) bool {
				return true
			},
			run: runGitleaks,
		},
		{
			name:   "golangci-lint",
			binary: "golangci-lint",
			applicable: func(workspacePath string) bool {
				return fileExists(filepath.Join(workspacePath, "go.mod"))
			},
			run: runGolangCILint,
		},
		{
			name:   "go-vet",
			binary: "go",
			applicable: func(workspacePath string) bool {
				return fileExists(filepath.Join(workspacePath, "go.mod"))
			},
			run: runGoVet,
		},
	}

	runs := make([]domain.BaselineToolRun, 0, len(specs))
	findings := []domain.CodeReviewFinding{}
	for _, spec := range specs {
		if !spec.applicable(workspacePath) {
			runs = append(runs, domain.BaselineToolRun{
				Tool:   spec.name,
				Status: "skipped",
			})
			continue
		}
		if _, err := exec.LookPath(spec.binary); err != nil {
			runs = append(runs, domain.BaselineToolRun{
				Tool:          spec.name,
				Status:        "skipped",
				StderrExcerpt: fmt.Sprintf("%s is not installed on the scheduler host", spec.binary),
			})
			continue
		}
		run := spec.run(ctx, workspacePath)
		runs = append(runs, run)
		findings = append(findings, filterFindingsByChangedFiles(run.Findings, changedFiles)...)
	}
	return runs, findings, nil
}

func runESLint(ctx context.Context, workspacePath string) domain.BaselineToolRun {
	stdout, stderr, exitCode, duration, err := runCommand(ctx, workspacePath, "pnpm", "exec", "eslint", ".", "--format", "json")
	toolRun := domain.BaselineToolRun{
		Tool:          "eslint",
		Version:       commandVersion("pnpm", "exec", "eslint", "--version"),
		Status:        statusFromCommand(err),
		Command:       "pnpm exec eslint . --format json",
		DurationMs:    int(duration.Milliseconds()),
		StdoutExcerpt: truncate(strings.TrimSpace(stdout), 1200),
		StderrExcerpt: truncate(strings.TrimSpace(stderr), 1200),
	}
	if err != nil {
		toolRun.ExitCode = &exitCode
	}

	var entries []struct {
		FilePath string `json:"filePath"`
		Messages []struct {
			RuleID   string `json:"ruleId"`
			Severity int    `json:"severity"`
			Message  string `json:"message"`
			Line     int    `json:"line"`
			EndLine  int    `json:"endLine"`
		} `json:"messages"`
	}
	if parseErr := json.Unmarshal([]byte(stdout), &entries); parseErr == nil {
		for _, entry := range entries {
			for _, message := range entry.Messages {
				sev := "low"
				if message.Severity >= 2 {
					sev = "medium"
				}
				ruleID := strings.TrimSpace(message.RuleID)
				if ruleID == "" {
					ruleID = "eslint"
				}
				file := normalizeFile(entry.FilePath)
				line := message.Line
				endLine := message.EndLine
				toolName := "eslint"
				toolRun.Findings = append(toolRun.Findings, domain.CodeReviewFinding{
					Stage:       "baseline_scan",
					Source:      "baseline",
					Tool:        &toolName,
					RuleID:      &ruleID,
					Fingerprint: makeFindingFingerprint("baseline", ruleID, file, &line, message.Message),
					Category:    "maintainability",
					Severity:    sev,
					Title:       ruleID,
					Message:     message.Message,
					File:        file,
					Line:        &line,
					EndLine:     &endLine,
				})
			}
		}
	}
	return toolRun
}

func runTypeScript(ctx context.Context, workspacePath string) domain.BaselineToolRun {
	stdout, stderr, exitCode, duration, err := runCommand(ctx, workspacePath, "pnpm", "exec", "tsc", "--noEmit", "--pretty", "false")
	toolRun := domain.BaselineToolRun{
		Tool:          "tsc",
		Version:       commandVersion("pnpm", "exec", "tsc", "--version"),
		Status:        statusFromCommand(err),
		Command:       "pnpm exec tsc --noEmit --pretty false",
		DurationMs:    int(duration.Milliseconds()),
		StdoutExcerpt: truncate(strings.TrimSpace(stdout), 1200),
		StderrExcerpt: truncate(strings.TrimSpace(stderr), 1200),
	}
	if err != nil {
		toolRun.ExitCode = &exitCode
	}
	combined := strings.TrimSpace(strings.Join([]string{stdout, stderr}, "\n"))
	pattern := regexp.MustCompile(`(?m)^(.+)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$`)
	for _, match := range pattern.FindAllStringSubmatch(combined, -1) {
		if len(match) < 5 {
			continue
		}
		file := normalizeFile(match[1])
		line := parseInt(match[2])
		message := strings.TrimSpace(match[4])
		toolName := "tsc"
		ruleID := "typescript-error"
		toolRun.Findings = append(toolRun.Findings, domain.CodeReviewFinding{
			Stage:       "baseline_scan",
			Source:      "baseline",
			Tool:        &toolName,
			RuleID:      &ruleID,
			Fingerprint: makeFindingFingerprint("baseline", ruleID, file, &line, message),
			Category:    "maintainability",
			Severity:    "high",
			Title:       "TypeScript type error",
			Message:     message,
			File:        file,
			Line:        &line,
		})
	}
	return toolRun
}

func runSemgrep(ctx context.Context, workspacePath string) domain.BaselineToolRun {
	stdout, stderr, exitCode, duration, err := runCommand(ctx, workspacePath, "semgrep", "scan", "--config", "auto", "--json", ".")
	toolRun := domain.BaselineToolRun{
		Tool:          "semgrep",
		Version:       commandVersion("semgrep", "--version"),
		Status:        statusFromCommand(err),
		Command:       "semgrep scan --config auto --json .",
		DurationMs:    int(duration.Milliseconds()),
		StdoutExcerpt: truncate(strings.TrimSpace(stdout), 1200),
		StderrExcerpt: truncate(strings.TrimSpace(stderr), 1200),
	}
	if err != nil {
		toolRun.ExitCode = &exitCode
	}

	var parsed struct {
		Results []struct {
			CheckID string `json:"check_id"`
			Path    string `json:"path"`
			Start   struct {
				Line int `json:"line"`
			} `json:"start"`
			Extra struct {
				Message  string `json:"message"`
				Severity string `json:"severity"`
				Metadata struct {
					Category string `json:"category"`
				} `json:"metadata"`
			} `json:"extra"`
		} `json:"results"`
	}
	if parseErr := json.Unmarshal([]byte(stdout), &parsed); parseErr == nil {
		for _, result := range parsed.Results {
			file := normalizeFile(result.Path)
			line := result.Start.Line
			ruleID := strings.TrimSpace(result.CheckID)
			if ruleID == "" {
				ruleID = "semgrep"
			}
			message := strings.TrimSpace(result.Extra.Message)
			if message == "" {
				message = ruleID
			}
			category := normalizeCategory(result.Extra.Metadata.Category)
			toolName := "semgrep"
			toolRun.Findings = append(toolRun.Findings, domain.CodeReviewFinding{
				Stage:       "baseline_scan",
				Source:      "baseline",
				Tool:        &toolName,
				RuleID:      &ruleID,
				Fingerprint: makeFindingFingerprint("baseline", ruleID, file, &line, message),
				Category:    category,
				Severity:    normalizeSeverity(strings.ToLower(result.Extra.Severity)),
				Title:       ruleID,
				Message:     message,
				File:        file,
				Line:        &line,
			})
		}
	}
	return toolRun
}

func runGitleaks(ctx context.Context, workspacePath string) domain.BaselineToolRun {
	reportPath := filepath.Join(workspacePath, ".code-review-gitleaks.json")
	stdout, stderr, exitCode, duration, err := runCommand(ctx, workspacePath, "gitleaks", "detect", "--no-banner", "--redact", "--report-format", "json", "--report-path", reportPath)
	toolRun := domain.BaselineToolRun{
		Tool:          "gitleaks",
		Version:       commandVersion("gitleaks", "version"),
		Status:        statusFromCommand(err),
		Command:       "gitleaks detect --no-banner --redact --report-format json",
		DurationMs:    int(duration.Milliseconds()),
		ArtifactPath:  reportPath,
		StdoutExcerpt: truncate(strings.TrimSpace(stdout), 1200),
		StderrExcerpt: truncate(strings.TrimSpace(stderr), 1200),
	}
	if err != nil {
		toolRun.ExitCode = &exitCode
	}
	raw, readErr := os.ReadFile(reportPath)
	if readErr == nil {
		var leaks []struct {
			RuleID      string `json:"RuleID"`
			Description string `json:"Description"`
			File        string `json:"File"`
			StartLine   int    `json:"StartLine"`
		}
		if parseErr := json.Unmarshal(raw, &leaks); parseErr == nil {
			for _, leak := range leaks {
				file := normalizeFile(leak.File)
				line := leak.StartLine
				ruleID := strings.TrimSpace(leak.RuleID)
				if ruleID == "" {
					ruleID = "gitleaks"
				}
				message := strings.TrimSpace(leak.Description)
				if message == "" {
					message = "Potential secret detected"
				}
				toolName := "gitleaks"
				toolRun.Findings = append(toolRun.Findings, domain.CodeReviewFinding{
					Stage:       "baseline_scan",
					Source:      "baseline",
					Tool:        &toolName,
					RuleID:      &ruleID,
					Fingerprint: makeFindingFingerprint("baseline", ruleID, file, &line, message),
					Category:    "security",
					Severity:    "critical",
					Title:       "Potential secret leak",
					Message:     message,
					File:        file,
					Line:        &line,
				})
			}
		}
	}
	return toolRun
}

func runGolangCILint(ctx context.Context, workspacePath string) domain.BaselineToolRun {
	stdout, stderr, exitCode, duration, err := runCommand(ctx, workspacePath, "golangci-lint", "run", "--out-format", "json")
	toolRun := domain.BaselineToolRun{
		Tool:          "golangci-lint",
		Version:       commandVersion("golangci-lint", "--version"),
		Status:        statusFromCommand(err),
		Command:       "golangci-lint run --out-format json",
		DurationMs:    int(duration.Milliseconds()),
		StdoutExcerpt: truncate(strings.TrimSpace(stdout), 1200),
		StderrExcerpt: truncate(strings.TrimSpace(stderr), 1200),
	}
	if err != nil {
		toolRun.ExitCode = &exitCode
	}

	var parsed struct {
		Issues []struct {
			FromLinter string `json:"FromLinter"`
			Text       string `json:"Text"`
			Pos        struct {
				Filename string `json:"Filename"`
				Line     int    `json:"Line"`
			} `json:"Pos"`
		} `json:"Issues"`
	}
	if parseErr := json.Unmarshal([]byte(stdout), &parsed); parseErr == nil {
		for _, issue := range parsed.Issues {
			file := normalizeFile(issue.Pos.Filename)
			line := issue.Pos.Line
			ruleID := strings.TrimSpace(issue.FromLinter)
			if ruleID == "" {
				ruleID = "golangci-lint"
			}
			message := strings.TrimSpace(issue.Text)
			toolName := "golangci-lint"
			toolRun.Findings = append(toolRun.Findings, domain.CodeReviewFinding{
				Stage:       "baseline_scan",
				Source:      "baseline",
				Tool:        &toolName,
				RuleID:      &ruleID,
				Fingerprint: makeFindingFingerprint("baseline", ruleID, file, &line, message),
				Category:    "maintainability",
				Severity:    "medium",
				Title:       ruleID,
				Message:     message,
				File:        file,
				Line:        &line,
			})
		}
	}
	return toolRun
}

func runGoVet(ctx context.Context, workspacePath string) domain.BaselineToolRun {
	stdout, stderr, exitCode, duration, err := runCommand(ctx, workspacePath, "go", "vet", "./...")
	toolRun := domain.BaselineToolRun{
		Tool:          "go-vet",
		Version:       commandVersion("go", "version"),
		Status:        statusFromCommand(err),
		Command:       "go vet ./...",
		DurationMs:    int(duration.Milliseconds()),
		StdoutExcerpt: truncate(strings.TrimSpace(stdout), 1200),
		StderrExcerpt: truncate(strings.TrimSpace(stderr), 1200),
	}
	if err != nil {
		toolRun.ExitCode = &exitCode
	}
	combined := strings.TrimSpace(strings.Join([]string{stdout, stderr}, "\n"))
	pattern := regexp.MustCompile(`(?m)^(.+?):(\d+):(?:(\d+):)?\s+(.+)$`)
	for _, match := range pattern.FindAllStringSubmatch(combined, -1) {
		if len(match) < 5 {
			continue
		}
		file := normalizeFile(match[1])
		line := parseInt(match[2])
		message := strings.TrimSpace(match[4])
		ruleID := "go-vet"
		toolName := "go-vet"
		toolRun.Findings = append(toolRun.Findings, domain.CodeReviewFinding{
			Stage:       "baseline_scan",
			Source:      "baseline",
			Tool:        &toolName,
			RuleID:      &ruleID,
			Fingerprint: makeFindingFingerprint("baseline", ruleID, file, &line, message),
			Category:    "maintainability",
			Severity:    "medium",
			Title:       "go vet",
			Message:     message,
			File:        file,
			Line:        &line,
		})
	}
	return toolRun
}

func filterFindingsByChangedFiles(findings []domain.CodeReviewFinding, changedFiles []string) []domain.CodeReviewFinding {
	if len(changedFiles) == 0 {
		return findings
	}
	allowed := map[string]bool{}
	for _, file := range changedFiles {
		allowed[normalizeFile(file)] = true
	}
	result := make([]domain.CodeReviewFinding, 0, len(findings))
	for _, finding := range findings {
		if allowed[normalizeFile(finding.File)] {
			result = append(result, finding)
		}
	}
	return result
}

func statusFromCommand(err error) string {
	if err == nil {
		return "completed"
	}
	return "failed"
}

func parseInt(value string) int {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}
	result := 0
	for _, ch := range trimmed {
		if ch < '0' || ch > '9' {
			break
		}
		result = result*10 + int(ch-'0')
	}
	return result
}
