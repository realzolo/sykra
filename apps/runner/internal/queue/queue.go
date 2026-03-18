package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/hibiken/asynq"

	"spec-axis/runner/internal/analysis"
	"spec-axis/runner/internal/domain"
	"spec-axis/runner/internal/events"
	"spec-axis/runner/internal/store"
)

const TaskTypeAnalyze = "task:analyze"
const TaskTypePipelineRun = "task:pipeline-run"

type PipelineRunPayload struct {
	RunID string `json:"runId"`
}

type PipelineExecutor interface {
	Execute(ctx context.Context, runID string) error
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
			if errors.Is(err, store.ErrReportNotAnalyzing) {
				log.Printf("analyze task skipped finalization: %v", err)
				return nil
			}
			log.Printf("analyze task failed: %v", err)
			markErr := st.MarkReportFailed(ctx, payload.ReportID, humanAnalyzeError(err, timeout))
			if errors.Is(markErr, store.ErrReportNotAnalyzing) {
				log.Printf("analyze task skipped failure update due terminal report status: %v", err)
				return nil
			}
			if markErr != nil {
				log.Printf("failed to mark report failed: %v", markErr)
			}
			if publisher != nil && markErr == nil {
				publisher.ReportStatus(payload.ReportID, "failed", nil)
			}
			if shouldSkipRetry(err) {
				return fmt.Errorf("non-retryable analyze failure: %v: %w", err, asynq.SkipRetry)
			}
			return err
		}

		return nil
	}
}

func humanAnalyzeError(err error, timeout time.Duration) string {
	if err == nil {
		return "analysis failed"
	}
	low := strings.ToLower(err.Error())
	if errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(low, "context deadline exceeded") ||
		strings.Contains(low, "client.timeout") {
		return fmt.Sprintf(
			"AI request timed out after %s. Increase runner analyze_timeout/ANALYZE_TIMEOUT or reduce Max Tokens/reasoning effort.",
			timeout.String(),
		)
	}
	return err.Error()
}

func shouldSkipRetry(err error) bool {
	if err == nil {
		return false
	}
	low := strings.ToLower(err.Error())
	nonRetryableSubstrings := []string{
		"invalid iv length",
		"invalid auth tag length",
		"integration secret format is invalid",
		"invalid encrypted data format",
		"unsupported ai provider",
		"unsupported vcs provider",
		"missing reportid or projectid",
		"missing repo or commit hashes",
		"report project mismatch",
		"invalid character '<' looking for beginning of value",
		"upstream returned html",
	}
	for _, token := range nonRetryableSubstrings {
		if strings.Contains(low, token) {
			return true
		}
	}
	return false
}

func HandlePipelineRunTask(executor PipelineExecutor) asynq.HandlerFunc {
	return func(ctx context.Context, task *asynq.Task) error {
		var payload PipelineRunPayload
		if err := json.Unmarshal(task.Payload(), &payload); err != nil {
			return err
		}
		if payload.RunID == "" {
			return nil
		}
		return executor.Execute(ctx, payload.RunID)
	}
}
