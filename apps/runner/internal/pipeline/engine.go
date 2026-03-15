package pipeline

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"spec-axis/runner/internal/store"
)

type Engine struct {
	Store       *store.Store
	Executors   *ExecutorRegistry
	Storage     *LocalStorage
	Concurrency int
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

	jobIndex := map[string]PipelineJob{}
	for _, job := range cfg.Jobs {
		jobIndex[job.ID] = job
	}

	jobRecords, err := e.Store.ListPipelineJobs(ctx, runID)
	if err != nil {
		return err
	}
	if len(jobRecords) == 0 {
		if err := EnsureRunGraph(ctx, e.Store, runID, cfg); err != nil {
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
		"runId":    runID,
		"pipelineId": run.PipelineID,
		"versionId":  run.VersionID,
		"status":  StatusRunning,
		"startedAt": time.Now().UTC().Format(time.RFC3339),
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
	for _, job := range cfg.Jobs {
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

	total := len(cfg.Jobs)
	inFlight := 0
	completed := 0
	failed := false

	startJob := func(jobID string) {
		inFlight++
		go func(id string) {
			err := e.runJob(ctx, runID, cfg, jobIndex[id], jobMap[id])
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
			"runId": runID,
			"status": StatusFailed,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return fmt.Errorf("pipeline run failed")
	}

	if completed < total {
		_ = e.Store.MarkPipelineRunFailed(ctx, runID, "dependency_deadlock")
		_ = e.Store.AppendRunEvent(ctx, runID, "run.failed", map[string]any{
			"runId": runID,
			"status": StatusFailed,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return fmt.Errorf("pipeline run stalled")
	}

	_ = e.Store.MarkPipelineRunSuccess(ctx, runID)
	_ = e.Store.AppendRunEvent(ctx, runID, "run.completed", map[string]any{
		"runId": runID,
		"status": StatusSuccess,
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	})

	return nil
}

func (e *Engine) runJob(ctx context.Context, runID string, cfg PipelineConfig, job PipelineJob, record store.PipelineJob) error {
	if record.ID == "" {
		return fmt.Errorf("job record missing for %s", job.ID)
	}

	if err := e.Store.MarkPipelineJobRunning(ctx, record.ID); err != nil {
		return err
	}
	_ = e.Store.AppendRunEvent(ctx, runID, "job.started", map[string]any{
		"runId": runID,
		"jobId": record.ID,
		"jobKey": job.ID,
		"name": job.Name,
		"status": StatusRunning,
		"startedAt": time.Now().UTC().Format(time.RFC3339),
	})

	jobCtx := ctx
	if job.TimeoutSeconds != nil && *job.TimeoutSeconds > 0 {
		var cancel context.CancelFunc
		jobCtx, cancel = context.WithTimeout(ctx, time.Duration(*job.TimeoutSeconds)*time.Second)
		defer cancel()
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

		status, err := e.runStep(jobCtx, runID, cfg, job, record, step, stepRecord)
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
			"runId": runID,
			"jobId": record.ID,
			"jobKey": job.ID,
			"status": StatusFailed,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return jobErr
	}

	_ = e.Store.MarkPipelineJobSuccess(ctx, record.ID)
	_ = e.Store.AppendRunEvent(ctx, runID, "job.completed", map[string]any{
		"runId": runID,
		"jobId": record.ID,
		"jobKey": job.ID,
		"status": StatusSuccess,
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	})
	return nil
}

func (e *Engine) runStep(
	ctx context.Context,
	runID string,
	cfg PipelineConfig,
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
		"runId": runID,
		"jobId": jobRecord.ID,
		"jobKey": job.ID,
		"stepId": stepRecord.ID,
		"stepKey": step.ID,
		"status": StatusRunning,
		"startedAt": time.Now().UTC().Format(time.RFC3339),
	})

	env := buildEnv(runID, cfg, job, step)
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
		var cancel context.CancelFunc
		execCtx, cancel = context.WithTimeout(ctx, time.Duration(*step.TimeoutSeconds)*time.Second)
		defer cancel()
	}

	executor := e.Executors.Get(step.Type)
	if executor == nil {
		return StatusFailed, fmt.Errorf("no executor registered for %s", step.Type)
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
		_ = e.Store.MarkPipelineStepFailed(ctx, stepRecord.ID, status, exitCode, err.Error())
		_ = e.Store.AppendRunEvent(ctx, runID, "step.failed", map[string]any{
			"runId": runID,
			"jobId": jobRecord.ID,
			"jobKey": job.ID,
			"stepId": stepRecord.ID,
			"stepKey": step.ID,
			"status": status,
			"exitCode": exitCode,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return status, err
	}

	if len(step.Artifacts) > 0 && workingDir != "" {
		if err := e.collectArtifacts(ctx, runID, job, jobRecord, step, stepRecord, workingDir); err != nil {
			log.Printf("artifact collection failed: %v", err)
		}
	}

	_ = e.Store.MarkPipelineStepSuccess(ctx, stepRecord.ID, exitCode)
	_ = e.Store.AppendRunEvent(ctx, runID, "step.completed", map[string]any{
		"runId": runID,
		"jobId": jobRecord.ID,
		"jobKey": job.ID,
		"stepId": stepRecord.ID,
		"stepKey": step.ID,
		"status": StatusSuccess,
		"exitCode": exitCode,
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	})
	return StatusSuccess, nil
}

func (e *Engine) collectArtifacts(
	ctx context.Context,
	runID string,
	job PipelineJob,
	jobRecord store.PipelineJob,
	step PipelineStep,
	stepRecord store.PipelineStep,
	workingDir string,
) error {
	for _, artifact := range step.Artifacts {
		path := artifact
		if !filepath.IsAbs(path) {
			path = filepath.Join(workingDir, artifact)
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			continue
		}
		storagePath, size, sha, err := e.Storage.SaveArtifact(runID, job.ID, step.ID, path, artifact)
		if err != nil {
			continue
		}
		_ = e.Store.InsertPipelineArtifact(ctx, store.PipelineArtifact{
			RunID:       runID,
			JobID:       jobRecord.ID,
			StepID:      stepRecord.ID,
			Path:        artifact,
			StoragePath: storagePath,
			SizeBytes:   size,
			Sha256:      sha,
		})
	}
	return nil
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
		"runId": runID,
		"status": StatusCanceled,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	return nil
}

func buildEnv(runID string, cfg PipelineConfig, job PipelineJob, step PipelineStep) map[string]string {
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
	env["PIPELINE_RUN_ID"] = runID
	env["PIPELINE_JOB_ID"] = job.ID
	env["PIPELINE_STEP_ID"] = step.ID
	return env
}
