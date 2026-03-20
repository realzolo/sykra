package domain

import "encoding/json"

type CodeReviewRequest struct {
	ProjectID        string          `json:"projectId"`
	RunID            string          `json:"runId"`
	Repo             string          `json:"repo"`
	ProfileID        string          `json:"profileId"`
	ProfileVersionID string          `json:"profileVersionId"`
	ScopeMode        string          `json:"scopeMode"`
	BaseRef          string          `json:"baseRef,omitempty"`
	HeadRef          string          `json:"headRef,omitempty"`
	Hashes           []string        `json:"hashes"`
	Policy           json.RawMessage `json:"policy"`
}

type CodeReviewProgress struct {
	Stage          string  `json:"stage"`
	Message        string  `json:"message"`
	CurrentTool    *string `json:"currentTool,omitempty"`
	FilesProcessed int     `json:"filesProcessed"`
	FilesTotal     int     `json:"filesTotal"`
}

type CodeReviewFinding struct {
	Stage       string          `json:"stage"`
	Source      string          `json:"source"`
	Tool        *string         `json:"tool,omitempty"`
	RuleID      *string         `json:"ruleId,omitempty"`
	Fingerprint string          `json:"fingerprint"`
	Category    string          `json:"category"`
	Severity    string          `json:"severity"`
	Confidence  *float64        `json:"confidence,omitempty"`
	Title       string          `json:"title"`
	Message     string          `json:"message"`
	File        string          `json:"file"`
	Line        *int            `json:"line,omitempty"`
	EndLine     *int            `json:"endLine,omitempty"`
	Suggestion  *string         `json:"suggestion,omitempty"`
	FixPatch    *string         `json:"fixPatch,omitempty"`
	Priority    *int            `json:"priority,omitempty"`
	ImpactScope *string         `json:"impactScope,omitempty"`
	Metadata    json.RawMessage `json:"metadata,omitempty"`
}

type CodeReviewResult struct {
	Summary    string              `json:"summary"`
	Score      int                 `json:"score"`
	RiskLevel  string              `json:"riskLevel"`
	GateStatus string              `json:"gateStatus"`
	Findings   []CodeReviewFinding `json:"findings"`
	Result     json.RawMessage     `json:"result,omitempty"`
}

type BaselineToolRun struct {
	Tool          string          `json:"tool"`
	Version       string          `json:"version,omitempty"`
	Status        string          `json:"status"`
	Command       string          `json:"command,omitempty"`
	ExitCode      *int            `json:"exitCode,omitempty"`
	DurationMs    int             `json:"durationMs"`
	ArtifactPath  string          `json:"artifactPath,omitempty"`
	StdoutExcerpt string          `json:"stdoutExcerpt,omitempty"`
	StderrExcerpt string          `json:"stderrExcerpt,omitempty"`
	Metadata      json.RawMessage `json:"metadata,omitempty"`
	Findings      []CodeReviewFinding
}
