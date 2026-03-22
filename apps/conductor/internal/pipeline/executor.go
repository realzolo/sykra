package pipeline

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"

	"spec-axis/conductor/internal/store"
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
		args = append(args, "--mount", fmt.Sprintf("type=bind,src=%s,dst=/workspace", workingDir))
	}

	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		// Pass only the variable name so Docker reads the value from the current
		// process environment instead of exposing secrets in the process args.
		args = append(args, "-e", key)
	}

	args = append(args, image, "/bin/sh", "-c", step.Script)

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = log
	cmd.Stderr = log
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

// ── Review gate executor ───────────────────────────────────────────────────
// Checks the latest persisted analysis score for the project directly from
// Conductor's database view of reports. Fails if qualityGateEnabled and
// score < minScore.

type ReviewGateExecutor struct {
	Store       *store.Store
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
	if e.Store == nil {
		return 0, fmt.Errorf("store is required")
	}
	if strings.TrimSpace(e.ProjectID) == "" {
		return 0, fmt.Errorf("projectId is required")
	}
	score, err := e.Store.GetLatestProjectReviewScore(ctx, e.ProjectID)
	if err != nil {
		return 0, fmt.Errorf("failed to load latest review score: %w", err)
	}
	if score == nil {
		return 0, fmt.Errorf("no completed review found")
	}
	return *score, nil
}
