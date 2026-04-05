package workerhub

import (
	"strings"
	"testing"
	"time"
)

func TestSelectWorkerPrefersLowerLoadAndHeadroom(t *testing.T) {
	hub := New(nil, time.Second)
	workerA := newTestWorker("worker-a", "online", 1, 2, map[string]string{"env": "production"}, []string{"shell"})
	workerB := newTestWorker("worker-b", "online", 2, 4, map[string]string{"env": "production"}, []string{"shell"})
	workerC := newTestWorker("worker-c", "online", 0, 1, map[string]string{"env": "production"}, []string{"shell"})

	hub.workers = map[string]*workerConn{
		workerA.id: workerA,
		workerB.id: workerB,
		workerC.id: workerC,
	}
	hub.workerOrder = []string{workerA.id, workerB.id, workerC.id}

	selected, err := hub.selectWorker(DispatchRequest{
		RunID:              "run-1",
		Environment:        "production",
		RequiredCapability: []string{"shell"},
	})
	if err != nil {
		t.Fatalf("expected worker selection success, got error: %v", err)
	}
	if selected.id != "worker-c" {
		t.Fatalf("expected worker-c (lowest load), got %s", selected.id)
	}
}

func TestSelectWorkerErrorIncludesDiagnostics(t *testing.T) {
	hub := New(nil, time.Second)
	draining := newTestWorker("draining", "draining", 1, 2, map[string]string{"env": "production"}, []string{"shell"})
	saturated := newTestWorker("saturated", "online", 2, 2, map[string]string{"env": "production"}, []string{"shell"})
	envMismatch := newTestWorker("env-mismatch", "online", 0, 2, map[string]string{"env": "preview"}, []string{"shell"})
	capabilityMismatch := newTestWorker("capability-mismatch", "online", 0, 2, map[string]string{"env": "production"}, []string{"shell"})

	hub.workers = map[string]*workerConn{
		draining.id:           draining,
		saturated.id:          saturated,
		envMismatch.id:        envMismatch,
		capabilityMismatch.id: capabilityMismatch,
	}
	hub.workerOrder = []string{draining.id, saturated.id, envMismatch.id, capabilityMismatch.id}

	_, err := hub.selectWorker(DispatchRequest{
		RunID:              "run-2",
		Environment:        "production",
		RequiredCapability: []string{"artifact_upload"},
	})
	if err == nil {
		t.Fatal("expected worker selection failure")
	}
	message := err.Error()
	assertContains(t, message, "workers=4")
	assertContains(t, message, "draining=1")
	assertContains(t, message, "saturated=1")
	assertContains(t, message, "env_mismatch=1")
	assertContains(t, message, "capability_mismatch=1")
	assertContains(t, message, "required_capabilities=artifact_upload")
}

func TestCompletePendingTransitionsDrainingWorkerToDrained(t *testing.T) {
	hub := New(nil, time.Second)
	worker := newTestWorker("worker-drain", "online", 1, 2, map[string]string{"env": "production"}, []string{"shell"})
	hub.workers = map[string]*workerConn{worker.id: worker}
	hub.workerOrder = []string{worker.id}

	if err := hub.SetWorkerDraining(worker.id, true); err != nil {
		t.Fatalf("unexpected drain setup error: %v", err)
	}
	worker.mu.Lock()
	statusBefore := worker.status
	worker.pending["req-1"] = &pendingDispatch{
		requestID: "req-1",
		runID:     "run-3",
		callbacks: DispatchCallbacks{},
		resultCh:  make(chan DispatchResult, 1),
	}
	worker.mu.Unlock()
	if statusBefore != "draining" {
		t.Fatalf("expected draining status before pending completion, got %s", statusBefore)
	}

	hub.completePending(worker, "req-1", DispatchResult{Status: "success"})

	worker.mu.Lock()
	defer worker.mu.Unlock()
	if worker.status != "drained" {
		t.Fatalf("expected drained status after pending completion, got %s", worker.status)
	}
}

func newTestWorker(
	id string,
	status string,
	busy int,
	maxConcurrent int,
	labels map[string]string,
	capabilities []string,
) *workerConn {
	capabilityLookup := map[string]bool{}
	for _, capability := range capabilities {
		capabilityLookup[strings.ToLower(strings.TrimSpace(capability))] = true
	}
	if !capabilityLookup["shell"] {
		capabilityLookup["shell"] = true
		capabilities = append(capabilities, "shell")
	}
	now := time.Now().UTC()
	return &workerConn{
		id:               id,
		sessionID:        id + "-session",
		status:           status,
		hostname:         id + ".local",
		version:          "test",
		labels:           labels,
		capabilities:     capabilities,
		capabilityLookup: capabilityLookup,
		maxConcurrent:    maxConcurrent,
		busy:             busy,
		connectedAt:      now,
		lastSeenAt:       now,
		send:             make(chan any, 1),
		pending:          map[string]*pendingDispatch{},
		conn:             nil,
	}
}

func assertContains(t *testing.T, value string, fragment string) {
	t.Helper()
	if !strings.Contains(value, fragment) {
		t.Fatalf("expected %q to contain %q", value, fragment)
	}
}

func TestReleaseRunRemovesAssignment(t *testing.T) {
	hub := New(nil, time.Second)
	hub.runAssignments["run-x"] = "worker-x"
	hub.ReleaseRun("run-x")
	if _, ok := hub.runAssignments["run-x"]; ok {
		t.Fatal("expected run assignment to be removed")
	}
}

func TestHasWorkersReflectsConnectedWorkers(t *testing.T) {
	hub := New(nil, time.Second)
	if hub.HasWorkers() {
		t.Fatal("expected no workers on a new hub")
	}
	hub.workers["worker-1"] = newTestWorker("worker-1", "online", 0, 1, map[string]string{}, []string{"shell"})
	if !hub.HasWorkers() {
		t.Fatal("expected HasWorkers to be true when worker exists")
	}
}

func TestSelectWorkerRespectsRunAssignmentWhenStillRunnable(t *testing.T) {
	hub := New(nil, time.Second)
	workerA := newTestWorker("worker-a", "online", 0, 2, map[string]string{"env": "production"}, []string{"shell"})
	workerB := newTestWorker("worker-b", "online", 0, 2, map[string]string{"env": "production"}, []string{"shell"})
	hub.workers = map[string]*workerConn{workerA.id: workerA, workerB.id: workerB}
	hub.workerOrder = []string{workerA.id, workerB.id}
	hub.runAssignments["run-assigned"] = workerB.id

	selected, err := hub.selectWorker(DispatchRequest{
		RunID:              "run-assigned",
		Environment:        "production",
		RequiredCapability: []string{"shell"},
	})
	if err != nil {
		t.Fatalf("expected assignment-preserving selection, got error: %v", err)
	}
	if selected.id != workerB.id {
		t.Fatalf("expected assigned worker %s, got %s", workerB.id, selected.id)
	}
}

func TestSelectWorkerDropsStaleRunAssignment(t *testing.T) {
	hub := New(nil, time.Second)
	workerA := newTestWorker("worker-a", "online", 0, 2, map[string]string{"env": "production"}, []string{"shell"})
	workerB := newTestWorker("worker-b", "draining", 0, 2, map[string]string{"env": "production"}, []string{"shell"})
	hub.workers = map[string]*workerConn{workerA.id: workerA, workerB.id: workerB}
	hub.workerOrder = []string{workerA.id, workerB.id}
	hub.runAssignments["run-stale"] = workerB.id

	selected, err := hub.selectWorker(DispatchRequest{
		RunID:              "run-stale",
		Environment:        "production",
		RequiredCapability: []string{"shell"},
	})
	if err != nil {
		t.Fatalf("expected fallback selection, got error: %v", err)
	}
	if selected.id != workerA.id {
		t.Fatalf("expected fallback worker %s, got %s", workerA.id, selected.id)
	}
}

func TestDispatchRequestCapabilitySanitization(t *testing.T) {
	hub := New(nil, time.Second)
	worker := newTestWorker("worker-cap", "online", 0, 1, map[string]string{"env": "production"}, []string{"shell", "artifact_upload"})
	hub.workers = map[string]*workerConn{worker.id: worker}
	hub.workerOrder = []string{worker.id}

	_, err := hub.selectWorker(DispatchRequest{
		RunID:              "run-cap",
		Environment:        "production",
		RequiredCapability: []string{"  ARTIFACT_UPLOAD  "},
	})
	if err != nil {
		t.Fatalf("expected capability-matched selection, got error: %v", err)
	}
}
