package pipeline

import (
	"context"
	"errors"
	"testing"
	"time"

	"sykra/conductor/internal/store"
)

type fakeRunConcurrencyStore struct {
	listStatusesArg []string
	listPipelineID  string
	listResult      []string
	listErr         error

	cancelCalls []string
	cancelByID  map[string]struct {
		canceled bool
		err      error
	}

	appendCalls []string
}

func (f *fakeRunConcurrencyStore) ListPipelineRunIDsByStatuses(_ context.Context, pipelineID string, statuses []string) ([]string, error) {
	f.listPipelineID = pipelineID
	f.listStatusesArg = append([]string(nil), statuses...)
	if f.listErr != nil {
		return nil, f.listErr
	}
	return append([]string(nil), f.listResult...), nil
}

func (f *fakeRunConcurrencyStore) CancelPipelineRun(_ context.Context, runID string, _ string) (bool, error) {
	f.cancelCalls = append(f.cancelCalls, runID)
	if f.cancelByID == nil {
		return true, nil
	}
	result, ok := f.cancelByID[runID]
	if !ok {
		return true, nil
	}
	return result.canceled, result.err
}

func (f *fakeRunConcurrencyStore) AppendRunEvent(_ context.Context, runID string, _ string, _ map[string]any) error {
	f.appendCalls = append(f.appendCalls, runID)
	return nil
}

func TestApplyRunConcurrencyModeWithStoreAllowNoop(t *testing.T) {
	ctx := context.Background()
	fakeStore := &fakeRunConcurrencyStore{}

	err := applyRunConcurrencyModeWithStore(ctx, fakeStore, &store.Pipeline{
		ID:              "pipeline-1",
		ConcurrencyMode: "allow",
	}, time.Now)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(fakeStore.cancelCalls) != 0 {
		t.Fatalf("expected no cancel calls, got %d", len(fakeStore.cancelCalls))
	}
	if len(fakeStore.appendCalls) != 0 {
		t.Fatalf("expected no append calls, got %d", len(fakeStore.appendCalls))
	}
}

func TestApplyRunConcurrencyModeWithStoreQueueNoop(t *testing.T) {
	ctx := context.Background()
	fakeStore := &fakeRunConcurrencyStore{}

	err := applyRunConcurrencyModeWithStore(ctx, fakeStore, &store.Pipeline{
		ID:              "pipeline-1",
		ConcurrencyMode: "queue",
	}, time.Now)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(fakeStore.cancelCalls) != 0 {
		t.Fatalf("expected no cancel calls, got %d", len(fakeStore.cancelCalls))
	}
	if len(fakeStore.appendCalls) != 0 {
		t.Fatalf("expected no append calls, got %d", len(fakeStore.appendCalls))
	}
}

func TestApplyRunConcurrencyModeWithStoreCancelPrevious(t *testing.T) {
	ctx := context.Background()
	fakeStore := &fakeRunConcurrencyStore{
		listResult: []string{"run-a", "run-b", "run-c"},
		cancelByID: map[string]struct {
			canceled bool
			err      error
		}{
			"run-a": {canceled: true, err: nil},
			"run-b": {canceled: false, err: nil},
			"run-c": {canceled: true, err: nil},
		},
	}

	fixedNow := func() time.Time { return time.Date(2026, time.April, 5, 12, 0, 0, 0, time.UTC) }
	err := applyRunConcurrencyModeWithStore(ctx, fakeStore, &store.Pipeline{
		ID:              "pipeline-1",
		ConcurrencyMode: "cancel_previous",
	}, fixedNow)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if fakeStore.listPipelineID != "pipeline-1" {
		t.Fatalf("expected pipeline id pipeline-1, got %q", fakeStore.listPipelineID)
	}
	if len(fakeStore.listStatusesArg) != 3 {
		t.Fatalf("expected 3 statuses, got %d", len(fakeStore.listStatusesArg))
	}
	if len(fakeStore.cancelCalls) != 3 {
		t.Fatalf("expected 3 cancel calls, got %d", len(fakeStore.cancelCalls))
	}
	if len(fakeStore.appendCalls) != 2 {
		t.Fatalf("expected 2 append calls for canceled runs, got %d", len(fakeStore.appendCalls))
	}
	if fakeStore.appendCalls[0] != "run-a" || fakeStore.appendCalls[1] != "run-c" {
		t.Fatalf("unexpected append calls order: %#v", fakeStore.appendCalls)
	}
}

func TestApplyRunConcurrencyModeWithStoreCancelPreviousListError(t *testing.T) {
	ctx := context.Background()
	expectedErr := errors.New("list failed")
	fakeStore := &fakeRunConcurrencyStore{listErr: expectedErr}

	err := applyRunConcurrencyModeWithStore(ctx, fakeStore, &store.Pipeline{
		ID:              "pipeline-1",
		ConcurrencyMode: "cancel_previous",
	}, time.Now)
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected list error, got %v", err)
	}
}

func TestApplyRunConcurrencyModeWithStoreCancelPreviousCancelError(t *testing.T) {
	ctx := context.Background()
	expectedErr := errors.New("cancel failed")
	fakeStore := &fakeRunConcurrencyStore{
		listResult: []string{"run-a"},
		cancelByID: map[string]struct {
			canceled bool
			err      error
		}{
			"run-a": {canceled: false, err: expectedErr},
		},
	}

	err := applyRunConcurrencyModeWithStore(ctx, fakeStore, &store.Pipeline{
		ID:              "pipeline-1",
		ConcurrencyMode: "cancel_previous",
	}, time.Now)
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected cancel error, got %v", err)
	}
}

func TestApplyRunConcurrencyModeWithStoreRejectsUnsupportedMode(t *testing.T) {
	ctx := context.Background()
	fakeStore := &fakeRunConcurrencyStore{}

	err := applyRunConcurrencyModeWithStore(ctx, fakeStore, &store.Pipeline{
		ID:              "pipeline-1",
		ConcurrencyMode: "invalid-mode",
	}, time.Now)
	if err == nil {
		t.Fatal("expected error for unsupported mode")
	}
}
