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
		Port:                   "8200",
		ConductorToken:         "",
		DatabaseURL:            "",
		EncryptionKey:          "",
		Concurrency:            4,
		PipelineConcurrency:    4,
		PipelineRunConcurrency: 1,
		DataDir:                "data",
		LogRetentionDays:       30,
		ArtifactRetentionDays:  30,
	}

	analyzeTimeoutRaw := "1h"
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
		applyFileConfig(&cfg, fileCfg, &analyzeTimeoutRaw, &workerLeaseTTLRaw)
	}

	cfg.Port = envString("CONDUCTOR_PORT", cfg.Port)
	cfg.ConductorToken = envString("CONDUCTOR_TOKEN", cfg.ConductorToken)
	cfg.DatabaseURL = envString("DATABASE_URL", cfg.DatabaseURL)
	cfg.EncryptionKey = envString("ENCRYPTION_KEY", cfg.EncryptionKey)
	cfg.Concurrency = envInt("CONDUCTOR_CONCURRENCY", cfg.Concurrency)
	cfg.PipelineConcurrency = envInt("PIPELINE_CONCURRENCY", cfg.PipelineConcurrency)
	cfg.PipelineRunConcurrency = envInt("PIPELINE_RUN_CONCURRENCY", cfg.PipelineRunConcurrency)
	cfg.DataDir = envString("CONDUCTOR_DATA_DIR", cfg.DataDir)
	cfg.LogRetentionDays = envInt("PIPELINE_LOG_RETENTION_DAYS", cfg.LogRetentionDays)
	cfg.ArtifactRetentionDays = envInt("PIPELINE_ARTIFACT_RETENTION_DAYS", cfg.ArtifactRetentionDays)
	cfg.StudioURL = envString("STUDIO_URL", cfg.StudioURL)
	cfg.StudioToken = envString("STUDIO_TOKEN", cfg.StudioToken)

	// Backward/ergonomic default: if a dedicated Studio token isn't provided,
	// reuse the conductor token so a single shared secret can secure both directions
	// (Studio -> Conductor and Conductor -> Studio).
	if cfg.StudioToken == "" {
		cfg.StudioToken = cfg.ConductorToken
	}
	if cfg.StudioToken == "" {
		// Allows local development without configuring tokens, while still letting
		// Studio distinguish conductor calls from normal browser traffic.
		cfg.StudioToken = "dev-conductor"
	}

	analyzeTimeoutRaw = envString("ANALYZE_TIMEOUT", analyzeTimeoutRaw)
	workerLeaseTTLRaw = envString("WORKER_LEASE_TTL", workerLeaseTTLRaw)

	analyzeTimeout, err := time.ParseDuration(analyzeTimeoutRaw)
	if err != nil {
		return Config{}, fmt.Errorf("invalid ANALYZE_TIMEOUT: %w", err)
	}
	cfg.AnalyzeTimeout = analyzeTimeout

	leaseTTL, err := time.ParseDuration(workerLeaseTTLRaw)
	if err != nil {
		return Config{}, fmt.Errorf("invalid WORKER_LEASE_TTL: %w", err)
	}
	cfg.WorkerLeaseTTL = leaseTTL

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
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
