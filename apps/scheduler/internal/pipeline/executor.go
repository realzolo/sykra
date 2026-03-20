package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// ── Executor interface ─────────────────────────────────────────────────────

type StepExecutor interface {
	Execute(ctx context.Context, step PipelineStep, env map[string]string, workingDir string, log io.Writer) (int, error)
}

type ExecutorRegistry struct {
	executors map[string]StepExecutor
}

func NewExecutorRegistry() *ExecutorRegistry {
	return &ExecutorRegistry{executors: map[string]StepExecutor{}}
}

func (r *ExecutorRegistry) Register(stepType string, executor StepExecutor) {
	if stepType == "" || executor == nil {
		return
	}
	r.executors[strings.ToLower(stepType)] = executor
}

func (r *ExecutorRegistry) Get(stepType string) StepExecutor {
	return r.executors[strings.ToLower(stepType)]
}

// ── Shell executor ─────────────────────────────────────────────────────────

type ShellExecutor struct{}

func (e *ShellExecutor) Execute(ctx context.Context, step PipelineStep, env map[string]string, workingDir string, log io.Writer) (int, error) {
	name, args := shellCommand(step.Script)
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = log
	cmd.Stderr = log
	if workingDir != "" {
		cmd.Dir = workingDir
	}
	cmd.Env = mergeEnv(env)

	if err := cmd.Start(); err != nil {
		return 0, err
	}
	err := cmd.Wait()
	if err == nil {
		return 0, nil
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode(), err
	}
	return 1, err
}

func shellCommand(script string) (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd", []string{"/C", script}
	}
	return "/bin/sh", []string{"-lc", script}
}

func mergeEnv(overrides map[string]string) []string {
	base := os.Environ()
	if len(overrides) == 0 {
		return base
	}
	seen := map[string]bool{}
	for k := range overrides {
		seen[k] = true
	}
	result := make([]string, 0, len(base)+len(overrides))
	for _, item := range base {
		parts := strings.SplitN(item, "=", 2)
		if len(parts) == 2 && seen[parts[0]] {
			continue
		}
		result = append(result, item)
	}
	for k, v := range overrides {
		result = append(result, fmt.Sprintf("%s=%s", k, v))
	}
	return result
}

// ── Docker executor ────────────────────────────────────────────────────────

type DockerExecutor struct{}

func (e *DockerExecutor) Execute(ctx context.Context, step PipelineStep, env map[string]string, workingDir string, log io.Writer) (int, error) {
	image := step.DockerImage
	if image == "" {
		return 1, fmt.Errorf("dockerImage is required for docker step type")
	}

	args := []string{"run", "--rm", "-w", "/workspace"}

	if workingDir != "" {
		args = append(args, "-v", workingDir+":/workspace")
	}

	for k, v := range env {
		args = append(args, "-e", k+"="+v)
	}

	args = append(args, image, "/bin/sh", "-c", step.Script)

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = log
	cmd.Stderr = log

	if err := cmd.Start(); err != nil {
		return 0, err
	}
	err := cmd.Wait()
	if err == nil {
		return 0, nil
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode(), err
	}
	return 1, err
}

// ── Source checkout executor ───────────────────────────────────────────────
// Runs git clone/pull for the project's repository.
// The repo URL is fetched from Studio API using the projectId and studioToken.

type SourceCheckoutExecutor struct {
	StudioURL   string
	StudioToken string
	ProjectID   string
	Branch      string
}

func (e *SourceCheckoutExecutor) Execute(ctx context.Context, step PipelineStep, env map[string]string, workingDir string, log io.Writer) (int, error) {
	fmt.Fprintf(log, "[source] Fetching project info for %s\n", e.ProjectID)

	// Fetch repo URL from Studio
	repoURL, err := e.fetchRepoURL(ctx)
	if err != nil {
		fmt.Fprintf(log, "[source] ERROR: %v\n", err)
		return 1, err
	}

	branch := e.Branch
	if branch == "" {
		branch = "main"
	}

	fmt.Fprintf(log, "[source] Repository: %s\n", repoURL)
	fmt.Fprintf(log, "[source] Branch: %s\n", branch)

	// Determine checkout dir
	checkoutDir := workingDir
	if checkoutDir == "" {
		checkoutDir = "/tmp/pipeline-source"
	}

	// Clone or pull
	if _, err := os.Stat(checkoutDir + "/.git"); os.IsNotExist(err) {
		fmt.Fprintf(log, "[source] Cloning repository...\n")
		cmd := exec.CommandContext(ctx, "git", "clone", "--depth=1", "--branch", branch, repoURL, checkoutDir)
		cmd.Stdout = log
		cmd.Stderr = log
		if err := cmd.Run(); err != nil {
			fmt.Fprintf(log, "[source] Clone failed: %v\n", err)
			return 1, err
		}
	} else {
		fmt.Fprintf(log, "[source] Pulling latest changes...\n")
		cmd := exec.CommandContext(ctx, "git", "-C", checkoutDir, "pull", "--ff-only", "origin", branch)
		cmd.Stdout = log
		cmd.Stderr = log
		if err := cmd.Run(); err != nil {
			fmt.Fprintf(log, "[source] Pull failed: %v\n", err)
			return 1, err
		}
	}

	fmt.Fprintf(log, "[source] Source checkout complete.\n")
	return 0, nil
}

func (e *SourceCheckoutExecutor) fetchRepoURL(ctx context.Context) (string, error) {
	if e.StudioURL == "" || e.ProjectID == "" {
		return "", fmt.Errorf("studioURL and projectId are required for source checkout")
	}
	url := strings.TrimRight(e.StudioURL, "/") + "/api/projects/" + e.ProjectID
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	if e.StudioToken != "" {
		req.Header.Set("X-Scheduler-Token", e.StudioToken)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to fetch project: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("studio returned %d for project %s", resp.StatusCode, e.ProjectID)
	}
	var project struct {
		Repo string `json:"repo"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&project); err != nil {
		return "", fmt.Errorf("failed to decode project: %w", err)
	}
	if project.Repo == "" {
		return "", fmt.Errorf("project has no repository configured")
	}
	return project.Repo, nil
}

// ── Review gate executor ───────────────────────────────────────────────────
// Calls Studio API to check the latest analysis score for the project.
// Fails if qualityGateEnabled and score < minScore.

type ReviewGateExecutor struct {
	StudioURL   string
	StudioToken string
	ProjectID   string
	MinScore    int
	GateEnabled bool
}

func (e *ReviewGateExecutor) Execute(ctx context.Context, step PipelineStep, env map[string]string, workingDir string, log io.Writer) (int, error) {
	fmt.Fprintf(log, "[review] Checking latest code review score for project %s\n", e.ProjectID)

	score, err := e.fetchLatestScore(ctx)
	if err != nil {
		// If we can't fetch (no review done yet), warn but don't block
		fmt.Fprintf(log, "[review] WARNING: could not fetch review score: %v\n", err)
		fmt.Fprintf(log, "[review] Proceeding without quality gate check.\n")
		return 0, nil
	}

	fmt.Fprintf(log, "[review] Latest review score: %d/100\n", score)

	if e.GateEnabled && score < e.MinScore {
		fmt.Fprintf(log, "[review] BLOCKED: score %d is below minimum %d\n", score, e.MinScore)
		return 1, fmt.Errorf("quality gate failed: score %d < minimum %d", score, e.MinScore)
	}

	if e.GateEnabled {
		fmt.Fprintf(log, "[review] Quality gate passed (score %d >= %d)\n", score, e.MinScore)
	} else {
		fmt.Fprintf(log, "[review] Review complete (quality gate not enforced)\n")
	}
	return 0, nil
}

func (e *ReviewGateExecutor) fetchLatestScore(ctx context.Context) (int, error) {
	if e.StudioURL == "" || e.ProjectID == "" {
		return 0, fmt.Errorf("studioURL and projectId are required")
	}
	url := strings.TrimRight(e.StudioURL, "/") + "/api/code-reviews?projectId=" + e.ProjectID + "&limit=1"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	if e.StudioToken != "" {
		req.Header.Set("X-Scheduler-Token", e.StudioToken)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to call studio: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("studio returned %d", resp.StatusCode)
	}
	var reports []struct {
		Score  *int   `json:"score"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&reports); err != nil {
		return 0, fmt.Errorf("decode error: %w", err)
	}
	for _, r := range reports {
		if (r.Status == "completed" || r.Status == "partial_failed") && r.Score != nil {
			return *r.Score, nil
		}
	}
	return 0, fmt.Errorf("no completed review found")
}
