package httpapi

import (
	"net/http"

	"github.com/hibiken/asynq"

	"spec-axis/scheduler/internal/domain"
	"spec-axis/scheduler/internal/httpx"
	"spec-axis/scheduler/internal/queue"
)

func (s *Server) handleCodeReview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !authorized(s.cfg.SchedulerToken, r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var payload domain.CodeReviewRequest
	if err := httpx.ReadJSON(r, 2<<20, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if payload.ProjectID == "" || payload.RunID == "" || payload.Repo == "" || payload.ProfileID == "" || payload.ProfileVersionID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "missing required fields")
		return
	}

	task, err := queue.NewCodeReviewTask(payload)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create task")
		return
	}
	options := []asynq.Option{
		asynq.Queue(s.cfg.Queue),
		asynq.MaxRetry(1),
		asynq.Timeout(s.cfg.AnalyzeTimeout),
		asynq.TaskID("code-review:" + payload.RunID),
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
