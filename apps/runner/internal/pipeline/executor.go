package pipeline

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

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
