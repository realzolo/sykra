package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"

	"spec-axis/runner/internal/config"
	"spec-axis/runner/internal/events"
	"spec-axis/runner/internal/httpapi"
	"spec-axis/runner/internal/pipeline"
	"spec-axis/runner/internal/queue"
	"spec-axis/runner/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	ctx := context.Background()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db error: %v", err)
	}
	defer st.Close()

	publisher, err := events.NewPublisher(cfg.NatsURL)
	if err != nil {
		log.Fatalf("nats error: %v", err)
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
		cfg.Queue:        1,
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
	}

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

	pipelineService := &pipeline.Service{
		Store:      st,
		Queue:      client,
		QueueName:  cfg.PipelineQueue,
		RunTimeout: cfg.PipelineRunTimeout,
		Storage:    storage,
	}

	httpServer := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: httpapi.New(cfg, client, pipelineService).Handler(),
	}

	go func() {
		logRetention := time.Duration(cfg.LogRetentionDays) * 24 * time.Hour
		artifactRetention := time.Duration(cfg.ArtifactRetentionDays) * 24 * time.Hour
		storage.Cleanup(logRetention, artifactRetention)
		ticker := time.NewTicker(24 * time.Hour)
		for range ticker.C {
			storage.Cleanup(logRetention, artifactRetention)
		}
	}()

	go func() {
		log.Printf("runner listening on :%s", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	server.Shutdown()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown error: %v", err)
	}
}
