package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"spec-axis/scheduler/internal/httpx"
	"spec-axis/scheduler/internal/pipeline"
)

func (s *Server) handleWorkersList(w http.ResponseWriter, r *http.Request) {
	if !authorized(s.cfg.SchedulerToken, r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if r.Method != http.MethodGet {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.workerHub == nil {
		httpx.WriteJSON(w, http.StatusOK, []any{})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.workerHub.ListWorkers())
}

func (s *Server) handleWorkerConnect(w http.ResponseWriter, r *http.Request) {
	if !authorized(s.cfg.SchedulerToken, r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if r.Method != http.MethodGet {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.workerHub == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "worker hub is not enabled")
		return
	}
	if err := s.workerHub.ServeWS(w, r); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	}
}

func (s *Server) handleWorkerState(w http.ResponseWriter, r *http.Request) {
	if !authorized(s.cfg.SchedulerToken, r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if r.Method != http.MethodPost {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.workerHub == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "worker hub is not enabled")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/v1/workers/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || parts[0] == "" {
		httpx.WriteError(w, http.StatusBadRequest, "invalid worker path")
		return
	}
	workerID := parts[0]
	action := parts[1]

	switch action {
	case "drain":
		if err := s.workerHub.SetWorkerDraining(workerID, true); err != nil {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "status": "draining"})
	case "resume":
		if err := s.workerHub.SetWorkerDraining(workerID, false); err != nil {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "status": "online"})
	default:
		httpx.WriteError(w, http.StatusNotFound, "unknown worker action")
	}
}

func (s *Server) handleWorkerArtifactUpload(w http.ResponseWriter, r *http.Request) {
	if !authorized(s.cfg.SchedulerToken, r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if r.Method != http.MethodPut {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.pipelineSvc == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "pipeline service is not available")
		return
	}

	runID := strings.TrimSpace(r.URL.Query().Get("runId"))
	jobID := strings.TrimSpace(r.URL.Query().Get("jobId"))
	stepKey := strings.TrimSpace(r.URL.Query().Get("stepKey"))
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	attempt := intFromHeader(r, "X-Artifact-Upload-Attempt", 1)
	maxAttempts := intFromHeader(r, "X-Artifact-Upload-Max-Attempts", 1)

	startedAt := time.Now().UTC()
	artifact, err := s.pipelineSvc.UploadWorkerArtifact(r.Context(), pipeline.UploadWorkerArtifactInput{
		RunID:         runID,
		JobID:         jobID,
		StepKey:       stepKey,
		Path:          path,
		Content:       r.Body,
		ContentLength: r.ContentLength,
		Attempt:       attempt,
		MaxAttempts:   maxAttempts,
	})
	if err != nil {
		if strings.TrimSpace(runID) != "" {
			_ = s.pipelineSvc.Store.AppendRunEvent(r.Context(), runID, "step.artifact.upload_failed", map[string]any{
				"runId":         runID,
				"jobId":         jobID,
				"stepKey":       stepKey,
				"path":          path,
				"attempt":       attempt,
				"maxAttempts":   maxAttempts,
				"failedAt":      time.Now().UTC().Format(time.RFC3339),
				"handlingMs":    time.Since(startedAt).Milliseconds(),
				"error":         err.Error(),
				"errorCategory": categorizeUploadError(err),
			})
		}
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = s.pipelineSvc.Store.AppendRunEvent(r.Context(), runID, "step.artifact.upload_observed", map[string]any{
		"runId":       runID,
		"jobId":       jobID,
		"stepKey":     stepKey,
		"path":        path,
		"attempt":     attempt,
		"maxAttempts": maxAttempts,
		"handlingMs":  time.Since(startedAt).Milliseconds(),
		"observedAt":  time.Now().UTC().Format(time.RFC3339),
	})
	httpx.WriteJSON(w, http.StatusOK, artifact)
}

func intFromHeader(r *http.Request, key string, fallback int) int {
	value := strings.TrimSpace(r.Header.Get(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func categorizeUploadError(err error) string {
	lower := strings.ToLower(strings.TrimSpace(err.Error()))
	switch {
	case strings.Contains(lower, "not found"):
		return "not_found"
	case strings.Contains(lower, "required"), strings.Contains(lower, "invalid"):
		return "validation"
	case strings.Contains(lower, "artifact manager"):
		return "configuration"
	case strings.Contains(lower, "s3"):
		return "storage_backend"
	default:
		return "unknown"
	}
}
