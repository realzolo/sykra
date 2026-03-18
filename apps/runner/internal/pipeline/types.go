package pipeline

import (
	"errors"
	"fmt"
	"regexp"
)

// RunStatus values
type RunStatus string

const (
	StatusQueued   RunStatus = "queued"
	StatusRunning  RunStatus = "running"
	StatusSuccess  RunStatus = "success"
	StatusFailed   RunStatus = "failed"
	StatusCanceled RunStatus = "canceled"
	StatusTimedOut RunStatus = "timed_out"
	StatusSkipped  RunStatus = "skipped"
)

// ── Pipeline config (fixed four-stage format) ─────────────────────────────

type PipelineConfig struct {
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Variables   map[string]string `json:"variables,omitempty"`
	Source      SourceStage       `json:"source"`
	Review      ReviewStage       `json:"review"`
	Build       BuildStage        `json:"build"`
	Deploy      DeployStage       `json:"deploy"`
	Notify      NotifyConfig      `json:"notifications"`
}

type SourceStage struct {
	Branch      string `json:"branch"`
	AutoTrigger bool   `json:"autoTrigger"`
}

type ReviewStage struct {
	Enabled             bool `json:"enabled"`
	QualityGateEnabled  bool `json:"qualityGateEnabled"`
	QualityGateMinScore int  `json:"qualityGateMinScore"`
}

type BuildStage struct {
	Enabled bool           `json:"enabled"`
	Steps   []PipelineStep `json:"steps"`
}

type DeployStage struct {
	Enabled         bool           `json:"enabled"`
	Steps           []PipelineStep `json:"steps"`
	RollbackEnabled bool           `json:"rollbackEnabled"`
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
	Env             map[string]string `json:"env,omitempty"`
	WorkingDir      string            `json:"workingDir,omitempty"`
	TimeoutSeconds  *int              `json:"timeoutSeconds,omitempty"`
	ContinueOnError bool              `json:"continueOnError,omitempty"`
	// Docker step fields
	Type        string `json:"type,omitempty"`        // "shell" (default) | "docker"
	DockerImage string `json:"dockerImage,omitempty"` // e.g. "node:22-alpine"
}

// ── Internal job representation (used by engine) ─────────────────────────
// The engine works with PipelineJob DAGs internally.
// Four-stage config is translated to a linear DAG before execution.

type PipelineJob struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
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

// ── Legacy internal stage structure (used by graph/engine) ────────────────

type PipelineStage struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	JobIDs []string `json:"jobIds"`
}

// ── InternalPlan: four-stage config translated to a job DAG ───────────────

type InternalPlan struct {
	Jobs   []PipelineJob   `json:"jobs"`
	Stages []PipelineStage `json:"stages"`
}

// BuildInternalPlan translates the four-stage PipelineConfig into a linear
// job DAG: source_checkout → review_gate? → build? → deploy?
func BuildInternalPlan(cfg PipelineConfig, projectID, studioURL, studioToken string) InternalPlan {
	var jobs []PipelineJob
	var prev string // job ID that the next one depends on

	// Stage 1: source checkout (always present)
	sourceJob := PipelineJob{
		ID:        "source",
		Name:      "Source",
		Type:      "source_checkout",
		Branch:    cfg.Source.Branch,
		ProjectID: projectID,
		Steps: []PipelineStep{{
			ID:     "checkout",
			Name:   "Checkout",
			Script: "",
		}},
	}
	if prev != "" {
		sourceJob.Needs = []string{prev}
	}
	jobs = append(jobs, sourceJob)
	prev = sourceJob.ID

	// Stage 2: review gate (optional)
	if cfg.Review.Enabled {
		score := cfg.Review.QualityGateMinScore
		if !cfg.Review.QualityGateEnabled {
			score = 0 // run review but don't block
		}
		reviewJob := PipelineJob{
			ID:          "review",
			Name:        "Code Review",
			Type:        "review_gate",
			Needs:       []string{prev},
			ProjectID:   projectID,
			MinScore:    score,
			StudioURL:   studioURL,
			StudioToken: studioToken,
			Steps: []PipelineStep{{
				ID:     "gate",
				Name:   "Quality Gate",
				Script: "",
			}},
		}
		jobs = append(jobs, reviewJob)
		prev = reviewJob.ID
	}

	// Stage 3: build (optional)
	if cfg.Build.Enabled && len(cfg.Build.Steps) > 0 {
		buildJob := PipelineJob{
			ID:    "build",
			Name:  "Build",
			Needs: []string{prev},
			Steps: cfg.Build.Steps,
		}
		jobs = append(jobs, buildJob)
		prev = buildJob.ID
	}

	// Stage 4: deploy (optional)
	if cfg.Deploy.Enabled && len(cfg.Deploy.Steps) > 0 {
		deployJob := PipelineJob{
			ID:    "deploy",
			Name:  "Deploy",
			Needs: []string{prev},
			Steps: cfg.Deploy.Steps,
		}
		jobs = append(jobs, deployJob)
		prev = deployJob.ID
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

// ── Validation ─────────────────────────────────────────────────────────────

func ValidateConfig(cfg PipelineConfig) error {
	if cfg.Name == "" {
		return errors.New("pipeline name is required")
	}
	if cfg.Source.Branch == "" {
		cfg.Source.Branch = "main"
	}

	plan := BuildInternalPlan(cfg, "", "", "")
	if len(plan.Jobs) == 0 {
		return errors.New("pipeline must have at least one enabled stage with steps")
	}

	for _, job := range plan.Jobs {
		for _, step := range job.Steps {
			if step.ID == "" {
				return fmt.Errorf("job %s has a step with empty id", job.ID)
			}
			if !isSafeID(step.ID) {
				return fmt.Errorf("step id contains invalid characters: %s", step.ID)
			}
		}
	}
	return nil
}

var safeIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func isSafeID(value string) bool {
	return safeIDPattern.MatchString(value)
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
