package pipeline

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"sykra/conductor/internal/store"
)

func TestScanScheduledPipelinesWithDepsContinuesAfterPerPipelineFailures(t *testing.T) {
	ctx := context.Background()
	scheduleA := "0 2 * * *"
	scheduleB := "0 3 * * *"
	dueA := time.Date(2026, time.April, 6, 2, 0, 0, 0, time.UTC)
	dueB := time.Date(2026, time.April, 6, 3, 0, 0, 0, time.UTC)
	batchNow := time.Date(2026, time.April, 6, 4, 0, 0, 0, time.UTC)

	triggeredInputs := make([]TriggerRunInput, 0, 2)
	updatedPipelines := make([]string, 0, 1)

	err := scanScheduledPipelinesWithDeps(
		ctx,
		50,
		func(context.Context, int) ([]store.Pipeline, error) {
			return []store.Pipeline{
				{ID: "pipeline-a", TriggerSchedule: &scheduleA, NextScheduledAt: &dueA},
				{ID: "pipeline-b", TriggerSchedule: &scheduleB, NextScheduledAt: &dueB},
			}, nil
		},
		func(_ context.Context, input TriggerRunInput) (*store.PipelineRun, error) {
			triggeredInputs = append(triggeredInputs, input)
			if input.PipelineID == "pipeline-a" {
				return nil, errors.New("boom")
			}
			return &store.PipelineRun{ID: "run-b", PipelineID: input.PipelineID}, nil
		},
		func(_ context.Context, pipelineID string, _ *string, nextScheduledAt *time.Time, lastScheduledAt *time.Time) error {
			if nextScheduledAt == nil || lastScheduledAt == nil {
				t.Fatalf("expected schedule timestamps for %s", pipelineID)
			}
			if pipelineID != "pipeline-b" {
				t.Fatalf("unexpected schedule update for %s", pipelineID)
			}
			if !lastScheduledAt.Equal(dueB) {
				t.Fatalf("expected last scheduled at %s, got %s", dueB, *lastScheduledAt)
			}
			updatedPipelines = append(updatedPipelines, pipelineID)
			return nil
		},
		func(expr string, after time.Time) (time.Time, error) {
			if expr != scheduleB {
				t.Fatalf("expected next schedule to be computed only for pipeline-b, got %s", expr)
			}
			if !after.Equal(batchNow) {
				t.Fatalf("expected next schedule after %s, got %s", batchNow, after)
			}
			return dueB.Add(24 * time.Hour), nil
		},
		func() time.Time { return batchNow },
	)
	if err == nil {
		t.Fatal("expected aggregated scan error")
	}
	if !strings.Contains(err.Error(), "pipeline pipeline-a trigger failed") {
		t.Fatalf("expected aggregated trigger failure, got %v", err)
	}
	if len(triggeredInputs) != 2 {
		t.Fatalf("expected 2 trigger attempts, got %d", len(triggeredInputs))
	}
	if len(updatedPipelines) != 1 || updatedPipelines[0] != "pipeline-b" {
		t.Fatalf("expected pipeline-b schedule update, got %#v", updatedPipelines)
	}
}

func TestScanScheduledPipelinesWithDepsReturnsNilWhenNoFailures(t *testing.T) {
	ctx := context.Background()
	schedule := "0 5 * * *"
	dueAt := time.Date(2026, time.April, 6, 5, 0, 0, 0, time.UTC)
	batchNow := time.Date(2026, time.April, 6, 6, 0, 0, 0, time.UTC)

	err := scanScheduledPipelinesWithDeps(
		ctx,
		50,
		func(context.Context, int) ([]store.Pipeline, error) {
			return []store.Pipeline{
				{ID: "pipeline-ok", TriggerSchedule: &schedule, NextScheduledAt: &dueAt},
			}, nil
		},
		func(context.Context, TriggerRunInput) (*store.PipelineRun, error) {
			return &store.PipelineRun{ID: "run-ok", PipelineID: "pipeline-ok"}, nil
		},
		func(context.Context, string, *string, *time.Time, *time.Time) error {
			return nil
		},
		func(string, time.Time) (time.Time, error) {
			return batchNow.Add(time.Hour), nil
		},
		func() time.Time { return batchNow },
	)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}
