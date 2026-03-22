package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/bmatcuk/doublestar/v4"
	"github.com/gorilla/websocket"

	"spec-axis/conductor/pkg/workerprotocol"
)

type workerConfig struct {
	ConductorBaseURL string
	ConductorToken   string
	WorkerID         string
	Hostname         string
	Version          string
	Labels           map[string]string
	Capabilities     []string
	MaxConcurrency   int
	WorkspaceRoot    string
	ReconnectDelay   time.Duration
	HeartbeatSeconds int
}

type workerAgent struct {
	cfg      workerConfig
	conn     *websocket.Conn
	writeMu  sync.Mutex
	cancels  map[string]context.CancelFunc
	cancelMu sync.Mutex
	busy     atomic.Int64
	sem      chan struct{}
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("worker config error: %v", err)
	}
	if hasCapability(cfg.Capabilities, "docker") {
		checkCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := requireDockerAvailable(checkCtx); err != nil {
			cancel()
			log.Fatalf("docker availability check failed: %v", err)
		}
		cancel()
	}
	log.Printf("worker starting: role=deploy id=%s conductor=%s", cfg.WorkerID, cfg.ConductorBaseURL)

	agent := &workerAgent{
		cfg:     cfg,
		cancels: map[string]context.CancelFunc{},
		sem:     make(chan struct{}, cfg.MaxConcurrency),
	}

	for {
		if err := agent.runSession(); err != nil {
			log.Printf("worker session ended: %v", err)
		}
		time.Sleep(cfg.ReconnectDelay)
	}
}

func (a *workerAgent) runSession() error {
	wsURL, err := toWorkerWSURL(a.cfg.ConductorBaseURL)
	if err != nil {
		return err
	}
	headers := http.Header{}
	if token := strings.TrimSpace(a.cfg.ConductorToken); token != "" {
		headers.Set("X-Conductor-Token", token)
	}

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, headers)
	if err != nil {
		return err
	}
	a.conn = conn
	defer func() {
		_ = conn.Close()
	}()

	hello := workerprotocol.HelloMessage{
		Type:          workerprotocol.WorkerMessageTypeHello,
		WorkerID:      a.cfg.WorkerID,
		Hostname:      a.cfg.Hostname,
		Version:       a.cfg.Version,
		Labels:        a.cfg.Labels,
		Capabilities:  a.cfg.Capabilities,
		MaxConcurrent: a.cfg.MaxConcurrency,
	}
	if err := a.send(hello); err != nil {
		return err
	}

	done := make(chan struct{})
	go a.heartbeatLoop(done)
	defer close(done)

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var envelope workerprotocol.Envelope
		if err := json.Unmarshal(raw, &envelope); err != nil {
			continue
		}

		switch envelope.Type {
		case workerprotocol.MasterMessageTypeWelcome:
			var welcome workerprotocol.WelcomeMessage
			if err := json.Unmarshal(raw, &welcome); err == nil {
				log.Printf("connected: session=%s lease=%ds", welcome.SessionID, welcome.LeaseSeconds)
			}
		case workerprotocol.MasterMessageTypeExecuteJob:
			var message workerprotocol.ExecuteJobMessage
			if err := json.Unmarshal(raw, &message); err != nil {
				continue
			}
			_ = a.send(workerprotocol.JobAckMessage{
				Type:      workerprotocol.WorkerMessageTypeJobAck,
				RequestID: message.RequestID,
			})
			go a.executeJob(message)
		case workerprotocol.MasterMessageTypeCancelJob:
			var message workerprotocol.CancelJobMessage
			if err := json.Unmarshal(raw, &message); err != nil {
				continue
			}
			a.cancelJob(message.RequestID)
		case workerprotocol.MasterMessageTypePing:
			_ = a.send(workerprotocol.HeartbeatMessage{
				Type: workerprotocol.WorkerMessageTypeHeartbeat,
				Busy: int(a.busy.Load()),
			})
		}
	}
}

func (a *workerAgent) executeJob(message workerprotocol.ExecuteJobMessage) {
	expectedTarget := strings.TrimSpace(strings.ToLower(message.ExecutionTarget))
	if expectedTarget == "" {
		expectedTarget = "deploy"
	}
	if expectedTarget != "deploy" {
		_ = a.send(workerprotocol.JobFinishedMessage{
			Type:         workerprotocol.WorkerMessageTypeJobFinished,
			RequestID:    message.RequestID,
			Status:       "failed",
			ErrorMessage: fmt.Sprintf("deploy worker cannot execute %s jobs", expectedTarget),
		})
		return
	}

	a.sem <- struct{}{}
	a.busy.Add(1)
	defer func() {
		a.busy.Add(-1)
		<-a.sem
	}()

	jobCtx, cancel := context.WithCancel(context.Background())
	a.registerCancel(message.RequestID, cancel)
	defer func() {
		cancel()
		a.unregisterCancel(message.RequestID)
	}()

	workspaceRoot := strings.TrimSpace(message.WorkspaceRoot)
	if workspaceRoot == "" {
		workspaceRoot = filepath.Join(a.cfg.WorkspaceRoot, message.RunID)
	}
	_ = os.MkdirAll(workspaceRoot, 0o755)

	jobStatus := "success"
	jobError := ""
	for _, step := range message.Steps {
		_ = a.send(workerprotocol.StepStartedMessage{
			Type:      workerprotocol.WorkerMessageTypeStepStarted,
			RequestID: message.RequestID,
			StepID:    step.ID,
		})

		workingDir := resolveWorkingDir(workspaceRoot, message.JobWorkingDir, step.WorkingDir)
		if err := os.MkdirAll(workingDir, 0o755); err != nil {
			jobStatus = "failed"
			jobError = err.Error()
			_ = a.send(workerprotocol.StepFinishedMessage{
				Type:         workerprotocol.WorkerMessageTypeStepFinished,
				RequestID:    message.RequestID,
				StepID:       step.ID,
				Status:       "failed",
				ExitCode:     1,
				ErrorMessage: err.Error(),
			})
			break
		}

		writer := &streamWriter{
			onChunk: func(chunk string) {
				_ = a.send(workerprotocol.StepLogMessage{
					Type:      workerprotocol.WorkerMessageTypeStepLog,
					RequestID: message.RequestID,
					StepID:    step.ID,
					Chunk:     chunk,
					Stream:    "stdout",
				})
			},
		}

		stepCtx := jobCtx
		cancelStep := func() {}
		if step.TimeoutSeconds != nil && *step.TimeoutSeconds > 0 {
			stepCtx, cancelStep = context.WithTimeout(jobCtx, time.Duration(*step.TimeoutSeconds)*time.Second)
		}
		exitCode := 0
		status := "success"
		var runErr error
		if strings.EqualFold(strings.TrimSpace(step.ArtifactSource), "registry") {
			runErr = a.downloadRegistryArtifacts(stepCtx, message, step, workingDir, writer)
			if runErr != nil {
				exitCode = 1
				if errors.Is(stepCtx.Err(), context.Canceled) {
					status = "canceled"
				} else if errors.Is(stepCtx.Err(), context.DeadlineExceeded) {
					status = "timed_out"
				} else {
					status = "failed"
				}
			}
		} else if len(step.ArtifactInputs) > 0 {
			runErr = a.downloadStepArtifacts(stepCtx, message, step, workingDir, writer)
			if runErr != nil {
				exitCode = 1
				if errors.Is(stepCtx.Err(), context.Canceled) {
					status = "canceled"
				} else if errors.Is(stepCtx.Err(), context.DeadlineExceeded) {
					status = "timed_out"
				} else {
					status = "failed"
				}
			}
		}
		if runErr == nil {
			exitCode, status, runErr = runStep(stepCtx, message, step, workingDir, writer)
		}
		cancelStep()
		if runErr == nil && status == "success" && len(step.ArtifactPaths) > 0 {
			if artifactErr := a.uploadStepArtifacts(message, step, workingDir); artifactErr != nil {
				runErr = artifactErr
				status = "failed"
				exitCode = 1
			}
		}
		_ = a.send(workerprotocol.StepFinishedMessage{
			Type:         workerprotocol.WorkerMessageTypeStepFinished,
			RequestID:    message.RequestID,
			StepID:       step.ID,
			Status:       status,
			ExitCode:     exitCode,
			ErrorMessage: errorMessage(runErr),
		})
		if runErr != nil && !step.ContinueOnError {
			jobStatus = status
			jobError = runErr.Error()
			break
		}
	}

	_ = a.send(workerprotocol.JobFinishedMessage{
		Type:         workerprotocol.WorkerMessageTypeJobFinished,
		RequestID:    message.RequestID,
		Status:       jobStatus,
		ErrorMessage: jobError,
	})
}

func (a *workerAgent) uploadStepArtifacts(
	message workerprotocol.ExecuteJobMessage,
	step workerprotocol.ExecuteStep,
	workingDir string,
) error {
	files, err := resolveArtifactFiles(workingDir, step.ArtifactPaths)
	if err != nil {
		return err
	}
	for _, filePath := range files {
		if err := a.uploadSingleArtifact(message, step, workingDir, filePath); err != nil {
			return err
		}
	}
	return nil
}

func (a *workerAgent) uploadSingleArtifact(
	message workerprotocol.ExecuteJobMessage,
	step workerprotocol.ExecuteStep,
	workingDir string,
	absolutePath string,
) error {
	info, err := os.Stat(absolutePath)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return nil
	}

	relativePath, err := filepath.Rel(workingDir, absolutePath)
	if err != nil || strings.HasPrefix(relativePath, "..") {
		relativePath = filepath.Base(absolutePath)
	}
	relativePath = filepath.ToSlash(relativePath)

	httpBase, err := toConductorHTTPBase(a.cfg.ConductorBaseURL)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(httpBase, "/") + "/v1/workers/artifacts/upload"
	query := url.Values{}
	query.Set("runId", message.RunID)
	query.Set("jobId", message.JobID)
	query.Set("stepKey", step.ID)
	query.Set("path", relativePath)

	const maxAttempts = 3
	client := &http.Client{Timeout: 15 * time.Minute}
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		file, err := os.Open(absolutePath)
		if err != nil {
			return err
		}

		request, err := http.NewRequest(http.MethodPut, endpoint+"?"+query.Encode(), file)
		if err != nil {
			_ = file.Close()
			return err
		}
		request.ContentLength = info.Size()
		request.Header.Set("Content-Type", "application/octet-stream")
		request.Header.Set("X-Artifact-Upload-Attempt", strconv.Itoa(attempt))
		request.Header.Set("X-Artifact-Upload-Max-Attempts", strconv.Itoa(maxAttempts))
		if token := strings.TrimSpace(a.cfg.ConductorToken); token != "" {
			request.Header.Set("X-Conductor-Token", token)
		}

		response, err := client.Do(request)
		_ = file.Close()
		if err != nil {
			lastErr = fmt.Errorf("artifact upload attempt %d/%d failed (%s): %w", attempt, maxAttempts, classifyUploadError(nil, err), err)
		} else {
			body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
			_ = response.Body.Close()
			if response.StatusCode < 300 {
				return nil
			}
			lastErr = fmt.Errorf("artifact upload attempt %d/%d failed (status=%d category=%s body=%s)", attempt, maxAttempts, response.StatusCode, classifyUploadError(response, nil), string(body))
			if response.StatusCode >= 400 && response.StatusCode < 500 && response.StatusCode != http.StatusTooManyRequests {
				return lastErr
			}
		}

		if attempt < maxAttempts {
			time.Sleep(time.Duration(attempt) * 400 * time.Millisecond)
		}
	}
	if lastErr == nil {
		lastErr = errors.New("artifact upload failed")
	}
	return lastErr
}

type runArtifact struct {
	ID        string  `json:"id"`
	Path      string  `json:"path"`
	Sha256    string  `json:"sha256"`
	SizeBytes int64   `json:"size_bytes"`
	CreatedAt *string `json:"created_at,omitempty"`
}

type artifactDownloadError struct {
	category  string
	message   string
	retryable bool
}

func (e *artifactDownloadError) Error() string {
	return e.message
}

func (a *workerAgent) downloadStepArtifacts(
	ctx context.Context,
	message workerprotocol.ExecuteJobMessage,
	step workerprotocol.ExecuteStep,
	workingDir string,
	output io.Writer,
) error {
	artifacts, err := a.listRunArtifacts(ctx, message.RunID)
	if err != nil {
		return err
	}
	if len(artifacts) == 0 {
		return errors.New("no artifacts are available for this run")
	}

	matched, err := filterArtifactInputs(artifacts, step.ArtifactInputs)
	if err != nil {
		return err
	}
	if len(matched) == 0 {
		return fmt.Errorf("no artifacts matched artifactInputs for step %s", step.ID)
	}
	_, _ = fmt.Fprintf(output, "[artifact] Preparing %d artifact(s) for step %s\n", len(matched), step.ID)

	for _, artifact := range matched {
		if err := a.downloadArtifactWithRetry(ctx, message.RequestID, step.ID, message.RunID, artifact, workingDir); err != nil {
			return err
		}
	}
	_, _ = fmt.Fprintf(output, "[artifact] Prepared %d artifact(s) for step %s\n", len(matched), step.ID)
	return nil
}

func (a *workerAgent) downloadRegistryArtifacts(
	ctx context.Context,
	message workerprotocol.ExecuteJobMessage,
	step workerprotocol.ExecuteStep,
	workingDir string,
	output io.Writer,
) error {
	if len(step.RegistryFiles) == 0 {
		return fmt.Errorf("no registry files resolved for step %s", step.ID)
	}
	_, _ = fmt.Fprintf(
		output,
		"[artifact] Preparing %d published artifact file(s) from %s@%s for step %s\n",
		len(step.RegistryFiles),
		strings.TrimSpace(step.RegistryRepository),
		strings.TrimSpace(step.RegistryVersion),
		step.ID,
	)
	for _, file := range step.RegistryFiles {
		if err := a.downloadPublishedArtifactFileWithRetry(ctx, message.RequestID, step.ID, file, workingDir); err != nil {
			return err
		}
	}
	_, _ = fmt.Fprintf(output, "[artifact] Prepared %d published artifact file(s) for step %s\n", len(step.RegistryFiles), step.ID)
	return nil
}

func (a *workerAgent) listRunArtifacts(ctx context.Context, runID string) ([]runArtifact, error) {
	httpBase, err := toConductorHTTPBase(a.cfg.ConductorBaseURL)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(httpBase, "/") + "/v1/pipeline-runs/" + url.PathEscape(runID) + "/artifacts"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if token := strings.TrimSpace(a.cfg.ConductorToken); token != "" {
		request.Header.Set("X-Conductor-Token", token)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return nil, fmt.Errorf("list run artifacts failed: status=%d body=%s", response.StatusCode, string(body))
	}

	var artifacts []runArtifact
	if err := json.NewDecoder(response.Body).Decode(&artifacts); err != nil {
		return nil, err
	}
	return artifacts, nil
}

func filterArtifactInputs(artifacts []runArtifact, patterns []string) ([]runArtifact, error) {
	matched := make([]runArtifact, 0)
	seen := map[string]bool{}
	for _, rawPattern := range patterns {
		pattern := strings.TrimSpace(strings.ReplaceAll(rawPattern, "\\", "/"))
		if pattern == "" {
			continue
		}
		for _, artifact := range artifacts {
			target := strings.TrimSpace(strings.ReplaceAll(artifact.Path, "\\", "/"))
			ok, err := doublestar.Match(pattern, target)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
			if seen[artifact.ID] {
				continue
			}
			seen[artifact.ID] = true
			matched = append(matched, artifact)
		}
	}
	sort.Slice(matched, func(i int, j int) bool {
		if matched[i].Path == matched[j].Path {
			return matched[i].ID < matched[j].ID
		}
		return matched[i].Path < matched[j].Path
	})
	return matched, nil
}

func sanitizeDownloadRelativePath(value string) (string, error) {
	normalized := path.Clean(strings.TrimSpace(strings.ReplaceAll(value, "\\", "/")))
	if normalized == "." || normalized == "" {
		return "", errors.New("artifact path is required")
	}
	if strings.HasPrefix(normalized, "../") || strings.HasPrefix(normalized, "/") || normalized == ".." {
		return "", fmt.Errorf("invalid artifact path: %s", value)
	}
	return normalized, nil
}

func (a *workerAgent) downloadPublishedArtifactFileWithRetry(
	ctx context.Context,
	requestID string,
	stepID string,
	file workerprotocol.RegistryArtifactFile,
	workingDir string,
) error {
	if strings.TrimSpace(file.FileID) == "" {
		return errors.New("registry artifact file id is required")
	}
	cleanPath, err := sanitizeDownloadRelativePath(file.LogicalPath)
	if err != nil {
		return err
	}

	httpBase, err := toConductorHTTPBase(a.cfg.ConductorBaseURL)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(httpBase, "/") + "/v1/artifact-files/" + url.PathEscape(file.FileID) + "/content"
	destinationPath := filepath.Join(workingDir, filepath.FromSlash(cleanPath))
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o755); err != nil {
		return err
	}

	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		startedAt := time.Now()
		_ = a.send(workerprotocol.StepArtifactMessage{
			Type:       workerprotocol.WorkerMessageTypeStepArtifact,
			RequestID:  requestID,
			StepID:     stepID,
			Status:     "started",
			ArtifactID: file.FileID,
			Path:       cleanPath,
			Attempt:    attempt,
		})

		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return err
		}
		if token := strings.TrimSpace(a.cfg.ConductorToken); token != "" {
			request.Header.Set("X-Conductor-Token", token)
		}

		client := &http.Client{Timeout: 15 * time.Minute}
		response, err := client.Do(request)
		if err != nil {
			lastErr = err
		} else {
			err = a.writeDownloadedArtifact(response, destinationPath, file)
			_ = response.Body.Close()
			if err == nil {
				_ = a.send(workerprotocol.StepArtifactMessage{
					Type:       workerprotocol.WorkerMessageTypeStepArtifact,
					RequestID:  requestID,
					StepID:     stepID,
					Status:     "downloaded",
					ArtifactID: file.FileID,
					Path:       cleanPath,
					Attempt:    attempt,
					DurationMs: time.Since(startedAt).Milliseconds(),
					SizeBytes:  file.SizeBytes,
				})
				return nil
			}
			lastErr = err
		}

		downloadErr := classifyRegistryDownloadError(lastErr)
		_ = a.send(workerprotocol.StepArtifactMessage{
			Type:          workerprotocol.WorkerMessageTypeStepArtifact,
			RequestID:     requestID,
			StepID:        stepID,
			Status:        "failed",
			ArtifactID:    file.FileID,
			Path:          cleanPath,
			Attempt:       attempt,
			DurationMs:    time.Since(startedAt).Milliseconds(),
			ErrorCategory: downloadErr.category,
			ErrorMessage:  downloadErr.message,
		})
		if !downloadErr.retryable || attempt == maxAttempts {
			return downloadErr
		}
		time.Sleep(time.Duration(attempt) * 400 * time.Millisecond)
	}
	if lastErr != nil {
		return lastErr
	}
	return errors.New("published artifact download failed")
}

func (a *workerAgent) writeDownloadedArtifact(
	response *http.Response,
	destinationPath string,
	file workerprotocol.RegistryArtifactFile,
) error {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return fmt.Errorf("published artifact download failed: status=%d body=%s", response.StatusCode, string(body))
	}

	tempPath := destinationPath + ".part"
	output, err := os.OpenFile(tempPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer func() {
		_ = output.Close()
	}()

	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(output, hash), response.Body)
	if err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	if file.SizeBytes > 0 && written != file.SizeBytes {
		_ = os.Remove(tempPath)
		return fmt.Errorf("artifact size mismatch for %s", file.LogicalPath)
	}
	if expected := strings.TrimSpace(file.Sha256); expected != "" {
		actual := hex.EncodeToString(hash.Sum(nil))
		if !strings.EqualFold(expected, actual) {
			_ = os.Remove(tempPath)
			return fmt.Errorf("artifact checksum mismatch for %s", file.LogicalPath)
		}
	}
	if err := output.Close(); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	if err := os.Rename(tempPath, destinationPath); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	return nil
}

func classifyRegistryDownloadError(err error) *artifactDownloadError {
	if err == nil {
		return &artifactDownloadError{category: "unknown", message: "download failed", retryable: true}
	}
	message := err.Error()
	switch {
	case strings.Contains(message, "status=404"):
		return &artifactDownloadError{category: "artifact_not_found", message: message, retryable: false}
	case strings.Contains(message, "checksum mismatch"):
		return &artifactDownloadError{category: "checksum_mismatch", message: message, retryable: false}
	case strings.Contains(message, "size mismatch"):
		return &artifactDownloadError{category: "size_mismatch", message: message, retryable: false}
	default:
		return &artifactDownloadError{category: "download_failed", message: message, retryable: true}
	}
}

func (a *workerAgent) downloadArtifactWithRetry(
	ctx context.Context,
	requestID string,
	stepID string,
	runID string,
	artifact runArtifact,
	workingDir string,
) error {
	const maxAttempts = 3
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		startedAt := time.Now()
		_ = a.send(workerprotocol.StepArtifactMessage{
			Type:       workerprotocol.WorkerMessageTypeStepArtifact,
			RequestID:  requestID,
			StepID:     stepID,
			Status:     "started",
			ArtifactID: artifact.ID,
			Path:       artifact.Path,
			Attempt:    attempt,
		})

		sizeBytes, err := a.downloadSingleArtifact(ctx, runID, artifact, workingDir)
		if err == nil {
			_ = a.send(workerprotocol.StepArtifactMessage{
				Type:       workerprotocol.WorkerMessageTypeStepArtifact,
				RequestID:  requestID,
				StepID:     stepID,
				Status:     "downloaded",
				ArtifactID: artifact.ID,
				Path:       artifact.Path,
				Attempt:    attempt,
				DurationMs: time.Since(startedAt).Milliseconds(),
				SizeBytes:  sizeBytes,
			})
			return nil
		}
		lastErr = err

		category := "unknown"
		retryable := false
		var downloadErr *artifactDownloadError
		if errors.As(err, &downloadErr) {
			category = downloadErr.category
			retryable = downloadErr.retryable
		}
		_ = a.send(workerprotocol.StepArtifactMessage{
			Type:          workerprotocol.WorkerMessageTypeStepArtifact,
			RequestID:     requestID,
			StepID:        stepID,
			Status:        "failed",
			ArtifactID:    artifact.ID,
			Path:          artifact.Path,
			Attempt:       attempt,
			DurationMs:    time.Since(startedAt).Milliseconds(),
			ErrorCategory: category,
			ErrorMessage:  err.Error(),
		})
		if !retryable || attempt == maxAttempts {
			break
		}
		time.Sleep(time.Duration(attempt) * 400 * time.Millisecond)
	}

	if lastErr == nil {
		lastErr = errors.New("artifact download failed")
	}
	return lastErr
}

func (a *workerAgent) downloadSingleArtifact(
	ctx context.Context,
	runID string,
	artifact runArtifact,
	workingDir string,
) (int64, error) {
	relativePath, err := sanitizeArtifactRelativePath(artifact.Path)
	if err != nil {
		return 0, &artifactDownloadError{
			category:  "validation",
			message:   fmt.Sprintf("invalid artifact path %q: %v", artifact.Path, err),
			retryable: false,
		}
	}
	workingAbs, err := filepath.Abs(workingDir)
	if err != nil {
		return 0, err
	}
	destination := filepath.Clean(filepath.Join(workingAbs, filepath.FromSlash(relativePath)))
	if !isWithinBasePath(workingAbs, destination) {
		return 0, &artifactDownloadError{
			category:  "validation",
			message:   fmt.Sprintf("artifact path escapes working directory: %s", artifact.Path),
			retryable: false,
		}
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return 0, err
	}

	httpBase, err := toConductorHTTPBase(a.cfg.ConductorBaseURL)
	if err != nil {
		return 0, err
	}
	endpoint := strings.TrimRight(httpBase, "/") + "/v1/pipeline-runs/" + url.PathEscape(runID) + "/artifacts/" + url.PathEscape(artifact.ID) + "/content"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	if token := strings.TrimSpace(a.cfg.ConductorToken); token != "" {
		request.Header.Set("X-Conductor-Token", token)
	}

	client := &http.Client{Timeout: 15 * time.Minute}
	response, err := client.Do(request)
	if err != nil {
		return 0, classifyArtifactDownloadHTTPError(nil, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return 0, classifyArtifactDownloadHTTPError(response, fmt.Errorf("status=%d body=%s", response.StatusCode, string(body)))
	}

	tempFile, err := os.CreateTemp(filepath.Dir(destination), ".artifact-*.tmp")
	if err != nil {
		return 0, err
	}
	tempPath := tempFile.Name()
	defer func() {
		_ = os.Remove(tempPath)
	}()

	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(tempFile, hasher), response.Body)
	closeErr := tempFile.Close()
	if copyErr != nil {
		return 0, classifyArtifactDownloadHTTPError(response, copyErr)
	}
	if closeErr != nil {
		return 0, closeErr
	}

	expectedHash := strings.TrimSpace(strings.ToLower(artifact.Sha256))
	if expectedHash != "" {
		computedHash := hex.EncodeToString(hasher.Sum(nil))
		if computedHash != expectedHash {
			return 0, &artifactDownloadError{
				category:  "checksum",
				message:   fmt.Sprintf("artifact checksum mismatch for %s", artifact.Path),
				retryable: true,
			}
		}
	}

	if err := os.Rename(tempPath, destination); err != nil {
		return 0, err
	}
	return written, nil
}

func sanitizeArtifactRelativePath(value string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if normalized == "" {
		return "", errors.New("empty path")
	}
	cleaned := path.Clean("/" + normalized)
	if strings.HasPrefix(cleaned, "/..") {
		return "", errors.New("path traversal is not allowed")
	}
	relative := strings.TrimPrefix(cleaned, "/")
	if relative == "" || relative == "." {
		return "", errors.New("empty path")
	}
	return relative, nil
}

func classifyArtifactDownloadHTTPError(response *http.Response, err error) error {
	if err == nil {
		return &artifactDownloadError{
			category:  "unknown",
			message:   "artifact download failed",
			retryable: false,
		}
	}
	errString := strings.ToLower(strings.TrimSpace(err.Error()))
	if strings.Contains(errString, "timeout") || strings.Contains(errString, "deadline exceeded") {
		return &artifactDownloadError{
			category:  "timeout",
			message:   err.Error(),
			retryable: true,
		}
	}
	if response == nil {
		return &artifactDownloadError{
			category:  "network",
			message:   err.Error(),
			retryable: true,
		}
	}
	if response.StatusCode >= 500 {
		return &artifactDownloadError{
			category:  "upstream_server",
			message:   err.Error(),
			retryable: true,
		}
	}
	if response.StatusCode == http.StatusTooManyRequests {
		return &artifactDownloadError{
			category:  "rate_limit",
			message:   err.Error(),
			retryable: true,
		}
	}
	return &artifactDownloadError{
		category:  "upstream_client",
		message:   err.Error(),
		retryable: false,
	}
}

func classifyUploadError(response *http.Response, err error) string {
	if err != nil {
		errString := strings.ToLower(err.Error())
		switch {
		case strings.Contains(errString, "timeout"):
			return "timeout"
		default:
			return "network"
		}
	}
	if response == nil {
		return "unknown"
	}
	switch {
	case response.StatusCode >= 500:
		return "server"
	case response.StatusCode == http.StatusTooManyRequests:
		return "rate_limit"
	case response.StatusCode >= 400:
		return "client"
	default:
		return "unknown"
	}
}

func resolveArtifactFiles(workingDir string, patterns []string) ([]string, error) {
	baseAbs, err := filepath.Abs(workingDir)
	if err != nil {
		return nil, err
	}

	seen := map[string]bool{}
	files := make([]string, 0, len(patterns))
	for _, rawPattern := range patterns {
		pattern := strings.TrimSpace(rawPattern)
		if pattern == "" {
			continue
		}
		candidate := pattern
		if !filepath.IsAbs(candidate) {
			candidate = filepath.Join(baseAbs, candidate)
		}

		matches, globErr := doublestar.FilepathGlob(candidate)
		if globErr != nil {
			return nil, globErr
		}
		if len(matches) == 0 {
			if _, statErr := os.Stat(candidate); statErr == nil {
				matches = []string{candidate}
			}
		}

		for _, match := range matches {
			absolute, absErr := filepath.Abs(match)
			if absErr != nil {
				continue
			}
			if !isWithinBasePath(baseAbs, absolute) {
				return nil, fmt.Errorf("artifact path escapes workspace: %s", pattern)
			}

			info, statErr := os.Stat(absolute)
			if statErr != nil {
				continue
			}
			if info.IsDir() {
				walkErr := filepath.WalkDir(absolute, func(path string, entry fs.DirEntry, walkErr error) error {
					if walkErr != nil {
						return walkErr
					}
					if entry.IsDir() {
						return nil
					}
					fileAbs, absErr := filepath.Abs(path)
					if absErr != nil {
						return nil
					}
					if !isWithinBasePath(baseAbs, fileAbs) || seen[fileAbs] {
						return nil
					}
					seen[fileAbs] = true
					files = append(files, fileAbs)
					return nil
				})
				if walkErr != nil {
					return nil, walkErr
				}
				continue
			}

			if seen[absolute] {
				continue
			}
			seen[absolute] = true
			files = append(files, absolute)
		}
	}
	sort.Strings(files)
	return files, nil
}

func isWithinBasePath(basePath string, candidate string) bool {
	rel, err := filepath.Rel(basePath, candidate)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	rel = filepath.ToSlash(rel)
	return !strings.HasPrefix(rel, "../")
}

func runStep(
	ctx context.Context,
	message workerprotocol.ExecuteJobMessage,
	step workerprotocol.ExecuteStep,
	workingDir string,
	writer io.Writer,
) (int, string, error) {
	var exitCode int
	var err error
	switch message.JobType {
	case "source_checkout":
		exitCode, err = runSourceCheckoutStep(ctx, message, workingDir, writer)
	case "review_gate":
		exitCode, err = runReviewGateStep(ctx, message, writer)
	default:
		if strings.EqualFold(step.Type, "docker") {
			exitCode, err = runDockerStep(ctx, message, step, workingDir, writer)
		} else {
			exitCode, err = runShellStep(ctx, step.Script, step.Env, workingDir, writer)
		}
	}

	if err == nil {
		return exitCode, "success", nil
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return exitCode, "canceled", err
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return exitCode, "timed_out", err
	}
	return exitCode, "failed", err
}

func runShellStep(ctx context.Context, script string, env map[string]string, workingDir string, output io.Writer) (int, error) {
	name, args := shellCommand(script)
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = output
	cmd.Stderr = output
	if workingDir != "" {
		cmd.Dir = workingDir
	}
	cmd.Env = mergeEnv(env)

	if err := cmd.Start(); err != nil {
		return 1, err
	}
	err := cmd.Wait()
	if err == nil {
		return 0, nil
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode(), err
	}
	return 1, err
}

func runDockerStep(ctx context.Context, message workerprotocol.ExecuteJobMessage, step workerprotocol.ExecuteStep, workingDir string, output io.Writer) (int, error) {
	image := strings.TrimSpace(step.DockerImage)
	if image == "" {
		return 1, errors.New("dockerImage is required for docker step")
	}

	args := []string{"run", "--rm", "--name", dockerStepContainerName(message, step), "-w", "/workspace"}
	if workingDir != "" {
		args = append(args, "--mount", fmt.Sprintf("type=bind,src=%s,dst=/workspace", workingDir))
	}
	envKeys := make([]string, 0, len(step.Env))
	for key := range step.Env {
		envKeys = append(envKeys, key)
	}
	sort.Strings(envKeys)
	for _, key := range envKeys {
		// Pass only the variable name so Docker reads the value from the current
		// process environment instead of exposing secrets in the process args.
		args = append(args, "-e", key)
	}
	args = append(args, image, "/bin/sh", "-c", step.Script)

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = output
	cmd.Stderr = output
	cmd.Env = mergeEnv(step.Env)
	if err := cmd.Start(); err != nil {
		return 1, err
	}
	err := cmd.Wait()
	if err == nil {
		return 0, nil
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode(), err
	}
	return 1, err
}

func dockerStepContainerName(message workerprotocol.ExecuteJobMessage, step workerprotocol.ExecuteStep) string {
	return strings.Join([]string{
		"conductor-step",
		shortDockerNameSegment(message.RunID),
		shortDockerNameSegment(message.JobID),
		shortDockerNameSegment(step.ID),
		shortDockerNameSegment(message.RequestID),
	}, "-")
}

func shortDockerNameSegment(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "-", "")
	if len(value) > 8 {
		value = value[:8]
	}
	if value == "" {
		return "unknown"
	}
	return value
}

func runSourceCheckoutStep(
	ctx context.Context,
	message workerprotocol.ExecuteJobMessage,
	workingDir string,
	output io.Writer,
) (int, error) {
	if strings.TrimSpace(message.ProjectID) == "" {
		return 1, errors.New("projectId is required for source checkout")
	}
	if strings.TrimSpace(message.StudioURL) == "" {
		return 1, errors.New("studioUrl is required for source checkout")
	}

	branch := strings.TrimSpace(message.Branch)
	if branch == "" {
		branch = "main"
	}

	repoURL, err := fetchProjectRepo(ctx, message.StudioURL, message.StudioToken, message.ProjectID)
	if err != nil {
		return 1, err
	}
	_, _ = fmt.Fprintf(output, "[source] Repository: %s\n", repoURL)
	_, _ = fmt.Fprintf(output, "[source] Branch: %s\n", branch)

	if _, statErr := os.Stat(filepath.Join(workingDir, ".git")); statErr == nil {
		_, _ = io.WriteString(output, "[source] Pulling latest changes...\n")
		return runCommand(ctx, "git", []string{"-C", workingDir, "pull", "--ff-only", "origin", branch}, nil, "", output)
	}

	_, _ = io.WriteString(output, "[source] Cloning repository...\n")
	return runCommand(ctx, "git", []string{"clone", "--depth=1", "--branch", branch, repoURL, workingDir}, nil, "", output)
}

func runReviewGateStep(ctx context.Context, message workerprotocol.ExecuteJobMessage, output io.Writer) (int, error) {
	if strings.TrimSpace(message.ProjectID) == "" || strings.TrimSpace(message.StudioURL) == "" {
		return 1, errors.New("projectId and studioUrl are required for review gate")
	}
	score, err := fetchLatestScore(ctx, message.StudioURL, message.StudioToken, message.ProjectID)
	if err != nil {
		_, _ = fmt.Fprintf(output, "[review] WARNING: %v\n", err)
		_, _ = io.WriteString(output, "[review] Proceeding without quality gate check.\n")
		return 0, nil
	}

	_, _ = fmt.Fprintf(output, "[review] Latest review score: %d/100\n", score)
	if message.MinScore > 0 && score < message.MinScore {
		err := fmt.Errorf("quality gate failed: score %d < minimum %d", score, message.MinScore)
		_, _ = fmt.Fprintf(output, "[review] BLOCKED: %v\n", err)
		return 1, err
	}
	if message.MinScore > 0 {
		_, _ = fmt.Fprintf(output, "[review] Quality gate passed (score %d >= %d)\n", score, message.MinScore)
	}
	return 0, nil
}

func runCommand(
	ctx context.Context,
	name string,
	args []string,
	env map[string]string,
	workingDir string,
	output io.Writer,
) (int, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = output
	cmd.Stderr = output
	if workingDir != "" {
		cmd.Dir = workingDir
	}
	cmd.Env = mergeEnv(env)
	if err := cmd.Start(); err != nil {
		return 1, err
	}
	err := cmd.Wait()
	if err == nil {
		return 0, nil
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode(), err
	}
	return 1, err
}

func fetchProjectRepo(ctx context.Context, studioURL string, studioToken string, projectID string) (string, error) {
	endpoint := strings.TrimRight(studioURL, "/") + "/api/projects/" + projectID
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	if token := strings.TrimSpace(studioToken); token != "" {
		request.Header.Set("X-Conductor-Token", token)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("studio returned %d for project %s", response.StatusCode, projectID)
	}

	var payload struct {
		Repo string `json:"repo"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", err
	}
	if strings.TrimSpace(payload.Repo) == "" {
		return "", errors.New("project has no repository configured")
	}
	return payload.Repo, nil
}

func fetchLatestScore(ctx context.Context, studioURL string, studioToken string, projectID string) (int, error) {
	endpoint := strings.TrimRight(studioURL, "/") + "/api/reports?projectId=" + projectID + "&limit=1"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	if token := strings.TrimSpace(studioToken); token != "" {
		request.Header.Set("X-Conductor-Token", token)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("studio returned %d for review query", response.StatusCode)
	}

	var payload []struct {
		Score  *int   `json:"score"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return 0, err
	}
	for _, item := range payload {
		if item.Status == "done" && item.Score != nil {
			return *item.Score, nil
		}
	}
	return 0, errors.New("no completed report found")
}

func shellCommand(script string) (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd", []string{"/C", script}
	}
	return "/bin/sh", []string{"-lc", script}
}

func mergeEnv(overrides map[string]string) []string {
	base := os.Environ()
	if len(overrides) == 0 {
		return base
	}
	seen := map[string]bool{}
	for key := range overrides {
		seen[key] = true
	}
	result := make([]string, 0, len(base)+len(overrides))
	for _, item := range base {
		parts := strings.SplitN(item, "=", 2)
		if len(parts) == 2 && seen[parts[0]] {
			continue
		}
		result = append(result, item)
	}
	for key, value := range overrides {
		result = append(result, key+"="+value)
	}
	return result
}

func (a *workerAgent) heartbeatLoop(done <-chan struct{}) {
	ticker := time.NewTicker(time.Duration(a.cfg.HeartbeatSeconds) * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			_ = a.send(workerprotocol.HeartbeatMessage{
				Type: workerprotocol.WorkerMessageTypeHeartbeat,
				Busy: int(a.busy.Load()),
			})
		}
	}
}

func (a *workerAgent) registerCancel(requestID string, cancel context.CancelFunc) {
	a.cancelMu.Lock()
	defer a.cancelMu.Unlock()
	a.cancels[requestID] = cancel
}

func (a *workerAgent) unregisterCancel(requestID string) {
	a.cancelMu.Lock()
	defer a.cancelMu.Unlock()
	delete(a.cancels, requestID)
}

func (a *workerAgent) cancelJob(requestID string) {
	a.cancelMu.Lock()
	cancel := a.cancels[requestID]
	a.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *workerAgent) send(payload any) error {
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	if a.conn == nil {
		return errors.New("worker connection is nil")
	}
	return a.conn.WriteJSON(payload)
}

func loadConfig() (workerConfig, error) {
	baseURL := strings.TrimSpace(os.Getenv("CONDUCTOR_BASE_URL"))
	if baseURL == "" {
		return workerConfig{}, errors.New("CONDUCTOR_BASE_URL is required")
	}
	workerID := strings.TrimSpace(os.Getenv("WORKER_ID"))
	if workerID == "" {
		host, _ := os.Hostname()
		if host == "" {
			host = "worker"
		}
		workerID = host
	}
	hostname := strings.TrimSpace(os.Getenv("WORKER_HOSTNAME"))
	if hostname == "" {
		hostname, _ = os.Hostname()
	}

	maxConcurrency := envInt("WORKER_MAX_CONCURRENCY", 1)
	if maxConcurrency <= 0 {
		maxConcurrency = 1
	}

	workspaceRoot := strings.TrimSpace(os.Getenv("WORKER_WORKSPACE_ROOT"))
	if workspaceRoot == "" {
		workspaceRoot = "/tmp/spec-axis-runs"
	}

	reconnectDelay := envDuration("WORKER_RECONNECT_DELAY", 3*time.Second)
	heartbeatSeconds := envInt("WORKER_HEARTBEAT_SECONDS", 10)
	if heartbeatSeconds <= 0 {
		heartbeatSeconds = 10
	}

	capabilities := parseList(os.Getenv("WORKER_CAPABILITIES"))
	if len(capabilities) == 0 {
		capabilities = defaultCapabilities()
	}

	return workerConfig{
		ConductorBaseURL: baseURL,
		ConductorToken:   strings.TrimSpace(os.Getenv("CONDUCTOR_TOKEN")),
		WorkerID:         workerID,
		Hostname:         hostname,
		Version:          strings.TrimSpace(os.Getenv("WORKER_VERSION")),
		Labels:           parseLabels(os.Getenv("WORKER_LABELS")),
		Capabilities:     capabilities,
		MaxConcurrency:   maxConcurrency,
		WorkspaceRoot:    workspaceRoot,
		ReconnectDelay:   reconnectDelay,
		HeartbeatSeconds: heartbeatSeconds,
	}, nil
}

func parseLabels(raw string) map[string]string {
	labels := map[string]string{}
	for _, token := range parseList(raw) {
		parts := strings.SplitN(token, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		if key == "" {
			continue
		}
		labels[key] = value
	}
	return labels
}

func parseList(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		value := strings.TrimSpace(strings.ToLower(part))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func defaultCapabilities() []string {
	return []string{"deploy", "shell", "docker", "artifact_download"}
}

func hasCapability(capabilities []string, target string) bool {
	target = strings.TrimSpace(strings.ToLower(target))
	if target == "" {
		return false
	}
	for _, capability := range capabilities {
		if strings.TrimSpace(strings.ToLower(capability)) == target {
			return true
		}
	}
	return false
}

func requireDockerAvailable(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "docker", "info")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker daemon is not available or not reachable: %w", err)
	}
	return nil
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func envDuration(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return value
}

func toWorkerWSURL(baseURL string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	switch parsed.Scheme {
	case "http":
		parsed.Scheme = "ws"
	case "https":
		parsed.Scheme = "wss"
	case "ws", "wss":
	default:
		return "", errors.New("CONDUCTOR_BASE_URL must use http/https/ws/wss scheme")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/v1/workers/connect"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func toConductorHTTPBase(baseURL string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	switch parsed.Scheme {
	case "http", "https":
	case "ws":
		parsed.Scheme = "http"
	case "wss":
		parsed.Scheme = "https"
	default:
		return "", errors.New("CONDUCTOR_BASE_URL must use http/https/ws/wss scheme")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func resolveWorkingDir(workspaceRoot string, jobWorkingDir string, stepWorkingDir string) string {
	path := strings.TrimSpace(stepWorkingDir)
	if path == "" {
		path = strings.TrimSpace(jobWorkingDir)
	}
	if path == "" {
		return workspaceRoot
	}
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Clean(filepath.Join(workspaceRoot, path))
}

func errorMessage(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

type streamWriter struct {
	onChunk func(chunk string)
}

func (w *streamWriter) Write(p []byte) (int, error) {
	if w.onChunk != nil && len(p) > 0 {
		w.onChunk(string(p))
	}
	return len(p), nil
}
