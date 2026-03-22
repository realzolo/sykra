package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"spec-axis/conductor/internal/artifacts"
	"spec-axis/conductor/internal/config"
	"spec-axis/conductor/internal/dispatch"
	"spec-axis/conductor/internal/events"
	"spec-axis/conductor/internal/httpapi"
	"spec-axis/conductor/internal/pipeline"
	"spec-axis/conductor/internal/store"
	"spec-axis/conductor/internal/workerhub"
)

func main() {
	configPath := flag.String("config", "", "path to conductor TOML config")
	flag.Parse()

	cfg, err := config.LoadWithOptions(config.LoadOptions{
		ConfigPath: *configPath,
	})
	if err != nil {
		log.Fatalf("config error: %v", err)
	}
	log.Printf(
		"conductor config loaded: analyze_timeout=%s worker_lease_ttl=%s",
		cfg.AnalyzeTimeout,
		cfg.WorkerLeaseTTL,
	)
	if err := requireCommandAvailable("docker", "info"); err != nil {
		log.Fatalf("docker preflight failed: %v", err)
	}

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

	storage := pipeline.NewLocalStorage(cfg.DataDir)
	artifactManager := &artifacts.Manager{Store: st, LocalDataDir: cfg.DataDir}
	executors := pipeline.NewExecutorRegistry()
	executors.Register("shell", &pipeline.ShellExecutor{})
	engine := &pipeline.Engine{
		Store:                 st,
		Executors:             executors,
		Storage:               storage,
		Artifacts:             artifactManager,
		Concurrency:           cfg.PipelineConcurrency,
		ArtifactRetentionDays: cfg.ArtifactRetentionDays,
		StudioURL:             cfg.StudioURL,
		StudioToken:           cfg.StudioToken,
	}
	hub := workerhub.New(st, cfg.WorkerLeaseTTL)
	hub.Start()
	defer hub.Stop()
	engine.WorkerHub = hub

	pipelineService := &pipeline.Service{
		Store:                 st,
		Storage:               storage,
		Artifacts:             artifactManager,
		ArtifactRetentionDays: cfg.ArtifactRetentionDays,
		StudioURL:             cfg.StudioURL,
		StudioToken:           cfg.StudioToken,
	}
	go pipelineService.RunScheduleLoop(ctx, 30*time.Second)
	go dispatch.RunAnalysisLoop(ctx, st, publisher, cfg.AnalyzeTimeout, cfg.Concurrency, 2*time.Second)
	go dispatch.RunPipelineLoop(ctx, st, engine, 1, 2*time.Second)

	httpServer := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: httpapi.New(cfg, pipelineService, hub).Handler(),
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
		log.Printf("conductor listening on :%s", cfg.Port)
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

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown error: %v", err)
	}
}

func requireCommandAvailable(name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	if err := cmd.Run(); err != nil {
		return err
	}
	return nil
}
