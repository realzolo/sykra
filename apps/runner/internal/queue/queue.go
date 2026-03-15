package queue

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/hibiken/asynq"

	"spec-axis/runner/internal/analysis"
	"spec-axis/runner/internal/domain"
	"spec-axis/runner/internal/events"
	"spec-axis/runner/internal/pipeline"
	"spec-axis/runner/internal/store"
)

const TaskTypeAnalyze = "task:analyze"
const TaskTypePipelineRun = "task:pipeline-run"

type PipelineRunPayload struct {
	RunID string `json:"runId"`
}

func NewAnalyzeTask(payload domain.AnalyzeRequest) (*asynq.Task, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeAnalyze, raw), nil
}

func NewPipelineRunTask(runID string) (*asynq.Task, error) {
	raw, err := json.Marshal(PipelineRunPayload{RunID: runID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypePipelineRun, raw), nil
}

func HandleAnalyzeTask(st *store.Store, publisher *events.Publisher, timeout time.Duration) asynq.HandlerFunc {
	return func(ctx context.Context, task *asynq.Task) error {
		var payload domain.AnalyzeRequest
		if err := json.Unmarshal(task.Payload(), &payload); err != nil {
			return err
		}

		err := analysis.RunAnalyzeTask(ctx, st, publisher, payload, timeout)
		if err != nil {
			log.Printf("analyze task failed: %v", err)
			_ = st.MarkReportFailed(ctx, payload.ReportID, err.Error())
			if publisher != nil {
				publisher.ReportStatus(payload.ReportID, "failed", nil)
			}
			return err
		}

		return nil
	}
}

func HandlePipelineRunTask(engine *pipeline.Engine) asynq.HandlerFunc {
	return func(ctx context.Context, task *asynq.Task) error {
		var payload PipelineRunPayload
		if err := json.Unmarshal(task.Payload(), &payload); err != nil {
			return err
		}
		if payload.RunID == "" {
			return nil
		}
		return engine.Execute(ctx, payload.RunID)
	}
}
