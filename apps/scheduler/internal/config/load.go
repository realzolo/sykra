package config

import (
	"fmt"
	"os"
	"time"
)

type LoadOptions struct {
	ConfigPath string
}

func LoadWithOptions(opts LoadOptions) (Config, error) {
	cfg := Config{
		Port:                  "8200",
		SchedulerToken:        "",
		DatabaseURL:           "",
		RedisURL:              "",
		EncryptionKey:         "",
		Concurrency:           4,
		Queue:                 "analysis",
		PipelineQueue:         "pipelines",
		PipelineConcurrency:   4,
		DataDir:               "data",
		LogRetentionDays:      30,
		ArtifactRetentionDays: 30,
	}

	analyzeTimeoutRaw := "1h"
	pipelineTimeoutRaw := "2h"
	workerLeaseTTLRaw := "45s"

	configPath, err := resolveConfigPath(opts.ConfigPath)
	if err != nil {
		return Config{}, err
	}
	if configPath != "" {
		fileCfg, err := loadFileConfig(configPath)
		if err != nil {
			return Config{}, err
		}
		applyFileConfig(&cfg, fileCfg, &analyzeTimeoutRaw, &pipelineTimeoutRaw, &workerLeaseTTLRaw)
	}

	cfg.Port = envString("SCHEDULER_PORT", cfg.Port)
	cfg.SchedulerToken = envString("SCHEDULER_TOKEN", cfg.SchedulerToken)
	cfg.DatabaseURL = envString("DATABASE_URL", cfg.DatabaseURL)
	cfg.RedisURL = envString("REDIS_URL", cfg.RedisURL)
	cfg.EncryptionKey = envString("ENCRYPTION_KEY", cfg.EncryptionKey)
	cfg.Concurrency = envInt("SCHEDULER_CONCURRENCY", cfg.Concurrency)
	cfg.Queue = envString("SCHEDULER_QUEUE", cfg.Queue)
	cfg.PipelineQueue = envString("PIPELINE_QUEUE", cfg.PipelineQueue)
	cfg.PipelineConcurrency = envInt("PIPELINE_CONCURRENCY", cfg.PipelineConcurrency)
	cfg.DataDir = envString("SCHEDULER_DATA_DIR", cfg.DataDir)
	cfg.LogRetentionDays = envInt("PIPELINE_LOG_RETENTION_DAYS", cfg.LogRetentionDays)
	cfg.ArtifactRetentionDays = envInt("PIPELINE_ARTIFACT_RETENTION_DAYS", cfg.ArtifactRetentionDays)
	cfg.StudioURL = envString("STUDIO_URL", cfg.StudioURL)
	cfg.StudioToken = envString("STUDIO_TOKEN", cfg.StudioToken)

	// Backward/ergonomic default: if a dedicated Studio token isn't provided,
	// reuse the scheduler token so a single shared secret can secure both directions
	// (Studio -> Scheduler and Scheduler -> Studio).
	if cfg.StudioToken == "" {
		cfg.StudioToken = cfg.SchedulerToken
	}
	if cfg.StudioToken == "" {
		// Allows local development without configuring tokens, while still letting
		// Studio distinguish scheduler calls from normal browser traffic.
		cfg.StudioToken = "dev-scheduler"
	}

	analyzeTimeoutRaw = envString("ANALYZE_TIMEOUT", analyzeTimeoutRaw)
	pipelineTimeoutRaw = envString("PIPELINE_RUN_TIMEOUT", pipelineTimeoutRaw)
	workerLeaseTTLRaw = envString("WORKER_LEASE_TTL", workerLeaseTTLRaw)

	analyzeTimeout, err := time.ParseDuration(analyzeTimeoutRaw)
	if err != nil {
		return Config{}, fmt.Errorf("invalid ANALYZE_TIMEOUT: %w", err)
	}
	cfg.AnalyzeTimeout = analyzeTimeout

	pipelineTimeout, err := time.ParseDuration(pipelineTimeoutRaw)
	if err != nil {
		return Config{}, fmt.Errorf("invalid PIPELINE_RUN_TIMEOUT: %w", err)
	}
	cfg.PipelineRunTimeout = pipelineTimeout

	leaseTTL, err := time.ParseDuration(workerLeaseTTLRaw)
	if err != nil {
		return Config{}, fmt.Errorf("invalid WORKER_LEASE_TTL: %w", err)
	}
	cfg.WorkerLeaseTTL = leaseTTL

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.RedisURL == "" {
		return Config{}, fmt.Errorf("REDIS_URL is required")
	}
	if cfg.EncryptionKey != "" && os.Getenv("ENCRYPTION_KEY") == "" {
		_ = os.Setenv("ENCRYPTION_KEY", cfg.EncryptionKey)
	}
	if cfg.StudioURL != "" && os.Getenv("STUDIO_URL") == "" {
		_ = os.Setenv("STUDIO_URL", cfg.StudioURL)
	}
	if cfg.StudioToken != "" && os.Getenv("STUDIO_TOKEN") == "" {
		_ = os.Setenv("STUDIO_TOKEN", cfg.StudioToken)
	}

	return cfg, nil
}
