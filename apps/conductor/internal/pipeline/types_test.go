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
	cfg.Jobs[0].MinScore = 0

	err := ValidateConfig(cfg)
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	if !strings.Contains(err.Error(), "minScore must be between 1 and 100") {
		t.Fatalf("expected minScore validation error, got %v", err)
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
					{ID: "static-analysis", Name: "Static Analysis", CheckType: "static_analysis", Script: "npm run lint"},
				},
			},
		},
	}
}
