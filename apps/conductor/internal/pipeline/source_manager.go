package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"spec-axis/conductor/internal/integrations"
	"spec-axis/conductor/internal/store"
)

type ResolvedSource struct {
	Repository    string
	Branch        string
	CommitSHA     string
	CommitMessage string
	MirrorPath    string
}

type SourceManager struct {
	baseDir        string
	lockTimeout    time.Duration
	lockStaleAfter time.Duration
	gitCommand     string
}

func NewSourceManager(dataDir string) *SourceManager {
	root := filepath.Join(dataDir, "git")
	if abs, err := filepath.Abs(root); err == nil {
		root = abs
	}
	return &SourceManager{
		baseDir:        filepath.Clean(root),
		lockTimeout:    2 * time.Minute,
		lockStaleAfter: 5 * time.Minute,
		gitCommand:     "git",
	}
}

func (m *SourceManager) ResolveSnapshot(
	ctx context.Context,
	st *store.Store,
	project *store.Project,
	branch string,
	pinnedCommit string,
) (*ResolvedSource, error) {
	if st == nil {
		return nil, fmt.Errorf("store is required")
	}
	if project == nil {
		return nil, fmt.Errorf("project is required")
	}
	repository := strings.TrimSpace(project.Repo)
	if repository == "" {
		return nil, fmt.Errorf("project has no repository configured")
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return nil, fmt.Errorf("source branch is required")
	}

	spec, err := integrations.ResolveCheckoutSpec(ctx, st, project)
	if err != nil {
		return nil, err
	}
	paths := m.paths(project.OrgID, project.ID, spec.Repository)
	if err := os.MkdirAll(paths.basePath, 0o755); err != nil {
		return nil, err
	}

	release, err := m.acquireLock(paths.lockPath)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = release()
	}()

	if !m.isMirrorRepo(paths.mirrorPath) {
		if err := m.cloneMirror(ctx, spec.RemoteURL, paths.mirrorPath, spec.Env); err != nil {
			return nil, err
		}
	} else if err := m.ensureRemoteURL(ctx, paths.mirrorPath, spec.RemoteURL, spec.Env); err != nil {
		return nil, err
	}

	commitSHA := strings.TrimSpace(pinnedCommit)
	if commitSHA != "" {
		exists, err := m.commitExists(ctx, paths.mirrorPath, commitSHA, spec.Env)
		if err != nil {
			return nil, err
		}
		if !exists {
			if err := m.fetchMirror(ctx, paths.mirrorPath, spec.Env); err != nil {
				return nil, err
			}
			exists, err = m.commitExists(ctx, paths.mirrorPath, commitSHA, spec.Env)
			if err != nil {
				return nil, err
			}
			if !exists {
				return nil, fmt.Errorf("pinned source commit %s is not available in local mirror", commitSHA)
			}
		}
	} else {
		if err := m.fetchMirror(ctx, paths.mirrorPath, spec.Env); err != nil {
			return nil, err
		}
		commitSHA, err = m.resolveRemoteBranchCommit(ctx, paths.mirrorPath, branch, spec.Env)
		if err != nil {
			branches, listErr := m.listRemoteBranches(ctx, paths.mirrorPath, spec.Env)
			if listErr == nil && len(branches) > 0 {
				return nil, fmt.Errorf("source branch %s is not available in local mirror; available branches: %s", branch, strings.Join(branches, ", "))
			}
			return nil, err
		}
	}

	commitMessage, err := m.readCommitMessage(ctx, paths.mirrorPath, commitSHA, spec.Env)
	if err != nil {
		return nil, err
	}

	return &ResolvedSource{
		Repository:    spec.Repository,
		Branch:        branch,
		CommitSHA:     commitSHA,
		CommitMessage: commitMessage,
		MirrorPath:    paths.mirrorPath,
	}, nil
}

func (m *SourceManager) MaterializeWorkspace(
	ctx context.Context,
	source *ResolvedSource,
	workspacePath string,
) error {
	if source == nil {
		return fmt.Errorf("source snapshot is required")
	}
	if strings.TrimSpace(workspacePath) == "" {
		return fmt.Errorf("workspace path is required")
	}
	workspacePath, err := filepath.Abs(workspacePath)
	if err != nil {
		return err
	}
	_ = os.RemoveAll(workspacePath)
	if err := os.MkdirAll(filepath.Dir(workspacePath), 0o755); err != nil {
		return err
	}

	if err := m.runGit(
		ctx,
		nil,
		"clone",
		"--no-hardlinks",
		"--no-checkout",
		source.MirrorPath,
		workspacePath,
	); err != nil {
		return err
	}

	if err := m.runGit(
		ctx,
		nil,
		"-C",
		workspacePath,
		"checkout",
		"--force",
		"-B",
		source.Branch,
		source.CommitSHA,
	); err != nil {
		_ = os.RemoveAll(workspacePath)
		return err
	}

	if err := m.runGit(
		ctx,
		nil,
		"-C",
		workspacePath,
		"reset",
		"--hard",
		source.CommitSHA,
	); err != nil {
		_ = os.RemoveAll(workspacePath)
		return err
	}

	if err := m.runGit(ctx, nil, "-C", workspacePath, "clean", "-ffd"); err != nil {
		_ = os.RemoveAll(workspacePath)
		return err
	}

	return nil
}

func (m *SourceManager) WarmActivePipelineMirrors(ctx context.Context, st *store.Store) error {
	if m == nil || st == nil {
		return nil
	}
	pipelines, err := st.ListActivePipelines(ctx)
	if err != nil {
		return err
	}

	seen := map[string]bool{}
	for _, pipeline := range pipelines {
		if pipeline.ProjectID == nil || strings.TrimSpace(*pipeline.ProjectID) == "" {
			continue
		}
		branch := strings.TrimSpace(pipeline.SourceBranch)
		if branch == "" {
			branch = "main"
		}
		key := strings.TrimSpace(*pipeline.ProjectID) + "::" + branch
		if seen[key] {
			continue
		}
		seen[key] = true

		project, err := st.GetProject(ctx, *pipeline.ProjectID)
		if err != nil {
			continue
		}
		if _, err := m.ResolveSnapshot(ctx, st, project, branch, ""); err != nil {
			continue
		}
	}

	return nil
}

func (m *SourceManager) RunWarmupLoop(ctx context.Context, st *store.Store, interval time.Duration) {
	if m == nil || st == nil {
		return
	}
	if interval <= 0 {
		interval = 30 * time.Minute
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	run := func() {
		warmCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		defer cancel()
		_ = m.WarmActivePipelineMirrors(warmCtx, st)
	}

	run()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

type sourcePaths struct {
	basePath   string
	mirrorPath string
	lockPath   string
}

func (m *SourceManager) paths(orgID string, projectID string, repository string) sourcePaths {
	basePath := filepath.Join(
		m.baseDir,
		"mirrors",
		safePathSegment(orgID, "org"),
		safePathSegment(projectID, "project"),
		repoPathSlug(repository),
	)
	return sourcePaths{
		basePath:   basePath,
		mirrorPath: filepath.Join(basePath, "mirror.git"),
		lockPath:   filepath.Join(basePath, "mirror.lock"),
	}
}

func (m *SourceManager) cloneMirror(ctx context.Context, remoteURL string, mirrorPath string, env map[string]string) error {
	_ = os.RemoveAll(mirrorPath)
	return m.runGit(ctx, env, "clone", "--mirror", remoteURL, mirrorPath)
}

func (m *SourceManager) ensureRemoteURL(ctx context.Context, mirrorPath string, remoteURL string, env map[string]string) error {
	return m.runGit(ctx, env, "--git-dir", mirrorPath, "remote", "set-url", "origin", remoteURL)
}

func (m *SourceManager) fetchMirror(ctx context.Context, mirrorPath string, env map[string]string) error {
	return m.runGit(ctx, env, "--git-dir", mirrorPath, "fetch", "--prune", "--tags", "origin")
}

func (m *SourceManager) resolveRemoteBranchCommit(ctx context.Context, mirrorPath string, branch string, env map[string]string) (string, error) {
	ref := "refs/heads/" + strings.TrimSpace(branch) + "^{commit}"
	output, err := m.runGitOutput(ctx, env, "--git-dir", mirrorPath, "rev-parse", "--verify", "--quiet", ref)
	if err != nil {
		return "", fmt.Errorf("source branch %s is not available in local mirror", branch)
	}
	commitSHA := strings.TrimSpace(output)
	if commitSHA == "" {
		return "", fmt.Errorf("source branch %s is not available in local mirror", branch)
	}
	return commitSHA, nil
}

func (m *SourceManager) listRemoteBranches(ctx context.Context, mirrorPath string, env map[string]string) ([]string, error) {
	output, err := m.runGitOutput(
		ctx,
		env,
		"--git-dir",
		mirrorPath,
		"for-each-ref",
		"--format=%(refname:strip=2)",
		"refs/heads",
	)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(output, "\n")
	branches := make([]string, 0, len(lines))
	seen := map[string]bool{}
	for _, line := range lines {
		branch := strings.TrimSpace(line)
		if branch == "" || branch == "HEAD" || seen[branch] {
			continue
		}
		seen[branch] = true
		branches = append(branches, branch)
	}
	return branches, nil
}

func (m *SourceManager) readCommitMessage(ctx context.Context, mirrorPath string, commitSHA string, env map[string]string) (string, error) {
	output, err := m.runGitOutput(ctx, env, "--git-dir", mirrorPath, "show", "-s", "--format=%s", commitSHA)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(output), nil
}

func (m *SourceManager) commitExists(ctx context.Context, mirrorPath string, commitSHA string, env map[string]string) (bool, error) {
	output, err := m.runGitOutput(ctx, env, "--git-dir", mirrorPath, "rev-parse", "--verify", "--quiet", commitSHA+"^{commit}")
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "exit status 1") {
			return false, nil
		}
		return false, err
	}
	return strings.TrimSpace(output) != "", nil
}

func (m *SourceManager) isMirrorRepo(mirrorPath string) bool {
	if strings.TrimSpace(mirrorPath) == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(mirrorPath, "HEAD"))
	return err == nil
}

func (m *SourceManager) acquireLock(lockPath string) (func() error, error) {
	start := time.Now()
	for time.Since(start) < m.lockTimeout {
		file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			payload, _ := json.Marshal(map[string]any{
				"pid":       os.Getpid(),
				"createdAt": time.Now().UTC().Format(time.RFC3339),
			})
			_, _ = file.Write(payload)
			_ = file.Close()
			return func() error {
				if removeErr := os.Remove(lockPath); removeErr != nil && !os.IsNotExist(removeErr) {
					return removeErr
				}
				return nil
			}, nil
		}
		if !os.IsExist(err) {
			return nil, err
		}
		stale, staleErr := m.lockIsStale(lockPath)
		if staleErr == nil && stale {
			_ = os.Remove(lockPath)
			continue
		}
		time.Sleep(200 * time.Millisecond)
	}
	return nil, fmt.Errorf("timed out acquiring source mirror lock")
}

func (m *SourceManager) lockIsStale(lockPath string) (bool, error) {
	info, err := os.Stat(lockPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return time.Since(info.ModTime()) > m.lockStaleAfter, nil
}

func (m *SourceManager) runGit(ctx context.Context, env map[string]string, args ...string) error {
	cmd := exec.CommandContext(ctx, m.gitCommand, args...)
	cmd.Env = mergeEnv(env)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %s failed: %w (%s)", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func (m *SourceManager) runGitOutput(ctx context.Context, env map[string]string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, m.gitCommand, args...)
	cmd.Env = mergeEnv(env)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s failed: %w (%s)", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return string(output), nil
}

func safePathSegment(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		trimmed = fallback
	}
	replacer := strings.NewReplacer("\\", "_", "/", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return replacer.Replace(trimmed)
}

func repoPathSlug(value string) string {
	trimmed := strings.TrimSpace(strings.TrimSuffix(value, ".git"))
	replacer := strings.NewReplacer("\\", "__", "/", "__", ":", "__", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	trimmed = replacer.Replace(trimmed)
	if trimmed == "" {
		return "repo"
	}
	return trimmed
}
