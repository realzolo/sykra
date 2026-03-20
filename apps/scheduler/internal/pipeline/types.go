package pipeline

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// RunStatus values
type RunStatus string

const (
	StatusQueued        RunStatus = "queued"
	StatusRunning       RunStatus = "running"
	StatusWaitingManual RunStatus = "waiting_manual"
	StatusSuccess       RunStatus = "success"
	StatusFailed        RunStatus = "failed"
	StatusCanceled      RunStatus = "canceled"
	StatusTimedOut      RunStatus = "timed_out"
	StatusSkipped       RunStatus = "skipped"
)

type PipelineStageKey string

const (
	StageSource      PipelineStageKey = "source"
	StageAfterSource PipelineStageKey = "after_source"
	StageReview      PipelineStageKey = "review"
	StageAfterReview PipelineStageKey = "after_review"
	StageBuild       PipelineStageKey = "build"
	StageAfterBuild  PipelineStageKey = "after_build"
	StageDeploy      PipelineStageKey = "deploy"
	StageAfterDeploy PipelineStageKey = "after_deploy"
)

var pipelineStageSequence = []PipelineStageKey{
	StageSource,
	StageAfterSource,
	StageReview,
	StageAfterReview,
	StageBuild,
	StageAfterBuild,
	StageDeploy,
	StageAfterDeploy,
}

type PipelineStageConfig struct {
	EntryMode    string `json:"entryMode,omitempty"`    // "auto" | "manual"
	DispatchMode string `json:"dispatchMode,omitempty"` // "parallel" | "serial"
}

type PipelineStageSettings struct {
	Source      *PipelineStageConfig `json:"source,omitempty"`
	AfterSource *PipelineStageConfig `json:"after_source,omitempty"`
	Review      *PipelineStageConfig `json:"review,omitempty"`
	AfterReview *PipelineStageConfig `json:"after_review,omitempty"`
	Build       *PipelineStageConfig `json:"build,omitempty"`
	AfterBuild  *PipelineStageConfig `json:"after_build,omitempty"`
	Deploy      *PipelineStageConfig `json:"deploy,omitempty"`
	AfterDeploy *PipelineStageConfig `json:"after_deploy,omitempty"`
}

// ── Pipeline config (stage-authored, runtime DAG-derived) ─────────────────

type PipelineConfig struct {
	Name          string                `json:"name"`
	Description   string                `json:"description,omitempty"`
	Variables     map[string]string     `json:"variables,omitempty"`
	Environment   string                `json:"environment,omitempty"`
	Trigger       TriggerConfig         `json:"trigger"`
	Notifications NotifyConfig          `json:"notifications"`
	Stages        PipelineStageSettings `json:"stages,omitempty"`
	Jobs          []PipelineJob         `json:"jobs"`
}

type TriggerConfig struct {
	Branch      string `json:"branch"`
	AutoTrigger bool   `json:"autoTrigger"`
}

type NotifyConfig struct {
	OnSuccess bool     `json:"onSuccess"`
	OnFailure bool     `json:"onFailure"`
	Channels  []string `json:"channels"`
}

// ── Step (same for build and deploy) ─────────────────────────────────────

type PipelineStep struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Script          string            `json:"script"`
	ArtifactPaths   []string          `json:"artifactPaths,omitempty"`
	ArtifactInputs  []string          `json:"artifactInputs,omitempty"`
	Env             map[string]string `json:"env,omitempty"`
	WorkingDir      string            `json:"workingDir,omitempty"`
	TimeoutSeconds  *int              `json:"timeoutSeconds,omitempty"`
	ContinueOnError bool              `json:"continueOnError,omitempty"`
	// Docker step fields
	Type        string `json:"type,omitempty"`        // "shell" (default) | "docker"
	DockerImage string `json:"dockerImage,omitempty"` // e.g. "node:22-alpine"
}

// ── Pipeline jobs (DAG nodes) ──────────────────────────────────────────────
type PipelineJob struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Stage          string            `json:"stage,omitempty"`
	Needs          []string          `json:"needs,omitempty"`
	Steps          []PipelineStep    `json:"steps"`
	TimeoutSeconds *int              `json:"timeoutSeconds,omitempty"`
	Env            map[string]string `json:"env,omitempty"`
	WorkingDir     string            `json:"workingDir,omitempty"`
	// Internal metadata for built-in step types
	Type string `json:"type,omitempty"` // "shell" | "source_checkout" | "review_gate"
	// For source_checkout
	Branch    string `json:"branch,omitempty"`
	ProjectID string `json:"projectId,omitempty"`
	// For review_gate
	MinScore    int    `json:"minScore,omitempty"`
	StudioURL   string `json:"studioUrl,omitempty"`
	StudioToken string `json:"studioToken,omitempty"`
}

// ── Internal stage structure (used by graph/engine) ───────────────────────

type PipelineStage struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	JobIDs []string `json:"jobIds"`
}

// ── InternalPlan: normalized job DAG ───────────────────────────────────────

type InternalPlan struct {
	Jobs   []PipelineJob   `json:"jobs"`
	Stages []PipelineStage `json:"stages"`
}

// BuildInternalPlan normalizes the pipeline config into executable jobs.
func BuildInternalPlan(cfg PipelineConfig, projectID, studioURL, studioToken string) InternalPlan {
	jobs := make([]PipelineJob, 0, len(cfg.Jobs))
	for _, item := range cfg.Jobs {
		job := item
		job.Needs = append([]string(nil), item.Needs...)
		job.Steps = append([]PipelineStep(nil), item.Steps...)
		job.Env = cloneMap(item.Env)

		jobType := strings.TrimSpace(strings.ToLower(job.Type))
		if jobType == "" {
			jobType = "shell"
		}
		job.Type = jobType
		job.Stage = string(normalizeStageKey(job.Stage, job))
		switch job.Type {
		case "source_checkout":
			job.ProjectID = projectID
			if strings.TrimSpace(job.Branch) == "" {
				job.Branch = strings.TrimSpace(cfg.Trigger.Branch)
			}
			if strings.TrimSpace(job.Branch) == "" {
				job.Branch = "main"
			}
			if len(job.Steps) == 0 {
				job.Steps = []PipelineStep{{ID: "checkout", Name: "Checkout"}}
			}
		case "review_gate":
			job.ProjectID = projectID
			job.StudioURL = studioURL
			job.StudioToken = studioToken
			if len(job.Steps) == 0 {
				job.Steps = []PipelineStep{{ID: "gate", Name: "Quality Gate"}}
			}
		}
		jobs = append(jobs, job)
	}

	// Build stage list (one stage per job for simplicity)
	var stages []PipelineStage
	for _, j := range jobs {
		stages = append(stages, PipelineStage{
			ID:     j.ID,
			Name:   j.Name,
			JobIDs: []string{j.ID},
		})
	}

	return InternalPlan{Jobs: jobs, Stages: stages}
}

func normalizeStageKey(raw string, job PipelineJob) PipelineStageKey {
	stage := PipelineStageKey(strings.TrimSpace(strings.ToLower(raw)))
	switch stage {
	case StageSource, StageAfterSource, StageReview, StageAfterReview, StageBuild, StageAfterBuild, StageDeploy, StageAfterDeploy:
		return stage
	}

	switch strings.TrimSpace(strings.ToLower(job.Type)) {
	case "source_checkout":
		return StageSource
	case "review_gate":
		return StageReview
	}

	name := strings.ToLower(strings.TrimSpace(job.ID + " " + job.Name))
	if strings.Contains(name, "deploy") || strings.Contains(name, "release") || strings.Contains(name, "publish") {
		return StageDeploy
	}
	return StageBuild
}

func getStageConfig(settings PipelineStageSettings, stage PipelineStageKey) PipelineStageConfig {
	var config *PipelineStageConfig
	switch stage {
	case StageSource:
		config = settings.Source
	case StageAfterSource:
		config = settings.AfterSource
	case StageReview:
		config = settings.Review
	case StageAfterReview:
		config = settings.AfterReview
	case StageBuild:
		config = settings.Build
	case StageAfterBuild:
		config = settings.AfterBuild
	case StageDeploy:
		config = settings.Deploy
	case StageAfterDeploy:
		config = settings.AfterDeploy
	}

	if config == nil {
		return PipelineStageConfig{
			EntryMode:    "auto",
			DispatchMode: "parallel",
		}
	}

	entryMode := strings.TrimSpace(strings.ToLower(config.EntryMode))
	if entryMode == "" {
		entryMode = "auto"
	}
	dispatchMode := strings.TrimSpace(strings.ToLower(config.DispatchMode))
	if dispatchMode == "" {
		dispatchMode = "parallel"
	}

	return PipelineStageConfig{
		EntryMode:    entryMode,
		DispatchMode: dispatchMode,
	}
}

func stageOrder(stage PipelineStageKey) int {
	for index, item := range pipelineStageSequence {
		if item == stage {
			return index
		}
	}
	return len(pipelineStageSequence)
}

// ── Validation ─────────────────────────────────────────────────────────────

func ValidateConfig(cfg PipelineConfig) error {
	if strings.TrimSpace(cfg.Name) == "" {
		return errors.New("pipeline name is required")
	}

	plan := BuildInternalPlan(cfg, "", "", "")
	if len(plan.Jobs) == 0 {
		return errors.New("pipeline must have at least one job")
	}
	jobIndex := map[string]PipelineJob{}
	for _, job := range plan.Jobs {
		if strings.TrimSpace(job.ID) == "" {
			return errors.New("job id is required")
		}
		if !isSafeID(job.ID) {
			return fmt.Errorf("job id contains invalid characters: %s", job.ID)
		}
		if _, exists := jobIndex[job.ID]; exists {
			return fmt.Errorf("duplicate job id: %s", job.ID)
		}
		if strings.TrimSpace(job.Name) == "" {
			return fmt.Errorf("job %s name is required", job.ID)
		}
		if len(job.Steps) == 0 {
			return fmt.Errorf("job %s must include at least one step", job.ID)
		}
		jobIndex[job.ID] = job
	}

	for _, job := range plan.Jobs {
		for _, need := range job.Needs {
			if need == job.ID {
				return fmt.Errorf("job %s cannot depend on itself", job.ID)
			}
			if _, ok := jobIndex[need]; !ok {
				return fmt.Errorf("job %s depends on unknown job %s", job.ID, need)
			}
		}
		for _, step := range job.Steps {
			if step.ID == "" {
				return fmt.Errorf("job %s has a step with empty id", job.ID)
			}
			if !isSafeID(step.ID) {
				return fmt.Errorf("step id contains invalid characters: %s", step.ID)
			}
			if strings.TrimSpace(step.Name) == "" {
				return fmt.Errorf("step %s in job %s has empty name", step.ID, job.ID)
			}
			if strings.EqualFold(strings.TrimSpace(step.Type), "docker") && strings.TrimSpace(step.DockerImage) == "" {
				return fmt.Errorf("step %s in job %s requires dockerImage when type=docker", step.ID, job.ID)
			}
		}
	}
	if hasCycle(jobIndex) {
		return errors.New("pipeline graph contains a cycle")
	}
	return nil
}

var safeIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func isSafeID(value string) bool {
	return safeIDPattern.MatchString(value)
}

func cloneMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]string, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func hasCycle(jobIndex map[string]PipelineJob) bool {
	const (
		unvisited = 0
		visiting  = 1
		visited   = 2
	)
	state := map[string]int{}
	var visit func(string) bool
	visit = func(id string) bool {
		switch state[id] {
		case visiting:
			return true
		case visited:
			return false
		}
		state[id] = visiting
		job := jobIndex[id]
		for _, dep := range job.Needs {
			if visit(dep) {
				return true
			}
		}
		state[id] = visited
		return false
	}
	for id := range jobIndex {
		if state[id] == unvisited {
			if visit(id) {
				return true
			}
		}
	}
	return false
}
