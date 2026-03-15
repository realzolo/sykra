package httpapi

import (
	"net/http"
	"strings"

	"github.com/hibiken/asynq"

	"spec-axis/runner/internal/config"
	"spec-axis/runner/internal/pipeline"
)

type Server struct {
	cfg        config.Config
	client     *asynq.Client
	pipelineAPI *pipeline.API
}

func New(cfg config.Config, client *asynq.Client, pipelineService *pipeline.Service) *Server {
	return &Server{
		cfg:        cfg,
		client:     client,
		pipelineAPI: pipeline.NewAPI(pipelineService, func(r *http.Request) bool { return authorized(cfg.RunnerToken, r) }),
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
	s.pipelineAPI.Register(mux)

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

	return headerToken != "" && headerToken == token
}
