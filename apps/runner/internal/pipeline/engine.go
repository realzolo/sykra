package pipeline

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	runnercrypto "spec-axis/runner/internal/crypto"
	"spec-axis/runner/internal/store"
)

type Engine struct {
	Store       *store.Store
	Executors   *ExecutorRegistry
	Storage     *LocalStorage
	Concurrency int
	// Studio integration for source_checkout and review_gate
	StudioURL   string
	StudioToken string
}

func (e *Engine) postStudioEvent(ctx context.Context, typ string, payload map[string]any) {
	if strings.TrimSpace(e.StudioURL) == "" || strings.TrimSpace(e.StudioToken) == "" {
		return
	}
	url := strings.TrimRight(e.StudioURL, "/") + "/api/runner/events"
	body := map[string]any{
		"type": typ,
	}
	for k, v := range payload {
		body[k] = v
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Runner-Token", e.StudioToken)

	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		log.Printf("studio event post failed: %v", err)
		return
	}
	_ = res.Body.Close()
	if res.StatusCode >= 300 {
		log.Printf("studio event post failed: status=%d", res.StatusCode)
	}
}

func (e *Engine) Execute(ctx context.Context, runID string) error {
	if runID == "" {
		return errors.New("runId is required")
	}

	run, version, err := e.Store.GetPipelineRunWithVersion(ctx, runID)
	if err != nil {
		return err
	}

	var cfg PipelineConfig
	if err := version.DecodeConfig(&cfg); err != nil {
		return err
	}
	if err := ValidateConfig(cfg); err != nil {
		return err
	}

	// Derive projectID from run record
	projectID := ""
	if run.ProjectID != nil {
		projectID = *run.ProjectID
	}

	// Decrypt pipeline secrets once per run.
	// Secrets are injected as environment variables into every step.
	secrets := map[string]string{}
	secretRows, err := e.Store.ListPipelineSecrets(ctx, run.PipelineID)
	if err != nil {
		return err
	}
	for _, row := range secretRows {
		plain, err := runnercrypto.DecryptSecret(row.ValueEncrypted)
		if err != nil {
			return fmt.Errorf("decrypt pipeline secret %s: %w", row.Name, err)
		}
		secrets[row.Name] = plain
	}

	// Build the internal plan from the four-stage config
	plan := BuildInternalPlan(cfg, projectID, e.StudioURL, e.StudioToken)
	jobIndex := map[string]PipelineJob{}
	for _, job := range plan.Jobs {
		jobIndex[job.ID] = job
	}

	// Ensure job/step records exist in DB
	jobRecords, err := e.Store.ListPipelineJobs(ctx, runID)
	if err != nil {
		return err
	}
	if len(jobRecords) == 0 {
		if err := EnsureRunGraph(ctx, e.Store, runID, cfg, projectID, e.StudioURL, e.StudioToken); err != nil {
			return err
		}
		jobRecords, err = e.Store.ListPipelineJobs(ctx, runID)
		if err != nil {
			return err
		}
	}

	jobMap := map[string]store.PipelineJob{}
	for _, job := range jobRecords {
		jobMap[job.JobKey] = job
	}

	if err := e.Store.MarkPipelineRunRunning(ctx, runID); err != nil {
		return err
	}
	_ = e.Store.AppendRunEvent(ctx, runID, "run.started", map[string]any{
		"runId":      runID,
		"pipelineId": run.PipelineID,
		"versionId":  run.VersionID,
		"status":     StatusRunning,
		"startedAt":  time.Now().UTC().Format(time.RFC3339),
	})

	concurrency := e.Concurrency
	if concurrency <= 0 {
		concurrency = 1
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	type jobResult struct {
		jobKey string
		err    error
	}

	jobDone := make(chan jobResult)
	var mu sync.Mutex
	remaining := map[string]int{}
	dependents := map[string][]string{}
	for _, job := range plan.Jobs {
		remaining[job.ID] = len(job.Needs)
		for _, dep := range job.Needs {
			dependents[dep] = append(dependents[dep], job.ID)
		}
	}

	ready := make([]string, 0)
	for jobID, count := range remaining {
		if count == 0 {
			ready = append(ready, jobID)
		}
	}

	total := len(plan.Jobs)
	inFlight := 0
	completed := 0
	failed := false

	startJob := func(jobID string) {
		inFlight++
		go func(id string) {
			err := e.runJob(ctx, runID, cfg, secrets, jobIndex[id], jobMap[id])
			jobDone <- jobResult{jobKey: id, err: err}
		}(jobID)
	}

	for completed < total {
		for len(ready) > 0 && inFlight < concurrency && !failed {
			jobID := ready[0]
			ready = ready[1:]
			startJob(jobID)
		}

		if inFlight == 0 && (failed || len(ready) == 0) {
			break
		}

		result := <-jobDone
		inFlight--
		completed++

		if result.err != nil && !failed {
			failed = true
			cancel()
			_ = e.cancelPendingJobs(ctx, runID, jobIndex, jobMap)
		}

		if !failed {
			for _, dep := range dependents[result.jobKey] {
				mu.Lock()
				remaining[dep]--
				if remaining[dep] == 0 {
					ready = append(ready, dep)
				}
				mu.Unlock()
			}
		}
	}

	if failed {
		_ = e.Store.MarkPipelineRunFailed(ctx, runID, "job_failed")
		_ = e.Store.AppendRunEvent(ctx, runID, "run.failed", map[string]any{
			"runId":      runID,
			"status":     StatusFailed,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		e.postStudioEvent(ctx, "pipeline.run.failed", map[string]any{"runId": runID})
		return fmt.Errorf("pipeline run failed")
	}

	if completed < total {
		_ = e.Store.MarkPipelineRunFailed(ctx, runID, "dependency_deadlock")
		_ = e.Store.AppendRunEvent(ctx, runID, "run.failed", map[string]any{
			"runId":      runID,
			"status":     StatusFailed,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		e.postStudioEvent(ctx, "pipeline.run.failed", map[string]any{"runId": runID})
		return fmt.Errorf("pipeline run stalled")
	}

	_ = e.Store.MarkPipelineRunSuccess(ctx, runID)
	_ = e.Store.AppendRunEvent(ctx, runID, "run.completed", map[string]any{
		"runId":      runID,
		"status":     StatusSuccess,
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	})
	e.postStudioEvent(ctx, "pipeline.run.completed", map[string]any{"runId": runID})

	return nil
}

func (e *Engine) runJob(ctx context.Context, runID string, cfg PipelineConfig, secrets map[string]string, job PipelineJob, record store.PipelineJob) error {
	if record.ID == "" {
		return fmt.Errorf("job record missing for %s", job.ID)
	}

	if err := e.Store.MarkPipelineJobRunning(ctx, record.ID); err != nil {
		return err
	}
	_ = e.Store.AppendRunEvent(ctx, runID, "job.started", map[string]any{
		"runId":     runID,
		"jobId":     record.ID,
		"jobKey":    job.ID,
		"name":      job.Name,
		"status":    StatusRunning,
		"startedAt": time.Now().UTC().Format(time.RFC3339),
	})

	jobCtx := ctx
	if job.TimeoutSeconds != nil && *job.TimeoutSeconds > 0 {
		var cancelFn context.CancelFunc
		jobCtx, cancelFn = context.WithTimeout(ctx, time.Duration(*job.TimeoutSeconds)*time.Second)
		defer cancelFn()
	}

	var jobErr error
	for _, step := range job.Steps {
		stepRecord, err := e.Store.GetPipelineStepByKey(ctx, record.ID, step.ID)
		if err != nil {
			return err
		}
		if stepRecord.ID == "" {
			return fmt.Errorf("step record missing for %s", step.ID)
		}

		status, err := e.runStep(jobCtx, runID, cfg, secrets, job, record, step, stepRecord)
		if err != nil && !step.ContinueOnError {
			jobErr = err
		}

		if status == StatusFailed || status == StatusTimedOut || status == StatusCanceled {
			if !step.ContinueOnError {
				break
			}
		}
	}

	if jobErr != nil {
		if errors.Is(jobCtx.Err(), context.DeadlineExceeded) {
			_ = e.Store.MarkPipelineJobTimedOut(ctx, record.ID, jobCtx.Err().Error())
		} else if errors.Is(jobCtx.Err(), context.Canceled) {
			_ = e.Store.MarkPipelineJobCanceled(ctx, record.ID, jobCtx.Err().Error())
		} else {
			_ = e.Store.MarkPipelineJobFailed(ctx, record.ID, jobErr.Error())
		}
		_ = e.Store.AppendRunEvent(ctx, runID, "job.failed", map[string]any{
			"runId":      runID,
			"jobId":      record.ID,
			"jobKey":     job.ID,
			"status":     StatusFailed,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return jobErr
	}

	_ = e.Store.MarkPipelineJobSuccess(ctx, record.ID)
	_ = e.Store.AppendRunEvent(ctx, runID, "job.completed", map[string]any{
		"runId":      runID,
		"jobId":      record.ID,
		"jobKey":     job.ID,
		"status":     StatusSuccess,
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	})
	return nil
}

func (e *Engine) runStep(
	ctx context.Context,
	runID string,
	cfg PipelineConfig,
	secrets map[string]string,
	job PipelineJob,
	jobRecord store.PipelineJob,
	step PipelineStep,
	stepRecord store.PipelineStep,
) (RunStatus, error) {
	status := StatusRunning
	if err := e.Store.MarkPipelineStepRunning(ctx, stepRecord.ID); err != nil {
		return StatusFailed, err
	}
	_ = e.Store.AppendRunEvent(ctx, runID, "step.started", map[string]any{
		"runId":     runID,
		"jobId":     jobRecord.ID,
		"jobKey":    job.ID,
		"stepId":    stepRecord.ID,
		"stepKey":   step.ID,
		"status":    StatusRunning,
		"startedAt": time.Now().UTC().Format(time.RFC3339),
	})

	env := buildEnv(runID, cfg, secrets, job, step)
	workingDir := step.WorkingDir
	if workingDir == "" {
		workingDir = job.WorkingDir
	}

	logPath, logWriter, err := e.Storage.OpenStepLog(runID, job.ID, step.ID)
	if err != nil {
		_ = e.Store.MarkPipelineStepFailed(ctx, stepRecord.ID, string(StatusFailed), 1, err.Error())
		return StatusFailed, err
	}
	defer logWriter.Close()
	_ = e.Store.UpdatePipelineStepLogPath(ctx, stepRecord.ID, logPath)

	execCtx := ctx
	if step.TimeoutSeconds != nil && *step.TimeoutSeconds > 0 {
		var cancelFn context.CancelFunc
		execCtx, cancelFn = context.WithTimeout(ctx, time.Duration(*step.TimeoutSeconds)*time.Second)
		defer cancelFn()
	}

	// Resolve executor: built-in job types take precedence over step type
	var executor StepExecutor
	switch job.Type {
	case "source_checkout":
		executor = &SourceCheckoutExecutor{
			StudioURL:   job.StudioURL,
			StudioToken: job.StudioToken,
			ProjectID:   job.ProjectID,
			Branch:      job.Branch,
		}
	case "review_gate":
		executor = &ReviewGateExecutor{
			StudioURL:   job.StudioURL,
			StudioToken: job.StudioToken,
			ProjectID:   job.ProjectID,
			MinScore:    job.MinScore,
			GateEnabled: job.MinScore > 0,
		}
	default:
		// For user-defined steps, check step-level type
		if step.Type == "docker" {
			executor = &DockerExecutor{}
		} else {
			executor = e.Executors.Get("shell")
		}
	}

	if executor == nil {
		return StatusFailed, fmt.Errorf("no executor for job type %q", job.Type)
	}

	exitCode, err := executor.Execute(execCtx, step, env, workingDir, logWriter)
	if err != nil {
		if errors.Is(execCtx.Err(), context.DeadlineExceeded) {
			status = StatusTimedOut
		} else if errors.Is(execCtx.Err(), context.Canceled) {
			status = StatusCanceled
		} else {
			status = StatusFailed
		}
		_ = e.Store.MarkPipelineStepFailed(ctx, stepRecord.ID, string(status), exitCode, err.Error())
		_ = e.Store.AppendRunEvent(ctx, runID, "step.failed", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"stepId":     stepRecord.ID,
			"stepKey":    step.ID,
			"status":     status,
			"exitCode":   exitCode,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return status, err
	}

	_ = e.Store.MarkPipelineStepSuccess(ctx, stepRecord.ID, exitCode)
	_ = e.Store.AppendRunEvent(ctx, runID, "step.completed", map[string]any{
		"runId":      runID,
		"jobId":      jobRecord.ID,
		"jobKey":     job.ID,
		"stepId":     stepRecord.ID,
		"stepKey":    step.ID,
		"status":     StatusSuccess,
		"exitCode":   exitCode,
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	})
	return StatusSuccess, nil
}

func (e *Engine) cancelPendingJobs(ctx context.Context, runID string, jobIndex map[string]PipelineJob, jobMap map[string]store.PipelineJob) error {
	for jobID, job := range jobIndex {
		record, ok := jobMap[jobID]
		if !ok {
			continue
		}
		if record.Status != string(StatusQueued) {
			continue
		}
		_ = e.Store.MarkPipelineJobCanceled(ctx, record.ID, "canceled_by_dependency")
		for _, step := range job.Steps {
			stepRecord, err := e.Store.GetPipelineStepByKey(ctx, record.ID, step.ID)
			if err != nil {
				continue
			}
			if stepRecord.Status != string(StatusQueued) {
				continue
			}
			_ = e.Store.MarkPipelineStepCanceled(ctx, stepRecord.ID, "canceled_by_dependency")
		}
	}
	_ = e.Store.AppendRunEvent(ctx, runID, "run.canceled", map[string]any{
		"runId":     runID,
		"status":    StatusCanceled,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	return nil
}

func buildEnv(runID string, cfg PipelineConfig, secrets map[string]string, job PipelineJob, step PipelineStep) map[string]string {
	env := map[string]string{}
	for k, v := range cfg.Variables {
		env[k] = v
	}
	for k, v := range job.Env {
		env[k] = v
	}
	for k, v := range step.Env {
		env[k] = v
	}
	// Secrets override variables and inline env to discourage plain-text secret values in config.
	for k, v := range secrets {
		env[k] = v
	}
	env["PIPELINE_RUN_ID"] = runID
	env["PIPELINE_JOB_ID"] = job.ID
	env["PIPELINE_STEP_ID"] = step.ID
	return env
}

// collectArtifacts is kept for possible future shell-step artifact support.
func (e *Engine) collectArtifacts(
	ctx context.Context,
	runID string,
	job PipelineJob,
	jobRecord store.PipelineJob,
	step PipelineStep,
	stepRecord store.PipelineStep,
	workingDir string,
) error {
	// No artifacts field in current step schema; reserved for future use.
	_ = runID
	_ = job
	_ = jobRecord
	_ = step
	_ = stepRecord
	_ = workingDir
	_ = log.Writer()
	_ = os.Stderr
	_ = filepath.Join
	return nil
}
