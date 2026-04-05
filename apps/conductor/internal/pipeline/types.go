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
	BuildImage    string                `json:"buildImage,omitempty"`
	Variables     map[string]string     `json:"variables,omitempty"`
	Environment   string                `json:"environment,omitempty"`
	Trigger       TriggerConfig         `json:"trigger"`
	Notifications NotifyConfig          `json:"notifications"`
	Stages        PipelineStageSettings `json:"stages,omitempty"`
	Jobs          []PipelineJob         `json:"jobs"`
}

type TriggerConfig struct {
	AutoTrigger bool   `json:"autoTrigger"`
	Schedule    string `json:"schedule,omitempty"`
	Purpose     string `json:"purpose,omitempty"`
}

type NotifyConfig struct {
	OnSuccess bool     `json:"onSuccess"`
	OnFailure bool     `json:"onFailure"`
	Channels  []string `json:"channels"`
}

// ── Step (same for build and deploy) ─────────────────────────────────────

type PipelineStep struct {
	ID                 string            `json:"id"`
	Name               string            `json:"name"`
	Script             string            `json:"script"`
	CheckType          string            `json:"checkType,omitempty"` // "ai_review" | "static_analysis"
	ArtifactPaths      []string          `json:"artifactPaths,omitempty"`
	ArtifactInputs     []string          `json:"artifactInputs,omitempty"`
	ArtifactSource     string            `json:"artifactSource,omitempty"` // "run" | "registry"
	RegistryRepository string            `json:"registryRepository,omitempty"`
	RegistryVersion    string            `json:"registryVersion,omitempty"`
	RegistryChannel    string            `json:"registryChannel,omitempty"`
	Env                map[string]string `json:"env,omitempty"`
	WorkingDir         string            `json:"workingDir,omitempty"`
	TimeoutSeconds     *int              `json:"timeoutSeconds,omitempty"`
	ContinueOnError    bool              `json:"continueOnError,omitempty"`
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
	Type string `json:"type,omitempty"` // "shell" | "source_checkout" | "quality_gate"
	// For source_checkout
	Branch    string `json:"branch,omitempty"`
	ProjectID string `json:"projectId,omitempty"`
	// For quality_gate
	MinScore int `json:"minScore,omitempty"`
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
func BuildInternalPlan(cfg PipelineConfig, projectID string) InternalPlan {
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
			job.Branch = strings.TrimSpace(job.Branch)
			if strings.TrimSpace(job.Branch) == "" {
				job.Branch = "main"
			}
			if len(job.Steps) == 0 {
				job.Steps = []PipelineStep{{ID: "checkout", Name: "Checkout"}}
			}
		case "quality_gate":
			job.ProjectID = projectID
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
	case "quality_gate":
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
	if strings.TrimSpace(cfg.BuildImage) == "" {
		return errors.New("pipeline buildImage is required")
	}

	if schedule := strings.TrimSpace(cfg.Trigger.Schedule); schedule != "" {
		if _, err := parseSchedule(schedule); err != nil {
			return fmt.Errorf("invalid trigger schedule: %w", err)
		}
		if cfg.Trigger.AutoTrigger && strings.TrimSpace(cfg.Trigger.Purpose) == "" {
			return errors.New("trigger purpose is required when autoTrigger and schedule are both enabled")
		}
	}

	for _, job := range cfg.Jobs {
		if strings.TrimSpace(strings.ToLower(job.Type)) == "quality_gate" {
			stage := strings.TrimSpace(strings.ToLower(job.Stage))
			if stage != "" && stage != string(StageReview) {
				return fmt.Errorf("job %s of type quality_gate must use stage review", job.ID)
			}
		}
	}

	plan := BuildInternalPlan(cfg, "")
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
		stageKey := normalizeStageKey(job.Stage, job)
		for _, need := range job.Needs {
			if need == job.ID {
				return fmt.Errorf("job %s cannot depend on itself", job.ID)
			}
			if _, ok := jobIndex[need]; !ok {
				return fmt.Errorf("job %s depends on unknown job %s", job.ID, need)
			}
		}
		stepIndex := map[string]struct{}{}
		for _, step := range job.Steps {
			if step.ID == "" {
				return fmt.Errorf("job %s has a step with empty id", job.ID)
			}
			if !isSafeID(step.ID) {
				return fmt.Errorf("step id contains invalid characters: %s", step.ID)
			}
			if _, exists := stepIndex[step.ID]; exists {
				return fmt.Errorf("job %s has duplicate step id %s", job.ID, step.ID)
			}
			stepIndex[step.ID] = struct{}{}
			if strings.TrimSpace(step.Name) == "" {
				return fmt.Errorf("step %s in job %s has empty name", step.ID, job.ID)
			}
			if stageOrder(stageKey) < stageOrder(StageDeploy) && strings.EqualFold(strings.TrimSpace(step.Type), "docker") {
				return fmt.Errorf("step %s in job %s cannot use type=docker outside deploy stages; use pipeline buildImage instead", step.ID, job.ID)
			}
			if strings.EqualFold(strings.TrimSpace(step.Type), "docker") && strings.TrimSpace(step.DockerImage) == "" {
				return fmt.Errorf("step %s in job %s requires dockerImage when type=docker", step.ID, job.ID)
			}
			if strings.TrimSpace(strings.ToLower(job.Type)) == "quality_gate" {
				if step.CheckType != "ai_review" && step.CheckType != "static_analysis" {
					return fmt.Errorf("step %s in job %s must define checkType ai_review or static_analysis", step.ID, job.ID)
				}
			} else if strings.TrimSpace(step.CheckType) != "" {
				return fmt.Errorf("step %s in job %s cannot define checkType outside quality gate jobs", step.ID, job.ID)
			}
			if strings.TrimSpace(strings.ToLower(job.Type)) == "quality_gate" && strings.EqualFold(strings.TrimSpace(step.CheckType), "static_analysis") {
				if len(step.ArtifactPaths) == 0 {
					return fmt.Errorf("step %s in job %s requires a report artifact path", step.ID, job.ID)
				}
				if !hasStructuredStaticAnalysisArtifactPath(step.ArtifactPaths) {
					return fmt.Errorf("step %s in job %s must include a SARIF, normalized JSON, or Go vet JSON artifact path", step.ID, job.ID)
				}
			}
			artifactSource := strings.TrimSpace(strings.ToLower(step.ArtifactSource))
			if stageKey == StageDeploy {
				if artifactSource == "" {
					return fmt.Errorf("step %s in job %s must declare artifactSource=run or artifactSource=registry", step.ID, job.ID)
				}
				if artifactSource != "run" && artifactSource != "registry" {
					return fmt.Errorf("step %s in job %s has invalid artifactSource %s", step.ID, job.ID, step.ArtifactSource)
				}
				if artifactSource == "run" {
					hasArtifactInputs := false
					for _, input := range step.ArtifactInputs {
						if strings.TrimSpace(input) != "" {
							hasArtifactInputs = true
							break
						}
					}
					if !hasArtifactInputs {
						return fmt.Errorf("step %s in job %s requires artifactInputs when artifactSource=run", step.ID, job.ID)
					}
					if strings.TrimSpace(step.RegistryRepository) != "" || strings.TrimSpace(step.RegistryVersion) != "" || strings.TrimSpace(step.RegistryChannel) != "" {
						return fmt.Errorf("step %s in job %s cannot define registry fields when artifactSource=run", step.ID, job.ID)
					}
				}
			}
			if artifactSource == "registry" {
				if strings.TrimSpace(step.RegistryRepository) == "" {
					return fmt.Errorf("step %s in job %s requires registryRepository when artifactSource=registry", step.ID, job.ID)
				}
				hasVersion := strings.TrimSpace(step.RegistryVersion) != ""
				hasChannel := strings.TrimSpace(step.RegistryChannel) != ""
				if hasVersion == hasChannel {
					return fmt.Errorf("step %s in job %s must define exactly one of registryVersion or registryChannel", step.ID, job.ID)
				}
			}
		}
		if strings.TrimSpace(strings.ToLower(job.Type)) == "quality_gate" {
			if len(job.Steps) != 2 {
				return fmt.Errorf("job %s must include exactly two steps: ai_review and static_analysis", job.ID)
			}
			firstStep := job.Steps[0]
			secondStep := job.Steps[1]
			if firstStep.CheckType != "ai_review" || secondStep.CheckType != "static_analysis" {
				return fmt.Errorf("job %s must order steps as ai_review then static_analysis", job.ID)
			}
			if strings.TrimSpace(firstStep.Script) != "" {
				return fmt.Errorf("step %s in job %s must not define a shell command", firstStep.ID, job.ID)
			}
			if strings.TrimSpace(secondStep.Script) == "" {
				return fmt.Errorf("step %s in job %s requires a static analysis command", secondStep.ID, job.ID)
			}
			if job.MinScore < 1 || job.MinScore > 100 {
				return fmt.Errorf("job %s minScore must be between 1 and 100", job.ID)
			}
		}
	}
	if hasCycle(jobIndex) {
		return errors.New("pipeline graph contains a cycle")
	}

	// ── Fixed-stage constraints ────────────────────────────────────────────
	// source stage: exactly one source_checkout job required
	var sourceJobs []PipelineJob
	for _, job := range plan.Jobs {
		if normalizeStageKey(job.Stage, job) == StageSource {
			sourceJobs = append(sourceJobs, job)
		}
	}
	if len(sourceJobs) == 0 {
		return errors.New("pipeline must have exactly one source_checkout job in the source stage")
	}
	if len(sourceJobs) > 1 {
		return fmt.Errorf("pipeline must have exactly one source_checkout job in the source stage, found %d", len(sourceJobs))
	}
	if strings.TrimSpace(strings.ToLower(sourceJobs[0].Type)) != "source_checkout" {
		return fmt.Errorf("job %s in the source stage must be of type source_checkout", sourceJobs[0].ID)
	}

	// review stage: exactly one quality_gate job required
	var reviewJobs []PipelineJob
	for _, job := range plan.Jobs {
		if normalizeStageKey(job.Stage, job) == StageReview {
			reviewJobs = append(reviewJobs, job)
		}
	}
	if len(reviewJobs) == 0 {
		return errors.New("pipeline must have exactly one quality_gate job in the review stage")
	}
	if len(reviewJobs) > 1 {
		return fmt.Errorf("pipeline must have exactly one quality_gate job in the review stage, found %d", len(reviewJobs))
	}
	if strings.TrimSpace(strings.ToLower(reviewJobs[0].Type)) != "quality_gate" {
		return fmt.Errorf("job %s in the review stage must be of type quality_gate", reviewJobs[0].ID)
	}

	// after_* stages: only shell jobs allowed
	afterStages := []PipelineStageKey{StageAfterSource, StageAfterReview, StageAfterBuild, StageAfterDeploy}
	afterStageSet := make(map[PipelineStageKey]bool, len(afterStages))
	for _, s := range afterStages {
		afterStageSet[s] = true
	}
	for _, job := range plan.Jobs {
		stage := normalizeStageKey(job.Stage, job)
		if afterStageSet[stage] {
			jobType := strings.TrimSpace(strings.ToLower(job.Type))
			if jobType != "shell" && jobType != "" {
				return fmt.Errorf("job %s in stage %s must be of type shell (automation slots only support shell jobs)", job.ID, stage)
			}
		}
	}

	return nil
}

var safeIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func isSafeID(value string) bool {
	return safeIDPattern.MatchString(value)
}

func hasStructuredStaticAnalysisArtifactPath(values []string) bool {
	for _, value := range values {
		trimmed := strings.ToLower(strings.TrimSpace(value))
		if trimmed == "" {
			continue
		}
		if strings.HasSuffix(trimmed, ".sarif") || strings.HasSuffix(trimmed, ".static-analysis.json") || strings.HasSuffix(trimmed, ".vet.json") {
			return true
		}
	}
	return false
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
