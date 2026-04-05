package httpapi

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"sykra/conductor/internal/config"
	"sykra/conductor/internal/pipeline"
	"sykra/conductor/internal/workerhub"
)

type Server struct {
	cfg         config.Config
	pipelineSvc *pipeline.Service
	pipelineAPI *pipeline.API
	workerHub   *workerhub.Hub
}

func New(cfg config.Config, pipelineService *pipeline.Service, workerHub *workerhub.Hub) *Server {
	return &Server{
		cfg:         cfg,
		pipelineSvc: pipelineService,
		pipelineAPI: pipeline.NewAPI(pipelineService, func(r *http.Request) bool { return authorized(cfg.ConductorToken, r) }),
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
		checkCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := pipeline.CheckDockerAvailable(checkCtx); err != nil {
			http.Error(w, "docker not ready", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready"))
	})

	s.pipelineAPI.Register(mux)
	mux.HandleFunc("/v1/workers", s.handleWorkersList)
	mux.HandleFunc("/v1/workers/", s.handleWorkerState)
	mux.HandleFunc("/v1/workers/connect", s.handleWorkerConnect)
	mux.HandleFunc("/v1/workers/artifacts/upload", s.handleWorkerArtifactUpload)

	return mux
}

func authorized(token string, r *http.Request) bool {
	if token == "" {
		return false
	}

	headerToken := r.Header.Get("X-Conductor-Token")
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
