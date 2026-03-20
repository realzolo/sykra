package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port                  string
	RunnerToken           string
	DatabaseURL           string
	RedisURL              string
	EncryptionKey         string
	Concurrency           int
	Queue                 string
	AnalyzeTimeout        time.Duration
	PipelineQueue         string
	PipelineConcurrency   int
	PipelineRunTimeout    time.Duration
	DataDir               string
	LogRetentionDays      int
	ArtifactRetentionDays int
	// Studio integration — used by source_checkout and review_gate job types
	StudioURL   string
	StudioToken string
	// Worker control plane settings.
	WorkerLeaseTTL    time.Duration
	RequireWorkerNode bool
}

func Load() (Config, error) {
	return LoadWithOptions(LoadOptions{})
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

func envBool(key string, fallback bool) bool {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	switch raw {
	case "1", "true", "TRUE", "yes", "YES", "on", "ON":
		return true
	case "0", "false", "FALSE", "no", "NO", "off", "OFF":
		return false
	default:
		return fallback
	}
}
