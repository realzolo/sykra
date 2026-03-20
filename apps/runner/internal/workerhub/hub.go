package workerhub

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"spec-axis/runner/internal/store"
	"spec-axis/runner/pkg/workerprotocol"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool { return true },
}

type DispatchRequest struct {
	RunID              string
	JobID              string
	JobKey             string
	JobType            string
	Environment        string
	ProjectID          string
	Branch             string
	MinScore           int
	StudioURL          string
	StudioToken        string
	WorkspaceRoot      string
	JobWorkingDir      string
	Steps              []workerprotocol.ExecuteStep
	RequiredCapability []string
}

type DispatchCallbacks struct {
	OnAssigned     func(workerID string)
	OnStepStarted  func(stepID string)
	OnStepLog      func(stepID string, chunk string)
	OnStepArtifact func(message workerprotocol.StepArtifactMessage)
	OnStepFinished func(stepID string, status string, exitCode int, errorMessage string)
}

type DispatchResult struct {
	Status       string
	ErrorMessage string
}

type WorkerSnapshot struct {
	WorkerID      string            `json:"workerId"`
	SessionID     string            `json:"sessionId"`
	Status        string            `json:"status"`
	Hostname      string            `json:"hostname"`
	Version       string            `json:"version"`
	Labels        map[string]string `json:"labels"`
	Capabilities  []string          `json:"capabilities"`
	MaxConcurrent int               `json:"maxConcurrent"`
	Busy          int               `json:"busy"`
	ConnectedAt   time.Time         `json:"connectedAt"`
	LastSeenAt    time.Time         `json:"lastSeenAt"`
}

type pendingDispatch struct {
	requestID string
	runID     string
	callbacks DispatchCallbacks
	resultCh  chan DispatchResult
}

type workerConn struct {
	id               string
	sessionID        string
	status           string
	hostname         string
	version          string
	labels           map[string]string
	capabilities     []string
	capabilityLookup map[string]bool
	maxConcurrent    int
	busy             int
	connectedAt      time.Time
	lastSeenAt       time.Time
	conn             *websocket.Conn
	send             chan any
	pending          map[string]*pendingDispatch
	mu               sync.Mutex
	closeOnce        sync.Once
	unregisterOnce   sync.Once
}

type Hub struct {
	store    *store.Store
	leaseTTL time.Duration

	mu             sync.RWMutex
	workers        map[string]*workerConn
	workerOrder    []string
	nextIndex      int
	runAssignments map[string]string

	startOnce sync.Once
	stopOnce  sync.Once
	stopCh    chan struct{}
}

func New(storeRef *store.Store, leaseTTL time.Duration) *Hub {
	if leaseTTL <= 0 {
		leaseTTL = 45 * time.Second
	}
	return &Hub{
		store:          storeRef,
		leaseTTL:       leaseTTL,
		workers:        map[string]*workerConn{},
		runAssignments: map[string]string{},
		stopCh:         make(chan struct{}),
	}
}

func (h *Hub) Start() {
	h.startOnce.Do(func() {
		go h.monitorLoop()
	})
}

func (h *Hub) Stop() {
	h.stopOnce.Do(func() {
		close(h.stopCh)
	})
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) error {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return err
	}

	hello, err := readHello(conn)
	if err != nil {
		_ = conn.WriteJSON(map[string]any{"error": err.Error()})
		_ = conn.Close()
		return err
	}

	sessionID := randomID()
	worker := &workerConn{
		id:            strings.TrimSpace(hello.WorkerID),
		sessionID:     sessionID,
		status:        "online",
		hostname:      strings.TrimSpace(hello.Hostname),
		version:       strings.TrimSpace(hello.Version),
		labels:        cloneLabels(hello.Labels),
		capabilities:  sanitizeCapabilities(hello.Capabilities),
		maxConcurrent: max(1, hello.MaxConcurrent),
		connectedAt:   time.Now().UTC(),
		lastSeenAt:    time.Now().UTC(),
		conn:          conn,
		send:          make(chan any, 64),
		pending:       map[string]*pendingDispatch{},
	}
	worker.capabilityLookup = map[string]bool{}
	for _, capability := range worker.capabilities {
		worker.capabilityLookup[capability] = true
	}

	h.register(worker)
	_ = conn.WriteJSON(workerprotocol.WelcomeMessage{
		Type:         workerprotocol.MasterMessageTypeWelcome,
		SessionID:    worker.sessionID,
		LeaseSeconds: int(h.leaseTTL.Seconds()),
	})

	go h.writeLoop(worker)
	go h.readLoop(worker)
	return nil
}

func (h *Hub) DispatchJob(ctx context.Context, req DispatchRequest, callbacks DispatchCallbacks) (DispatchResult, error) {
	worker, err := h.selectWorker(req)
	if err != nil {
		return DispatchResult{}, err
	}
	if callbacks.OnAssigned != nil {
		callbacks.OnAssigned(worker.id)
	}

	requestID := randomID()
	pending := &pendingDispatch{
		requestID: requestID,
		runID:     req.RunID,
		callbacks: callbacks,
		resultCh:  make(chan DispatchResult, 1),
	}

	worker.mu.Lock()
	worker.pending[requestID] = pending
	worker.busy++
	worker.mu.Unlock()
	h.touchWorker(worker, nil)

	message := workerprotocol.ExecuteJobMessage{
		Type:          workerprotocol.MasterMessageTypeExecuteJob,
		RequestID:     requestID,
		RunID:         req.RunID,
		JobID:         req.JobID,
		JobKey:        req.JobKey,
		JobType:       req.JobType,
		Environment:   req.Environment,
		ProjectID:     req.ProjectID,
		Branch:        req.Branch,
		MinScore:      req.MinScore,
		StudioURL:     req.StudioURL,
		StudioToken:   req.StudioToken,
		WorkspaceRoot: req.WorkspaceRoot,
		JobWorkingDir: req.JobWorkingDir,
		Steps:         req.Steps,
	}

	select {
	case worker.send <- message:
	case <-ctx.Done():
		h.failPending(worker, requestID, DispatchResult{Status: "canceled", ErrorMessage: ctx.Err().Error()})
		return DispatchResult{}, ctx.Err()
	}

	select {
	case result := <-pending.resultCh:
		if strings.EqualFold(result.Status, "success") {
			return result, nil
		}
		if result.ErrorMessage == "" {
			result.ErrorMessage = "worker execution failed"
		}
		return result, errors.New(result.ErrorMessage)
	case <-ctx.Done():
		select {
		case worker.send <- workerprotocol.CancelJobMessage{
			Type:      workerprotocol.MasterMessageTypeCancelJob,
			RequestID: requestID,
		}:
		default:
		}
		h.failPending(worker, requestID, DispatchResult{Status: "canceled", ErrorMessage: ctx.Err().Error()})
		return DispatchResult{}, ctx.Err()
	}
}

func (h *Hub) SetWorkerDraining(workerID string, draining bool) error {
	workerID = strings.TrimSpace(workerID)
	if workerID == "" {
		return errors.New("worker id is required")
	}

	h.mu.RLock()
	worker, ok := h.workers[workerID]
	h.mu.RUnlock()
	if !ok {
		return errors.New("worker not found")
	}

	worker.mu.Lock()
	if draining {
		worker.status = "draining"
	} else {
		worker.status = "online"
	}
	worker.mu.Unlock()
	h.touchWorker(worker, nil)
	return nil
}

func (h *Hub) ReleaseRun(runID string) {
	if strings.TrimSpace(runID) == "" {
		return
	}
	h.mu.Lock()
	delete(h.runAssignments, runID)
	h.mu.Unlock()
}

func (h *Hub) HasWorkers() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.workers) > 0
}

func (h *Hub) ListWorkers() []WorkerSnapshot {
	h.mu.RLock()
	ids := append([]string(nil), h.workerOrder...)
	h.mu.RUnlock()

	out := make([]WorkerSnapshot, 0, len(ids))
	for _, id := range ids {
		h.mu.RLock()
		worker, ok := h.workers[id]
		h.mu.RUnlock()
		if !ok {
			continue
		}
		worker.mu.Lock()
		snapshot := WorkerSnapshot{
			WorkerID:      worker.id,
			SessionID:     worker.sessionID,
			Status:        worker.status,
			Hostname:      worker.hostname,
			Version:       worker.version,
			Labels:        cloneLabels(worker.labels),
			Capabilities:  append([]string(nil), worker.capabilities...),
			MaxConcurrent: worker.maxConcurrent,
			Busy:          worker.busy,
			ConnectedAt:   worker.connectedAt,
			LastSeenAt:    worker.lastSeenAt,
		}
		worker.mu.Unlock()
		out = append(out, snapshot)
	}
	return out
}

func (h *Hub) register(worker *workerConn) {
	h.mu.Lock()
	if existing, ok := h.workers[worker.id]; ok {
		_ = existing.conn.Close()
	}
	h.workers[worker.id] = worker
	if !contains(h.workerOrder, worker.id) {
		h.workerOrder = append(h.workerOrder, worker.id)
	}
	h.mu.Unlock()
	h.touchWorker(worker, nil)
}

func (h *Hub) unregister(worker *workerConn, reason string) {
	worker.unregisterOnce.Do(func() {
		worker.closeOnce.Do(func() {
			close(worker.send)
		})

		h.mu.Lock()
		current, ok := h.workers[worker.id]
		if ok && current.sessionID == worker.sessionID {
			delete(h.workers, worker.id)
		}
		h.mu.Unlock()

		worker.mu.Lock()
		pending := make([]*pendingDispatch, 0, len(worker.pending))
		for _, item := range worker.pending {
			pending = append(pending, item)
		}
		worker.pending = map[string]*pendingDispatch{}
		worker.busy = 0
		worker.status = "offline"
		worker.mu.Unlock()
		for _, item := range pending {
			item.resultCh <- DispatchResult{Status: "failed", ErrorMessage: reason}
			close(item.resultCh)
		}
		h.markWorkerOffline(worker.id, reason)
	})
}

func (h *Hub) readLoop(worker *workerConn) {
	defer func() {
		_ = worker.conn.Close()
		h.unregister(worker, "worker disconnected")
	}()
	for {
		_, raw, err := worker.conn.ReadMessage()
		if err != nil {
			return
		}
		var envelope workerprotocol.Envelope
		if err := json.Unmarshal(raw, &envelope); err != nil {
			continue
		}
		worker.mu.Lock()
		worker.lastSeenAt = time.Now().UTC()
		worker.mu.Unlock()
		h.touchWorker(worker, nil)

		switch envelope.Type {
		case workerprotocol.WorkerMessageTypeHeartbeat:
			var heartbeat workerprotocol.HeartbeatMessage
			if err := json.Unmarshal(raw, &heartbeat); err != nil {
				continue
			}
			worker.mu.Lock()
			worker.lastSeenAt = time.Now().UTC()
			if heartbeat.Busy >= 0 {
				worker.busy = heartbeat.Busy
			}
			worker.mu.Unlock()
			h.touchWorker(worker, nil)
		case workerprotocol.WorkerMessageTypeJobAck:
			// Fire-and-forget ack currently; presence of ack means socket and worker event loop are healthy.
		case workerprotocol.WorkerMessageTypeStepStarted:
			var message workerprotocol.StepStartedMessage
			if err := json.Unmarshal(raw, &message); err != nil {
				continue
			}
			if pending := h.getPending(worker, message.RequestID); pending != nil && pending.callbacks.OnStepStarted != nil {
				pending.callbacks.OnStepStarted(message.StepID)
			}
		case workerprotocol.WorkerMessageTypeStepLog:
			var message workerprotocol.StepLogMessage
			if err := json.Unmarshal(raw, &message); err != nil {
				continue
			}
			if pending := h.getPending(worker, message.RequestID); pending != nil && pending.callbacks.OnStepLog != nil {
				pending.callbacks.OnStepLog(message.StepID, message.Chunk)
			}
		case workerprotocol.WorkerMessageTypeStepArtifact:
			var message workerprotocol.StepArtifactMessage
			if err := json.Unmarshal(raw, &message); err != nil {
				continue
			}
			if pending := h.getPending(worker, message.RequestID); pending != nil && pending.callbacks.OnStepArtifact != nil {
				pending.callbacks.OnStepArtifact(message)
			}
		case workerprotocol.WorkerMessageTypeStepFinished:
			var message workerprotocol.StepFinishedMessage
			if err := json.Unmarshal(raw, &message); err != nil {
				continue
			}
			if pending := h.getPending(worker, message.RequestID); pending != nil && pending.callbacks.OnStepFinished != nil {
				pending.callbacks.OnStepFinished(message.StepID, message.Status, message.ExitCode, message.ErrorMessage)
			}
		case workerprotocol.WorkerMessageTypeJobFinished:
			var message workerprotocol.JobFinishedMessage
			if err := json.Unmarshal(raw, &message); err != nil {
				continue
			}
			h.completePending(worker, message.RequestID, DispatchResult{
				Status:       message.Status,
				ErrorMessage: message.ErrorMessage,
			})
		}
	}
}

func (h *Hub) writeLoop(worker *workerConn) {
	for message := range worker.send {
		if err := worker.conn.WriteJSON(message); err != nil {
			_ = worker.conn.Close()
			return
		}
	}
}

func (h *Hub) selectWorker(req DispatchRequest) (*workerConn, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if len(h.workers) == 0 {
		return nil, errors.New("no worker connected")
	}

	if assignedID, ok := h.runAssignments[req.RunID]; ok {
		if worker, exists := h.workers[assignedID]; exists && h.canRun(worker, req) {
			return worker, nil
		}
		delete(h.runAssignments, req.RunID)
	}

	total := len(h.workerOrder)
	for i := 0; i < total; i++ {
		index := (h.nextIndex + i) % total
		workerID := h.workerOrder[index]
		worker, ok := h.workers[workerID]
		if !ok {
			continue
		}
		if !h.canRun(worker, req) {
			continue
		}
		h.nextIndex = (index + 1) % total
		if strings.TrimSpace(req.RunID) != "" {
			h.runAssignments[req.RunID] = worker.id
		}
		return worker, nil
	}

	return nil, errors.New("no available worker matches pipeline constraints")
}

func (h *Hub) canRun(worker *workerConn, req DispatchRequest) bool {
	worker.mu.Lock()
	defer worker.mu.Unlock()
	if worker.status != "online" {
		return false
	}
	if worker.busy >= worker.maxConcurrent {
		return false
	}
	if req.Environment != "" {
		if envLabel, ok := worker.labels["env"]; ok && envLabel != req.Environment {
			return false
		}
	}
	for _, capability := range req.RequiredCapability {
		if capability == "" {
			continue
		}
		if !worker.capabilityLookup[capability] {
			return false
		}
	}
	return true
}

func (h *Hub) completePending(worker *workerConn, requestID string, result DispatchResult) {
	worker.mu.Lock()
	pending, ok := worker.pending[requestID]
	if ok {
		delete(worker.pending, requestID)
		if worker.busy > 0 {
			worker.busy--
		}
	}
	worker.mu.Unlock()
	h.touchWorker(worker, nil)
	if !ok {
		return
	}
	pending.resultCh <- result
	close(pending.resultCh)
}

func (h *Hub) failPending(worker *workerConn, requestID string, result DispatchResult) {
	h.completePending(worker, requestID, result)
}

func (h *Hub) getPending(worker *workerConn, requestID string) *pendingDispatch {
	worker.mu.Lock()
	defer worker.mu.Unlock()
	return worker.pending[requestID]
}

func (h *Hub) touchWorker(worker *workerConn, lastError *string) {
	if h.store == nil {
		return
	}
	worker.mu.Lock()
	defer worker.mu.Unlock()
	_ = h.store.UpsertRunnerNode(context.Background(), store.RunnerNode{
		ID:             worker.id,
		Hostname:       worker.hostname,
		Version:        worker.version,
		Labels:         cloneLabels(worker.labels),
		Capabilities:   append([]string(nil), worker.capabilities...),
		Status:         worker.status,
		MaxConcurrency: worker.maxConcurrent,
		CurrentLoad:    worker.busy,
		LastHeartbeat:  worker.lastSeenAt,
		ConnectedAt:    &worker.connectedAt,
		LastError:      lastError,
	})
}

func (h *Hub) monitorLoop() {
	interval := h.leaseTTL / 2
	if interval < 5*time.Second {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-h.stopCh:
			return
		case <-ticker.C:
		}

		now := time.Now().UTC()
		h.mu.RLock()
		workers := make([]*workerConn, 0, len(h.workers))
		for _, worker := range h.workers {
			workers = append(workers, worker)
		}
		h.mu.RUnlock()

		for _, worker := range workers {
			worker.mu.Lock()
			lastSeen := worker.lastSeenAt
			worker.mu.Unlock()
			if now.Sub(lastSeen) <= h.leaseTTL {
				continue
			}
			_ = worker.conn.Close()
			h.unregister(worker, "worker lease expired")
		}
	}
}

func (h *Hub) markWorkerOffline(workerID string, reason string) {
	if h.store == nil {
		return
	}
	reasonCopy := reason
	_ = h.store.MarkRunnerNodeOffline(context.Background(), workerID, &reasonCopy)
}

func readHello(conn *websocket.Conn) (workerprotocol.HelloMessage, error) {
	_ = conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	defer conn.SetReadDeadline(time.Time{})

	var hello workerprotocol.HelloMessage
	if err := conn.ReadJSON(&hello); err != nil {
		return workerprotocol.HelloMessage{}, err
	}
	if hello.Type != workerprotocol.WorkerMessageTypeHello {
		return workerprotocol.HelloMessage{}, errors.New("first message must be hello")
	}
	if strings.TrimSpace(hello.WorkerID) == "" {
		return workerprotocol.HelloMessage{}, errors.New("workerId is required")
	}
	if hello.MaxConcurrent <= 0 {
		hello.MaxConcurrent = 1
	}
	return hello, nil
}

func randomID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf[:])
}

func cloneLabels(labels map[string]string) map[string]string {
	if len(labels) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(labels))
	for key, value := range labels {
		out[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	return out
}

func sanitizeCapabilities(values []string) []string {
	if len(values) == 0 {
		return []string{"shell"}
	}
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		capability := strings.TrimSpace(strings.ToLower(value))
		if capability == "" || seen[capability] {
			continue
		}
		seen[capability] = true
		out = append(out, capability)
	}
	if len(out) == 0 {
		return []string{"shell"}
	}
	return out
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func max(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
