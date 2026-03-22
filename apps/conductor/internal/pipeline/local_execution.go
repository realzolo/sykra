package pipeline

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/bmatcuk/doublestar/v4"
	"github.com/jackc/pgx/v5"

	"spec-axis/conductor/internal/artifacts"
	"spec-axis/conductor/internal/store"
	"spec-axis/conductor/pkg/workerprotocol"
)

func (e *Engine) runJobLocally(
	ctx context.Context,
	run *store.PipelineRun,
	runID string,
	workspaceRoot string,
	cfg PipelineConfig,
	secrets map[string]string,
	source *ResolvedSource,
	job PipelineJob,
	jobRecord store.PipelineJob,
) error {
	jobWorkspaceRoot, err := prepareLocalJobWorkspace(ctx, e.SourceManager, source, workspaceRoot, job)
	if err != nil {
		e.failJobWithoutStartedStep(ctx, runID, job, jobRecord, err.Error())
		_ = e.Store.MarkPipelineJobFailed(ctx, jobRecord.ID, err.Error())
		_ = e.Store.AppendRunEvent(ctx, runID, "job.failed", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"status":     StatusFailed,
			"error":      err.Error(),
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return err
	}
	sandbox, err := startJobSandbox(ctx, runID, job.ID, strings.TrimSpace(cfg.BuildImage), jobWorkspaceRoot)
	if err != nil {
		e.failJobWithoutStartedStep(ctx, runID, job, jobRecord, err.Error())
		_ = e.Store.MarkPipelineJobFailed(ctx, jobRecord.ID, err.Error())
		_ = e.Store.AppendRunEvent(ctx, runID, "job.failed", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"status":     StatusFailed,
			"error":      err.Error(),
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return err
	}
	defer func() {
		_ = sandbox.Close()
	}()

	for _, step := range job.Steps {
		stepRecord, err := e.Store.GetPipelineStepByKey(ctx, jobRecord.ID, step.ID)
		if err != nil {
			return err
		}
		if stepRecord.ID == "" {
			return fmt.Errorf("step record missing for %s", step.ID)
		}

		_, err = e.runStep(ctx, sandbox, run, runID, jobWorkspaceRoot, cfg, secrets, source, job, jobRecord, step, stepRecord)
		if err != nil && !step.ContinueOnError {
			_ = e.Store.MarkPipelineJobFailed(ctx, jobRecord.ID, err.Error())
			_ = e.Store.AppendRunEvent(ctx, runID, "job.failed", map[string]any{
				"runId":      runID,
				"jobId":      jobRecord.ID,
				"jobKey":     job.ID,
				"status":     StatusFailed,
				"error":      err.Error(),
				"finishedAt": time.Now().UTC().Format(time.RFC3339),
			})
			return err
		}
	}

	_ = e.Store.MarkPipelineJobSuccess(ctx, jobRecord.ID)
	_ = e.Store.AppendRunEvent(ctx, runID, "job.completed", map[string]any{
		"runId":      runID,
		"jobId":      jobRecord.ID,
		"jobKey":     job.ID,
		"status":     StatusSuccess,
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	})
	return nil
}

func (e *Engine) executeLocalStep(
	ctx context.Context,
	sandbox *jobSandbox,
	step PipelineStep,
	env map[string]string,
	workingDir string,
	job PipelineJob,
	logWriter io.Writer,
) (int, error) {
	switch job.Type {
	case "source_checkout":
		if sandbox == nil {
			return 1, errors.New("sandbox is required for source checkout")
		}
		if strings.TrimSpace(env["PIPELINE_REPOSITORY"]) == "" {
			return 1, errors.New("source repository is not resolved")
		}
		if strings.TrimSpace(env["PIPELINE_SOURCE_BRANCH"]) == "" {
			return 1, errors.New("source branch is not resolved")
		}
		if strings.TrimSpace(env["PIPELINE_SOURCE_COMMIT"]) == "" {
			return 1, errors.New("source commit is not resolved")
		}
		script := `
set -eu
echo "[source] Repository: ${PIPELINE_REPOSITORY}"
echo "[source] Branch: ${PIPELINE_SOURCE_BRANCH}"
echo "[source] Commit: ${PIPELINE_SOURCE_COMMIT}"
if [ -n "${PIPELINE_SOURCE_COMMIT_MESSAGE:-}" ]; then
  echo "[source] Subject: ${PIPELINE_SOURCE_COMMIT_MESSAGE}"
fi
if [ -n "${PIPELINE_SOURCE_MIRROR:-}" ]; then
  echo "[source] Mirror cache: ${PIPELINE_SOURCE_MIRROR}"
fi
echo "[source] Local workspace snapshot is ready."
`
		return sandbox.ExecScript(ctx, script, env, workingDir, logWriter)
	case "review_gate":
		if sandbox == nil {
			return 1, errors.New("sandbox is required for review gate")
		}
		executor := &ReviewGateExecutor{
			Store:       e.Store,
			ProjectID:   job.ProjectID,
			MinScore:    job.MinScore,
			GateEnabled: job.MinScore > 0,
		}
		score, err := executor.fetchLatestScore(ctx)
		if err != nil {
			_, _ = fmt.Fprintf(logWriter, "[review] WARNING: could not fetch review score: %v\n", err)
			_, _ = io.WriteString(logWriter, "[review] Proceeding without quality gate check.\n")
			return 0, nil
		}
		env["PIPELINE_REVIEW_SCORE"] = strconv.Itoa(score)
		env["PIPELINE_REVIEW_MIN_SCORE"] = strconv.Itoa(job.MinScore)
		if job.MinScore > 0 {
			env["PIPELINE_REVIEW_GATE_ENABLED"] = "1"
		} else {
			env["PIPELINE_REVIEW_GATE_ENABLED"] = "0"
		}
		script := `
set -eu
echo "[review] Latest review score: ${PIPELINE_REVIEW_SCORE}/100"
if [ "${PIPELINE_REVIEW_GATE_ENABLED}" = "1" ] && [ "${PIPELINE_REVIEW_SCORE}" -lt "${PIPELINE_REVIEW_MIN_SCORE}" ]; then
  echo "[review] BLOCKED: score ${PIPELINE_REVIEW_SCORE} is below minimum ${PIPELINE_REVIEW_MIN_SCORE}"
  exit 1
fi
if [ "${PIPELINE_REVIEW_GATE_ENABLED}" = "1" ]; then
  echo "[review] Quality gate passed (score ${PIPELINE_REVIEW_SCORE} >= ${PIPELINE_REVIEW_MIN_SCORE})"
else
  echo "[review] Review complete (quality gate not enforced)"
fi
`
		return sandbox.ExecScript(ctx, script, env, workingDir, logWriter)
	default:
		if strings.EqualFold(step.Type, "docker") {
			return 1, fmt.Errorf("step %s cannot use docker type in CI sandbox jobs; use pipeline buildImage instead", step.ID)
		}
		if sandbox == nil {
			executor := e.Executors.Get("shell")
			if executor == nil {
				return 1, fmt.Errorf("no shell executor configured")
			}
			return executor.Execute(ctx, step, env, workingDir, logWriter)
		}
		return sandbox.ExecScript(ctx, step.Script, env, workingDir, logWriter)
	}
}

func resolvePipelineWorkingDir(workspaceRoot string, jobWorkingDir string, stepWorkingDir string) string {
	pathValue := strings.TrimSpace(stepWorkingDir)
	if pathValue == "" {
		pathValue = strings.TrimSpace(jobWorkingDir)
	}
	if pathValue == "" {
		return workspaceRoot
	}
	if filepath.IsAbs(pathValue) {
		return filepath.Clean(pathValue)
	}
	return filepath.Clean(filepath.Join(workspaceRoot, pathValue))
}

func sanitizeArtifactRelativePath(value string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if normalized == "" {
		return "", errors.New("empty path")
	}
	cleaned := path.Clean("/" + normalized)
	if strings.HasPrefix(cleaned, "/..") {
		return "", errors.New("path traversal is not allowed")
	}
	relative := strings.TrimPrefix(cleaned, "/")
	if relative == "" || relative == "." {
		return "", errors.New("empty path")
	}
	return relative, nil
}

func resolveArtifactFiles(workingDir string, patterns []string) ([]string, error) {
	baseAbs, err := filepath.Abs(workingDir)
	if err != nil {
		return nil, err
	}

	seen := map[string]bool{}
	files := make([]string, 0, len(patterns))
	for _, rawPattern := range patterns {
		pattern := strings.TrimSpace(rawPattern)
		if pattern == "" {
			continue
		}
		candidate := pattern
		if !filepath.IsAbs(candidate) {
			candidate = filepath.Join(baseAbs, candidate)
		}

		matches, globErr := doublestar.FilepathGlob(candidate)
		if globErr != nil {
			return nil, globErr
		}
		if len(matches) == 0 {
			if _, statErr := os.Stat(candidate); statErr == nil {
				matches = []string{candidate}
			}
		}

		for _, match := range matches {
			absolute, absErr := filepath.Abs(match)
			if absErr != nil {
				continue
			}
			if !isWithinBasePath(baseAbs, absolute) {
				return nil, fmt.Errorf("artifact path escapes workspace: %s", pattern)
			}

			info, statErr := os.Stat(absolute)
			if statErr != nil {
				continue
			}
			if info.IsDir() {
				walkErr := filepath.WalkDir(absolute, func(walkPath string, entry fs.DirEntry, walkErr error) error {
					if walkErr != nil {
						return walkErr
					}
					if entry.IsDir() {
						return nil
					}
					fileAbs, absErr := filepath.Abs(walkPath)
					if absErr != nil {
						return nil
					}
					if !isWithinBasePath(baseAbs, fileAbs) || seen[fileAbs] {
						return nil
					}
					seen[fileAbs] = true
					files = append(files, fileAbs)
					return nil
				})
				if walkErr != nil {
					return nil, walkErr
				}
				continue
			}

			if seen[absolute] {
				continue
			}
			seen[absolute] = true
			files = append(files, absolute)
		}
	}
	sort.Strings(files)
	return files, nil
}

func isWithinBasePath(basePath string, candidate string) bool {
	rel, err := filepath.Rel(basePath, candidate)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return !strings.HasPrefix(filepath.ToSlash(rel), "../")
}

func filterArtifactInputs(artifacts []store.PipelineArtifact, patterns []string) ([]store.PipelineArtifact, error) {
	matched := make([]store.PipelineArtifact, 0)
	seen := map[string]bool{}
	for _, rawPattern := range patterns {
		pattern := strings.TrimSpace(strings.ReplaceAll(rawPattern, "\\", "/"))
		if pattern == "" {
			continue
		}
		for _, artifact := range artifacts {
			target := strings.TrimSpace(strings.ReplaceAll(artifact.Path, "\\", "/"))
			ok, err := doublestar.Match(pattern, target)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
			if seen[artifact.ID] {
				continue
			}
			seen[artifact.ID] = true
			matched = append(matched, artifact)
		}
	}
	sort.Slice(matched, func(i int, j int) bool {
		if matched[i].Path == matched[j].Path {
			return matched[i].ID < matched[j].ID
		}
		return matched[i].Path < matched[j].Path
	})
	return matched, nil
}

func (e *Engine) resolveArtifactRetentionDays(ctx context.Context, run *store.PipelineRun) (int, error) {
	if run != nil && run.ProjectID != nil && strings.TrimSpace(*run.ProjectID) != "" {
		project, err := e.Store.GetProject(ctx, *run.ProjectID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return 0, err
		}
		if project != nil && project.ArtifactRetentionDays != nil {
			return *project.ArtifactRetentionDays, nil
		}
	}
	return e.ArtifactRetentionDays, nil
}

func (e *Engine) prepareLocalStepArtifacts(
	ctx context.Context,
	run *store.PipelineRun,
	runID string,
	cfg PipelineConfig,
	job PipelineJob,
	jobRecord store.PipelineJob,
	step PipelineStep,
	stepRecord store.PipelineStep,
	workingDir string,
	output io.Writer,
) error {
	if strings.EqualFold(strings.TrimSpace(step.ArtifactSource), "registry") {
		if run == nil {
			return errors.New("registry deployment requires pipeline run context")
		}
		resolvedVersion, files, err := e.resolveRegistryDeployment(ctx, run, jobRecord, cfg, step)
		if err != nil {
			return err
		}
		_ = e.Store.AppendRunEvent(ctx, runID, "step.artifact.registry_resolved", map[string]any{
			"runId":           runID,
			"jobId":           jobRecord.ID,
			"jobKey":          job.ID,
			"stepId":          stepRecord.ID,
			"stepKey":         step.ID,
			"repository":      resolvedVersion.RepositorySlug,
			"resolvedVersion": resolvedVersion.Version,
			"channel":         resolvedVersion.ChannelName,
			"fileCount":       len(files),
			"resolvedAt":      time.Now().UTC().Format(time.RFC3339),
		})
		return e.downloadLocalRegistryArtifacts(ctx, runID, job, jobRecord, step, stepRecord, workingDir, files, output)
	}

	if len(step.ArtifactInputs) == 0 {
		return nil
	}
	return e.downloadLocalRunArtifacts(ctx, runID, job, jobRecord, step, stepRecord, workingDir, output)
}

func (e *Engine) downloadLocalRunArtifacts(
	ctx context.Context,
	runID string,
	job PipelineJob,
	jobRecord store.PipelineJob,
	step PipelineStep,
	stepRecord store.PipelineStep,
	workingDir string,
	output io.Writer,
) error {
	if e.Artifacts == nil {
		return errors.New("artifact manager is not configured")
	}

	artifactsList, err := e.Store.ListPipelineArtifactsForRun(ctx, runID)
	if err != nil {
		return err
	}
	if len(artifactsList) == 0 {
		return errors.New("no artifacts are available for this run")
	}

	matched, err := filterArtifactInputs(artifactsList, step.ArtifactInputs)
	if err != nil {
		return err
	}
	if len(matched) == 0 {
		return fmt.Errorf("no artifacts matched artifactInputs for step %s", step.ID)
	}
	_, _ = fmt.Fprintf(output, "[artifact] Preparing %d artifact(s) for step %s\n", len(matched), step.ID)

	for _, artifact := range matched {
		startedAt := time.Now()
		_ = e.Store.AppendRunEvent(ctx, runID, "step.artifact.pull_started", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"stepId":     stepRecord.ID,
			"stepKey":    step.ID,
			"artifactId": artifact.ID,
			"path":       artifact.Path,
			"timestamp":  startedAt.UTC().Format(time.RFC3339),
		})

		sizeBytes, err := e.downloadPipelineArtifactToWorkingDir(ctx, artifact, workingDir)
		if err != nil {
			_ = e.Store.AppendRunEvent(ctx, runID, "step.artifact.pull_failed", map[string]any{
				"runId":         runID,
				"jobId":         jobRecord.ID,
				"jobKey":        job.ID,
				"stepId":        stepRecord.ID,
				"stepKey":       step.ID,
				"artifactId":    artifact.ID,
				"path":          artifact.Path,
				"durationMs":    time.Since(startedAt).Milliseconds(),
				"errorCategory": "download_failed",
				"error":         err.Error(),
				"timestamp":     time.Now().UTC().Format(time.RFC3339),
			})
			return err
		}

		_ = e.Store.AppendRunEvent(ctx, runID, "step.artifact.pulled", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"stepId":     stepRecord.ID,
			"stepKey":    step.ID,
			"artifactId": artifact.ID,
			"path":       artifact.Path,
			"durationMs": time.Since(startedAt).Milliseconds(),
			"sizeBytes":  sizeBytes,
			"timestamp":  time.Now().UTC().Format(time.RFC3339),
		})
	}

	_, _ = fmt.Fprintf(output, "[artifact] Prepared %d artifact(s) for step %s\n", len(matched), step.ID)
	return nil
}

func (e *Engine) downloadLocalRegistryArtifacts(
	ctx context.Context,
	runID string,
	job PipelineJob,
	jobRecord store.PipelineJob,
	step PipelineStep,
	stepRecord store.PipelineStep,
	workingDir string,
	files []workerprotocol.RegistryArtifactFile,
	output io.Writer,
) error {
	if e.Artifacts == nil {
		return errors.New("artifact manager is not configured")
	}
	if len(files) == 0 {
		return fmt.Errorf("no registry files resolved for step %s", step.ID)
	}

	_, _ = fmt.Fprintf(
		output,
		"[artifact] Preparing %d published artifact file(s) from %s@%s for step %s\n",
		len(files),
		strings.TrimSpace(step.RegistryRepository),
		strings.TrimSpace(step.RegistryVersion),
		step.ID,
	)

	for _, file := range files {
		artifactFile, err := e.Store.GetArtifactFile(ctx, file.FileID)
		if err != nil {
			return err
		}
		if artifactFile == nil {
			return fmt.Errorf("artifact file %s not found", file.FileID)
		}

		startedAt := time.Now()
		_ = e.Store.AppendRunEvent(ctx, runID, "step.artifact.pull_started", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"stepId":     stepRecord.ID,
			"stepKey":    step.ID,
			"artifactId": artifactFile.ID,
			"path":       file.LogicalPath,
			"timestamp":  startedAt.UTC().Format(time.RFC3339),
		})

		sizeBytes, err := e.downloadPublishedArtifactFileToWorkingDir(ctx, *artifactFile, workingDir)
		if err != nil {
			_ = e.Store.AppendRunEvent(ctx, runID, "step.artifact.pull_failed", map[string]any{
				"runId":         runID,
				"jobId":         jobRecord.ID,
				"jobKey":        job.ID,
				"stepId":        stepRecord.ID,
				"stepKey":       step.ID,
				"artifactId":    artifactFile.ID,
				"path":          file.LogicalPath,
				"durationMs":    time.Since(startedAt).Milliseconds(),
				"errorCategory": "download_failed",
				"error":         err.Error(),
				"timestamp":     time.Now().UTC().Format(time.RFC3339),
			})
			return err
		}

		_ = e.Store.AppendRunEvent(ctx, runID, "step.artifact.pulled", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"stepId":     stepRecord.ID,
			"stepKey":    step.ID,
			"artifactId": artifactFile.ID,
			"path":       file.LogicalPath,
			"durationMs": time.Since(startedAt).Milliseconds(),
			"sizeBytes":  sizeBytes,
			"timestamp":  time.Now().UTC().Format(time.RFC3339),
		})
	}

	_, _ = fmt.Fprintf(output, "[artifact] Prepared %d published artifact file(s) for step %s\n", len(files), step.ID)
	return nil
}

func (e *Engine) downloadPipelineArtifactToWorkingDir(
	ctx context.Context,
	artifact store.PipelineArtifact,
	workingDir string,
) (int64, error) {
	if e.Artifacts == nil {
		return 0, errors.New("artifact manager is not configured")
	}
	relativePath, err := sanitizeArtifactRelativePath(artifact.Path)
	if err != nil {
		return 0, err
	}
	destination := filepath.Join(workingDir, filepath.FromSlash(relativePath))
	return e.downloadStoredArtifact(ctx, artifact.OrgID, artifact.StoragePath, destination, artifact.SizeBytes, artifact.Sha256)
}

func (e *Engine) downloadPublishedArtifactFileToWorkingDir(
	ctx context.Context,
	file store.ArtifactFile,
	workingDir string,
) (int64, error) {
	if e.Artifacts == nil {
		return 0, errors.New("artifact manager is not configured")
	}
	relativePath, err := sanitizeArtifactRelativePath(file.LogicalPath)
	if err != nil {
		return 0, err
	}
	destination := filepath.Join(workingDir, filepath.FromSlash(relativePath))
	return e.downloadStoredArtifact(ctx, file.OrgID, file.StoragePath, destination, file.SizeBytes, file.Sha256)
}

func (e *Engine) downloadStoredArtifact(
	ctx context.Context,
	orgID string,
	storagePath string,
	destination string,
	expectedSize int64,
	expectedSHA string,
) (int64, error) {
	workingAbs, err := filepath.Abs(filepath.Dir(destination))
	if err != nil {
		return 0, err
	}
	destination = filepath.Clean(destination)
	if !isWithinBasePath(workingAbs, destination) {
		return 0, fmt.Errorf("artifact path escapes working directory: %s", destination)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return 0, err
	}

	content, err := e.Artifacts.OpenArtifact(ctx, orgID, storagePath)
	if err != nil {
		return 0, err
	}
	defer content.Reader.Close()

	tempFile, err := os.CreateTemp(filepath.Dir(destination), ".artifact-*.tmp")
	if err != nil {
		return 0, err
	}
	tempPath := tempFile.Name()

	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(tempFile, hash), content.Reader)
	closeErr := tempFile.Close()
	if copyErr != nil {
		_ = os.Remove(tempPath)
		return 0, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tempPath)
		return 0, closeErr
	}
	if expectedSize > 0 && written != expectedSize {
		_ = os.Remove(tempPath)
		return 0, fmt.Errorf("artifact size mismatch for %s", destination)
	}
	if expected := strings.TrimSpace(expectedSHA); expected != "" {
		actual := hex.EncodeToString(hash.Sum(nil))
		if !strings.EqualFold(expected, actual) {
			_ = os.Remove(tempPath)
			return 0, fmt.Errorf("artifact checksum mismatch for %s", destination)
		}
	}
	if err := os.Rename(tempPath, destination); err != nil {
		_ = os.Remove(tempPath)
		return 0, err
	}
	return written, nil
}

func (e *Engine) uploadLocalStepArtifacts(
	ctx context.Context,
	run *store.PipelineRun,
	runID string,
	job PipelineJob,
	jobRecord store.PipelineJob,
	step PipelineStep,
	stepRecord store.PipelineStep,
	workingDir string,
) error {
	if e.Artifacts == nil || run == nil {
		return errors.New("artifact manager is not configured")
	}

	files, err := resolveArtifactFiles(workingDir, step.ArtifactPaths)
	if err != nil {
		return err
	}
	retentionDays, err := e.resolveArtifactRetentionDays(ctx, run)
	if err != nil {
		return err
	}

	for _, absolutePath := range files {
		info, err := os.Stat(absolutePath)
		if err != nil || info.IsDir() {
			continue
		}

		relativePath, relErr := filepath.Rel(workingDir, absolutePath)
		if relErr != nil || strings.HasPrefix(filepath.ToSlash(relativePath), "../") {
			relativePath = filepath.Base(absolutePath)
		}
		relativePath = filepath.ToSlash(relativePath)

		file, err := os.Open(absolutePath)
		if err != nil {
			return err
		}

		artifact, err := e.Artifacts.SaveArtifact(ctx, artifacts.SaveArtifactInput{
			OrgID:         run.OrgID,
			RunID:         runID,
			JobID:         jobRecord.ID,
			StepID:        stepRecord.ID,
			RelativePath:  relativePath,
			Content:       file,
			ContentLength: info.Size(),
		})
		_ = file.Close()
		if err != nil {
			return err
		}
		if retentionDays > 0 {
			expiresAt := time.Now().UTC().Add(time.Duration(retentionDays) * 24 * time.Hour)
			artifact.ExpiresAt = &expiresAt
		}
		if err := e.Store.InsertPipelineArtifact(ctx, artifact); err != nil {
			return err
		}
		_ = e.Store.AppendRunEvent(ctx, runID, "step.artifact.uploaded", map[string]any{
			"runId":       runID,
			"jobId":       jobRecord.ID,
			"jobKey":      job.ID,
			"stepId":      stepRecord.ID,
			"stepKey":     step.ID,
			"path":        artifact.Path,
			"storagePath": artifact.StoragePath,
			"sizeBytes":   artifact.SizeBytes,
			"sha256":      artifact.Sha256,
			"uploadedAt":  time.Now().UTC().Format(time.RFC3339),
		})
	}
	return nil
}
