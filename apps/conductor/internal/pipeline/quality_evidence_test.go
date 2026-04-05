package pipeline

import (
	"math"
	"testing"
)

func TestSummarizeTestReportArtifactJUnitSuite(t *testing.T) {
	raw := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<testsuite tests="5" failures="1" errors="0" skipped="1" time="3.5">
  <testcase classname="pkg" name="a" time="0.2"></testcase>
  <testcase classname="pkg" name="b" time="0.3"><failure message="boom"/></testcase>
  <testcase classname="pkg" name="c" time="0.1"><skipped/></testcase>
</testsuite>`)

	summary, err := summarizeTestReportArtifact("reports/junit.xml", raw)
	if err != nil {
		t.Fatalf("expected junit summary, got error: %v", err)
	}
	if summary.ReportFormat != "junit_xml" {
		t.Fatalf("expected junit_xml format, got %s", summary.ReportFormat)
	}
	if summary.Total != 5 || summary.Failed != 1 || summary.Skipped != 1 || summary.Passed != 3 {
		t.Fatalf("unexpected junit totals: %+v", summary)
	}
	if summary.DurationSeconds == nil || math.Abs(*summary.DurationSeconds-3.5) > 1e-9 {
		t.Fatalf("expected duration 3.5, got %#v", summary.DurationSeconds)
	}
}

func TestSummarizeCoverageSummaryJSON(t *testing.T) {
	raw := []byte(`{
  "total": {
    "lines": { "total": 200, "covered": 150, "pct": 75 },
    "statements": { "total": 300, "covered": 210, "pct": 70 },
    "functions": { "total": 80, "covered": 72, "pct": 90 },
    "branches": { "total": 60, "covered": 30, "pct": 50 }
  }
}`)

	summary, err := summarizeCoverageArtifact("coverage/coverage-summary.json", raw)
	if err != nil {
		t.Fatalf("expected coverage summary parse success, got error: %v", err)
	}
	if summary.ReportFormat != "coverage_summary_json" {
		t.Fatalf("expected coverage_summary_json format, got %s", summary.ReportFormat)
	}
	if summary.LinePct == nil || math.Abs(*summary.LinePct-75) > 1e-9 {
		t.Fatalf("expected line pct 75, got %#v", summary.LinePct)
	}
	if summary.BranchPct == nil || math.Abs(*summary.BranchPct-50) > 1e-9 {
		t.Fatalf("expected branch pct 50, got %#v", summary.BranchPct)
	}
	if summary.FunctionPct == nil || math.Abs(*summary.FunctionPct-90) > 1e-9 {
		t.Fatalf("expected function pct 90, got %#v", summary.FunctionPct)
	}
	if summary.StatementPct == nil || math.Abs(*summary.StatementPct-70) > 1e-9 {
		t.Fatalf("expected statement pct 70, got %#v", summary.StatementPct)
	}
}

func TestSummarizeCoverageLCOV(t *testing.T) {
	raw := []byte(`TN:
SF:main.go
FNF:10
FNH:8
BRF:20
BRH:15
LF:100
LH:80
end_of_record
`)

	summary, err := summarizeCoverageArtifact("coverage/lcov.info", raw)
	if err != nil {
		t.Fatalf("expected lcov parse success, got error: %v", err)
	}
	if summary.ReportFormat != "lcov_info" {
		t.Fatalf("expected lcov_info format, got %s", summary.ReportFormat)
	}
	if summary.LinePct == nil || math.Abs(*summary.LinePct-80) > 1e-9 {
		t.Fatalf("expected line pct 80, got %#v", summary.LinePct)
	}
	if summary.BranchPct == nil || math.Abs(*summary.BranchPct-75) > 1e-9 {
		t.Fatalf("expected branch pct 75, got %#v", summary.BranchPct)
	}
	if summary.FunctionPct == nil || math.Abs(*summary.FunctionPct-80) > 1e-9 {
		t.Fatalf("expected function pct 80, got %#v", summary.FunctionPct)
	}
}

func TestEvidenceArtifactPathDetection(t *testing.T) {
	if !isTestReportArtifactPath("reports/junit.xml") {
		t.Fatal("expected junit xml path to be detected as test report")
	}
	if isTestReportArtifactPath("reports/config.xml") {
		t.Fatal("expected generic xml path to not be treated as test report")
	}
	if !isCoverageArtifactPath("coverage/coverage-summary.json") {
		t.Fatal("expected coverage-summary.json path to be detected as coverage")
	}
	if !isCoverageArtifactPath("coverage/lcov.info") {
		t.Fatal("expected lcov.info path to be detected as coverage")
	}
}
