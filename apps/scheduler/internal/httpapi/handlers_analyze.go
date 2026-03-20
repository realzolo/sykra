package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/hibiken/asynq"

	"spec-axis/scheduler/internal/domain"
	"spec-axis/scheduler/internal/httpx"
	"spec-axis/scheduler/internal/queue"
)

func (s *Server) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if !authorized(s.cfg.SchedulerToken, r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var payload domain.AnalyzeRequest
	if err := httpx.ReadJSON(r, 2<<20, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json")
		return
	}

	if payload.ProjectID == "" || payload.ReportID == "" || payload.Repo == "" || len(payload.Hashes) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "missing required fields")
		return
	}

	task, err := queue.NewAnalyzeTask(payload)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create task")
		return
	}

	options := []asynq.Option{
		asynq.Queue(s.cfg.Queue),
		asynq.MaxRetry(3),
		asynq.Timeout(s.cfg.AnalyzeTimeout),
	}
	if payload.ReportID != "" {
		options = append(options, asynq.TaskID("analyze:"+payload.ReportID))
	}

	info, err := s.client.Enqueue(task, options...)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to enqueue task")
		return
	}

	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{
		"taskId": info.ID,
	})
}

func (s *Server) handleAnalyzeTaskControl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if !authorized(s.cfg.SchedulerToken, r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	reportID, ok := parseAnalyzeCancelPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if s.inspector == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "inspector is not initialized")
		return
	}

	taskID := "analyze:" + reportID
	deleteErr := s.inspector.DeleteTask(s.cfg.Queue, taskID)
	if deleteErr != nil &&
		!errors.Is(deleteErr, asynq.ErrTaskNotFound) &&
		!errors.Is(deleteErr, asynq.ErrQueueNotFound) {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to remove queued analyze task")
		return
	}

	if err := s.inspector.CancelProcessing(taskID); err != nil &&
		!errors.Is(err, asynq.ErrTaskNotFound) {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to cancel running analyze task")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"taskId": taskID,
	})
}

func parseAnalyzeCancelPath(path string) (reportID string, ok bool) {
	const prefix = "/v1/tasks/analyze/"
	const suffix = "/cancel"

	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}

	reportID = strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	reportID = strings.Trim(reportID, "/")
	if reportID == "" || strings.Contains(reportID, "/") {
		return "", false
	}
	return reportID, true
}
