package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

type fileConfig struct {
	Conductor conductorConfig `toml:"conductor"`
	Database  databaseConfig  `toml:"database"`
	Pipeline  pipelineConfig  `toml:"pipeline"`
	Worker    workerConfig    `toml:"worker"`
	Security  securityConfig  `toml:"security"`
	Studio    studioConfig    `toml:"studio"`
}

type conductorConfig struct {
	Port           *string `toml:"port"`
	Token          *string `toml:"token"`
	Concurrency    *int    `toml:"concurrency"`
	AnalyzeTimeout *string `toml:"analyze_timeout"`
	DataDir        *string `toml:"data_dir"`
}

type databaseConfig struct {
	URL *string `toml:"url"`
}

type pipelineConfig struct {
	Concurrency           *int `toml:"concurrency"`
	LogRetentionDays      *int `toml:"log_retention_days"`
	ArtifactRetentionDays *int `toml:"artifact_retention_days"`
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
	if envPath := os.Getenv("CONDUCTOR_CONFIG"); envPath != "" {
		return ensureFileExists(envPath)
	}

	candidates := []string{
		filepath.Join("apps", "conductor", "config.toml"),
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

func applyFileConfig(cfg *Config, fileCfg fileConfig, analyzeTimeoutRaw *string, workerLeaseTTLRaw *string) {
	if fileCfg.Conductor.Port != nil {
		cfg.Port = *fileCfg.Conductor.Port
	}
	if fileCfg.Conductor.Token != nil {
		cfg.ConductorToken = *fileCfg.Conductor.Token
	}
	if fileCfg.Database.URL != nil {
		cfg.DatabaseURL = *fileCfg.Database.URL
	}
	if fileCfg.Security.EncryptionKey != nil {
		cfg.EncryptionKey = *fileCfg.Security.EncryptionKey
	}
	if fileCfg.Conductor.Concurrency != nil {
		cfg.Concurrency = *fileCfg.Conductor.Concurrency
	}
	if fileCfg.Pipeline.Concurrency != nil {
		cfg.PipelineConcurrency = *fileCfg.Pipeline.Concurrency
	}
	if fileCfg.Conductor.DataDir != nil {
		cfg.DataDir = *fileCfg.Conductor.DataDir
	}
	if fileCfg.Pipeline.LogRetentionDays != nil {
		cfg.LogRetentionDays = *fileCfg.Pipeline.LogRetentionDays
	}
	if fileCfg.Pipeline.ArtifactRetentionDays != nil {
		cfg.ArtifactRetentionDays = *fileCfg.Pipeline.ArtifactRetentionDays
	}
	if fileCfg.Conductor.AnalyzeTimeout != nil {
		*analyzeTimeoutRaw = *fileCfg.Conductor.AnalyzeTimeout
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
