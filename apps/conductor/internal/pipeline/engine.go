package pipeline

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"spec-axis/conductor/internal/artifacts"
	conductorcrypto "spec-axis/conductor/internal/crypto"
	"spec-axis/conductor/internal/store"
	"spec-axis/conductor/internal/workerhub"
	"spec-axis/conductor/pkg/workerprotocol"
)

type Engine struct {
	Store                 *store.Store
	Executors             *ExecutorRegistry
	Storage               *LocalStorage
	Artifacts             *artifacts.Manager
	Concurrency           int
	ArtifactRetentionDays int
	// Studio integration for source_checkout and review_gate
	StudioURL   string
	StudioToken string
	WorkerHub   *workerhub.Hub
}

func (e *Engine) postStudioEvent(ctx context.Context, typ string, payload map[string]any) {
	if strings.TrimSpace(e.StudioURL) == "" || strings.TrimSpace(e.StudioToken) == "" {
		return
	}
	url := strings.TrimRight(e.StudioURL, "/") + "/api/conductor/events"
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
	req.Header.Set("X-Conductor-Token", e.StudioToken)

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
	if e.WorkerHub != nil {
		defer e.WorkerHub.ReleaseRun(runID)
	}

	run, version, err := e.Store.GetPipelineRunWithVersion(ctx, runID)
	if err != nil {
		return err
	}
	if run.Status == string(StatusCanceled) ||
		run.Status == string(StatusSuccess) ||
		run.Status == string(StatusFailed) ||
		run.Status == string(StatusTimedOut) ||
		run.Status == string(StatusSkipped) {
		return nil
	}

	var cfg PipelineConfig
	if err := version.DecodeConfig(&cfg); err != nil {
		return err
	}
	if err := ValidateConfig(cfg); err != nil {
		return err
	}
	control, err := decodeRunControlMetadata(run.Metadata)
	if err != nil {
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
		plain, err := conductorcrypto.DecryptSecret(row.ValueEncrypted)
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

	workspaceRoot := ""
	cleanupWorkspace := true
	defer func() {
		if cleanupWorkspace && e.Storage != nil {
			_ = e.Storage.DeleteRunWorkspaces([]string{runID})
		}
	}()
	if e.Storage != nil {
		workspaceRoot = e.Storage.RunWorkspaceRoot(runID)
		if workspaceRoot != "" {
			if err := os.MkdirAll(workspaceRoot, 0o755); err != nil {
				return err
			}
		}
	}

	// Cancellation watcher: if an external request marks this run as canceled in DB,
	// cancel the execution context so running steps can exit.
	stopWatch := make(chan struct{})
	defer close(stopWatch)
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopWatch:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				checkCtx, checkCancel := context.WithTimeout(context.Background(), 2*time.Second)
				canceled, err := e.Store.IsPipelineRunCanceled(checkCtx, runID)
				checkCancel()
				if err == nil && canceled {
					cancel()
					return
				}
			}
		}
	}()

	type jobResult struct {
		jobKey string
		err    error
	}

	jobDone := make(chan jobResult)
	var mu sync.Mutex
	remaining := map[string]int{}
	dependents := map[string][]string{}
	completedJobs := map[string]bool{}
	for _, record := range jobRecords {
		if record.Status == string(StatusSuccess) || record.Status == string(StatusSkipped) {
			completedJobs[record.JobKey] = true
		}
	}
	for _, job := range plan.Jobs {
		if completedJobs[job.ID] {
			continue
		}
		unmetDependencies := 0
		for _, dep := range job.Needs {
			if completedJobs[dep] {
				continue
			}
			unmetDependencies++
			dependents[dep] = append(dependents[dep], job.ID)
		}
		remaining[job.ID] = unmetDependencies
	}

	ready := make([]string, 0)
	for jobID, count := range remaining {
		if count == 0 {
			ready = append(ready, jobID)
		}
	}

	total := len(plan.Jobs)
	inFlight := 0
	completed := len(completedJobs)
	failed := false
	canceled := false

	startJob := func(jobID string) {
		inFlight++
		go func(id string) {
			err := e.runJob(ctx, run, runID, workspaceRoot, cfg, secrets, jobIndex[id], jobMap[id])
			jobDone <- jobResult{jobKey: id, err: err}
		}(jobID)
	}

	if completed == total {
		_ = e.Store.MarkPipelineRunSuccess(ctx, runID)
		return nil
	}

	for completed < total {
		waitingJobs := make([]string, 0)
		nextReady := make([]string, 0, len(ready))
		slots := concurrency - inFlight

		for _, jobID := range ready {
			blocked, waitErr := e.blockManualJobIfNeeded(ctx, runID, control, cfg.Stages, jobIndex, jobMap, jobID)
			if waitErr != nil {
				return waitErr
			}
			if blocked {
				waitingJobs = append(waitingJobs, jobID)
				nextReady = append(nextReady, jobID)
				continue
			}

			if failed || slots <= 0 {
				nextReady = append(nextReady, jobID)
				continue
			}

			startJob(jobID)
			slots--
		}
		ready = nextReady

		if !failed && len(waitingJobs) > 0 && inFlight == 0 {
			metadataRaw, metaErr := encodeRunControlMetadata(run.Metadata, control)
			if metaErr != nil {
				return metaErr
			}
			message := "Waiting for manual node trigger"
			if err := e.Store.MarkPipelineRunWaitingManual(ctx, runID, message, metadataRaw); err != nil {
				return err
			}
			_ = e.Store.AppendRunEvent(ctx, runID, "run.waiting_manual", map[string]any{
				"runId":     runID,
				"status":    StatusWaitingManual,
				"jobKeys":   waitingJobs,
				"timestamp": time.Now().UTC().Format(time.RFC3339),
			})
			cleanupWorkspace = false
			return nil
		}

		if inFlight == 0 && (failed || len(ready) == 0) {
			break
		}

		result := <-jobDone
		inFlight--
		completed++

		if result.err != nil && !failed {
			checkCtx, checkCancel := context.WithTimeout(context.Background(), 2*time.Second)
			canceledInDB, checkErr := e.Store.IsPipelineRunCanceled(checkCtx, runID)
			checkCancel()
			if checkErr == nil && canceledInDB {
				canceled = true
				cancel()
				_ = e.cancelPendingJobs(ctx, runID, jobIndex, jobMap)
				break
			}
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

	if canceled {
		// Ensure run is marked canceled (idempotent if already canceled by API).
		_ = e.Store.MarkPipelineRunCanceled(context.Background(), runID, "canceled")
		return nil
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

	// If a cancellation request raced with completion, treat it as canceled.
	checkCtx, checkCancel := context.WithTimeout(context.Background(), 2*time.Second)
	canceledInDB, checkErr := e.Store.IsPipelineRunCanceled(checkCtx, runID)
	checkCancel()
	if checkErr == nil && canceledInDB {
		_ = e.Store.MarkPipelineRunCanceled(context.Background(), runID, "canceled")
		return nil
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

type runControlMetadata struct {
	ApprovedJobs []string `json:"approvedJobs,omitempty"`
}

func decodeRunControlMetadata(raw []byte) (runControlMetadata, error) {
	if len(raw) == 0 {
		return runControlMetadata{}, nil
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return runControlMetadata{}, nil
	}
	value, ok := payload["_conductor"]
	if !ok || len(value) == 0 {
		return runControlMetadata{}, nil
	}
	var control runControlMetadata
	if err := json.Unmarshal(value, &control); err != nil {
		return runControlMetadata{}, err
	}
	return control, nil
}

func encodeRunControlMetadata(raw []byte, control runControlMetadata) ([]byte, error) {
	payload := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			payload = map[string]any{}
		}
	}
	payload["_conductor"] = control
	return json.Marshal(payload)
}

func appendUniqueValue(values []string, value string) []string {
	for _, item := range values {
		if item == value {
			return values
		}
	}
	return append(values, value)
}

func (e *Engine) blockManualJobIfNeeded(
	ctx context.Context,
	runID string,
	control runControlMetadata,
	settings PipelineStageSettings,
	jobIndex map[string]PipelineJob,
	jobMap map[string]store.PipelineJob,
	jobID string,
) (bool, error) {
	job, ok := jobIndex[jobID]
	if !ok {
		return false, nil
	}
	stage := normalizeStageKey(job.Stage, job)
	if getStageConfig(settings, stage).EntryMode != "manual" {
		return false, nil
	}

	for _, approvedJob := range control.ApprovedJobs {
		if approvedJob == jobID {
			return false, nil
		}
	}

	record, ok := jobMap[jobID]
	if !ok {
		return false, fmt.Errorf("job record missing for %s", jobID)
	}
	if record.Status == string(StatusWaitingManual) {
		return true, nil
	}
	if record.Status != string(StatusQueued) {
		return false, nil
	}

	if err := e.Store.MarkPipelineJobWaitingManual(ctx, record.ID); err != nil {
		return false, err
	}
	_ = e.Store.AppendRunEvent(ctx, runID, "job.waiting_manual", map[string]any{
		"runId":     runID,
		"jobId":     record.ID,
		"jobKey":    jobID,
		"stage":     stage,
		"status":    StatusWaitingManual,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	record.Status = string(StatusWaitingManual)
	jobMap[jobID] = record
	return true, nil
}

func (e *Engine) runJob(
	ctx context.Context,
	run *store.PipelineRun,
	runID string,
	workspaceRoot string,
	cfg PipelineConfig,
	secrets map[string]string,
	job PipelineJob,
	record store.PipelineJob,
) error {
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

	target := jobExecutionTarget(job)
	if target != "deploy" {
		return e.runJobLocally(ctx, run, runID, workspaceRoot, cfg, secrets, job, record)
	}
	if e.WorkerHub == nil || !e.WorkerHub.HasWorkers() {
		err := fmt.Errorf("no deploy worker node available for pipeline execution")
		_ = e.Store.MarkPipelineJobFailed(ctx, record.ID, err.Error())
		return err
	}
	return e.runJobOnWorker(ctx, runID, cfg, secrets, job, record, target)
}

func (e *Engine) runJobOnWorker(
	ctx context.Context,
	runID string,
	cfg PipelineConfig,
	secrets map[string]string,
	job PipelineJob,
	jobRecord store.PipelineJob,
	executionTarget string,
) error {
	if e.WorkerHub == nil {
		return errors.New("worker hub is not configured")
	}

	steps := make([]workerprotocol.ExecuteStep, 0, len(job.Steps))
	stepRecords := map[string]store.PipelineStep{}
	runRecord, err := e.Store.GetPipelineRun(ctx, runID)
	if err != nil {
		return err
	}
	for _, step := range job.Steps {
		stepRecord, err := e.Store.GetPipelineStepByKey(ctx, jobRecord.ID, step.ID)
		if err != nil {
			return err
		}
		if stepRecord.ID == "" {
			return fmt.Errorf("step record missing for %s", step.ID)
		}
		stepRecords[step.ID] = stepRecord
		stepEnv := buildEnv(runID, cfg, secrets, job, step)
		registryFiles := []workerprotocol.RegistryArtifactFile{}
		registryVersion := strings.TrimSpace(step.RegistryVersion)
		registryChannel := strings.TrimSpace(step.RegistryChannel)
		if strings.EqualFold(strings.TrimSpace(step.ArtifactSource), "registry") {
			resolvedVersion, files, resolveErr := e.resolveRegistryDeployment(ctx, runRecord, jobRecord, cfg, step)
			if resolveErr != nil {
				return resolveErr
			}
			registryVersion = resolvedVersion.Version
			registryChannel = resolvedVersion.ChannelName
			registryFiles = files
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
		}
		steps = append(steps, workerprotocol.ExecuteStep{
			ID:                 step.ID,
			Name:               step.Name,
			Script:             step.Script,
			Type:               step.Type,
			DockerImage:        step.DockerImage,
			ArtifactPaths:      append([]string(nil), step.ArtifactPaths...),
			ArtifactInputs:     append([]string(nil), step.ArtifactInputs...),
			ArtifactSource:     step.ArtifactSource,
			RegistryRepository: step.RegistryRepository,
			RegistryVersion:    registryVersion,
			RegistryChannel:    registryChannel,
			RegistryFiles:      registryFiles,
			Env:                stepEnv,
			WorkingDir:         step.WorkingDir,
			TimeoutSeconds:     step.TimeoutSeconds,
			ContinueOnError:    step.ContinueOnError,
		})
	}

	logWriters := map[string]io.WriteCloser{}
	var logsMu sync.Mutex
	closeLog := func(stepID string) {
		logsMu.Lock()
		defer logsMu.Unlock()
		writer, ok := logWriters[stepID]
		if !ok {
			return
		}
		_ = writer.Close()
		delete(logWriters, stepID)
	}
	defer func() {
		logsMu.Lock()
		defer logsMu.Unlock()
		for stepID, writer := range logWriters {
			_ = writer.Close()
			delete(logWriters, stepID)
		}
	}()

	var (
		result      workerhub.DispatchResult
		dispatchErr error
		stepStarted atomic.Bool
	)

	callbacks := workerhub.DispatchCallbacks{
		OnAssigned: func(workerID string) {
			_ = e.Store.AssignPipelineJobWorker(ctx, jobRecord.ID, workerID)
			_ = e.Store.AppendRunEvent(ctx, runID, "job.assigned", map[string]any{
				"runId":     runID,
				"jobId":     jobRecord.ID,
				"jobKey":    job.ID,
				"workerId":  workerID,
				"timestamp": time.Now().UTC().Format(time.RFC3339),
			})
		},
		OnStepStarted: func(stepID string) {
			stepStarted.Store(true)
			stepRecord, ok := stepRecords[stepID]
			if !ok {
				return
			}
			_ = e.Store.MarkPipelineStepRunning(ctx, stepRecord.ID)
			logPath, writer, err := e.Storage.OpenStepLog(runID, job.ID, stepID)
			if err == nil {
				_ = e.Store.UpdatePipelineStepLogPath(ctx, stepRecord.ID, logPath)
				logsMu.Lock()
				logWriters[stepID] = writer
				logsMu.Unlock()
			}
			_ = e.Store.AppendRunEvent(ctx, runID, "step.started", map[string]any{
				"runId":     runID,
				"jobId":     jobRecord.ID,
				"jobKey":    job.ID,
				"stepId":    stepRecord.ID,
				"stepKey":   stepID,
				"status":    StatusRunning,
				"startedAt": time.Now().UTC().Format(time.RFC3339),
			})
		},
		OnStepLog: func(stepID string, chunk string) {
			logsMu.Lock()
			writer := logWriters[stepID]
			logsMu.Unlock()
			if writer == nil {
				return
			}
			_, _ = writer.Write([]byte(chunk))
		},
		OnStepArtifact: func(message workerprotocol.StepArtifactMessage) {
			stepRecord, ok := stepRecords[message.StepID]
			if !ok {
				return
			}
			eventType := "step.artifact.pull_observed"
			switch strings.ToLower(strings.TrimSpace(message.Status)) {
			case "started":
				eventType = "step.artifact.pull_started"
			case "downloaded":
				eventType = "step.artifact.pulled"
			case "failed":
				eventType = "step.artifact.pull_failed"
			}
			_ = e.Store.AppendRunEvent(ctx, runID, eventType, map[string]any{
				"runId":         runID,
				"jobId":         jobRecord.ID,
				"jobKey":        job.ID,
				"stepId":        stepRecord.ID,
				"stepKey":       message.StepID,
				"status":        message.Status,
				"path":          message.Path,
				"artifactId":    message.ArtifactID,
				"attempt":       message.Attempt,
				"durationMs":    message.DurationMs,
				"sizeBytes":     message.SizeBytes,
				"errorCategory": message.ErrorCategory,
				"error":         message.ErrorMessage,
				"timestamp":     time.Now().UTC().Format(time.RFC3339),
			})
		},
		OnStepFinished: func(stepID string, status string, exitCode int, errorMessage string) {
			stepRecord, ok := stepRecords[stepID]
			if !ok {
				return
			}
			closeLog(stepID)

			switch status {
			case string(StatusSuccess):
				_ = e.Store.MarkPipelineStepSuccess(ctx, stepRecord.ID, exitCode)
				_ = e.Store.AppendRunEvent(ctx, runID, "step.completed", map[string]any{
					"runId":      runID,
					"jobId":      jobRecord.ID,
					"jobKey":     job.ID,
					"stepId":     stepRecord.ID,
					"stepKey":    stepID,
					"status":     StatusSuccess,
					"exitCode":   exitCode,
					"finishedAt": time.Now().UTC().Format(time.RFC3339),
				})
			case string(StatusCanceled):
				_ = e.Store.MarkPipelineStepCanceled(ctx, stepRecord.ID, errorMessage)
				_ = e.Store.AppendRunEvent(ctx, runID, "step.failed", map[string]any{
					"runId":      runID,
					"jobId":      jobRecord.ID,
					"jobKey":     job.ID,
					"stepId":     stepRecord.ID,
					"stepKey":    stepID,
					"status":     StatusCanceled,
					"exitCode":   exitCode,
					"finishedAt": time.Now().UTC().Format(time.RFC3339),
					"error":      errorMessage,
				})
			case string(StatusTimedOut):
				_ = e.Store.MarkPipelineStepFailed(ctx, stepRecord.ID, string(StatusTimedOut), exitCode, errorMessage)
				_ = e.Store.AppendRunEvent(ctx, runID, "step.failed", map[string]any{
					"runId":      runID,
					"jobId":      jobRecord.ID,
					"jobKey":     job.ID,
					"stepId":     stepRecord.ID,
					"stepKey":    stepID,
					"status":     StatusTimedOut,
					"exitCode":   exitCode,
					"finishedAt": time.Now().UTC().Format(time.RFC3339),
					"error":      errorMessage,
				})
			default:
				_ = e.Store.MarkPipelineStepFailed(ctx, stepRecord.ID, string(StatusFailed), exitCode, errorMessage)
				_ = e.Store.AppendRunEvent(ctx, runID, "step.failed", map[string]any{
					"runId":      runID,
					"jobId":      jobRecord.ID,
					"jobKey":     job.ID,
					"stepId":     stepRecord.ID,
					"stepKey":    stepID,
					"status":     StatusFailed,
					"exitCode":   exitCode,
					"finishedAt": time.Now().UTC().Format(time.RFC3339),
					"error":      errorMessage,
				})
			}
		},
	}

	dispatchRequest := workerhub.DispatchRequest{
		RunID:              runID,
		JobID:              jobRecord.ID,
		JobKey:             job.ID,
		JobType:            job.Type,
		ExecutionTarget:    executionTarget,
		Environment:        cfg.Environment,
		ProjectID:          job.ProjectID,
		Branch:             job.Branch,
		MinScore:           job.MinScore,
		StudioURL:          job.StudioURL,
		StudioToken:        job.StudioToken,
		WorkspaceRoot:      "",
		JobWorkingDir:      job.WorkingDir,
		Steps:              steps,
		RequiredCapability: requiredCapabilities(job, steps),
	}

	maxDispatchAttempts := 2
	for attempt := 1; attempt <= maxDispatchAttempts; attempt++ {
		stepStarted.Store(false)
		result, dispatchErr = e.WorkerHub.DispatchJob(ctx, dispatchRequest, callbacks)
		if dispatchErr == nil {
			break
		}
		if stepStarted.Load() || attempt == maxDispatchAttempts {
			break
		}
		_ = e.Store.AppendRunEvent(ctx, runID, "job.reassigning", map[string]any{
			"runId":        runID,
			"jobId":        jobRecord.ID,
			"jobKey":       job.ID,
			"attempt":      attempt + 1,
			"reason":       dispatchErr.Error(),
			"reassignedAt": time.Now().UTC().Format(time.RFC3339),
		})
	}

	if dispatchErr != nil {
		_ = e.Store.MarkPipelineJobFailed(ctx, jobRecord.ID, dispatchErr.Error())
		_ = e.Store.AppendRunEvent(ctx, runID, "job.failed", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"status":     StatusFailed,
			"error":      dispatchErr.Error(),
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return dispatchErr
	}

	if !strings.EqualFold(result.Status, string(StatusSuccess)) {
		message := result.ErrorMessage
		if message == "" {
			message = "worker returned non-success status"
		}
		_ = e.Store.MarkPipelineJobFailed(ctx, jobRecord.ID, message)
		_ = e.Store.AppendRunEvent(ctx, runID, "job.failed", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"status":     StatusFailed,
			"error":      message,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return errors.New(message)
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

func (e *Engine) runStep(
	ctx context.Context,
	sandbox *jobSandbox,
	run *store.PipelineRun,
	runID string,
	workspaceRoot string,
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
	workingDir := resolvePipelineWorkingDir(workspaceRoot, job.WorkingDir, step.WorkingDir)
	if err := os.MkdirAll(workingDir, 0o755); err != nil {
		_ = e.Store.MarkPipelineStepFailed(ctx, stepRecord.ID, string(StatusFailed), 1, err.Error())
		return StatusFailed, err
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

	if err := e.prepareLocalStepArtifacts(ctx, run, runID, cfg, job, jobRecord, step, stepRecord, workingDir, logWriter); err != nil {
		_ = e.Store.MarkPipelineStepFailed(ctx, stepRecord.ID, string(StatusFailed), 1, err.Error())
		_ = e.Store.AppendRunEvent(ctx, runID, "step.failed", map[string]any{
			"runId":      runID,
			"jobId":      jobRecord.ID,
			"jobKey":     job.ID,
			"stepId":     stepRecord.ID,
			"stepKey":    step.ID,
			"status":     StatusFailed,
			"exitCode":   1,
			"finishedAt": time.Now().UTC().Format(time.RFC3339),
			"error":      err.Error(),
		})
		return StatusFailed, err
	}

	exitCode, err := e.executeLocalStep(execCtx, sandbox, step, env, workingDir, job, logWriter)
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

	if len(step.ArtifactPaths) > 0 {
		if err := e.uploadLocalStepArtifacts(ctx, run, runID, job, jobRecord, step, stepRecord, workingDir); err != nil {
			_ = e.Store.MarkPipelineStepFailed(ctx, stepRecord.ID, string(StatusFailed), 1, err.Error())
			_ = e.Store.AppendRunEvent(ctx, runID, "step.failed", map[string]any{
				"runId":      runID,
				"jobId":      jobRecord.ID,
				"jobKey":     job.ID,
				"stepId":     stepRecord.ID,
				"stepKey":    step.ID,
				"status":     StatusFailed,
				"exitCode":   1,
				"finishedAt": time.Now().UTC().Format(time.RFC3339),
				"error":      err.Error(),
			})
			return StatusFailed, err
		}
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
	if strings.TrimSpace(cfg.Environment) != "" {
		env["PIPELINE_ENVIRONMENT"] = strings.TrimSpace(cfg.Environment)
	}
	return env
}

func requiredCapabilities(job PipelineJob, steps []workerprotocol.ExecuteStep) []string {
	seen := map[string]bool{}
	capabilities := []string{}
	add := func(value string) {
		value = strings.TrimSpace(strings.ToLower(value))
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		capabilities = append(capabilities, value)
	}

	add("shell")
	target := jobExecutionTarget(job)
	add(target)
	switch strings.TrimSpace(strings.ToLower(job.Type)) {
	case "source_checkout":
		add("source_checkout")
	case "review_gate":
		add("review_gate")
	}
	for _, step := range steps {
		if strings.EqualFold(step.Type, "docker") {
			add("docker")
		}
		if len(step.ArtifactInputs) > 0 {
			add("artifact_download")
		}
		if strings.EqualFold(step.ArtifactSource, "registry") {
			add("artifact_download")
		}
		if target == "build" && len(step.ArtifactPaths) > 0 {
			add("artifact_upload")
		}
	}
	return capabilities
}

func jobExecutionTarget(job PipelineJob) string {
	stage := normalizeStageKey(job.Stage, job)
	if stageOrder(stage) >= stageOrder(StageDeploy) {
		return "deploy"
	}
	return "build"
}

func (e *Engine) resolveRegistryDeployment(
	ctx context.Context,
	run *store.PipelineRun,
	jobRecord store.PipelineJob,
	cfg PipelineConfig,
	step PipelineStep,
) (*store.ArtifactVersion, []workerprotocol.RegistryArtifactFile, error) {
	if run == nil || run.ProjectID == nil || strings.TrimSpace(*run.ProjectID) == "" {
		return nil, nil, errors.New("registry deployment requires a project-scoped pipeline run")
	}

	resolvedVersion, err := e.Store.ResolveArtifactVersionForDeployment(
		ctx,
		*run.ProjectID,
		step.RegistryRepository,
		step.RegistryVersion,
		step.RegistryChannel,
	)
	if err != nil {
		return nil, nil, err
	}
	if resolvedVersion == nil {
		return nil, nil, fmt.Errorf("artifact version not found for repository=%s version=%s channel=%s", step.RegistryRepository, step.RegistryVersion, step.RegistryChannel)
	}

	files, err := e.Store.ListArtifactFilesForVersion(ctx, resolvedVersion.ID)
	if err != nil {
		return nil, nil, err
	}
	if len(files) == 0 {
		return nil, nil, fmt.Errorf("artifact version %s does not contain any files", resolvedVersion.Version)
	}

	downloadFiles := make([]workerprotocol.RegistryArtifactFile, 0, len(files))
	for _, file := range files {
		downloadFiles = append(downloadFiles, workerprotocol.RegistryArtifactFile{
			FileID:      file.ID,
			LogicalPath: file.LogicalPath,
			FileName:    file.FileName,
			SizeBytes:   file.SizeBytes,
			Sha256:      file.Sha256,
		})
	}

	_ = e.Store.InsertArtifactVersionUsage(ctx, store.ArtifactVersionUsage{
		OrgID:         resolvedVersion.OrgID,
		ProjectID:     resolvedVersion.ProjectID,
		RepositoryID:  resolvedVersion.RepositoryID,
		VersionID:     resolvedVersion.ID,
		PipelineRunID: run.ID,
		PipelineJobID: jobRecord.ID,
		Environment:   cfg.Environment,
		ChannelName:   resolvedVersion.ChannelName,
		UsageType:     "deployment",
	})

	return resolvedVersion, downloadFiles, nil
}
