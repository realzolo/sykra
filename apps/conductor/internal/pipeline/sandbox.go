package pipeline

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type jobSandbox struct {
	containerName string
	workspacePath string
}

func startJobSandbox(
	ctx context.Context,
	runID string,
	jobID string,
	image string,
	workspacePath string,
) (*jobSandbox, error) {
	containerName := runnerContainerName(runID, jobID)
	args := []string{
		"run",
		"-d",
		"--rm",
		"--name",
		containerName,
		"--workdir",
		"/workspace",
		"--mount",
		fmt.Sprintf("type=bind,src=%s,dst=/workspace", workspacePath),
		image,
		"/bin/sh",
		"-lc",
		"trap 'exit 0' TERM INT; while :; do sleep 5; done",
	}
	cmd := exec.CommandContext(ctx, "docker", args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("start sandbox container: %w (%s)", err, strings.TrimSpace(string(output)))
	}
	return &jobSandbox{
		containerName: containerName,
		workspacePath: workspacePath,
	}, nil
}

func (s *jobSandbox) Close() error {
	if s == nil || strings.TrimSpace(s.containerName) == "" {
		return nil
	}
	cmd := exec.Command("docker", "rm", "-f", s.containerName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		text := strings.ToLower(strings.TrimSpace(string(output)))
		if strings.Contains(text, "no such container") {
			return nil
		}
		return fmt.Errorf("remove sandbox container: %w (%s)", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func (s *jobSandbox) ExecScript(
	ctx context.Context,
	script string,
	env map[string]string,
	workingDir string,
	output io.Writer,
) (int, error) {
	args := []string{"exec"}
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		args = append(args, "-e", key)
	}
	if workdir := s.containerWorkdir(workingDir); workdir != "" {
		args = append(args, "-w", workdir)
	}
	args = append(args, s.containerName, "/bin/sh", "-lc", script)

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = output
	cmd.Stderr = output
	cmd.Env = mergeEnv(env)
	if err := cmd.Start(); err != nil {
		return 1, err
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

func (s *jobSandbox) containerWorkdir(hostPath string) string {
	if s == nil {
		return ""
	}
	if strings.TrimSpace(hostPath) == "" {
		return "/workspace"
	}
	rel, err := filepath.Rel(s.workspacePath, hostPath)
	if err != nil {
		return "/workspace"
	}
	rel = filepath.ToSlash(rel)
	if rel == "." || rel == "" {
		return "/workspace"
	}
	if strings.HasPrefix(rel, "../") {
		return "/workspace"
	}
	return "/workspace/" + rel
}

func runnerContainerName(runID string, jobID string) string {
	return strings.Join([]string{
		"conductor-runner",
		shortContainerNameSegment(runID),
		shortContainerNameSegment(jobID),
	}, "-")
}

func shortContainerNameSegment(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "-", "")
	if len(value) > 8 {
		value = value[:8]
	}
	if value == "" {
		return "unknown"
	}
	return value
}

func prepareLocalJobWorkspace(workspaceRoot string, job PipelineJob) (string, error) {
	if strings.TrimSpace(workspaceRoot) == "" {
		return "", fmt.Errorf("workspace root is required")
	}

	sourceRoot := filepath.Join(workspaceRoot, "source")
	jobRoot := sourceRoot
	if strings.TrimSpace(strings.ToLower(job.Type)) != "source_checkout" {
		jobRoot = filepath.Join(workspaceRoot, "jobs", job.ID)
		_ = os.RemoveAll(jobRoot)
		if _, err := os.Stat(sourceRoot); err == nil {
			if err := copyTree(sourceRoot, jobRoot); err != nil {
				return "", err
			}
		} else if err := os.MkdirAll(jobRoot, 0o755); err != nil {
			return "", err
		}
	} else {
		_ = os.RemoveAll(jobRoot)
		if err := os.MkdirAll(jobRoot, 0o755); err != nil {
			return "", err
		}
	}

	return jobRoot, nil
}

func copyTree(src string, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		targetPath := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(targetPath, 0o755)
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return err
		}

		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()

		out, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			_ = out.Close()
			return err
		}
		return out.Close()
	})
}
