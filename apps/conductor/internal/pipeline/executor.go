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
