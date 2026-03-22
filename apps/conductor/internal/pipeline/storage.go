package pipeline

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type LocalStorage struct {
	baseDir string
}

func NewLocalStorage(baseDir string) *LocalStorage {
	resolved := filepath.Clean(baseDir)
	if resolved == "" {
		resolved = "data"
	}
	if abs, err := filepath.Abs(resolved); err == nil {
		resolved = abs
	}
	return &LocalStorage{baseDir: resolved}
}

func (s *LocalStorage) RunWorkspaceRoot(runID string) string {
	return filepath.Join(s.baseDir, "workspaces", runID)
}

func (s *LocalStorage) StepLogPath(runID string, jobKey string, stepKey string) string {
	return filepath.ToSlash(filepath.Join("logs", runID, jobKey, stepKey+".log"))
}

func (s *LocalStorage) OpenStepLog(runID string, jobKey string, stepKey string) (string, io.WriteCloser, error) {
	relPath := s.StepLogPath(runID, jobKey, stepKey)
	absPath := filepath.Join(s.baseDir, filepath.FromSlash(relPath))
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return "", nil, err
	}
	file, err := os.OpenFile(absPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return "", nil, err
	}
	return relPath, file, nil
}

func (s *LocalStorage) ReadLog(relPath string, offset int64, limit int64) ([]byte, int64, error) {
	if relPath == "" {
		return nil, 0, fmt.Errorf("log path is empty")
	}
	absPath := filepath.Join(s.baseDir, filepath.FromSlash(relPath))
	file, err := os.Open(absPath)
	if err != nil {
		return nil, 0, err
	}
	defer file.Close()

	if offset > 0 {
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			return nil, 0, err
		}
	}

	reader := io.Reader(file)
	if limit > 0 {
		reader = io.LimitReader(file, limit)
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, 0, err
	}
	nextOffset := offset + int64(len(data))
	return data, nextOffset, nil
}

func (s *LocalStorage) SaveArtifact(runID string, jobKey string, stepKey string, srcPath string, relPath string) (string, int64, string, error) {
	if srcPath == "" {
		return "", 0, "", fmt.Errorf("artifact source path is empty")
	}
	if relPath == "" {
		relPath = filepath.Base(srcPath)
	}

	storageRel := filepath.ToSlash(filepath.Join("artifacts", runID, jobKey, stepKey, relPath))
	absDest := filepath.Join(s.baseDir, filepath.FromSlash(storageRel))
	if err := os.MkdirAll(filepath.Dir(absDest), 0o755); err != nil {
		return "", 0, "", err
	}

	src, err := os.Open(srcPath)
	if err != nil {
		return "", 0, "", err
	}
	defer src.Close()

	dst, err := os.OpenFile(absDest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return "", 0, "", err
	}
	defer dst.Close()

	hasher := sha256.New()
	writer := io.MultiWriter(dst, hasher)
	size, err := io.Copy(writer, src)
	if err != nil {
		return "", 0, "", err
	}

	sum := hex.EncodeToString(hasher.Sum(nil))
	return storageRel, size, sum, nil
}

func (s *LocalStorage) Cleanup(logRetention time.Duration, artifactRetention time.Duration) {
	if logRetention > 0 {
		cutoff := time.Now().Add(-logRetention)
		_ = s.cleanupDir(filepath.Join(s.baseDir, "logs"), cutoff)
	}
	if artifactRetention > 0 {
		cutoff := time.Now().Add(-artifactRetention)
		_ = s.cleanupDir(filepath.Join(s.baseDir, "artifacts"), cutoff)
	}
}

func (s *LocalStorage) DeleteRunLogs(runIDs []string) error {
	for _, runID := range runIDs {
		trimmed := filepath.Clean(runID)
		if trimmed == "." || trimmed == "" {
			continue
		}
		runLogDir := filepath.Join(s.baseDir, "logs", trimmed)
		err := os.RemoveAll(runLogDir)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (s *LocalStorage) DeleteLogPaths(paths []string) error {
	for _, relPath := range paths {
		trimmed := strings.TrimSpace(relPath)
		if trimmed == "" {
			continue
		}
		absPath := filepath.Join(s.baseDir, filepath.FromSlash(trimmed))
		err := os.Remove(absPath)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (s *LocalStorage) DeleteRunWorkspaces(runIDs []string) error {
	for _, runID := range runIDs {
		trimmed := filepath.Clean(runID)
		if trimmed == "." || trimmed == "" {
			continue
		}
		runWorkspaceDir := filepath.Join(s.baseDir, "workspaces", trimmed)
		err := os.RemoveAll(runWorkspaceDir)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (s *LocalStorage) cleanupDir(root string, cutoff time.Time) error {
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(path)
		}
		return nil
	})
}
