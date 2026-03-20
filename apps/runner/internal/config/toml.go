package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

type fileConfig struct {
	Runner   runnerConfig   `toml:"runner"`
	Database databaseConfig `toml:"database"`
	Redis    redisConfig    `toml:"redis"`
	Pipeline pipelineConfig `toml:"pipeline"`
	Worker   workerConfig   `toml:"worker"`
	Security securityConfig `toml:"security"`
	Studio   studioConfig   `toml:"studio"`
}

type runnerConfig struct {
	Port           *string `toml:"port"`
	Token          *string `toml:"token"`
	Concurrency    *int    `toml:"concurrency"`
	Queue          *string `toml:"queue"`
	AnalyzeTimeout *string `toml:"analyze_timeout"`
	DataDir        *string `toml:"data_dir"`
}

type databaseConfig struct {
	URL *string `toml:"url"`
}

type redisConfig struct {
	URL *string `toml:"url"`
}

type pipelineConfig struct {
	Queue                 *string `toml:"queue"`
	Concurrency           *int    `toml:"concurrency"`
	RunTimeout            *string `toml:"run_timeout"`
	LogRetentionDays      *int    `toml:"log_retention_days"`
	ArtifactRetentionDays *int    `toml:"artifact_retention_days"`
	RequireWorker         *bool   `toml:"require_worker"`
}

type workerConfig struct {
	LeaseTTL *string `toml:"lease_ttl"`
}

type securityConfig struct {
	EncryptionKey *string `toml:"encryption_key"`
}

type studioConfig struct {
	URL   *string `toml:"url"`
	Token *string `toml:"token"`
}

func resolveConfigPath(explicitPath string) (string, error) {
	if explicitPath != "" {
		return ensureFileExists(explicitPath)
	}
	if envPath := os.Getenv("RUNNER_CONFIG"); envPath != "" {
		return ensureFileExists(envPath)
	}

	candidates := []string{
		filepath.Join("apps", "runner", "config.toml"),
		"config.toml",
	}
	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate, nil
		}
	}
	return "", nil
}

func ensureFileExists(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if !fileExists(path) {
		return "", fmt.Errorf("config file not found: %s", path)
	}
	return path, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func loadFileConfig(path string) (fileConfig, error) {
	var cfg fileConfig
	if _, err := toml.DecodeFile(path, &cfg); err != nil {
		return fileConfig{}, fmt.Errorf("invalid TOML config %s: %w", path, err)
	}
	return cfg, nil
}

func applyFileConfig(cfg *Config, fileCfg fileConfig, analyzeTimeoutRaw *string, pipelineTimeoutRaw *string, workerLeaseTTLRaw *string) {
	if fileCfg.Runner.Port != nil {
		cfg.Port = *fileCfg.Runner.Port
	}
	if fileCfg.Runner.Token != nil {
		cfg.RunnerToken = *fileCfg.Runner.Token
	}
	if fileCfg.Database.URL != nil {
		cfg.DatabaseURL = *fileCfg.Database.URL
	}
	if fileCfg.Redis.URL != nil {
		cfg.RedisURL = *fileCfg.Redis.URL
	}
	if fileCfg.Security.EncryptionKey != nil {
		cfg.EncryptionKey = *fileCfg.Security.EncryptionKey
	}
	if fileCfg.Runner.Concurrency != nil {
		cfg.Concurrency = *fileCfg.Runner.Concurrency
	}
	if fileCfg.Runner.Queue != nil {
		cfg.Queue = *fileCfg.Runner.Queue
	}
	if fileCfg.Pipeline.Queue != nil {
		cfg.PipelineQueue = *fileCfg.Pipeline.Queue
	}
	if fileCfg.Pipeline.Concurrency != nil {
		cfg.PipelineConcurrency = *fileCfg.Pipeline.Concurrency
	}
	if fileCfg.Runner.DataDir != nil {
		cfg.DataDir = *fileCfg.Runner.DataDir
	}
	if fileCfg.Pipeline.LogRetentionDays != nil {
		cfg.LogRetentionDays = *fileCfg.Pipeline.LogRetentionDays
	}
	if fileCfg.Pipeline.ArtifactRetentionDays != nil {
		cfg.ArtifactRetentionDays = *fileCfg.Pipeline.ArtifactRetentionDays
	}
	if fileCfg.Pipeline.RequireWorker != nil {
		cfg.RequireWorkerNode = *fileCfg.Pipeline.RequireWorker
	}
	if fileCfg.Runner.AnalyzeTimeout != nil {
		*analyzeTimeoutRaw = *fileCfg.Runner.AnalyzeTimeout
	}
	if fileCfg.Pipeline.RunTimeout != nil {
		*pipelineTimeoutRaw = *fileCfg.Pipeline.RunTimeout
	}
	if fileCfg.Studio.URL != nil {
		cfg.StudioURL = *fileCfg.Studio.URL
	}
	if fileCfg.Studio.Token != nil {
		cfg.StudioToken = *fileCfg.Studio.Token
	}
	if fileCfg.Worker.LeaseTTL != nil {
		*workerLeaseTTLRaw = *fileCfg.Worker.LeaseTTL
	}
}
