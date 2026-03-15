package httpapi

import (
	"net/http"

	"github.com/hibiken/asynq"

	"spec-axis/runner/internal/domain"
	"spec-axis/runner/internal/httpx"
	"spec-axis/runner/internal/queue"
)

func (s *Server) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if !authorized(s.cfg.RunnerToken, r) {
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
