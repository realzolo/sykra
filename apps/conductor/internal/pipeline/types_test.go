package pipeline

import (
	"strings"
	"testing"
)

func TestBuildInternalPlanDefaultsQualityGateStageToReview(t *testing.T) {
	cfg := validQualityGateConfig()
	cfg.Jobs[0].Stage = ""

	plan := BuildInternalPlan(cfg, "project-1")
	if len(plan.Jobs) != 1 {
		t.Fatalf("expected 1 job, got %d", len(plan.Jobs))
	}
	if got := plan.Jobs[0].Stage; got != string(StageReview) {
		t.Fatalf("expected quality gate stage to normalize to %q, got %q", StageReview, got)
	}
}

func TestValidateConfigRejectsQualityGateStageMismatch(t *testing.T) {
	cfg := validQualityGateConfig()
	cfg.Jobs[0].Stage = "build"

	err := ValidateConfig(cfg)
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	if !strings.Contains(err.Error(), "must use stage review") {
		t.Fatalf("expected stage validation error, got %v", err)
	}
}

func TestValidateConfigRejectsMissingQualityGateMinScore(t *testing.T) {
	cfg := validQualityGateConfig()
	cfg.Jobs[0].Steps[1].ArtifactPaths = []string{"quality-gate.sarif"}
	cfg.Jobs[0].MinScore = 0

	err := ValidateConfig(cfg)
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	if !strings.Contains(err.Error(), "minScore must be between 1 and 100") {
		t.Fatalf("expected minScore validation error, got %v", err)
	}
}

func TestValidateConfigRejectsMissingStaticAnalysisArtifactPaths(t *testing.T) {
	cfg := validQualityGateConfig()
	cfg.Jobs[0].MinScore = 60
	cfg.Jobs[0].Steps[1].ArtifactPaths = nil

	err := ValidateConfig(cfg)
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	if !strings.Contains(err.Error(), "requires a report artifact path") {
		t.Fatalf("expected artifact path validation error, got %v", err)
	}
}

func TestValidateConfigRejectsMixedTriggerWithoutPurpose(t *testing.T) {
	cfg := validPipelineConfigWithDeploy()
	cfg.Trigger.AutoTrigger = true
	cfg.Trigger.Schedule = "0 2 * * *"
	cfg.Trigger.Purpose = ""

	err := ValidateConfig(cfg)
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	if !strings.Contains(err.Error(), "trigger purpose is required") {
		t.Fatalf("expected mixed-trigger purpose validation error, got %v", err)
	}
}

func TestValidateConfigRejectsDeployStepMissingArtifactSource(t *testing.T) {
	cfg := validPipelineConfigWithDeploy()
	cfg.Jobs[2].Steps[0].ArtifactSource = ""

	err := ValidateConfig(cfg)
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	if !strings.Contains(err.Error(), "must declare artifactSource=run or artifactSource=registry") {
		t.Fatalf("expected deploy artifact source validation error, got %v", err)
	}
}

func TestValidateConfigRejectsDeployStepMissingArtifactInputs(t *testing.T) {
	cfg := validPipelineConfigWithDeploy()
	cfg.Jobs[2].Steps[0].ArtifactSource = "run"
	cfg.Jobs[2].Steps[0].ArtifactInputs = nil

	err := ValidateConfig(cfg)
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	if !strings.Contains(err.Error(), "requires artifactInputs when artifactSource=run") {
		t.Fatalf("expected deploy artifact input validation error, got %v", err)
	}
}

func validQualityGateConfig() PipelineConfig {
	return PipelineConfig{
		Name:          "Example",
		BuildImage:    "node:22-bookworm",
		Trigger:       TriggerConfig{},
		Notifications: NotifyConfig{},
		Jobs: []PipelineJob{
			{
				ID:       "quality",
				Name:     "Quality Gate",
				Stage:    "review",
				Type:     "quality_gate",
				MinScore: 60,
				Steps: []PipelineStep{
					{ID: "ai-review", Name: "AI Review", CheckType: "ai_review"},
					{
						ID:            "static-analysis",
						Name:          "Static Analysis",
						CheckType:     "static_analysis",
						Script:        "npm run lint",
						ArtifactPaths: []string{"quality-gate.sarif"},
					},
				},
			},
		},
	}
}

func validPipelineConfigWithDeploy() PipelineConfig {
	return PipelineConfig{
		Name:       "Deploy Example",
		BuildImage: "node:22-bookworm",
		Trigger:    TriggerConfig{},
		Jobs: []PipelineJob{
			{
				ID:    "source",
				Name:  "Source",
				Stage: "source",
				Type:  "source_checkout",
				Steps: []PipelineStep{
					{ID: "checkout", Name: "Checkout"},
				},
			},
			{
				ID:       "quality",
				Name:     "Quality Gate",
				Stage:    "review",
				Type:     "quality_gate",
				MinScore: 60,
				Needs:    []string{"source"},
				Steps: []PipelineStep{
					{ID: "ai-review", Name: "AI Review", CheckType: "ai_review"},
					{
						ID:            "static-analysis",
						Name:          "Static Analysis",
						CheckType:     "static_analysis",
						Script:        "npm run lint",
						ArtifactPaths: []string{"quality-gate.sarif"},
					},
				},
			},
			{
				ID:    "deploy",
				Name:  "Deploy",
				Stage: "deploy",
				Type:  "shell",
				Needs: []string{"quality"},
				Steps: []PipelineStep{
					{
						ID:             "deploy-step",
						Name:           "Deploy Step",
						Script:         "echo deploy",
						ArtifactSource: "run",
						ArtifactInputs: []string{"dist/**"},
					},
				},
			},
		},
	}
}
