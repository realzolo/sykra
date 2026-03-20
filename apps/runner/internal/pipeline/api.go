package pipeline

import (
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"spec-axis/runner/internal/httpx"
)

type API struct {
	service    *Service
	authorized func(*http.Request) bool
}

func NewAPI(service *Service, authorized func(*http.Request) bool) *API {
	return &API{service: service, authorized: authorized}
}

func (a *API) Register(mux *http.ServeMux) {
	mux.HandleFunc("/v1/pipelines", a.handlePipelines)
	mux.HandleFunc("/v1/pipelines/", a.handlePipelineByID)
	mux.HandleFunc("/v1/pipeline-runs/", a.handlePipelineRuns)
}

func (a *API) handlePipelines(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		orgID := r.URL.Query().Get("orgId")
		projectID := r.URL.Query().Get("projectId")
		if orgID == "" {
			httpx.WriteError(w, http.StatusBadRequest, "orgId is required")
			return
		}
		items, err := a.service.ListPipelines(r.Context(), orgID, projectID)
		if err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
		httpx.WriteJSON(w, http.StatusOK, items)
	case http.MethodPost:
		var payload struct {
			OrgID               string         `json:"orgId"`
			ProjectID           *string        `json:"projectId,omitempty"`
			Name                string         `json:"name"`
			Description         string         `json:"description"`
			Config              PipelineConfig `json:"config"`
			CreatedBy           string         `json:"createdBy"`
			Environment         string         `json:"environment"`
			AutoTrigger         bool           `json:"autoTrigger"`
			TriggerBranch       string         `json:"triggerBranch"`
			QualityGateEnabled  bool           `json:"qualityGateEnabled"`
			QualityGateMinScore int            `json:"qualityGateMinScore"`
			NotifyOnSuccess     bool           `json:"notifyOnSuccess"`
			NotifyOnFailure     bool           `json:"notifyOnFailure"`
		}
		if err := httpx.ReadJSON(r, 2<<20, &payload); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid json")
			return
		}
		pipeline, version, err := a.service.CreatePipeline(r.Context(), CreatePipelineInput{
			OrgID:               payload.OrgID,
			ProjectID:           payload.ProjectID,
			Name:                payload.Name,
			Description:         payload.Description,
			Config:              payload.Config,
			CreatedBy:           payload.CreatedBy,
			Environment:         payload.Environment,
			AutoTrigger:         payload.AutoTrigger,
			TriggerBranch:       payload.TriggerBranch,
			QualityGateEnabled:  payload.QualityGateEnabled,
			QualityGateMinScore: payload.QualityGateMinScore,
			NotifyOnSuccess:     payload.NotifyOnSuccess,
			NotifyOnFailure:     payload.NotifyOnFailure,
		})
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{
			"pipeline": pipeline,
			"version":  version,
		})
	default:
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (a *API) handlePipelineByID(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/v1/pipelines/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		httpx.WriteError(w, http.StatusBadRequest, "pipeline id is required")
		return
	}
	pipelineID := parts[0]
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			pipeline, version, err := a.service.GetPipeline(r.Context(), pipelineID)
			if err != nil {
				httpx.WriteError(w, http.StatusInternalServerError, err.Error())
				return
			}
			if pipeline == nil {
				httpx.WriteError(w, http.StatusNotFound, "pipeline not found")
				return
			}
			httpx.WriteJSON(w, http.StatusOK, map[string]any{
				"pipeline": pipeline,
				"version":  version,
			})
		case http.MethodPut:
			var payload struct {
				Name                string         `json:"name"`
				Description         string         `json:"description"`
				Config              PipelineConfig `json:"config"`
				Environment         string         `json:"environment"`
				AutoTrigger         bool           `json:"autoTrigger"`
				TriggerBranch       string         `json:"triggerBranch"`
				QualityGateEnabled  bool           `json:"qualityGateEnabled"`
				QualityGateMinScore int            `json:"qualityGateMinScore"`
				NotifyOnSuccess     bool           `json:"notifyOnSuccess"`
				NotifyOnFailure     bool           `json:"notifyOnFailure"`
				UpdatedBy           string         `json:"updatedBy"`
			}
			if err := httpx.ReadJSON(r, 2<<20, &payload); err != nil {
				httpx.WriteError(w, http.StatusBadRequest, "invalid json")
				return
			}
			version, err := a.service.UpdatePipeline(r.Context(), UpdatePipelineInput{
				PipelineID:          pipelineID,
				Name:                payload.Name,
				Description:         payload.Description,
				Config:              payload.Config,
				Environment:         payload.Environment,
				AutoTrigger:         payload.AutoTrigger,
				TriggerBranch:       payload.TriggerBranch,
				QualityGateEnabled:  payload.QualityGateEnabled,
				QualityGateMinScore: payload.QualityGateMinScore,
				NotifyOnSuccess:     payload.NotifyOnSuccess,
				NotifyOnFailure:     payload.NotifyOnFailure,
				UpdatedBy:           payload.UpdatedBy,
			})
			if err != nil {
				httpx.WriteError(w, http.StatusBadRequest, err.Error())
				return
			}
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"version": version})
		default:
			httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

	if len(parts) == 2 && parts[1] == "runs" {
		switch r.Method {
		case http.MethodGet:
			limit := 20
			if raw := r.URL.Query().Get("limit"); raw != "" {
				if value, err := strconv.Atoi(raw); err == nil {
					limit = value
				}
			}
			items, err := a.service.ListRuns(r.Context(), pipelineID, limit)
			if err != nil {
				httpx.WriteError(w, http.StatusInternalServerError, err.Error())
				return
			}
			httpx.WriteJSON(w, http.StatusOK, items)
		case http.MethodPost:
			var payload struct {
				TriggerType    string         `json:"triggerType"`
				TriggeredBy    string         `json:"triggeredBy"`
				IdempotencyKey string         `json:"idempotencyKey"`
				RollbackOf     *string        `json:"rollbackOf,omitempty"`
				Metadata       map[string]any `json:"metadata"`
			}
			if err := httpx.ReadJSON(r, 2<<20, &payload); err != nil {
				httpx.WriteError(w, http.StatusBadRequest, "invalid json")
				return
			}
			if payload.TriggerType == "" {
				payload.TriggerType = "manual"
			}
			run, err := a.service.TriggerRun(r.Context(), TriggerRunInput{
				PipelineID:     pipelineID,
				TriggerType:    payload.TriggerType,
				TriggeredBy:    payload.TriggeredBy,
				IdempotencyKey: payload.IdempotencyKey,
				RollbackOf:     payload.RollbackOf,
				Metadata:       payload.Metadata,
			})
			if err != nil {
				httpx.WriteError(w, http.StatusBadRequest, err.Error())
				return
			}
			httpx.WriteJSON(w, http.StatusAccepted, run)
		default:
			httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

	httpx.WriteError(w, http.StatusNotFound, "not found")
}

func (a *API) handlePipelineRuns(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/v1/pipeline-runs/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		httpx.WriteError(w, http.StatusBadRequest, "run id is required")
		return
	}
	runID := parts[0]

	if len(parts) == 2 && parts[1] == "cancel" {
		if r.Method != http.MethodPost {
			httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if err := a.service.CancelRun(r.Context(), runID); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	if len(parts) == 1 {
		if r.Method != http.MethodGet {
			httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		detail, err := a.service.GetRunDetail(r.Context(), runID)
		if err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if detail == nil {
			httpx.WriteError(w, http.StatusNotFound, "run not found")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, detail)
		return
	}

	if len(parts) >= 2 && parts[1] == "events" {
		if r.Method != http.MethodGet {
			httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		afterSeq := int64(0)
		if raw := r.URL.Query().Get("after"); raw != "" {
			if value, err := strconv.ParseInt(raw, 10, 64); err == nil {
				afterSeq = value
			}
		}
		limit := 200
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if value, err := strconv.Atoi(raw); err == nil {
				limit = value
			}
		}
		events, err := a.service.ListEvents(r.Context(), runID, afterSeq, limit)
		if err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
		httpx.WriteJSON(w, http.StatusOK, events)
		return
	}

	if len(parts) >= 4 && parts[1] == "artifacts" && parts[3] == "content" {
		if r.Method != http.MethodGet {
			httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		artifactID := parts[2]
		artifact, content, err := a.service.OpenArtifactContent(r.Context(), runID, artifactID)
		if err != nil {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		defer content.Reader.Close()

		filename := filepath.Base(artifact.Path)
		if filename == "." || filename == "" {
			filename = "artifact.bin"
		}
		contentType := strings.TrimSpace(content.ContentType)
		if contentType == "" {
			contentType = mime.TypeByExtension(filepath.Ext(filename))
		}
		if contentType == "" {
			contentType = "application/octet-stream"
		}

		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
		if content.ContentSize > 0 {
			w.Header().Set("Content-Length", strconv.FormatInt(content.ContentSize, 10))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, content.Reader)
		return
	}

	if len(parts) >= 3 && parts[1] == "logs" {
		if r.Method != http.MethodGet {
			httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		stepID := parts[2]
		offset := int64(0)
		if raw := r.URL.Query().Get("offset"); raw != "" {
			if value, err := strconv.ParseInt(raw, 10, 64); err == nil {
				offset = value
			}
		}
		limit := int64(200000)
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if value, err := strconv.ParseInt(raw, 10, 64); err == nil {
				limit = value
			}
		}
		data, next, err := a.service.ReadLog(r.Context(), stepID, offset, limit)
		if err != nil {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Log-Next-Offset", strconv.FormatInt(next, 10))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
		return
	}

	httpx.WriteError(w, http.StatusNotFound, "not found")
}
