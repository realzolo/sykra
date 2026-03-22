package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"spec-axis/conductor/internal/artifacts"
	"spec-axis/conductor/internal/store"
)

type Service struct {
	Store                 *store.Store
	Storage               *LocalStorage
	Artifacts             *artifacts.Manager
	ArtifactRetentionDays int
}

type CreatePipelineInput struct {
	OrgID       string
	ProjectID   *string
	Name        string
	Description string
	Config      PipelineConfig
	CreatedBy   string
}

type UpdatePipelineInput struct {
	PipelineID  string
	Name        string
	Description string
	Config      PipelineConfig
	UpdatedBy   string
}

type TriggerRunInput struct {
	PipelineID     string
	TriggerType    string
	TriggeredBy    string
	IdempotencyKey string
	Metadata       map[string]any
	RollbackOf     *string
}

type TriggerRunJobInput struct {
	RunID  string
	JobKey string
}

type RetryRunJobInput struct {
	RunID  string
	JobKey string
}

func (s *Service) DeletePipeline(ctx context.Context, pipelineID string) error {
	if strings.TrimSpace(pipelineID) == "" {
		return errors.New("pipelineId is required")
	}
	if s.Store == nil {
		return errors.New("pipeline store is not configured")
	}

	refs, err := s.Store.DeletePipeline(ctx, pipelineID)
	if err != nil {
		return err
	}
	if refs == nil {
		return errors.New("pipeline not found")
	}

	if s.Storage != nil {
		_ = s.Storage.DeleteRunLogs(refs.RunIDs)
	}
	if s.Artifacts != nil {
		for _, artifact := range refs.Artifacts {
			if strings.TrimSpace(artifact.StoragePath) == "" || strings.TrimSpace(artifact.OrgID) == "" {
				continue
			}
			_ = s.Artifacts.DeleteStoredArtifact(ctx, artifact.OrgID, artifact.StoragePath)
		}
	}

	return nil
}

func (s *Service) CreatePipeline(ctx context.Context, input CreatePipelineInput) (*store.Pipeline, *store.PipelineVersion, error) {
	if input.OrgID == "" {
		return nil, nil, errors.New("orgId is required")
	}
	if input.ProjectID != nil && strings.TrimSpace(*input.ProjectID) == "" {
		input.ProjectID = nil
	}
	if input.Name == "" {
		return nil, nil, errors.New("pipeline name is required")
	}
	input.Config.Name = input.Name
	if input.Description != "" {
		input.Config.Description = input.Description
	}
	if err := ValidateConfig(input.Config); err != nil {
		return nil, nil, err
	}

	var createdBy *string
	if input.CreatedBy != "" {
		createdBy = &input.CreatedBy
	}
	pipeline, err := s.Store.CreatePipeline(ctx, store.Pipeline{
		OrgID:       input.OrgID,
		ProjectID:   input.ProjectID,
		Name:        input.Name,
		Description: input.Description,
		CreatedBy:   createdBy,
	})
	if err != nil {
		return nil, nil, err
	}

	configRaw, _ := json.Marshal(input.Config)
	version, err := s.Store.CreatePipelineVersion(ctx, pipeline.ID, 1, configRaw, input.CreatedBy)
	if err != nil {
		return nil, nil, err
	}

	if err := s.Store.SetPipelineCurrentVersion(ctx, pipeline.ID, version.ID); err != nil {
		return nil, nil, err
	}

	if err := s.syncPipelineSchedule(ctx, pipeline.ID, input.Config.Trigger.Schedule); err != nil {
		return nil, nil, err
	}
	if schedule := normalizedSchedulePtr(input.Config.Trigger.Schedule); schedule != nil {
		pipeline.TriggerSchedule = schedule
		if next, nextErr := nextScheduleAt(*schedule, time.Now().UTC()); nextErr == nil {
			pipeline.NextScheduledAt = &next
		}
	}

	return pipeline, version, nil
}

func (s *Service) UpdatePipeline(ctx context.Context, input UpdatePipelineInput) (*store.PipelineVersion, error) {
	if input.PipelineID == "" {
		return nil, errors.New("pipelineId is required")
	}
	current, err := s.Store.GetPipeline(ctx, input.PipelineID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, errors.New("pipeline not found")
	}

	if input.Name == "" {
		input.Name = current.Name
	}
	if input.Description == "" {
		input.Description = current.Description
	}
	if input.Config.Name == "" {
		input.Config.Name = input.Name
	}
	if input.Config.Description == "" && input.Description != "" {
		input.Config.Description = input.Description
	}

	if err := ValidateConfig(input.Config); err != nil {
		return nil, err
	}

	if err := s.Store.UpdatePipelineMetadata(ctx, input.PipelineID, input.Name, input.Description); err != nil {
		return nil, err
	}

	versionNumber := current.LatestVersion + 1
	configRaw, _ := json.Marshal(input.Config)
	version, err := s.Store.CreatePipelineVersion(ctx, input.PipelineID, versionNumber, configRaw, input.UpdatedBy)
	if err != nil {
		return nil, err
	}
	if err := s.Store.SetPipelineCurrentVersion(ctx, input.PipelineID, version.ID); err != nil {
		return nil, err
	}
	if err := s.syncPipelineSchedule(ctx, input.PipelineID, input.Config.Trigger.Schedule); err != nil {
		return nil, err
	}
	return version, nil
}

func (s *Service) TriggerRun(ctx context.Context, input TriggerRunInput) (*store.PipelineRun, error) {
	if input.PipelineID == "" {
		return nil, errors.New("pipelineId is required")
	}

	pipeline, version, err := s.Store.GetPipelineWithCurrentVersion(ctx, input.PipelineID)
	if err != nil {
		return nil, err
	}
	if pipeline == nil || version == nil {
		return nil, errors.New("pipeline not found")
	}

	var cfg PipelineConfig
	if err := version.DecodeConfig(&cfg); err != nil {
		return nil, err
	}
	if err := ValidateConfig(cfg); err != nil {
		return nil, err
	}

	metadataRaw, _ := json.Marshal(input.Metadata)
	var triggeredBy *string
	if input.TriggeredBy != "" {
		triggeredBy = &input.TriggeredBy
	}
	var idempotency *string
	if input.IdempotencyKey != "" {
		idempotency = &input.IdempotencyKey
	}
	projectID := ""
	if pipeline.ProjectID != nil {
		projectID = *pipeline.ProjectID
	}
	run, err := s.Store.CreatePipelineRun(ctx, store.PipelineRun{
		PipelineID:     pipeline.ID,
		VersionID:      version.ID,
		OrgID:          pipeline.OrgID,
		ProjectID:      pipeline.ProjectID,
		Status:         string(StatusQueued),
		TriggerType:    input.TriggerType,
		TriggeredBy:    triggeredBy,
		IdempotencyKey: idempotency,
		RollbackOf:     input.RollbackOf,
		Metadata:       metadataRaw,
	})
	if err != nil {
		return nil, err
	}

	if err := EnsureRunGraph(ctx, s.Store, run.ID, cfg, projectID); err != nil {
		return nil, err
	}

	_ = s.Store.AppendRunEvent(ctx, run.ID, "run.queued", map[string]any{
		"runId":      run.ID,
		"pipelineId": pipeline.ID,
		"versionId":  version.ID,
		"status":     StatusQueued,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})

	return run, nil
}

func (s *Service) syncPipelineSchedule(ctx context.Context, pipelineID string, schedule string) error {
	trimmed := strings.TrimSpace(schedule)
	if trimmed == "" {
		return s.Store.UpdatePipelineSchedule(ctx, pipelineID, nil, nil, nil)
	}

	next, err := nextScheduleAt(trimmed, time.Now().UTC())
	if err != nil {
		return err
	}

	scheduleValue := trimmed
	return s.Store.UpdatePipelineSchedule(ctx, pipelineID, &scheduleValue, &next, nil)
}

func normalizedSchedulePtr(schedule string) *string {
	trimmed := strings.TrimSpace(schedule)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func (s *Service) RunScheduleLoop(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	if err := s.scanScheduledPipelines(ctx); err != nil {
		fmt.Printf("scheduled pipeline scan failed: %v\n", err)
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.scanScheduledPipelines(ctx); err != nil {
				fmt.Printf("scheduled pipeline scan failed: %v\n", err)
			}
		}
	}
}

func (s *Service) scanScheduledPipelines(ctx context.Context) error {
	if s.Store == nil {
		return nil
	}

	due, err := s.Store.ListDueScheduledPipelines(ctx, 50)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	for _, pipeline := range due {
		if pipeline.TriggerSchedule == nil || pipeline.NextScheduledAt == nil {
			continue
		}
		dueAt := *pipeline.NextScheduledAt
		idempotencyKey := fmt.Sprintf("schedule:%s:%s", pipeline.ID, dueAt.UTC().Format(time.RFC3339))
		run, triggerErr := s.TriggerRun(ctx, TriggerRunInput{
			PipelineID:     pipeline.ID,
			TriggerType:    "schedule",
			IdempotencyKey: idempotencyKey,
			Metadata: map[string]any{
				"schedule": map[string]any{
					"expression":  pipeline.TriggerSchedule,
					"scheduledAt": dueAt.UTC().Format(time.RFC3339),
				},
			},
		})
		if triggerErr != nil {
			return fmt.Errorf("trigger scheduled pipeline %s failed: %w", pipeline.ID, triggerErr)
		}

		next, nextErr := nextScheduleAt(*pipeline.TriggerSchedule, now)
		if nextErr != nil {
			return fmt.Errorf("compute next schedule for pipeline %s failed: %w", pipeline.ID, nextErr)
		}
		if err := s.Store.UpdatePipelineSchedule(ctx, pipeline.ID, pipeline.TriggerSchedule, &next, &dueAt); err != nil {
			return err
		}
		_ = run
	}
	return nil
}

func (s *Service) GetPipeline(ctx context.Context, pipelineID string) (*store.Pipeline, *store.PipelineVersion, error) {
	return s.Store.GetPipelineWithCurrentVersion(ctx, pipelineID)
}

func (s *Service) ListPipelines(ctx context.Context, orgID string, projectID string) ([]store.Pipeline, error) {
	var project *string
	if projectID != "" {
		project = &projectID
	}
	return s.Store.ListPipelines(ctx, orgID, project)
}

func (s *Service) ListRuns(ctx context.Context, pipelineID string, limit int) ([]store.PipelineRun, error) {
	return s.Store.ListPipelineRuns(ctx, pipelineID, limit)
}

func (s *Service) GetRunDetail(ctx context.Context, runID string) (*store.PipelineRunDetail, error) {
	return s.Store.GetPipelineRunDetail(ctx, runID)
}

func (s *Service) ListEvents(ctx context.Context, runID string, afterSeq int64, limit int) ([]store.RunEvent, error) {
	return s.Store.ListRunEvents(ctx, runID, afterSeq, limit)
}

func (s *Service) ListRunArtifacts(ctx context.Context, runID string) ([]store.PipelineArtifact, error) {
	if strings.TrimSpace(runID) == "" {
		return nil, errors.New("runId is required")
	}
	return s.Store.ListPipelineArtifactsForRun(ctx, runID)
}

func (s *Service) ReadLog(ctx context.Context, stepID string, offset int64, limit int64) ([]byte, int64, error) {
	step, err := s.Store.GetPipelineStep(ctx, stepID)
	if err != nil {
		return nil, 0, err
	}
	if step == nil {
		return nil, 0, fmt.Errorf("log not found")
	}
	if step.LogPath == nil || *step.LogPath == "" {
		if step.ErrorMessage != nil && strings.TrimSpace(*step.ErrorMessage) != "" {
			synthetic := []byte(fmt.Sprintf("[system] No persisted step log is available.\n[system] %s\n", *step.ErrorMessage))
			if offset >= int64(len(synthetic)) {
				return []byte{}, int64(len(synthetic)), nil
			}
			end := int64(len(synthetic))
			if limit > 0 && offset+limit < end {
				end = offset + limit
			}
			return synthetic[offset:end], end, nil
		}
		return []byte{}, 0, nil
	}
	data, next, err := s.Storage.ReadLog(*step.LogPath, offset, limit)
	if err == nil {
		return data, next, nil
	}
	if step.ErrorMessage != nil && strings.TrimSpace(*step.ErrorMessage) != "" {
		log.Printf("read step log fallback: step=%s log_path=%s err=%v", stepID, *step.LogPath, err)
		synthetic := []byte(fmt.Sprintf("[system] Persisted step log could not be read.\n[system] %s\n", *step.ErrorMessage))
		if offset >= int64(len(synthetic)) {
			return []byte{}, int64(len(synthetic)), nil
		}
		end := int64(len(synthetic))
		if limit > 0 && offset+limit < end {
			end = offset + limit
		}
		return synthetic[offset:end], end, nil
	}
	return nil, 0, err
}

func (s *Service) StreamLog(
	ctx context.Context,
	stepID string,
	offset int64,
	limit int64,
	emit func([]byte) error,
) error {
	if s == nil || s.Store == nil {
		return errors.New("store is required")
	}
	if s.Storage == nil {
		return errors.New("storage is required")
	}
	if strings.TrimSpace(stepID) == "" {
		return errors.New("stepId is required")
	}
	if emit == nil {
		return errors.New("emit callback is required")
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = 200000
	}

	terminalGrace := 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}

		step, err := s.Store.GetPipelineStep(ctx, stepID)
		if err != nil {
			return err
		}
		if step == nil {
			return fmt.Errorf("log not found")
		}

		active := step.Status == string(StatusQueued) ||
			step.Status == string(StatusRunning) ||
			step.Status == string(StatusWaitingManual)

		if step.LogPath == nil || strings.TrimSpace(*step.LogPath) == "" {
			if step.ErrorMessage != nil && strings.TrimSpace(*step.ErrorMessage) != "" {
				synthetic := []byte(fmt.Sprintf("[system] No persisted step log is available.\n[system] %s\n", *step.ErrorMessage))
				if offset < int64(len(synthetic)) {
					if err := emit(synthetic[offset:]); err != nil {
						return err
					}
				}
			}
			if active {
				if err := sleepContext(ctx, time.Second); err != nil {
					return err
				}
				continue
			}
			return nil
		}

		data, next, err := s.Storage.ReadLog(*step.LogPath, offset, limit)
		if err != nil {
			if active {
				if err := sleepContext(ctx, time.Second); err != nil {
					return err
				}
				continue
			}
			if step.ErrorMessage != nil && strings.TrimSpace(*step.ErrorMessage) != "" {
				synthetic := []byte(fmt.Sprintf("[system] Persisted step log could not be read.\n[system] %s\n", *step.ErrorMessage))
				if offset < int64(len(synthetic)) {
					if err := emit(synthetic[offset:]); err != nil {
						return err
					}
				}
				return nil
			}
			return err
		}

		if len(data) > 0 {
			if err := emit(data); err != nil {
				return err
			}
			offset = next
		}

		if active {
			terminalGrace = 0
		} else if len(data) == 0 {
			terminalGrace++
			if terminalGrace >= 2 {
				return nil
			}
		}

		if len(data) >= int(limit) {
			continue
		}

		if err := sleepContext(ctx, time.Second); err != nil {
			return err
		}
	}
}

func (s *Service) CancelRun(ctx context.Context, runID string) error {
	if strings.TrimSpace(runID) == "" {
		return errors.New("runId is required")
	}
	ok, err := s.Store.CancelPipelineRun(ctx, runID, "canceled_by_user")
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("run cannot be canceled")
	}
	_ = s.Store.AppendRunEvent(ctx, runID, "run.canceled", map[string]any{
		"runId":     runID,
		"status":    StatusCanceled,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	return nil
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) TriggerRunJob(ctx context.Context, input TriggerRunJobInput) error {
	if strings.TrimSpace(input.RunID) == "" {
		return errors.New("runId is required")
	}
	if strings.TrimSpace(input.JobKey) == "" {
		return errors.New("jobKey is required")
	}

	run, version, err := s.Store.GetPipelineRunWithVersion(ctx, input.RunID)
	if err != nil {
		return err
	}
	if run == nil || version == nil {
		return errors.New("run not found")
	}

	control, err := decodeRunControlMetadata(run.Metadata)
	if err != nil {
		return err
	}
	control.ApprovedJobs = appendUniqueValue(control.ApprovedJobs, input.JobKey)

	metadataRaw, err := encodeRunControlMetadata(run.Metadata, control)
	if err != nil {
		return err
	}
	job, ok, err := s.Store.TriggerPipelineJob(ctx, input.RunID, input.JobKey, metadataRaw)
	if err != nil {
		return err
	}
	if !ok || job == nil {
		return errors.New("job cannot be triggered")
	}

	_ = s.Store.AppendRunEvent(ctx, input.RunID, "job.manual_triggered", map[string]any{
		"runId":     input.RunID,
		"jobId":     job.ID,
		"jobKey":    job.JobKey,
		"status":    StatusQueued,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})

	return nil
}

func (s *Service) RetryRunJob(ctx context.Context, input RetryRunJobInput) error {
	if strings.TrimSpace(input.RunID) == "" {
		return errors.New("runId is required")
	}
	if strings.TrimSpace(input.JobKey) == "" {
		return errors.New("jobKey is required")
	}

	run, version, err := s.Store.GetPipelineRunWithVersion(ctx, input.RunID)
	if err != nil {
		return err
	}
	if run == nil || version == nil {
		return errors.New("run not found")
	}

	var cfg PipelineConfig
	if err := version.DecodeConfig(&cfg); err != nil {
		return err
	}
	if err := ValidateConfig(cfg); err != nil {
		return err
	}

	projectID := ""
	if run.ProjectID != nil {
		projectID = *run.ProjectID
	}
	plan := BuildInternalPlan(cfg, projectID)
	jobIndex := make(map[string]PipelineJob, len(plan.Jobs))
	for _, job := range plan.Jobs {
		jobIndex[job.ID] = job
	}
	if _, ok := jobIndex[input.JobKey]; !ok {
		return fmt.Errorf("job %s not found in pipeline plan", input.JobKey)
	}

	dependents := map[string][]string{}
	for _, job := range plan.Jobs {
		for _, need := range job.Needs {
			dependents[need] = append(dependents[need], job.ID)
		}
	}
	affectedSet := map[string]bool{input.JobKey: true}
	queue := []string{input.JobKey}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, dependent := range dependents[current] {
			if affectedSet[dependent] {
				continue
			}
			affectedSet[dependent] = true
			queue = append(queue, dependent)
		}
	}
	affectedJobKeys := make([]string, 0, len(affectedSet))
	for _, job := range plan.Jobs {
		if affectedSet[job.ID] {
			affectedJobKeys = append(affectedJobKeys, job.ID)
		}
	}

	reset, err := s.Store.RetryPipelineJobTree(ctx, input.RunID, input.JobKey, affectedJobKeys)
	if err != nil {
		return err
	}

	if s.Storage != nil && reset != nil && len(reset.LogPaths) > 0 {
		_ = s.Storage.DeleteLogPaths(reset.LogPaths)
	}
	if s.Artifacts != nil && reset != nil {
		for _, artifact := range reset.Artifacts {
			if strings.TrimSpace(artifact.OrgID) == "" || strings.TrimSpace(artifact.StoragePath) == "" {
				continue
			}
			_ = s.Artifacts.DeleteStoredArtifact(ctx, artifact.OrgID, artifact.StoragePath)
		}
	}

	_ = s.Store.AppendRunEvent(ctx, input.RunID, "run.retried", map[string]any{
		"runId":           input.RunID,
		"targetJobKey":    input.JobKey,
		"affectedJobKeys": affectedJobKeys,
		"status":          StatusQueued,
		"retriedAt":       time.Now().UTC().Format(time.RFC3339),
	})

	return nil
}

type UploadWorkerArtifactInput struct {
	RunID         string
	JobID         string
	StepKey       string
	Path          string
	Content       io.Reader
	ContentLength int64
	Attempt       int
	MaxAttempts   int
}

func (s *Service) resolveArtifactRetentionDays(ctx context.Context, run *store.PipelineRun) (int, error) {
	if run.ProjectID != nil && strings.TrimSpace(*run.ProjectID) != "" {
		project, err := s.Store.GetProject(ctx, *run.ProjectID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return 0, err
		}
		if project != nil && project.ArtifactRetentionDays != nil {
			return *project.ArtifactRetentionDays, nil
		}
	}
	return s.ArtifactRetentionDays, nil
}

func (s *Service) UploadWorkerArtifact(ctx context.Context, input UploadWorkerArtifactInput) (*store.PipelineArtifact, error) {
	if strings.TrimSpace(input.RunID) == "" {
		return nil, errors.New("runId is required")
	}
	if strings.TrimSpace(input.JobID) == "" {
		return nil, errors.New("jobId is required")
	}
	if strings.TrimSpace(input.StepKey) == "" {
		return nil, errors.New("stepKey is required")
	}
	if strings.TrimSpace(input.Path) == "" {
		return nil, errors.New("path is required")
	}
	if s.Artifacts == nil {
		return nil, errors.New("artifact manager is not configured")
	}

	run, err := s.Store.GetPipelineRun(ctx, input.RunID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("pipeline run not found")
		}
		return nil, err
	}
	step, err := s.Store.GetPipelineStepByKey(ctx, input.JobID, input.StepKey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("pipeline step not found")
		}
		return nil, err
	}

	artifact, err := s.Artifacts.SaveArtifact(ctx, artifacts.SaveArtifactInput{
		OrgID:         run.OrgID,
		RunID:         input.RunID,
		JobID:         input.JobID,
		StepID:        step.ID,
		RelativePath:  input.Path,
		Content:       input.Content,
		ContentLength: input.ContentLength,
	})
	if err != nil {
		return nil, err
	}
	retentionDays, err := s.resolveArtifactRetentionDays(ctx, run)
	if err != nil {
		return nil, err
	}
	if retentionDays > 0 {
		expiresAt := time.Now().UTC().Add(time.Duration(retentionDays) * 24 * time.Hour)
		artifact.ExpiresAt = &expiresAt
	}
	if err := s.Store.InsertPipelineArtifact(ctx, artifact); err != nil {
		return nil, err
	}
	_ = s.Store.AppendRunEvent(ctx, input.RunID, "step.artifact.uploaded", map[string]any{
		"runId":       input.RunID,
		"jobId":       input.JobID,
		"stepId":      step.ID,
		"path":        artifact.Path,
		"storagePath": artifact.StoragePath,
		"sizeBytes":   artifact.SizeBytes,
		"sha256":      artifact.Sha256,
		"attempt":     input.Attempt,
		"maxAttempts": input.MaxAttempts,
		"uploadedAt":  time.Now().UTC().Format(time.RFC3339),
	})
	return &artifact, nil
}

func (s *Service) OpenArtifactContent(ctx context.Context, runID string, artifactID string) (*store.PipelineArtifact, *artifacts.OpenArtifactOutput, error) {
	if strings.TrimSpace(runID) == "" {
		return nil, nil, errors.New("runId is required")
	}
	if strings.TrimSpace(artifactID) == "" {
		return nil, nil, errors.New("artifactId is required")
	}
	if s.Artifacts == nil {
		return nil, nil, errors.New("artifact manager is not configured")
	}

	artifact, err := s.Store.GetPipelineArtifact(ctx, runID, artifactID)
	if err != nil {
		return nil, nil, err
	}
	if artifact == nil {
		return nil, nil, errors.New("artifact not found")
	}
	if artifact.ExpiresAt != nil && artifact.ExpiresAt.Before(time.Now().UTC()) {
		return nil, nil, errors.New("artifact expired")
	}

	content, err := s.Artifacts.OpenArtifact(ctx, artifact.OrgID, artifact.StoragePath)
	if err != nil {
		return nil, nil, err
	}
	return artifact, content, nil
}

func (s *Service) OpenPublishedArtifactFileContent(ctx context.Context, fileID string) (*store.ArtifactFile, *artifacts.OpenArtifactOutput, error) {
	if strings.TrimSpace(fileID) == "" {
		return nil, nil, errors.New("fileId is required")
	}
	if s.Artifacts == nil {
		return nil, nil, errors.New("artifact manager is not configured")
	}

	file, err := s.Store.GetArtifactFile(ctx, fileID)
	if err != nil {
		return nil, nil, err
	}
	if file == nil {
		return nil, nil, errors.New("artifact file not found")
	}

	content, err := s.Artifacts.OpenArtifact(ctx, file.OrgID, file.StoragePath)
	if err != nil {
		return nil, nil, err
	}
	return file, content, nil
}
