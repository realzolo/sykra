package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"

	"spec-axis/scheduler/internal/artifacts"
	"spec-axis/scheduler/internal/config"
	"spec-axis/scheduler/internal/events"
	"spec-axis/scheduler/internal/httpapi"
	"spec-axis/scheduler/internal/pipeline"
	"spec-axis/scheduler/internal/queue"
	"spec-axis/scheduler/internal/store"
	"spec-axis/scheduler/internal/workerhub"
)

func main() {
	configPath := flag.String("config", "", "path to scheduler TOML config")
	flag.Parse()

	cfg, err := config.LoadWithOptions(config.LoadOptions{
		ConfigPath: *configPath,
	})
	if err != nil {
		log.Fatalf("config error: %v", err)
	}
	log.Printf(
		"scheduler config loaded: queue=%s analyze_timeout=%s pipeline_queue=%s pipeline_run_timeout=%s worker_lease_ttl=%s",
		cfg.Queue,
		cfg.AnalyzeTimeout,
		cfg.PipelineQueue,
		cfg.PipelineRunTimeout,
		cfg.WorkerLeaseTTL,
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db error: %v", err)
	}
	defer st.Close()

	publisher, err := events.NewPublisher()
	if err != nil {
		log.Fatalf("publisher error: %v", err)
	}
	defer func() {
		if publisher != nil {
			publisher.Close()
		}
	}()

	redisOpt, err := queue.ParseRedisURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis error: %v", err)
	}

	queueWeights := map[string]int{
		cfg.Queue:         1,
		cfg.PipelineQueue: 1,
	}
	server := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: cfg.Concurrency,
		Queues:      queueWeights,
	})

	storage := pipeline.NewLocalStorage(cfg.DataDir)
	executors := pipeline.NewExecutorRegistry()
	executors.Register("shell", &pipeline.ShellExecutor{})
	engine := &pipeline.Engine{
		Store:       st,
		Executors:   executors,
		Storage:     storage,
		Concurrency: cfg.PipelineConcurrency,
		StudioURL:   cfg.StudioURL,
		StudioToken: cfg.StudioToken,
	}
	hub := workerhub.New(st, cfg.WorkerLeaseTTL)
	hub.Start()
	defer hub.Stop()
	engine.WorkerHub = hub

	mux := asynq.NewServeMux()
	mux.HandleFunc(queue.TaskTypeAnalyze, queue.HandleAnalyzeTask(st, publisher, cfg.AnalyzeTimeout))
	mux.HandleFunc(queue.TaskTypePipelineRun, queue.HandlePipelineRunTask(engine))

	go func() {
		if err := server.Run(mux); err != nil {
			log.Fatalf("asynq server error: %v", err)
		}
	}()

	client := asynq.NewClient(redisOpt)
	defer client.Close()
	inspector := asynq.NewInspector(redisOpt)
	defer inspector.Close()

	pipelineService := &pipeline.Service{
		Store:                 st,
		Queue:                 client,
		QueueName:             cfg.PipelineQueue,
		RunTimeout:            cfg.PipelineRunTimeout,
		Storage:               storage,
		Artifacts:             &artifacts.Manager{Store: st, LocalDataDir: cfg.DataDir},
		ArtifactRetentionDays: cfg.ArtifactRetentionDays,
		StudioURL:             cfg.StudioURL,
		StudioToken:           cfg.StudioToken,
	}
	go pipelineService.RunScheduleLoop(ctx, 30*time.Second)

	httpServer := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: httpapi.New(cfg, client, inspector, pipelineService, hub).Handler(),
	}

	go func() {
		logRetention := time.Duration(cfg.LogRetentionDays) * 24 * time.Hour
		storage.Cleanup(logRetention, 0)
		if _, err := pipelineService.Artifacts.CleanupExpiredArtifacts(context.Background(), 500); err != nil {
			log.Printf("artifact cleanup failed: %v", err)
		}
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			storage.Cleanup(logRetention, 0)
			if _, err := pipelineService.Artifacts.CleanupExpiredArtifacts(context.Background(), 500); err != nil {
				log.Printf("artifact cleanup failed: %v", err)
			}
		}
	}()

	go func() {
		log.Printf("scheduler listening on :%s", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	cancel()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	server.Shutdown()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown error: %v", err)
	}
}
