package pipeline

import (
	"context"
	"encoding/json"
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
	absoluteWorkspacePath, err := filepath.Abs(workspacePath)
	if err != nil {
		return nil, fmt.Errorf("resolve sandbox workspace path: %w", err)
	}

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
		fmt.Sprintf("type=bind,src=%s,dst=/workspace", absoluteWorkspacePath),
		image,
		"/bin/sh",
		"-lc",
		"trap 'exit 0' TERM INT; while :; do sleep 5; done",
	}
	cmd := exec.CommandContext(ctx, "docker", args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("start sandbox container for image %s: %w (%s)", image, err, strings.TrimSpace(string(output)))
	}

	if err := bootstrapJobSandbox(ctx, containerName, image, absoluteWorkspacePath); err != nil {
		_ = exec.Command("docker", "rm", "-f", containerName).Run()
		return nil, err
	}

	return &jobSandbox{
		containerName: containerName,
		workspacePath: absoluteWorkspacePath,
	}, nil
}

func bootstrapJobSandbox(ctx context.Context, containerName string, image string, workspacePath string) error {
	script, err := buildSandboxBootstrapScript(workspacePath)
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, "docker", "exec", containerName, "/bin/sh", "-lc", script)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("bootstrap sandbox container for image %s: %w (%s)", image, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func buildSandboxBootstrapScript(workspacePath string) (string, error) {
	commands := []string{
		installGitBootstrapScript(),
	}

	if pnpmVersion, ok := detectPinnedPnpmVersion(workspacePath); ok {
		commands = append(commands, fmt.Sprintf(`
if command -v node >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || {
    echo "[bootstrap] corepack enable failed; use an official Node image with corepack support" >&2
    exit 1
  }
  corepack prepare "pnpm@%s" --activate >/dev/null 2>&1 || {
    echo "[bootstrap] failed to activate pnpm@%s via corepack" >&2
    exit 1
  }
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[bootstrap] pnpm is unavailable after corepack activation" >&2
    exit 1
  fi
else
  echo "[bootstrap] pnpm@%s is required by the repository but the selected build image does not provide node/corepack" >&2
  exit 1
fi
`, pnpmVersion, pnpmVersion, pnpmVersion))
	} else {
		commands = append(commands, `
if command -v node >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || {
    echo "[bootstrap] corepack enable failed; use an official Node image with corepack support" >&2
    exit 1
  }
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[bootstrap] pnpm is unavailable after corepack enable" >&2
    exit 1
  fi
fi
`)
	}

	commands = append(commands, `exit 0`)
	return strings.Join(commands, "\n"), nil
}

func installGitBootstrapScript() string {
	return `
if ! command -v git >/dev/null 2>&1; then
  if [ "$(id -u)" != "0" ]; then
    echo "[bootstrap] git is missing and container is not root" >&2
    exit 1
  fi

  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends git ca-certificates
    rm -rf /var/lib/apt/lists/*
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache git ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y git ca-certificates
  elif command -v microdnf >/dev/null 2>&1; then
    microdnf install -y git ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git ca-certificates
  else
    echo "[bootstrap] unsupported base image: cannot install git" >&2
    exit 1
  fi
fi
`
}

func detectPinnedPnpmVersion(workspacePath string) (string, bool) {
	if strings.TrimSpace(workspacePath) == "" {
		return "", false
	}
	raw, err := os.ReadFile(filepath.Join(workspacePath, "package.json"))
	if err != nil {
		return "", false
	}
	var payload struct {
		PackageManager string `json:"packageManager"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", false
	}
	value := strings.TrimSpace(payload.PackageManager)
	if !strings.HasPrefix(value, "pnpm@") {
		return "", false
	}
	version := strings.TrimSpace(strings.TrimPrefix(value, "pnpm@"))
	if version == "" {
		return "", false
	}
	return version, true
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

func prepareLocalJobWorkspace(
	ctx context.Context,
	sourceManager *SourceManager,
	source *ResolvedSource,
	workspaceRoot string,
	job PipelineJob,
) (string, error) {
	if strings.TrimSpace(workspaceRoot) == "" {
		return "", fmt.Errorf("workspace root is required")
	}
	if sourceManager == nil {
		return "", fmt.Errorf("source manager is required")
	}
	if source == nil {
		return "", fmt.Errorf("source snapshot is required")
	}
	jobRoot := filepath.Join(workspaceRoot, "jobs", job.ID)
	if err := os.MkdirAll(filepath.Dir(jobRoot), 0o755); err != nil {
		return "", err
	}
	if err := sourceManager.MaterializeWorkspace(ctx, source, jobRoot); err != nil {
		return "", err
	}
	return jobRoot, nil
}
