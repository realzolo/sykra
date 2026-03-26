package pipeline

import (
	"encoding/json"
	"testing"
)

func TestSummarizeStaticAnalysisSARIF(t *testing.T) {
	doc := sarifDocument{
		Runs: []sarifRun{
			{
				Tool: sarifTool{
					Driver: sarifDriver{
						Name:    "eslint",
						Version: "9.0.0",
					},
				},
				Results: []sarifResult{
					{
						RuleID: "no-undef",
						Level:  "error",
						Message: sarifMessage{
							Text: "x is not defined",
						},
						Locations: []sarifLocation{
							{
								PhysicalLocation: sarifPhysicalLocation{
									ArtifactLocation: sarifArtifactLocation{URI: "src/app.ts"},
									Region:           sarifRegion{StartLine: 12, StartColumn: 4},
								},
							},
						},
					},
					{
						RuleID: "unused-vars",
						Level:  "warning",
						Message: sarifMessage{
							Text: "unused variable",
						},
					},
					{
						RuleID: "informational",
						Level:  "note",
						Message: sarifMessage{
							Text: "informational note",
						},
					},
				},
			},
		},
	}

	summary := summarizeStaticAnalysisSARIF(doc)
	if summary.ToolName != "eslint" {
		t.Fatalf("expected tool name eslint, got %q", summary.ToolName)
	}
	if summary.ToolVersion != "9.0.0" {
		t.Fatalf("expected tool version 9.0.0, got %q", summary.ToolVersion)
	}
	if summary.ReportFormat != "" {
		t.Fatalf("expected empty report format from direct SARIF summarizer, got %q", summary.ReportFormat)
	}
	if summary.ResultCount != 3 {
		t.Fatalf("expected 3 results, got %d", summary.ResultCount)
	}
	if summary.HighCount != 1 {
		t.Fatalf("expected 1 high severity finding, got %d", summary.HighCount)
	}
	if summary.MediumCount != 1 {
		t.Fatalf("expected 1 medium severity finding, got %d", summary.MediumCount)
	}
	if summary.LowCount != 1 {
		t.Fatalf("expected 1 low severity finding, got %d", summary.LowCount)
	}
	if summary.BlockingFindingCount != 1 {
		t.Fatalf("expected 1 blocking finding, got %d", summary.BlockingFindingCount)
	}
	if len(summary.Findings) != 3 {
		t.Fatalf("expected 3 sampled findings, got %d", len(summary.Findings))
	}
	if summary.Findings[0].File != "src/app.ts" {
		t.Fatalf("expected first finding file src/app.ts, got %q", summary.Findings[0].File)
	}
	if summary.Findings[0].Line != 12 {
		t.Fatalf("expected first finding line 12, got %d", summary.Findings[0].Line)
	}
	if summary.Findings[0].Severity != "high" {
		t.Fatalf("expected first finding severity high, got %q", summary.Findings[0].Severity)
	}
	if !summary.Findings[0].Blocking {
		t.Fatalf("expected first finding to be blocking")
	}
}

func TestSummarizeNormalizedStaticAnalysis(t *testing.T) {
	critical := true
	doc := normalizedStaticAnalysisDocument{
		Schema: normalizedStaticAnalysisSchema,
		Tool: normalizedStaticAnalysisTool{
			Name:    "ruff",
			Version: "0.9.0",
		},
		Findings: []normalizedStaticAnalysisFinding{
			{
				RuleID:   "F401",
				Severity: "critical",
				Message:  "unused import",
				File:     "src/app.py",
				Line:     7,
				Column:   1,
				Blocking: &critical,
			},
			{
				RuleID:   "B001",
				Severity: "medium",
				Message:  "blocking call",
				File:     "src/app.py",
				Line:     12,
				Column:   4,
			},
		},
	}

	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal normalized report: %v", err)
	}

	summary, err := summarizeStaticAnalysisArtifact("quality-gate.static-analysis.json", raw)
	if err != nil {
		t.Fatalf("unexpected summary error: %v", err)
	}
	if summary.ReportFormat != "normalized_json" {
		t.Fatalf("expected normalized_json report format, got %q", summary.ReportFormat)
	}
	if summary.ToolName != "ruff" {
		t.Fatalf("expected tool name ruff, got %q", summary.ToolName)
	}
	if summary.CriticalCount != 1 {
		t.Fatalf("expected 1 critical finding, got %d", summary.CriticalCount)
	}
	if summary.MediumCount != 1 {
		t.Fatalf("expected 1 medium finding, got %d", summary.MediumCount)
	}
	if summary.BlockingFindingCount != 1 {
		t.Fatalf("expected 1 blocking finding, got %d", summary.BlockingFindingCount)
	}
	if len(summary.Findings) != 2 {
		t.Fatalf("expected 2 sampled findings, got %d", len(summary.Findings))
	}
	if summary.Findings[0].Severity != "critical" {
		t.Fatalf("expected first finding severity critical, got %q", summary.Findings[0].Severity)
	}
	if !summary.Findings[0].Blocking {
		t.Fatalf("expected first finding to be blocking")
	}
}

func TestSummarizeGoVetStaticAnalysis(t *testing.T) {
	raw := []byte(`{
		"example.com/project/pkg/foo": {
			"printf": [
				{
					"posn": "pkg/foo/foo.go:12:4",
					"message": "fmt.Printf format %s has arg 1 of wrong type",
					"category": "printf"
				}
			]
		}
	}`)

	summary, err := summarizeStaticAnalysisArtifact("quality-gate.vet.json", raw)
	if err != nil {
		t.Fatalf("unexpected summary error: %v", err)
	}
	if summary.ReportFormat != "go_vet_json" {
		t.Fatalf("expected go_vet_json report format, got %q", summary.ReportFormat)
	}
	if summary.ToolName != "go vet" {
		t.Fatalf("expected tool name go vet, got %q", summary.ToolName)
	}
	if summary.ResultCount != 1 {
		t.Fatalf("expected 1 result, got %d", summary.ResultCount)
	}
	if summary.HighCount != 1 {
		t.Fatalf("expected 1 high severity finding, got %d", summary.HighCount)
	}
	if summary.BlockingFindingCount != 1 {
		t.Fatalf("expected 1 blocking finding, got %d", summary.BlockingFindingCount)
	}
	if len(summary.Findings) != 1 {
		t.Fatalf("expected 1 sampled finding, got %d", len(summary.Findings))
	}
	finding := summary.Findings[0]
	if finding.Package != "example.com/project/pkg/foo" {
		t.Fatalf("expected package metadata example.com/project/pkg/foo, got %q", finding.Package)
	}
	if finding.Analyzer != "printf" {
		t.Fatalf("expected analyzer printf, got %q", finding.Analyzer)
	}
	if finding.File != "pkg/foo/foo.go" {
		t.Fatalf("expected file pkg/foo/foo.go, got %q", finding.File)
	}
	if finding.Line != 12 || finding.Column != 4 {
		t.Fatalf("expected file position 12:4, got %d:%d", finding.Line, finding.Column)
	}
	if finding.Fingerprint == "" {
		t.Fatal("expected fingerprint to be populated")
	}
}

func TestFindQualityGateStaticAnalysisStep(t *testing.T) {
	cfg := PipelineConfig{
		Name:          "Example",
		BuildImage:    "node:22-bookworm",
		Trigger:       TriggerConfig{},
		Notifications: NotifyConfig{},
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
				ID:    "quality",
				Name:  "Quality Gate",
				Stage: "review",
				Type:  "quality_gate",
				Steps: []PipelineStep{
					{ID: "ai-review", Name: "AI Review", CheckType: "ai_review"},
					{ID: "static-analysis", Name: "Static Analysis", CheckType: "static_analysis", Script: "npm run lint"},
				},
			},
		},
	}

	job, step, ok := findQualityGateStaticAnalysisStep(cfg, "quality", "static-analysis")
	if !ok {
		t.Fatal("expected static analysis step to be found")
	}
	if job.ID != "quality" {
		t.Fatalf("expected job id quality, got %q", job.ID)
	}
	if step.CheckType != "static_analysis" {
		t.Fatalf("expected static analysis checkType, got %q", step.CheckType)
	}
	if _, _, ok := findQualityGateStaticAnalysisStep(cfg, "source", "checkout"); ok {
		t.Fatal("expected non-quality job lookup to fail")
	}
}

func TestIsStaticAnalysisArtifactPath(t *testing.T) {
	if !isStaticAnalysisArtifactPath("quality-gate.sarif") {
		t.Fatal("expected SARIF artifact path to match")
	}
	if !isStaticAnalysisArtifactPath("quality-gate.static-analysis.json") {
		t.Fatal("expected normalized static-analysis artifact path to match")
	}
	if isStaticAnalysisArtifactPath("quality-gate.txt") {
		t.Fatal("expected plain text artifact path to not match")
	}
	if !isStaticAnalysisArtifactPath("quality-gate.vet.json") {
		t.Fatal("expected Go vet artifact path to match")
	}
}
