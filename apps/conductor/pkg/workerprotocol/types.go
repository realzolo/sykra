package workerprotocol

// Message types from worker -> master.
const (
	WorkerMessageTypeHello        = "hello"
	WorkerMessageTypeHeartbeat    = "heartbeat"
	WorkerMessageTypeJobAck       = "job_ack"
	WorkerMessageTypeStepStarted  = "step_started"
	WorkerMessageTypeStepLog      = "step_log"
	WorkerMessageTypeStepArtifact = "step_artifact"
	WorkerMessageTypeStepFinished = "step_finished"
	WorkerMessageTypeJobFinished  = "job_finished"
)

// Message types from master -> worker.
const (
	MasterMessageTypeWelcome    = "welcome"
	MasterMessageTypeExecuteJob = "execute_job"
	MasterMessageTypeCancelJob  = "cancel_job"
	MasterMessageTypePing       = "ping"
)

type Envelope struct {
	Type string `json:"type"`
}

type HelloMessage struct {
	Type          string            `json:"type"`
	WorkerID      string            `json:"workerId"`
	Hostname      string            `json:"hostname"`
	Version       string            `json:"version"`
	Labels        map[string]string `json:"labels,omitempty"`
	Capabilities  []string          `json:"capabilities,omitempty"`
	MaxConcurrent int               `json:"maxConcurrent"`
}

type HeartbeatMessage struct {
	Type string `json:"type"`
	Busy int    `json:"busy"`
}

type JobAckMessage struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
}

type StepStartedMessage struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	StepID    string `json:"stepId"`
}

type StepLogMessage struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	StepID    string `json:"stepId"`
	Chunk     string `json:"chunk"`
	Stream    string `json:"stream,omitempty"`
}

type StepArtifactMessage struct {
	Type          string `json:"type"`
	RequestID     string `json:"requestId"`
	StepID        string `json:"stepId"`
	Status        string `json:"status"` // started | downloaded | failed
	ArtifactID    string `json:"artifactId,omitempty"`
	Path          string `json:"path,omitempty"`
	Attempt       int    `json:"attempt,omitempty"`
	DurationMs    int64  `json:"durationMs,omitempty"`
	SizeBytes     int64  `json:"sizeBytes,omitempty"`
	ErrorCategory string `json:"errorCategory,omitempty"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
}

type StepFinishedMessage struct {
	Type         string `json:"type"`
	RequestID    string `json:"requestId"`
	StepID       string `json:"stepId"`
	Status       string `json:"status"`
	ExitCode     int    `json:"exitCode"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

type JobFinishedMessage struct {
	Type         string `json:"type"`
	RequestID    string `json:"requestId"`
	Status       string `json:"status"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

type WelcomeMessage struct {
	Type         string `json:"type"`
	SessionID    string `json:"sessionId"`
	LeaseSeconds int    `json:"leaseSeconds"`
}

type CancelJobMessage struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
}

type PingMessage struct {
	Type string `json:"type"`
}

type ExecuteJobMessage struct {
	Type            string        `json:"type"`
	RequestID       string        `json:"requestId"`
	RunID           string        `json:"runId"`
	JobID           string        `json:"jobId"`
	JobKey          string        `json:"jobKey"`
	JobType         string        `json:"jobType,omitempty"`
	ExecutionTarget string        `json:"executionTarget,omitempty"` // "build" | "deploy"
	Environment     string        `json:"environment,omitempty"`
	ProjectID       string        `json:"projectId,omitempty"`
	Branch          string        `json:"branch,omitempty"`
	MinScore        int           `json:"minScore,omitempty"`
	StudioURL       string        `json:"studioUrl,omitempty"`
	StudioToken     string        `json:"studioToken,omitempty"`
	WorkspaceRoot   string        `json:"workspaceRoot,omitempty"`
	JobWorkingDir   string        `json:"jobWorkingDir,omitempty"`
	Steps           []ExecuteStep `json:"steps"`
}

type ExecuteStep struct {
	ID                 string                 `json:"id"`
	Name               string                 `json:"name"`
	Script             string                 `json:"script"`
	Type               string                 `json:"type,omitempty"`
	DockerImage        string                 `json:"dockerImage,omitempty"`
	ArtifactPaths      []string               `json:"artifactPaths,omitempty"`
	ArtifactInputs     []string               `json:"artifactInputs,omitempty"`
	ArtifactSource     string                 `json:"artifactSource,omitempty"`
	RegistryRepository string                 `json:"registryRepository,omitempty"`
	RegistryVersion    string                 `json:"registryVersion,omitempty"`
	RegistryChannel    string                 `json:"registryChannel,omitempty"`
	RegistryFiles      []RegistryArtifactFile `json:"registryFiles,omitempty"`
	Env                map[string]string      `json:"env,omitempty"`
	WorkingDir         string                 `json:"workingDir,omitempty"`
	TimeoutSeconds     *int                   `json:"timeoutSeconds,omitempty"`
	ContinueOnError    bool                   `json:"continueOnError,omitempty"`
}

type RegistryArtifactFile struct {
	FileID      string `json:"fileId"`
	LogicalPath string `json:"logicalPath"`
	FileName    string `json:"fileName"`
	SizeBytes   int64  `json:"sizeBytes"`
	Sha256      string `json:"sha256,omitempty"`
}
