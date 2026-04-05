package pipeline

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

type jobSandbox struct {
	containerName string
	workspacePath string
}

var validatedSandboxProfiles sync.Map

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
	}
	for _, cm := range cacheVolumeMounts(workspacePath, image) {
		args = append(args, "--mount", cm)
	}
	args = append(args,
		image,
		"/bin/sh",
		"-lc",
		"trap 'exit 0' TERM INT; while :; do sleep 5; done",
	)
	cmd := exec.CommandContext(ctx, "docker", args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("start sandbox container for image %s: %w (%s)", image, err, strings.TrimSpace(string(output)))
	}

	profile := sandboxValidationProfile(image, absoluteWorkspacePath)
	if _, validated := validatedSandboxProfiles.Load(profile); !validated {
		if err := validateJobSandboxImage(ctx, containerName, image, absoluteWorkspacePath); err != nil {
			_ = exec.Command("docker", "rm", "-f", containerName).Run()
			return nil, err
		}
		validatedSandboxProfiles.Store(profile, true)
	}

	return &jobSandbox{
		containerName: containerName,
		workspacePath: absoluteWorkspacePath,
	}, nil
}

// cacheVolumeMounts returns docker --mount arguments for persisting package
// manager caches across runs. Each volume is shared across all pipeline runs
// so that repeated installs hit the local store instead of the network.
func cacheVolumeMounts(workspacePath string, image string) []string {
	type cacheMount struct {
		volume string // docker volume name
		target string // mount path inside the container
	}
	namespace := cacheNamespace(image)
	var mounts []cacheMount
	switch detectWorkspacePackageManager(workspacePath) {
	case "pnpm":
		mounts = []cacheMount{
			{volume: "sykra-cache-pnpm-" + namespace, target: "/root/.local/share/pnpm/store"},
		}
	case "yarn":
		mounts = []cacheMount{
			{volume: "sykra-cache-yarn-" + namespace, target: "/usr/local/share/.cache/yarn"},
		}
	case "bun":
		mounts = []cacheMount{
			{volume: "sykra-cache-bun-" + namespace, target: "/root/.bun/install/cache"},
		}
	case "npm":
		mounts = []cacheMount{
			{volume: "sykra-cache-npm-" + namespace, target: "/root/.npm"},
		}
	default:
		if fileExists(filepath.Join(workspacePath, "go.mod")) {
			mounts = []cacheMount{
				{volume: "sykra-cache-gomod-" + namespace, target: "/root/go/pkg/mod"},
				{volume: "sykra-cache-gobuild-" + namespace, target: "/root/.cache/go-build"},
			}
		}
	}
	result := make([]string, 0, len(mounts))
	for _, m := range mounts {
		result = append(result, fmt.Sprintf("type=volume,src=%s,dst=%s", m.volume, m.target))
	}
	return result
}

func cacheNamespace(image string) string {
	trimmed := strings.ToLower(strings.TrimSpace(image))
	if trimmed == "" {
		trimmed = "default"
	}
	sum := sha1.Sum([]byte(trimmed))
	return hex.EncodeToString(sum[:6])
}

func sandboxValidationProfile(image string, workspacePath string) string {
	packageManager := detectWorkspacePackageManager(workspacePath)
	if strings.TrimSpace(packageManager) == "" {
		packageManager = "none"
	}
	return strings.ToLower(strings.TrimSpace(image)) + "|" + packageManager
}

func validateJobSandboxImage(ctx context.Context, containerName string, image string, workspacePath string) error {
	script, err := buildSandboxValidationScript(workspacePath)
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, "docker", "exec", containerName, "/bin/sh", "-lc", script)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("validate sandbox container for image %s: %w (%s)", image, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func buildSandboxValidationScript(workspacePath string) (string, error) {
	commands := []string{
		`if ! command -v git >/dev/null 2>&1; then
  echo "[sandbox] git is required in the runner image; use an official base image with git preinstalled" >&2
  exit 1
fi`,
	}

	switch detectWorkspacePackageManager(workspacePath) {
	case "pnpm", "yarn":
		commands = append(commands, `
if ! command -v node >/dev/null 2>&1 || ! command -v corepack >/dev/null 2>&1; then
  echo "[sandbox] a pnpm/yarn workspace requires node with corepack enabled in the runner image" >&2
  exit 1
fi
`)
	case "bun":
		commands = append(commands, `
if ! command -v bun >/dev/null 2>&1; then
  echo "[sandbox] a bun workspace requires bun to be installed in the runner image" >&2
  exit 1
fi
`)
	}

	commands = append(commands, `exit 0`)
	return strings.Join(commands, "\n"), nil
}

func detectWorkspacePackageManager(workspacePath string) string {
	if strings.TrimSpace(workspacePath) == "" {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(workspacePath, "package.json"))
	if err == nil {
		var payload struct {
			PackageManager string `json:"packageManager"`
		}
		if err := json.Unmarshal(raw, &payload); err == nil {
			value := strings.TrimSpace(payload.PackageManager)
			switch {
			case strings.HasPrefix(value, "pnpm@"):
				return "pnpm"
			case strings.HasPrefix(value, "yarn@"):
				return "yarn"
			case strings.HasPrefix(value, "bun@"):
				return "bun"
			case strings.HasPrefix(value, "npm@"):
				return "npm"
			}
		}
	}
	switch {
	case fileExists(filepath.Join(workspacePath, "pnpm-lock.yaml")):
		return "pnpm"
	case fileExists(filepath.Join(workspacePath, "yarn.lock")):
		return "yarn"
	case fileExists(filepath.Join(workspacePath, "bun.lock")):
		return "bun"
	case fileExists(filepath.Join(workspacePath, "bun.lockb")):
		return "bun"
	case fileExists(filepath.Join(workspacePath, "package-lock.json")):
		return "npm"
	default:
		return ""
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
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
) (string, int, error) {
	if strings.TrimSpace(workspaceRoot) == "" {
		return "", 0, fmt.Errorf("workspace root is required")
	}
	if sourceManager == nil {
		return "", 0, fmt.Errorf("source manager is required")
	}
	if source == nil {
		return "", 0, fmt.Errorf("source snapshot is required")
	}
	jobRoot := filepath.Join(workspaceRoot, "jobs", job.ID)
	if err := os.MkdirAll(filepath.Dir(jobRoot), 0o755); err != nil {
		return "", 0, err
	}
	if err := sourceManager.MaterializeWorkspace(ctx, source, jobRoot); err != nil {
		return "", 0, err
	}
	changedFilesCount, err := sourceManager.WriteChangedFilesManifest(ctx, source, jobRoot)
	if err != nil {
		return "", 0, err
	}
	return jobRoot, changedFilesCount, nil
}
