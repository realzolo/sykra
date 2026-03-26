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

	"sykra/conductor/internal/artifacts"
	"sykra/conductor/internal/store"
	"sykra/conductor/pkg/workerprotocol"
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
	jobWorkspaceRoot, changedFilesCount, err := prepareLocalJobWorkspace(ctx, e.SourceManager, source, workspaceRoot, job)
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

		_, err = e.runStep(ctx, sandbox, run, runID, jobWorkspaceRoot, changedFilesCount, cfg, secrets, source, job, jobRecord, step, stepRecord)
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
	run *store.PipelineRun,
	runID string,
	jobRecord store.PipelineJob,
	stepRecord store.PipelineStep,
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
		writeCommandHeader(logWriter, "[command] /bin/sh -lc", workingDir)
		writeScriptBlock(logWriter, "[command] /bin/sh -lc", script)
		exitCode, err := sandbox.ExecScript(ctx, script, env, workingDir, logWriter)
		writeCommandResult(logWriter, exitCode, err)
		return exitCode, err
	case "quality_gate":
		if sandbox == nil {
			return 1, errors.New("sandbox is required for quality gate")
		}
		checkType := strings.TrimSpace(strings.ToLower(step.CheckType))
		switch checkType {
		case "ai_review":
			commitSHA := ""
			if run != nil && run.CommitSHA != nil {
				commitSHA = strings.TrimSpace(*run.CommitSHA)
			}
			if commitSHA == "" {
				e.recordQualityGateEvent(ctx, runID, run, jobRecord, stepRecord, job, step, "quality_gate.ai_review_failed", map[string]any{
					"status":    StatusFailed,
					"reason":    "missing_commit_sha",
					"minScore":  job.MinScore,
					"timestamp": time.Now().UTC().Format(time.RFC3339),
				})
				return 1, errors.New("quality gate requires a commit SHA for AI review")
			}
			if job.MinScore <= 0 {
				e.recordQualityGateEvent(ctx, runID, run, jobRecord, stepRecord, job, step, "quality_gate.ai_review_failed", map[string]any{
					"status":    StatusFailed,
					"reason":    "missing_min_score",
					"commitSha": commitSHA,
					"timestamp": time.Now().UTC().Format(time.RFC3339),
				})
				return 1, errors.New("quality gate minScore is required and must be greater than 0")
			}
			score, err := e.Store.GetLatestProjectReviewScore(ctx, job.ProjectID, commitSHA)
			if err != nil {
				e.recordQualityGateEvent(ctx, runID, run, jobRecord, stepRecord, job, step, "quality_gate.ai_review_failed", map[string]any{
					"status":    StatusFailed,
					"reason":    "review_lookup_failed",
					"commitSha": commitSHA,
					"minScore":  job.MinScore,
					"error":     err.Error(),
					"timestamp": time.Now().UTC().Format(time.RFC3339),
				})
				return 1, fmt.Errorf("quality gate: failed to load review score: %w", err)
			}
			if score == nil {
				e.recordQualityGateEvent(ctx, runID, run, jobRecord, stepRecord, job, step, "quality_gate.ai_review_failed", map[string]any{
					"status":    StatusFailed,
					"reason":    "review_not_found",
					"commitSha": commitSHA,
					"minScore":  job.MinScore,
					"timestamp": time.Now().UTC().Format(time.RFC3339),
				})
				if commitSHA != "" {
					return 1, fmt.Errorf("quality gate: no completed review found for commit %s", commitSHA)
				}
				return 1, fmt.Errorf("quality gate: no completed review found")
			}
			writeCommandHeader(logWriter, "[quality] ai review", workingDir)
			_, _ = fmt.Fprintf(logWriter, "[quality] AI review score: %d/100\n", *score)
			if *score < job.MinScore {
				err := fmt.Errorf("quality gate failed: score %d < minimum %d", *score, job.MinScore)
				_, _ = fmt.Fprintf(logWriter, "[quality] BLOCKED: %v\n", err)
				e.recordQualityGateEvent(ctx, runID, run, jobRecord, stepRecord, job, step, "quality_gate.ai_review_blocked", map[string]any{
					"status":    StatusFailed,
					"reason":    "below_threshold",
					"commitSha": commitSHA,
					"minScore":  job.MinScore,
					"score":     *score,
					"timestamp": time.Now().UTC().Format(time.RFC3339),
				})
				writeCommandResult(logWriter, 1, err)
				return 1, err
			}
			_, _ = fmt.Fprintf(logWriter, "[quality] Gate passed (score %d >= %d)\n", *score, job.MinScore)
			e.recordQualityGateEvent(ctx, runID, run, jobRecord, stepRecord, job, step, "quality_gate.ai_review_completed", map[string]any{
				"status":    StatusSuccess,
				"reason":    "passed",
				"commitSha": commitSHA,
				"minScore":  job.MinScore,
				"score":     *score,
				"timestamp": time.Now().UTC().Format(time.RFC3339),
			})
			return 0, nil
		case "static_analysis":
			staticScript := strings.TrimSpace(step.Script)
			if staticScript == "" {
				return 1, fmt.Errorf("quality gate step %s requires a static analysis command", step.ID)
			}
			changedFilesCount := 0
			if raw := strings.TrimSpace(env["PIPELINE_CHANGED_FILES_COUNT"]); raw != "" {
				if parsed, parseErr := strconv.Atoi(raw); parseErr == nil && parsed >= 0 {
					changedFilesCount = parsed
				}
			}
			writeCommandHeader(logWriter, "[command] static analysis", workingDir)
			writeScriptBlock(logWriter, "[command] /bin/sh -lc", staticScript)
			exitCode, err := sandbox.ExecScript(ctx, staticScript, env, workingDir, logWriter)
			eventPayload := map[string]any{
				"status":            statusFromExit(exitCode, err),
				"command":           staticScript,
				"exitCode":          exitCode,
				"changedFilesCount": changedFilesCount,
				"timestamp":         time.Now().UTC().Format(time.RFC3339),
			}
			if err != nil {
				eventPayload["error"] = err.Error()
			}
			e.recordQualityGateEvent(ctx, runID, run, jobRecord, stepRecord, job, step, "quality_gate.static_analysis_completed", eventPayload)
			writeCommandResult(logWriter, exitCode, err)
			return exitCode, err
		default:
			return 1, fmt.Errorf("quality gate step %s must define checkType ai_review or static_analysis", step.ID)
		}

	default:
		if strings.EqualFold(step.Type, "docker") {
			return 1, fmt.Errorf("step %s cannot use docker type in CI sandbox jobs; use pipeline buildImage instead", step.ID)
		}
		if sandbox == nil {
			executor := e.Executors.Get("shell")
			if executor == nil {
				return 1, fmt.Errorf("no shell executor configured")
			}
			writeCommandHeader(logWriter, "[command] /bin/sh -lc", workingDir)
			writeScriptBlock(logWriter, "[command] /bin/sh -lc", step.Script)
			exitCode, err := executor.Execute(ctx, step, env, workingDir, logWriter)
			writeCommandResult(logWriter, exitCode, err)
			return exitCode, err
		}
		writeCommandHeader(logWriter, "[command] /bin/sh -lc", workingDir)
		writeScriptBlock(logWriter, "[command] /bin/sh -lc", step.Script)
		exitCode, err := sandbox.ExecScript(ctx, step.Script, env, workingDir, logWriter)
		writeCommandResult(logWriter, exitCode, err)
		return exitCode, err
	}
}

func writeCommandHeader(output io.Writer, title string, workingDir string) {
	if output == nil {
		return
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "[command]"
	}
	_, _ = fmt.Fprintln(output, title)
	if cwd := strings.TrimSpace(workingDir); cwd != "" {
		_, _ = fmt.Fprintf(output, "[command] cwd: %s\n", cwd)
	}
}

func writeCommandResult(output io.Writer, exitCode int, err error) {
	if output == nil {
		return
	}
	if err == nil {
		_, _ = fmt.Fprintf(output, "[command] status=success exit=%d\n", exitCode)
		return
	}
	_, _ = fmt.Fprintf(output, "[command] status=failed exit=%d error=%s\n", exitCode, strings.TrimSpace(err.Error()))
}

func statusFromExit(exitCode int, err error) RunStatus {
	if err == nil {
		return StatusSuccess
	}
	if errors.Is(err, context.Canceled) {
		return StatusCanceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return StatusTimedOut
	}
	if exitCode == 0 {
		return StatusSuccess
	}
	return StatusFailed
}

func (e *Engine) recordQualityGateEvent(
	ctx context.Context,
	runID string,
	run *store.PipelineRun,
	jobRecord store.PipelineJob,
	stepRecord store.PipelineStep,
	job PipelineJob,
	step PipelineStep,
	eventType string,
	extra map[string]any,
) {
	if e == nil || e.Store == nil {
		return
	}
	payload := map[string]any{
		"runId":     runID,
		"jobId":     jobRecord.ID,
		"jobKey":    job.ID,
		"stepId":    stepRecord.ID,
		"stepKey":   step.ID,
		"checkType": strings.TrimSpace(strings.ToLower(step.CheckType)),
	}
	if run != nil {
		if run.CommitSHA != nil && strings.TrimSpace(*run.CommitSHA) != "" {
			payload["commitSha"] = strings.TrimSpace(*run.CommitSHA)
		}
		if run.ProjectID != nil && strings.TrimSpace(*run.ProjectID) != "" {
			payload["projectId"] = strings.TrimSpace(*run.ProjectID)
		}
	}
	for key, value := range extra {
		payload[key] = value
	}
	_ = e.Store.AppendRunEvent(ctx, runID, eventType, payload)
}

func writeScriptBlock(output io.Writer, label string, script string) {
	if output == nil {
		return
	}
	label = strings.TrimSpace(label)
	if label == "" {
		label = "[command]"
	}
	_, _ = fmt.Fprintln(output, label)
	if strings.TrimSpace(script) == "" {
		_, _ = io.WriteString(output, "[command] <empty>\n")
		return
	}
	_, _ = io.WriteString(output, script)
	if !strings.HasSuffix(script, "\n") {
		_, _ = io.WriteString(output, "\n")
	}
	_, _ = io.WriteString(output, "\n")
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
		if strings.EqualFold(strings.TrimSpace(step.CheckType), "static_analysis") {
			if err := ingestStaticAnalysisArtifact(ctx, e.Store, e.Artifacts, run, runID, job, jobRecord, step, stepRecord, artifact); err != nil {
				return err
			}
		}
	}
	return nil
}
