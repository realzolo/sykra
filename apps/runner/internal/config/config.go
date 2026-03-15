package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port                    string
	RunnerToken             string
	DatabaseURL             string
	RedisURL                string
	NatsURL                 string
	Concurrency             int
	Queue                   string
	AnalyzeTimeout          time.Duration
	PipelineQueue           string
	PipelineConcurrency     int
	PipelineRunTimeout      time.Duration
	DataDir                 string
	LogRetentionDays        int
	ArtifactRetentionDays   int
}

func Load() (Config, error) {
	cfg := Config{
		Port:                envString("RUNNER_PORT", "8200"),
		RunnerToken:         os.Getenv("RUNNER_TOKEN"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		RedisURL:            os.Getenv("REDIS_URL"),
		NatsURL:             os.Getenv("NATS_URL"),
		Concurrency:         envInt("RUNNER_CONCURRENCY", 4),
		Queue:               envString("RUNNER_QUEUE", "analysis"),
		PipelineQueue:       envString("PIPELINE_QUEUE", "pipelines"),
		PipelineConcurrency: envInt("PIPELINE_CONCURRENCY", 4),
		DataDir:             envString("RUNNER_DATA_DIR", "data"),
		LogRetentionDays:    envInt("PIPELINE_LOG_RETENTION_DAYS", 30),
		ArtifactRetentionDays: envInt("PIPELINE_ARTIFACT_RETENTION_DAYS", 30),
	}

	analyzeTimeoutRaw := envString("ANALYZE_TIMEOUT", "300s")
	analyzeTimeout, err := time.ParseDuration(analyzeTimeoutRaw)
	if err != nil {
		return Config{}, fmt.Errorf("invalid ANALYZE_TIMEOUT: %w", err)
	}
	cfg.AnalyzeTimeout = analyzeTimeout

	pipelineTimeoutRaw := envString("PIPELINE_RUN_TIMEOUT", "2h")
	pipelineTimeout, err := time.ParseDuration(pipelineTimeoutRaw)
	if err != nil {
		return Config{}, fmt.Errorf("invalid PIPELINE_RUN_TIMEOUT: %w", err)
	}
	cfg.PipelineRunTimeout = pipelineTimeout

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.RedisURL == "" {
		return Config{}, fmt.Errorf("REDIS_URL is required")
	}

	return cfg, nil
}

func envString(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}
