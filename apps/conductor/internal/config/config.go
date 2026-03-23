package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port                   string
	ConductorToken         string
	DatabaseURL            string
	EncryptionKey          string
	Concurrency            int
	AnalyzeTimeout         time.Duration
	PipelineConcurrency    int
	PipelineRunConcurrency int
	DataDir                string
	LogRetentionDays       int
	ArtifactRetentionDays  int
	// Studio integration — used for Conductor -> Studio callbacks/events.
	StudioURL   string
	StudioToken string
	// Worker control plane settings.
	WorkerLeaseTTL time.Duration
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
