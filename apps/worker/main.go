package main

import (
	"context"
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

	"spec-axis/runner/pkg/workerprotocol"
)

type workerConfig struct {
	RunnerBaseURL    string
	RunnerToken      string
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
	log.Printf("worker starting: id=%s runner=%s", cfg.WorkerID, cfg.RunnerBaseURL)

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
	wsURL, err := toWorkerWSURL(a.cfg.RunnerBaseURL)
	if err != nil {
		return err
	}
	headers := http.Header{}
	if token := strings.TrimSpace(a.cfg.RunnerToken); token != "" {
		headers.Set("X-Runner-Token", token)
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

		exitCode, status, runErr := runStep(stepCtx, message, step, workingDir, writer)
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

	httpBase, err := toRunnerHTTPBase(a.cfg.RunnerBaseURL)
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
		if token := strings.TrimSpace(a.cfg.RunnerToken); token != "" {
			request.Header.Set("X-Runner-Token", token)
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
			exitCode, err = runDockerStep(ctx, step, workingDir, writer)
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

func runDockerStep(ctx context.Context, step workerprotocol.ExecuteStep, workingDir string, output io.Writer) (int, error) {
	image := strings.TrimSpace(step.DockerImage)
	if image == "" {
		return 1, errors.New("dockerImage is required for docker step")
	}

	args := []string{"run", "--rm", "-w", "/workspace"}
	if workingDir != "" {
		args = append(args, "-v", workingDir+":/workspace")
	}
	for key, value := range step.Env {
		args = append(args, "-e", key+"="+value)
	}
	args = append(args, image, "/bin/sh", "-c", step.Script)

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = output
	cmd.Stderr = output
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
		request.Header.Set("X-Runner-Token", token)
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
		request.Header.Set("X-Runner-Token", token)
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
	baseURL := strings.TrimSpace(os.Getenv("RUNNER_BASE_URL"))
	if baseURL == "" {
		return workerConfig{}, errors.New("RUNNER_BASE_URL is required")
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
		capabilities = []string{"shell", "docker", "source_checkout", "review_gate"}
	}

	return workerConfig{
		RunnerBaseURL:    baseURL,
		RunnerToken:      strings.TrimSpace(os.Getenv("RUNNER_TOKEN")),
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
		return "", errors.New("RUNNER_BASE_URL must use http/https/ws/wss scheme")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/v1/workers/connect"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func toRunnerHTTPBase(baseURL string) (string, error) {
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
		return "", errors.New("RUNNER_BASE_URL must use http/https/ws/wss scheme")
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
