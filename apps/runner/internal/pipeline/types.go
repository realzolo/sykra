package pipeline

import (
	"errors"
	"fmt"
	"regexp"
)

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

type PipelineConfig struct {
	Version     string            `json:"version"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Variables   map[string]string `json:"variables,omitempty"`
	Stages      []PipelineStage   `json:"stages"`
	Jobs        []PipelineJob     `json:"jobs"`
}

type PipelineStage struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	JobIDs []string `json:"jobIds"`
}

type PipelineJob struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Needs          []string          `json:"needs,omitempty"`
	Steps          []PipelineStep    `json:"steps"`
	TimeoutSeconds *int              `json:"timeoutSeconds,omitempty"`
	Env            map[string]string `json:"env,omitempty"`
	WorkingDir     string            `json:"workingDir,omitempty"`
}

type PipelineStep struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Type            string            `json:"type"`
	Script          string            `json:"script,omitempty"`
	Env             map[string]string `json:"env,omitempty"`
	WorkingDir      string            `json:"workingDir,omitempty"`
	TimeoutSeconds  *int              `json:"timeoutSeconds,omitempty"`
	ContinueOnError bool              `json:"continueOnError,omitempty"`
	Artifacts       []string          `json:"artifacts,omitempty"`
}

func ValidateConfig(cfg PipelineConfig) error {
	if cfg.Version == "" {
		return errors.New("config version is required")
	}
	if cfg.Name == "" {
		return errors.New("pipeline name is required")
	}
	if len(cfg.Jobs) == 0 {
		return errors.New("at least one job is required")
	}

	jobIndex := map[string]PipelineJob{}
	for _, job := range cfg.Jobs {
		if job.ID == "" {
			return errors.New("job id is required")
		}
		if !isSafeID(job.ID) {
			return fmt.Errorf("job id contains invalid characters: %s", job.ID)
		}
		if _, exists := jobIndex[job.ID]; exists {
			return fmt.Errorf("duplicate job id: %s", job.ID)
		}
		if job.Name == "" {
			return fmt.Errorf("job name is required for %s", job.ID)
		}
		if len(job.Steps) == 0 {
			return fmt.Errorf("job %s must have at least one step", job.ID)
		}
		jobIndex[job.ID] = job

		stepIndex := map[string]struct{}{}
		for _, step := range job.Steps {
			if step.ID == "" {
				return fmt.Errorf("job %s has a step with empty id", job.ID)
			}
			if !isSafeID(step.ID) {
				return fmt.Errorf("step id contains invalid characters: %s", step.ID)
			}
			if _, exists := stepIndex[step.ID]; exists {
				return fmt.Errorf("job %s has duplicate step id: %s", job.ID, step.ID)
			}
			stepIndex[step.ID] = struct{}{}
			if step.Name == "" {
				return fmt.Errorf("step %s in job %s is missing name", step.ID, job.ID)
			}
			if step.Type == "" {
				return fmt.Errorf("step %s in job %s is missing type", step.ID, job.ID)
			}
			if step.Type != "shell" {
				return fmt.Errorf("unsupported step type %s in job %s", step.Type, job.ID)
			}
			if step.Type == "shell" && step.Script == "" {
				return fmt.Errorf("shell step %s in job %s requires script", step.ID, job.ID)
			}
		}
	}

	stageIndex := map[string]struct{}{}
	for _, stage := range cfg.Stages {
		if stage.ID == "" {
			return errors.New("stage id is required")
		}
		if !isSafeID(stage.ID) {
			return fmt.Errorf("stage id contains invalid characters: %s", stage.ID)
		}
		if _, exists := stageIndex[stage.ID]; exists {
			return fmt.Errorf("duplicate stage id: %s", stage.ID)
		}
		stageIndex[stage.ID] = struct{}{}
		if stage.Name == "" {
			return fmt.Errorf("stage %s is missing name", stage.ID)
		}
		for _, jobID := range stage.JobIDs {
			if _, exists := jobIndex[jobID]; !exists {
				return fmt.Errorf("stage %s references unknown job %s", stage.ID, jobID)
			}
		}
	}

	for _, job := range cfg.Jobs {
		for _, need := range job.Needs {
			if need == job.ID {
				return fmt.Errorf("job %s cannot depend on itself", job.ID)
			}
			if _, exists := jobIndex[need]; !exists {
				return fmt.Errorf("job %s depends on unknown job %s", job.ID, need)
			}
		}
	}

	if hasCycle(jobIndex) {
		return errors.New("job dependency graph contains a cycle")
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
