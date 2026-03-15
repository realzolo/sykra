package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/hibiken/asynq"

	"spec-axis/runner/internal/queue"
	"spec-axis/runner/internal/store"
)

type Service struct {
	Store        *store.Store
	Queue        *asynq.Client
	QueueName    string
	RunTimeout   time.Duration
	Storage      *LocalStorage
}

type CreatePipelineInput struct {
	OrgID       string
	ProjectID   string
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
}

func (s *Service) CreatePipeline(ctx context.Context, input CreatePipelineInput) (*store.Pipeline, *store.PipelineVersion, error) {
	if input.OrgID == "" || input.ProjectID == "" {
		return nil, nil, errors.New("orgId and projectId are required")
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

	return pipeline, version, nil
}

func (s *Service) UpdatePipeline(ctx context.Context, input UpdatePipelineInput) (*store.PipelineVersion, error) {
	if input.PipelineID == "" {
		return nil, errors.New("pipelineId is required")
	}
	if input.TriggerType == "" {
		input.TriggerType = "manual"
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

	if input.Name != "" || input.Description != "" {
		if err := s.Store.UpdatePipelineMetadata(ctx, input.PipelineID, input.Name, input.Description); err != nil {
			return nil, err
		}
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
	run, err := s.Store.CreatePipelineRun(ctx, store.PipelineRun{
		PipelineID:     pipeline.ID,
		VersionID:      version.ID,
		OrgID:          pipeline.OrgID,
		ProjectID:      pipeline.ProjectID,
		Status:         string(StatusQueued),
		TriggerType:    input.TriggerType,
		TriggeredBy:    triggeredBy,
		IdempotencyKey: idempotency,
		Metadata:       metadataRaw,
	})
	if err != nil {
		return nil, err
	}

	if err := EnsureRunGraph(ctx, s.Store, run.ID, cfg); err != nil {
		return nil, err
	}

	_ = s.Store.AppendRunEvent(ctx, run.ID, "run.queued", map[string]any{
		"runId": run.ID,
		"pipelineId": pipeline.ID,
		"versionId": version.ID,
		"status": StatusQueued,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})

	if s.Queue == nil {
		return nil, errors.New("queue client is not configured")
	}

	task, err := queue.NewPipelineRunTask(run.ID)
	if err != nil {
		return nil, err
	}

	options := []asynq.Option{
		asynq.Queue(s.QueueName),
		asynq.MaxRetry(1),
		asynq.Timeout(s.RunTimeout),
		asynq.TaskID("pipeline:" + run.ID),
	}
	if _, err := s.Queue.Enqueue(task, options...); err != nil {
		return nil, err
	}

	return run, nil
}

func (s *Service) GetPipeline(ctx context.Context, pipelineID string) (*store.Pipeline, *store.PipelineVersion, error) {
	return s.Store.GetPipelineWithCurrentVersion(ctx, pipelineID)
}

func (s *Service) ListPipelines(ctx context.Context, orgID string, projectID string) ([]store.Pipeline, error) {
	return s.Store.ListPipelines(ctx, orgID, projectID)
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

func (s *Service) ReadLog(ctx context.Context, stepID string, offset int64, limit int64) ([]byte, int64, error) {
	step, err := s.Store.GetPipelineStep(ctx, stepID)
	if err != nil {
		return nil, 0, err
	}
	if step == nil || step.LogPath == "" {
		return nil, 0, fmt.Errorf("log not found")
	}
	return s.Storage.ReadLog(step.LogPath, offset, limit)
}
