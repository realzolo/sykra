package httpapi

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/hibiken/asynq"

	"spec-axis/runner/internal/config"
	"spec-axis/runner/internal/pipeline"
	"spec-axis/runner/internal/workerhub"
)

type Server struct {
	cfg         config.Config
	client      *asynq.Client
	inspector   *asynq.Inspector
	pipelineSvc *pipeline.Service
	pipelineAPI *pipeline.API
	workerHub   *workerhub.Hub
}

func New(cfg config.Config, client *asynq.Client, inspector *asynq.Inspector, pipelineService *pipeline.Service, workerHub *workerhub.Hub) *Server {
	return &Server{
		cfg:         cfg,
		client:      client,
		inspector:   inspector,
		pipelineSvc: pipelineService,
		pipelineAPI: pipeline.NewAPI(pipelineService, func(r *http.Request) bool { return authorized(cfg.RunnerToken, r) }),
		workerHub:   workerHub,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready"))
	})

	mux.HandleFunc("/v1/tasks/analyze", s.handleAnalyze)
	mux.HandleFunc("/v1/tasks/analyze/", s.handleAnalyzeTaskControl)
	s.pipelineAPI.Register(mux)
	mux.HandleFunc("/v1/workers", s.handleWorkersList)
	mux.HandleFunc("/v1/workers/", s.handleWorkerState)
	mux.HandleFunc("/v1/workers/connect", s.handleWorkerConnect)
	mux.HandleFunc("/v1/workers/artifacts/upload", s.handleWorkerArtifactUpload)

	return mux
}

func authorized(token string, r *http.Request) bool {
	if token == "" {
		return true
	}

	headerToken := r.Header.Get("X-Runner-Token")
	if headerToken == "" {
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
			headerToken = strings.TrimSpace(auth[7:])
		}
	}

	if headerToken == "" {
		return false
	}
	// Constant-time compare to avoid leaking token length/prefix via timing.
	if len(headerToken) != len(token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(headerToken), []byte(token)) == 1
}
