package pipeline

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
	"time"

	"sykra/conductor/internal/artifacts"
	"sykra/conductor/internal/store"
)

type qualityEvidenceEventMeta struct {
	JobID     string
	JobKey    string
	StepID    string
	StepKey   string
	CheckType string
}

type qualityTestSummary struct {
	Total           int
	Passed          int
	Failed          int
	Skipped         int
	DurationSeconds *float64
	ReportFormat    string
}

type qualityCoverageSummary struct {
	LinesTotal   *int64
	LinesCovered *int64
	LinePct      *float64
	BranchPct    *float64
	FunctionPct  *float64
	StatementPct *float64
	ReportFormat string
}

type junitTestSuites struct {
	XMLName  xml.Name         `xml:"testsuites"`
	Tests    int              `xml:"tests,attr"`
	Failures int              `xml:"failures,attr"`
	Errors   int              `xml:"errors,attr"`
	Skipped  int              `xml:"skipped,attr"`
	Time     string           `xml:"time,attr"`
	Suites   []junitTestSuite `xml:"testsuite"`
}

type junitTestSuite struct {
	Tests     int             `xml:"tests,attr"`
	Failures  int             `xml:"failures,attr"`
	Errors    int             `xml:"errors,attr"`
	Skipped   int             `xml:"skipped,attr"`
	Time      string          `xml:"time,attr"`
	TestCases []junitTestCase `xml:"testcase"`
}

type junitTestCase struct {
	Failure *struct{} `xml:"failure"`
	Error   *struct{} `xml:"error"`
	Skipped *struct{} `xml:"skipped"`
}

func ingestQualityEvidenceArtifact(
	ctx context.Context,
	appender runEventAppender,
	artifactsManager *artifacts.Manager,
	run *store.PipelineRun,
	runID string,
	meta qualityEvidenceEventMeta,
	artifact store.PipelineArtifact,
) error {
	if appender == nil || artifactsManager == nil {
		return nil
	}

	trimmedPath := strings.TrimSpace(artifact.Path)
	if trimmedPath == "" {
		return nil
	}
	testReportCandidate := isTestReportArtifactPath(trimmedPath)
	coverageCandidate := isCoverageArtifactPath(trimmedPath)
	if !testReportCandidate && !coverageCandidate {
		return nil
	}

	content, err := artifactsManager.OpenArtifact(ctx, artifact.OrgID, artifact.StoragePath)
	if err != nil {
		_ = appendQualityEvidenceEvent(ctx, appender, run, runID, meta, "quality.evidence_ingestion_failed", map[string]any{
			"artifactId":   artifact.ID,
			"artifactPath": artifact.Path,
			"status":       StatusFailed,
			"reason":       "artifact_open_failed",
			"error":        err.Error(),
			"timestamp":    time.Now().UTC().Format(time.RFC3339),
		})
		return err
	}
	defer content.Reader.Close()

	raw, err := io.ReadAll(content.Reader)
	if err != nil {
		_ = appendQualityEvidenceEvent(ctx, appender, run, runID, meta, "quality.evidence_ingestion_failed", map[string]any{
			"artifactId":   artifact.ID,
			"artifactPath": artifact.Path,
			"status":       StatusFailed,
			"reason":       "artifact_read_failed",
			"error":        err.Error(),
			"timestamp":    time.Now().UTC().Format(time.RFC3339),
		})
		return err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if testReportCandidate {
		summary, summaryErr := summarizeTestReportArtifact(artifact.Path, raw)
		if summaryErr != nil {
			_ = appendQualityEvidenceEvent(ctx, appender, run, runID, meta, "quality.test_report_ingestion_failed", map[string]any{
				"artifactId":   artifact.ID,
				"artifactPath": artifact.Path,
				"status":       StatusFailed,
				"reason":       "unsupported_test_report_format",
				"error":        summaryErr.Error(),
				"timestamp":    now,
			})
			return nil
		}
		payload := map[string]any{
			"artifactId":   artifact.ID,
			"artifactPath": artifact.Path,
			"reportFormat": summary.ReportFormat,
			"status":       StatusSuccess,
			"total":        summary.Total,
			"passed":       summary.Passed,
			"failed":       summary.Failed,
			"skipped":      summary.Skipped,
			"timestamp":    now,
		}
		if summary.DurationSeconds != nil {
			payload["durationSeconds"] = *summary.DurationSeconds
		}
		if err := appendQualityEvidenceEvent(ctx, appender, run, runID, meta, "quality.test_report_ingested", payload); err != nil {
			return err
		}
	}

	if coverageCandidate {
		summary, summaryErr := summarizeCoverageArtifact(artifact.Path, raw)
		if summaryErr != nil {
			_ = appendQualityEvidenceEvent(ctx, appender, run, runID, meta, "quality.coverage_ingestion_failed", map[string]any{
				"artifactId":   artifact.ID,
				"artifactPath": artifact.Path,
				"status":       StatusFailed,
				"reason":       "unsupported_coverage_format",
				"error":        summaryErr.Error(),
				"timestamp":    now,
			})
			return nil
		}
		payload := map[string]any{
			"artifactId":   artifact.ID,
			"artifactPath": artifact.Path,
			"reportFormat": summary.ReportFormat,
			"status":       StatusSuccess,
			"timestamp":    now,
		}
		if summary.LinesTotal != nil {
			payload["linesTotal"] = *summary.LinesTotal
		}
		if summary.LinesCovered != nil {
			payload["linesCovered"] = *summary.LinesCovered
		}
		if summary.LinePct != nil {
			payload["linePct"] = *summary.LinePct
		}
		if summary.BranchPct != nil {
			payload["branchPct"] = *summary.BranchPct
		}
		if summary.FunctionPct != nil {
			payload["functionPct"] = *summary.FunctionPct
		}
		if summary.StatementPct != nil {
			payload["statementPct"] = *summary.StatementPct
		}
		if err := appendQualityEvidenceEvent(ctx, appender, run, runID, meta, "quality.coverage_ingested", payload); err != nil {
			return err
		}
	}
	return nil
}

func appendQualityEvidenceEvent(
	ctx context.Context,
	appender runEventAppender,
	run *store.PipelineRun,
	runID string,
	meta qualityEvidenceEventMeta,
	eventType string,
	extra map[string]any,
) error {
	payload := map[string]any{
		"runId":     runID,
		"jobId":     strings.TrimSpace(meta.JobID),
		"jobKey":    strings.TrimSpace(meta.JobKey),
		"stepId":    strings.TrimSpace(meta.StepID),
		"stepKey":   strings.TrimSpace(meta.StepKey),
		"checkType": strings.TrimSpace(strings.ToLower(meta.CheckType)),
	}
	if run != nil {
		if run.CommitSHA != nil && strings.TrimSpace(*run.CommitSHA) != "" {
			payload["commitSha"] = strings.TrimSpace(*run.CommitSHA)
		}
		if run.ProjectID != nil && strings.TrimSpace(*run.ProjectID) != "" {
			payload["projectId"] = strings.TrimSpace(*run.ProjectID)
		}
	}
	for key, value := range extra {
		payload[key] = value
	}
	return appender.AppendRunEvent(ctx, runID, eventType, payload)
}

func summarizeTestReportArtifact(artifactPath string, raw []byte) (qualityTestSummary, error) {
	if !isTestReportArtifactPath(artifactPath) {
		return qualityTestSummary{}, fmt.Errorf("unsupported test report artifact path %s", artifactPath)
	}

	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return qualityTestSummary{}, fmt.Errorf("test report %s is empty", artifactPath)
	}

	var suites junitTestSuites
	if err := xml.Unmarshal(raw, &suites); err == nil && strings.EqualFold(suites.XMLName.Local, "testsuites") {
		total, failed, skipped, durationSeconds := summarizeJUnitTestSuites(suites)
		passed := maxInt(total-failed-skipped, 0)
		return qualityTestSummary{
			Total:           total,
			Passed:          passed,
			Failed:          failed,
			Skipped:         skipped,
			DurationSeconds: durationSeconds,
			ReportFormat:    "junit_xml",
		}, nil
	}

	var suite junitTestSuite
	if err := xml.Unmarshal(raw, &suite); err == nil {
		total, failed, skipped, durationSeconds := summarizeJUnitSingleSuite(suite)
		passed := maxInt(total-failed-skipped, 0)
		return qualityTestSummary{
			Total:           total,
			Passed:          passed,
			Failed:          failed,
			Skipped:         skipped,
			DurationSeconds: durationSeconds,
			ReportFormat:    "junit_xml",
		}, nil
	}

	return qualityTestSummary{}, fmt.Errorf("parse junit report %s: unsupported xml shape", artifactPath)
}

func summarizeJUnitTestSuites(suites junitTestSuites) (int, int, int, *float64) {
	total := suites.Tests
	failed := suites.Failures + suites.Errors
	skipped := suites.Skipped
	duration := parseSecondsValue(suites.Time)

	if len(suites.Suites) > 0 {
		total = 0
		failed = 0
		skipped = 0
		duration = nil
		for _, suite := range suites.Suites {
			suiteTotal, suiteFailed, suiteSkipped, suiteDuration := summarizeJUnitSingleSuite(suite)
			total += suiteTotal
			failed += suiteFailed
			skipped += suiteSkipped
			duration = sumOptionalSeconds(duration, suiteDuration)
		}
	}
	return total, failed, skipped, duration
}

func summarizeJUnitSingleSuite(suite junitTestSuite) (int, int, int, *float64) {
	total := suite.Tests
	failed := suite.Failures + suite.Errors
	skipped := suite.Skipped
	duration := parseSecondsValue(suite.Time)

	if total <= 0 && len(suite.TestCases) > 0 {
		total = len(suite.TestCases)
	}
	if failed <= 0 || skipped < 0 {
		failed = 0
		skipped = 0
		for _, testcase := range suite.TestCases {
			if testcase.Failure != nil || testcase.Error != nil {
				failed++
				continue
			}
			if testcase.Skipped != nil {
				skipped++
			}
		}
	}
	return total, failed, skipped, duration
}

func summarizeCoverageArtifact(artifactPath string, raw []byte) (qualityCoverageSummary, error) {
	trimmedPath := strings.ToLower(strings.TrimSpace(artifactPath))
	switch {
	case strings.HasSuffix(trimmedPath, "coverage-summary.json") || strings.HasSuffix(trimmedPath, ".coverage-summary.json"):
		return summarizeCoverageSummaryJSON(artifactPath, raw)
	case strings.HasSuffix(trimmedPath, ".lcov.info") || strings.HasSuffix(trimmedPath, "/lcov.info"):
		return summarizeCoverageLCOV(artifactPath, raw)
	default:
		return qualityCoverageSummary{}, fmt.Errorf("unsupported coverage artifact path %s", artifactPath)
	}
}

func summarizeCoverageSummaryJSON(artifactPath string, raw []byte) (qualityCoverageSummary, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return qualityCoverageSummary{}, fmt.Errorf("parse coverage summary %s: %w", artifactPath, err)
	}
	totalValue, ok := payload["total"]
	if !ok {
		return qualityCoverageSummary{}, fmt.Errorf("coverage summary %s missing total object", artifactPath)
	}
	totalObject, ok := totalValue.(map[string]any)
	if !ok {
		return qualityCoverageSummary{}, fmt.Errorf("coverage summary %s total is invalid", artifactPath)
	}

	linesTotal, linesCovered, linePct := parseCoverageMetric(totalObject["lines"])
	_, _, statementPct := parseCoverageMetric(totalObject["statements"])
	_, _, functionPct := parseCoverageMetric(totalObject["functions"])
	_, _, branchPct := parseCoverageMetric(totalObject["branches"])
	if linePct == nil && statementPct == nil && functionPct == nil && branchPct == nil {
		return qualityCoverageSummary{}, fmt.Errorf("coverage summary %s does not include supported metric percentages", artifactPath)
	}

	return qualityCoverageSummary{
		LinesTotal:   linesTotal,
		LinesCovered: linesCovered,
		LinePct:      linePct,
		BranchPct:    branchPct,
		FunctionPct:  functionPct,
		StatementPct: statementPct,
		ReportFormat: "coverage_summary_json",
	}, nil
}

func summarizeCoverageLCOV(artifactPath string, raw []byte) (qualityCoverageSummary, error) {
	lines := strings.Split(string(raw), "\n")
	var linesFound int64
	var linesHit int64
	var branchesFound int64
	var branchesHit int64
	var functionsFound int64
	var functionsHit int64

	for _, line := range lines {
		item := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(item, "LF:"):
			linesFound += parseLCOVInt64(strings.TrimSpace(strings.TrimPrefix(item, "LF:")))
		case strings.HasPrefix(item, "LH:"):
			linesHit += parseLCOVInt64(strings.TrimSpace(strings.TrimPrefix(item, "LH:")))
		case strings.HasPrefix(item, "BRF:"):
			branchesFound += parseLCOVInt64(strings.TrimSpace(strings.TrimPrefix(item, "BRF:")))
		case strings.HasPrefix(item, "BRH:"):
			branchesHit += parseLCOVInt64(strings.TrimSpace(strings.TrimPrefix(item, "BRH:")))
		case strings.HasPrefix(item, "FNF:"):
			functionsFound += parseLCOVInt64(strings.TrimSpace(strings.TrimPrefix(item, "FNF:")))
		case strings.HasPrefix(item, "FNH:"):
			functionsHit += parseLCOVInt64(strings.TrimSpace(strings.TrimPrefix(item, "FNH:")))
		}
	}
	if linesFound <= 0 && branchesFound <= 0 && functionsFound <= 0 {
		return qualityCoverageSummary{}, fmt.Errorf("lcov report %s does not contain coverage totals", artifactPath)
	}

	return qualityCoverageSummary{
		LinesTotal:   int64PointerIfPositive(linesFound),
		LinesCovered: int64PointerIfPositive(linesHit),
		LinePct:      computePctPointer(linesHit, linesFound),
		BranchPct:    computePctPointer(branchesHit, branchesFound),
		FunctionPct:  computePctPointer(functionsHit, functionsFound),
		StatementPct: nil,
		ReportFormat: "lcov_info",
	}, nil
}

func parseCoverageMetric(value any) (*int64, *int64, *float64) {
	obj, ok := value.(map[string]any)
	if !ok {
		return nil, nil, nil
	}
	total := int64FromAny(obj["total"])
	covered := int64FromAny(obj["covered"])
	pct := float64FromAny(obj["pct"])
	if pct == nil && total != nil && covered != nil && *total > 0 {
		computed := float64(*covered) * 100 / float64(*total)
		pct = &computed
	}
	return total, covered, pct
}

func int64FromAny(value any) *int64 {
	switch typed := value.(type) {
	case int64:
		return &typed
	case int32:
		cast := int64(typed)
		return &cast
	case int:
		cast := int64(typed)
		return &cast
	case float64:
		cast := int64(typed)
		return &cast
	case float32:
		cast := int64(typed)
		return &cast
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return &parsed
		}
		if parsedFloat, err := typed.Float64(); err == nil {
			cast := int64(parsedFloat)
			return &cast
		}
	case string:
		trimmed := strings.TrimSpace(typed)
		if parsed, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			return &parsed
		}
		if parsedFloat, err := strconv.ParseFloat(trimmed, 64); err == nil {
			cast := int64(parsedFloat)
			return &cast
		}
	}
	return nil
}

func float64FromAny(value any) *float64 {
	switch typed := value.(type) {
	case float64:
		return &typed
	case float32:
		cast := float64(typed)
		return &cast
	case int:
		cast := float64(typed)
		return &cast
	case int64:
		cast := float64(typed)
		return &cast
	case json.Number:
		if parsed, err := typed.Float64(); err == nil {
			return &parsed
		}
	case string:
		trimmed := strings.TrimSpace(typed)
		if parsed, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return &parsed
		}
	}
	return nil
}

func parseSecondsValue(value string) *float64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func sumOptionalSeconds(current *float64, next *float64) *float64 {
	if next == nil {
		return current
	}
	if current == nil {
		copyValue := *next
		return &copyValue
	}
	sum := *current + *next
	return &sum
}

func parseLCOVInt64(value string) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func computePctPointer(hit int64, total int64) *float64 {
	if total <= 0 {
		return nil
	}
	pct := float64(hit) * 100 / float64(total)
	return &pct
}

func int64PointerIfPositive(value int64) *int64 {
	if value <= 0 {
		return nil
	}
	copyValue := value
	return &copyValue
}

func isTestReportArtifactPath(relativePath string) bool {
	trimmed := strings.TrimSpace(relativePath)
	if trimmed == "" {
		return false
	}
	if !strings.EqualFold(path.Ext(trimmed), ".xml") {
		return false
	}
	lower := strings.ToLower(trimmed)
	return strings.Contains(lower, "junit") ||
		strings.Contains(lower, "test-report") ||
		strings.Contains(lower, "test_results") ||
		strings.Contains(lower, "test-results") ||
		strings.Contains(lower, "surefire") ||
		strings.Contains(lower, "failsafe")
}

func isCoverageArtifactPath(relativePath string) bool {
	trimmed := strings.TrimSpace(relativePath)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	return strings.HasSuffix(lower, "coverage-summary.json") ||
		strings.HasSuffix(lower, ".coverage-summary.json") ||
		strings.HasSuffix(lower, ".lcov.info") ||
		strings.HasSuffix(lower, "/lcov.info")
}
