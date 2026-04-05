package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"sykra/conductor/internal/store"
)

type fakePipelineRunEventStore struct {
	calls []eventCall
}

type eventCall struct {
	runID     string
	eventType string
	payload   map[string]any
}

func (f *fakePipelineRunEventStore) AppendRunEvent(_ context.Context, runID string, eventType string, payload map[string]any) error {
	f.calls = append(f.calls, eventCall{
		runID:     runID,
		eventType: eventType,
		payload:   payload,
	})
	return nil
}

func TestEmitCanceledRunEvents(t *testing.T) {
	ctx := context.Background()
	store := &fakePipelineRunEventStore{}
	now := time.Date(2026, time.April, 5, 12, 0, 0, 0, time.UTC)
	emitCanceledRunEvents(ctx, store, []string{"run-a", "", "run-b"}, now)

	if len(store.calls) != 2 {
		t.Fatalf("expected 2 events, got %d", len(store.calls))
	}
	if store.calls[0].runID != "run-a" || store.calls[0].eventType != "run.canceled" {
		t.Fatalf("unexpected first call: %#v", store.calls[0])
	}
	if store.calls[1].runID != "run-b" || store.calls[1].eventType != "run.canceled" {
		t.Fatalf("unexpected second call: %#v", store.calls[1])
	}
	expectedTimestamp := now.Format(time.RFC3339)
	if got := store.calls[0].payload["timestamp"]; got != expectedTimestamp {
		t.Fatalf("expected timestamp %q, got %#v", expectedTimestamp, got)
	}
	if got := store.calls[0].payload["reason"]; got != "concurrency_cancel_previous" {
		t.Fatalf("expected reason concurrency_cancel_previous, got %#v", got)
	}
}

type fakeTriggerRunStore struct {
	pipeline *store.Pipeline
	version  *store.PipelineVersion
	getErr   error

	run            *store.PipelineRun
	canceledRunIDs []string
	created        bool
	createErr      error
	admittedRun    store.PipelineRun
	admittedMode   string
	*fakePipelineRunEventStore
}

func (f *fakeTriggerRunStore) GetPipelineWithCurrentVersion(_ context.Context, _ string) (*store.Pipeline, *store.PipelineVersion, error) {
	if f.getErr != nil {
		return nil, nil, f.getErr
	}
	return f.pipeline, f.version, nil
}

func (f *fakeTriggerRunStore) CreatePipelineRunWithAdmission(_ context.Context, run store.PipelineRun, concurrencyMode string) (*store.PipelineRun, []string, bool, error) {
	if f.createErr != nil {
		return nil, nil, false, f.createErr
	}
	f.admittedRun = run
	f.admittedMode = concurrencyMode
	return f.run, append([]string(nil), f.canceledRunIDs...), f.created, nil
}

func TestEmitQueuedRunEventIfCreated(t *testing.T) {
	ctx := context.Background()
	store := &fakePipelineRunEventStore{}
	now := time.Date(2026, time.April, 5, 12, 0, 0, 0, time.UTC)

	emitQueuedRunEventIfCreated(ctx, store, false, "run-a", "pipeline-a", "version-a", now)
	if len(store.calls) != 0 {
		t.Fatalf("expected no calls when created=false, got %d", len(store.calls))
	}

	emitQueuedRunEventIfCreated(ctx, store, true, "run-a", "pipeline-a", "version-a", now)
	if len(store.calls) != 1 {
		t.Fatalf("expected 1 call when created=true, got %d", len(store.calls))
	}
	call := store.calls[0]
	if call.runID != "run-a" || call.eventType != "run.queued" {
		t.Fatalf("unexpected queued call: %#v", call)
	}
	if got := call.payload["pipelineId"]; got != "pipeline-a" {
		t.Fatalf("expected pipelineId pipeline-a, got %#v", got)
	}
	if got := call.payload["versionId"]; got != "version-a" {
		t.Fatalf("expected versionId version-a, got %#v", got)
	}
}

func TestTriggerRunWithDepsIdempotentReplaySkipsGraphAndQueuedEvent(t *testing.T) {
	ctx := context.Background()
	configRaw, err := json.Marshal(PipelineConfig{
		Name:       "Deploy",
		BuildImage: "node:22-bookworm",
		Trigger:    TriggerConfig{},
		Jobs: []PipelineJob{
			{ID: "source", Name: "Source", Stage: "source", Type: "source_checkout", Steps: []PipelineStep{{ID: "checkout", Name: "Checkout"}}},
			{ID: "quality", Name: "Quality", Stage: "review", Type: "quality_gate", MinScore: 60, Needs: []string{"source"}, Steps: []PipelineStep{
				{ID: "ai-review", Name: "AI Review", CheckType: "ai_review"},
				{ID: "static-analysis", Name: "Static Analysis", CheckType: "static_analysis", Script: "npm run lint", ArtifactPaths: []string{"quality-gate.sarif"}},
			}},
		},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	storeFake := &fakeTriggerRunStore{
		pipeline:                  &store.Pipeline{ID: "pipeline-1", OrgID: "org-1", ConcurrencyMode: "queue"},
		version:                   &store.PipelineVersion{ID: "version-1", PipelineID: "pipeline-1", Version: 1, Config: configRaw},
		run:                       &store.PipelineRun{ID: "run-1", PipelineID: "pipeline-1"},
		created:                   false,
		fakePipelineRunEventStore: &fakePipelineRunEventStore{},
	}

	ensureGraphCalls := 0
	run, err := triggerRunWithDeps(ctx, storeFake, TriggerRunInput{
		PipelineID:     "pipeline-1",
		TriggerType:    "manual",
		TriggeredBy:    "user-1",
		IdempotencyKey: "idem-1",
	}, func(_ context.Context, _ string, _ PipelineConfig, _ string) error {
		ensureGraphCalls++
		return nil
	}, func() time.Time { return time.Date(2026, time.April, 6, 9, 0, 0, 0, time.UTC) })
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if run == nil || run.ID != "run-1" {
		t.Fatalf("expected existing run run-1, got %#v", run)
	}
	if ensureGraphCalls != 0 {
		t.Fatalf("expected no EnsureRunGraph call, got %d", ensureGraphCalls)
	}
	if len(storeFake.calls) != 0 {
		t.Fatalf("expected no events for idempotent replay, got %d", len(storeFake.calls))
	}
	if storeFake.admittedMode != "queue" {
		t.Fatalf("expected queue admission mode, got %q", storeFake.admittedMode)
	}
}

func TestTriggerRunWithDepsCreatedRunBuildsGraphAndEmitsEvents(t *testing.T) {
	ctx := context.Background()
	configRaw, err := json.Marshal(PipelineConfig{
		Name:       "Deploy",
		BuildImage: "node:22-bookworm",
		Trigger:    TriggerConfig{},
		Jobs: []PipelineJob{
			{ID: "source", Name: "Source", Stage: "source", Type: "source_checkout", Steps: []PipelineStep{{ID: "checkout", Name: "Checkout"}}},
			{ID: "quality", Name: "Quality", Stage: "review", Type: "quality_gate", MinScore: 60, Needs: []string{"source"}, Steps: []PipelineStep{
				{ID: "ai-review", Name: "AI Review", CheckType: "ai_review"},
				{ID: "static-analysis", Name: "Static Analysis", CheckType: "static_analysis", Script: "npm run lint", ArtifactPaths: []string{"quality-gate.sarif"}},
			}},
		},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	storeFake := &fakeTriggerRunStore{
		pipeline:                  &store.Pipeline{ID: "pipeline-1", OrgID: "org-1", ConcurrencyMode: "cancel_previous"},
		version:                   &store.PipelineVersion{ID: "version-1", PipelineID: "pipeline-1", Version: 1, Config: configRaw},
		run:                       &store.PipelineRun{ID: "run-2", PipelineID: "pipeline-1"},
		created:                   true,
		canceledRunIDs:            []string{"run-old-1", "run-old-2"},
		fakePipelineRunEventStore: &fakePipelineRunEventStore{},
	}

	ensureGraphCalls := 0
	run, err := triggerRunWithDeps(ctx, storeFake, TriggerRunInput{
		PipelineID:     "pipeline-1",
		TriggerType:    "manual",
		TriggeredBy:    "user-1",
		IdempotencyKey: "idem-2",
	}, func(_ context.Context, runID string, _ PipelineConfig, _ string) error {
		ensureGraphCalls++
		if runID != "run-2" {
			t.Fatalf("expected graph build for run-2, got %q", runID)
		}
		return nil
	}, func() time.Time { return time.Date(2026, time.April, 6, 10, 0, 0, 0, time.UTC) })
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if run == nil || run.ID != "run-2" {
		t.Fatalf("expected created run run-2, got %#v", run)
	}
	if ensureGraphCalls != 1 {
		t.Fatalf("expected 1 EnsureRunGraph call, got %d", ensureGraphCalls)
	}
	if len(storeFake.calls) != 3 {
		t.Fatalf("expected 3 events (2 canceled + 1 queued), got %d", len(storeFake.calls))
	}
	if storeFake.calls[0].runID != "run-old-1" || storeFake.calls[0].eventType != "run.canceled" {
		t.Fatalf("unexpected first event: %#v", storeFake.calls[0])
	}
	if storeFake.calls[2].runID != "run-2" || storeFake.calls[2].eventType != "run.queued" {
		t.Fatalf("unexpected queued event: %#v", storeFake.calls[2])
	}
}

func TestTriggerRunWithDepsPropagatesAdmissionError(t *testing.T) {
	ctx := context.Background()
	expectedErr := errors.New("admission failed")
	configRaw, err := json.Marshal(PipelineConfig{
		Name:       "Deploy",
		BuildImage: "node:22-bookworm",
		Trigger:    TriggerConfig{},
		Jobs: []PipelineJob{
			{ID: "source", Name: "Source", Stage: "source", Type: "source_checkout", Steps: []PipelineStep{{ID: "checkout", Name: "Checkout"}}},
			{ID: "quality", Name: "Quality", Stage: "review", Type: "quality_gate", MinScore: 60, Needs: []string{"source"}, Steps: []PipelineStep{
				{ID: "ai-review", Name: "AI Review", CheckType: "ai_review"},
				{ID: "static-analysis", Name: "Static Analysis", CheckType: "static_analysis", Script: "npm run lint", ArtifactPaths: []string{"quality-gate.sarif"}},
			}},
		},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	storeFake := &fakeTriggerRunStore{
		pipeline:                  &store.Pipeline{ID: "pipeline-1", OrgID: "org-1", ConcurrencyMode: "queue"},
		version:                   &store.PipelineVersion{ID: "version-1", PipelineID: "pipeline-1", Version: 1, Config: configRaw},
		createErr:                 expectedErr,
		fakePipelineRunEventStore: &fakePipelineRunEventStore{},
	}

	_, triggerErr := triggerRunWithDeps(ctx, storeFake, TriggerRunInput{
		PipelineID:  "pipeline-1",
		TriggerType: "manual",
	}, func(_ context.Context, _ string, _ PipelineConfig, _ string) error {
		t.Fatal("ensureGraph should not be called on admission error")
		return nil
	}, time.Now)
	if !errors.Is(triggerErr, expectedErr) {
		t.Fatalf("expected admission error, got %v", triggerErr)
	}
	if len(storeFake.calls) != 0 {
		t.Fatalf("expected no events on admission error, got %d", len(storeFake.calls))
	}
}
