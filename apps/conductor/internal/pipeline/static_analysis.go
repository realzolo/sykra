package pipeline

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"sykra/conductor/internal/artifacts"
	"sykra/conductor/internal/store"
)

type runEventAppender interface {
	AppendRunEvent(ctx context.Context, runID string, eventType string, payload map[string]any) error
}

type sarifDocument struct {
	Runs []sarifRun `json:"runs"`
}

type sarifRun struct {
	Tool    sarifTool     `json:"tool"`
	Results []sarifResult `json:"results"`
}

type sarifTool struct {
	Driver sarifDriver `json:"driver"`
}

type sarifDriver struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type sarifResult struct {
	RuleID    string          `json:"ruleId"`
	Level     string          `json:"level"`
	Message   sarifMessage    `json:"message"`
	Locations []sarifLocation `json:"locations"`
}

type sarifMessage struct {
	Text string `json:"text"`
}

type sarifLocation struct {
	PhysicalLocation sarifPhysicalLocation `json:"physicalLocation"`
}

type sarifPhysicalLocation struct {
	ArtifactLocation sarifArtifactLocation `json:"artifactLocation"`
	Region           sarifRegion           `json:"region"`
}

type sarifArtifactLocation struct {
	URI string `json:"uri"`
}

type sarifRegion struct {
	StartLine   int `json:"startLine"`
	StartColumn int `json:"startColumn"`
}

const normalizedStaticAnalysisSchema = "sykra.static-analysis.v1"

type staticAnalysisFinding struct {
	RuleID      string `json:"ruleId,omitempty"`
	Level       string `json:"level,omitempty"`
	Severity    string `json:"severity,omitempty"`
	Message     string `json:"message,omitempty"`
	File        string `json:"file,omitempty"`
	Line        int    `json:"line,omitempty"`
	Column      int    `json:"column,omitempty"`
	Package     string `json:"package,omitempty"`
	Analyzer    string `json:"analyzer,omitempty"`
	Fingerprint string `json:"fingerprint,omitempty"`
	Blocking    bool   `json:"blocking,omitempty"`
}

type staticAnalysisSummary struct {
	ToolName             string
	ToolVersion          string
	ReportFormat         string
	ResultCount          int
	NoteCount            int
	LowCount             int
	MediumCount          int
	HighCount            int
	CriticalCount        int
	BlockingFindingCount int
	Findings             []staticAnalysisFinding
}

func isStaticAnalysisArtifactPath(relativePath string) bool {
	trimmed := strings.TrimSpace(relativePath)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	return strings.EqualFold(path.Ext(trimmed), ".sarif") ||
		strings.HasSuffix(lower, ".static-analysis.json") ||
		strings.HasSuffix(lower, ".vet.json")
}

func ingestStaticAnalysisArtifact(
	ctx context.Context,
	appender runEventAppender,
	artifactsManager *artifacts.Manager,
	run *store.PipelineRun,
	runID string,
	job PipelineJob,
	jobRecord store.PipelineJob,
	step PipelineStep,
	stepRecord store.PipelineStep,
	artifact store.PipelineArtifact,
) error {
	if appender == nil || artifactsManager == nil {
		return nil
	}
	if !isStaticAnalysisArtifactPath(artifact.Path) {
		return nil
	}

	content, err := artifactsManager.OpenArtifact(ctx, artifact.OrgID, artifact.StoragePath)
	if err != nil {
		_ = appendStaticAnalysisEvent(ctx, appender, run, runID, job, jobRecord, step, stepRecord, "quality_gate.static_analysis_report_failed", map[string]any{
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
		_ = appendStaticAnalysisEvent(ctx, appender, run, runID, job, jobRecord, step, stepRecord, "quality_gate.static_analysis_report_failed", map[string]any{
			"artifactId":   artifact.ID,
			"artifactPath": artifact.Path,
			"status":       StatusFailed,
			"reason":       "artifact_read_failed",
			"error":        err.Error(),
			"timestamp":    time.Now().UTC().Format(time.RFC3339),
		})
		return err
	}

	summary, err := summarizeStaticAnalysisArtifact(artifact.Path, raw)
	if err != nil {
		_ = appendStaticAnalysisEvent(ctx, appender, run, runID, job, jobRecord, step, stepRecord, "quality_gate.static_analysis_report_failed", map[string]any{
			"artifactId":   artifact.ID,
			"artifactPath": artifact.Path,
			"status":       StatusFailed,
			"reason":       "unsupported_static_analysis_format",
			"error":        err.Error(),
			"timestamp":    time.Now().UTC().Format(time.RFC3339),
		})
		return err
	}

	payload := map[string]any{
		"artifactId":           artifact.ID,
		"artifactPath":         artifact.Path,
		"reportFormat":         summary.ReportFormat,
		"toolName":             summary.ToolName,
		"toolVersion":          summary.ToolVersion,
		"resultCount":          summary.ResultCount,
		"noteCount":            summary.NoteCount,
		"lowCount":             summary.LowCount,
		"mediumCount":          summary.MediumCount,
		"highCount":            summary.HighCount,
		"criticalCount":        summary.CriticalCount,
		"blockingFindingCount": summary.BlockingFindingCount,
		"findings":             summary.Findings,
		"status":               StatusSuccess,
		"reason":               "passed",
		"timestamp":            time.Now().UTC().Format(time.RFC3339),
	}
	if summary.BlockingFindingCount > 0 {
		payload["status"] = StatusFailed
		payload["reason"] = "blocking_findings"
	}
	if err := appendStaticAnalysisEvent(ctx, appender, run, runID, job, jobRecord, step, stepRecord, "quality_gate.static_analysis_reported", payload); err != nil {
		return err
	}
	if summary.BlockingFindingCount > 0 {
		if summary.ToolName != "" {
			return fmt.Errorf("static analysis tool %s reported %d blocking finding(s) in %s", summary.ToolName, summary.BlockingFindingCount, artifact.Path)
		}
		return fmt.Errorf("static analysis reported %d blocking finding(s) in %s", summary.BlockingFindingCount, artifact.Path)
	}
	return nil
}

func appendStaticAnalysisEvent(
	ctx context.Context,
	appender runEventAppender,
	run *store.PipelineRun,
	runID string,
	job PipelineJob,
	jobRecord store.PipelineJob,
	step PipelineStep,
	stepRecord store.PipelineStep,
	eventType string,
	extra map[string]any,
) error {
	payload := map[string]any{
		"runId":     runID,
		"jobId":     jobRecord.ID,
		"jobKey":    job.ID,
		"stepId":    stepRecord.ID,
		"stepKey":   step.ID,
		"checkType": strings.TrimSpace(strings.ToLower(step.CheckType)),
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

func summarizeStaticAnalysisArtifact(artifactPath string, raw []byte) (staticAnalysisSummary, error) {
	trimmedPath := strings.TrimSpace(artifactPath)
	if strings.HasSuffix(strings.ToLower(trimmedPath), ".sarif") {
		var doc sarifDocument
		if err := json.Unmarshal(raw, &doc); err != nil {
			return staticAnalysisSummary{}, fmt.Errorf("parse SARIF static analysis report %s: %w", artifactPath, err)
		}
		summary := summarizeStaticAnalysisSARIF(doc)
		summary.ReportFormat = "sarif"
		return summary, nil
	}
	if strings.HasSuffix(strings.ToLower(trimmedPath), ".static-analysis.json") {
		var doc normalizedStaticAnalysisDocument
		if err := json.Unmarshal(raw, &doc); err != nil {
			return staticAnalysisSummary{}, fmt.Errorf("parse normalized static analysis report %s: %w", artifactPath, err)
		}
		summary, err := summarizeNormalizedStaticAnalysis(doc)
		if err != nil {
			return staticAnalysisSummary{}, err
		}
		summary.ReportFormat = "normalized_json"
		return summary, nil
	}
	if strings.HasSuffix(strings.ToLower(trimmedPath), ".vet.json") {
		var doc goVetReport
		if err := json.Unmarshal(raw, &doc); err != nil {
			return staticAnalysisSummary{}, fmt.Errorf("parse Go vet static analysis report %s: %w", artifactPath, err)
		}
		summary := summarizeGoVetStaticAnalysis(doc)
		summary.ReportFormat = "go_vet_json"
		return summary, nil
	}
	return staticAnalysisSummary{}, fmt.Errorf("unsupported static analysis artifact path %s", artifactPath)
}

func summarizeStaticAnalysisSARIF(doc sarifDocument) staticAnalysisSummary {
	summary := staticAnalysisSummary{}
	findings := make([]staticAnalysisFinding, 0, 10)

	for _, run := range doc.Runs {
		if summary.ToolName == "" {
			summary.ToolName = strings.TrimSpace(run.Tool.Driver.Name)
		}
		if summary.ToolVersion == "" {
			summary.ToolVersion = strings.TrimSpace(run.Tool.Driver.Version)
		}
		for _, result := range run.Results {
			summary.ResultCount++
			level := strings.ToLower(strings.TrimSpace(result.Level))
			severity, blocking := summarizeStaticAnalysisLevel(level)
			summary.applySeverity(severity, blocking)

			if len(findings) >= 10 {
				continue
			}
			finding := staticAnalysisFinding{
				RuleID:   strings.TrimSpace(result.RuleID),
				Level:    level,
				Severity: severity,
				Message:  strings.TrimSpace(result.Message.Text),
				Blocking: blocking,
			}
			if len(result.Locations) > 0 {
				location := result.Locations[0]
				finding.File = strings.TrimSpace(location.PhysicalLocation.ArtifactLocation.URI)
				finding.Line = location.PhysicalLocation.Region.StartLine
				finding.Column = location.PhysicalLocation.Region.StartColumn
			}
			findings = append(findings, finding)
		}
	}

	sortStaticAnalysisFindings(findings)
	summary.Findings = findings
	return summary
}

type normalizedStaticAnalysisDocument struct {
	Schema   string                            `json:"schema"`
	Tool     normalizedStaticAnalysisTool      `json:"tool"`
	Findings []normalizedStaticAnalysisFinding `json:"findings"`
}

type normalizedStaticAnalysisTool struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type normalizedStaticAnalysisFinding struct {
	RuleID   string `json:"ruleId"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Blocking *bool  `json:"blocking,omitempty"`
}

type goVetReport map[string]map[string]json.RawMessage

type goVetDiagnostic struct {
	Posn           string              `json:"posn"`
	Message        string              `json:"message"`
	Category       string              `json:"category"`
	SuggestedFixes []goVetSuggestedFix `json:"suggested_fixes,omitempty"`
	Related        []goVetRelated      `json:"related,omitempty"`
}

type goVetAnalysisError struct {
	Error string `json:"error"`
}

type goVetSuggestedFix struct {
	Message string `json:"message"`
}

type goVetRelated struct {
	Posn    string `json:"posn"`
	Message string `json:"message"`
}

func summarizeNormalizedStaticAnalysis(doc normalizedStaticAnalysisDocument) (staticAnalysisSummary, error) {
	if strings.TrimSpace(doc.Schema) != normalizedStaticAnalysisSchema {
		return staticAnalysisSummary{}, fmt.Errorf("normalized static analysis report must declare schema %q", normalizedStaticAnalysisSchema)
	}

	summary := staticAnalysisSummary{
		ToolName:    strings.TrimSpace(doc.Tool.Name),
		ToolVersion: strings.TrimSpace(doc.Tool.Version),
	}
	findings := make([]staticAnalysisFinding, 0, 10)
	for _, finding := range doc.Findings {
		severity := normalizeStaticAnalysisSeverity(finding.Severity)
		blocking := isBlockingStaticAnalysisSeverity(severity)
		if finding.Blocking != nil {
			blocking = *finding.Blocking
		}
		summary.ResultCount++
		summary.applySeverity(severity, blocking)

		if len(findings) >= 10 {
			continue
		}
		findings = append(findings, staticAnalysisFinding{
			RuleID:      strings.TrimSpace(finding.RuleID),
			Level:       severity,
			Severity:    severity,
			Message:     strings.TrimSpace(finding.Message),
			File:        strings.TrimSpace(finding.File),
			Line:        finding.Line,
			Column:      finding.Column,
			Fingerprint: buildStaticAnalysisFingerprint(strings.TrimSpace(doc.Tool.Name), strings.TrimSpace(finding.RuleID), strings.TrimSpace(finding.File), finding.Line, finding.Column, severity, strings.TrimSpace(finding.Message), "", ""),
			Blocking:    blocking,
		})
	}
	sortStaticAnalysisFindings(findings)
	summary.Findings = findings
	return summary, nil
}

func summarizeGoVetStaticAnalysis(doc goVetReport) staticAnalysisSummary {
	summary := staticAnalysisSummary{
		ToolName: "go vet",
	}
	findings := make([]staticAnalysisFinding, 0, 10)

	for pkg, analyzers := range doc {
		packageName := strings.TrimSpace(pkg)
		for analyzer, raw := range analyzers {
			analyzerName := strings.TrimSpace(analyzer)
			var analysisErr goVetAnalysisError
			if err := json.Unmarshal(raw, &analysisErr); err == nil && strings.TrimSpace(analysisErr.Error) != "" {
				summary.ResultCount++
				severity := "high"
				blocking := true
				summary.applySeverity(severity, blocking)
				message := strings.TrimSpace(analysisErr.Error)
				ruleID := analyzerName
				if ruleID == "" {
					ruleID = packageName
				}
				if len(findings) >= 10 {
					continue
				}
				findings = append(findings, staticAnalysisFinding{
					RuleID:      ruleID,
					Level:       "error",
					Severity:    severity,
					Message:     message,
					Package:     packageName,
					Analyzer:    analyzerName,
					Fingerprint: buildStaticAnalysisFingerprint(summary.ToolName, ruleID, "", 0, 0, severity, message, packageName, analyzerName),
					Blocking:    blocking,
				})
				continue
			}

			var diagnostics []goVetDiagnostic
			if err := json.Unmarshal(raw, &diagnostics); err != nil {
				summary.ResultCount++
				severity := "high"
				blocking := true
				summary.applySeverity(severity, blocking)
				message := strings.TrimSpace(err.Error())
				ruleID := analyzerName
				if ruleID == "" {
					ruleID = packageName
				}
				if len(findings) >= 10 {
					continue
				}
				findings = append(findings, staticAnalysisFinding{
					RuleID:      ruleID,
					Level:       "error",
					Severity:    severity,
					Message:     message,
					Package:     packageName,
					Analyzer:    analyzerName,
					Fingerprint: buildStaticAnalysisFingerprint(summary.ToolName, ruleID, "", 0, 0, severity, message, packageName, analyzerName),
					Blocking:    blocking,
				})
				continue
			}

			for _, diagnostic := range diagnostics {
				summary.ResultCount++
				severity := "high"
				blocking := true
				summary.applySeverity(severity, blocking)

				if len(findings) >= 10 {
					continue
				}
				file, line, column := parseGoVetPosn(diagnostic.Posn)
				ruleID := analyzerName
				if ruleID == "" {
					ruleID = strings.TrimSpace(diagnostic.Category)
				}
				if ruleID == "" {
					ruleID = packageName
				}
				message := strings.TrimSpace(diagnostic.Message)
				findings = append(findings, staticAnalysisFinding{
					RuleID:      ruleID,
					Level:       "error",
					Severity:    severity,
					Message:     message,
					File:        file,
					Line:        line,
					Column:      column,
					Package:     packageName,
					Analyzer:    analyzerName,
					Fingerprint: buildStaticAnalysisFingerprint(summary.ToolName, ruleID, file, line, column, severity, message, packageName, analyzerName),
					Blocking:    blocking,
				})
			}
		}
	}

	sortStaticAnalysisFindings(findings)
	summary.Findings = findings
	return summary
}

func (s *staticAnalysisSummary) applySeverity(severity string, blocking bool) {
	switch severity {
	case "critical":
		s.CriticalCount++
	case "high":
		s.HighCount++
	case "medium":
		s.MediumCount++
	case "low":
		s.LowCount++
	default:
		s.NoteCount++
	}
	if blocking {
		s.BlockingFindingCount++
	}
}

func summarizeStaticAnalysisLevel(level string) (string, bool) {
	switch level {
	case "error":
		return "high", true
	case "warning":
		return "medium", false
	case "note", "none", "":
		return "low", false
	default:
		return normalizeStaticAnalysisSeverity(level), isBlockingStaticAnalysisSeverity(normalizeStaticAnalysisSeverity(level))
	}
}

func normalizeStaticAnalysisSeverity(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "critical":
		return "critical"
	case "high":
		return "high"
	case "medium", "moderate":
		return "medium"
	case "low":
		return "low"
	case "info", "information", "note", "none", "":
		return "low"
	default:
		return "low"
	}
}

func parseGoVetPosn(raw string) (string, int, int) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", 0, 0
	}

	parts := strings.Split(trimmed, ":")
	switch {
	case len(parts) >= 3:
		line, errLine := strconv.Atoi(parts[len(parts)-2])
		column, errColumn := strconv.Atoi(parts[len(parts)-1])
		if errLine == nil && errColumn == nil {
			return strings.Join(parts[:len(parts)-2], ":"), line, column
		}
	case len(parts) == 2:
		line, errLine := strconv.Atoi(parts[1])
		if errLine == nil {
			return parts[0], line, 0
		}
	}
	return trimmed, 0, 0
}

func buildStaticAnalysisFingerprint(
	toolName string,
	ruleID string,
	file string,
	line int,
	column int,
	severity string,
	message string,
	packageName string,
	analyzer string,
) string {
	parts := []string{
		strings.ToLower(strings.TrimSpace(toolName)),
		strings.ToLower(strings.TrimSpace(ruleID)),
		strings.ToLower(strings.TrimSpace(file)),
		strconv.Itoa(line),
		strconv.Itoa(column),
		strings.ToLower(strings.TrimSpace(severity)),
		strings.TrimSpace(message),
		strings.ToLower(strings.TrimSpace(packageName)),
		strings.ToLower(strings.TrimSpace(analyzer)),
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:])
}

func sortStaticAnalysisFindings(findings []staticAnalysisFinding) {
	sort.SliceStable(findings, func(left, right int) bool {
		a := findings[left]
		b := findings[right]
		if a.Blocking != b.Blocking {
			return a.Blocking
		}
		if severityRank(a.Severity) != severityRank(b.Severity) {
			return severityRank(a.Severity) < severityRank(b.Severity)
		}
		if a.File != b.File {
			return a.File < b.File
		}
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		if a.Column != b.Column {
			return a.Column < b.Column
		}
		if a.Package != b.Package {
			return a.Package < b.Package
		}
		if a.Analyzer != b.Analyzer {
			return a.Analyzer < b.Analyzer
		}
		if a.RuleID != b.RuleID {
			return a.RuleID < b.RuleID
		}
		return a.Message < b.Message
	})
}

func severityRank(severity string) int {
	switch strings.ToLower(strings.TrimSpace(severity)) {
	case "critical":
		return 0
	case "high":
		return 1
	case "medium":
		return 2
	case "low":
		return 3
	default:
		return 4
	}
}

func isBlockingStaticAnalysisSeverity(severity string) bool {
	switch strings.ToLower(strings.TrimSpace(severity)) {
	case "critical", "high":
		return true
	default:
		return false
	}
}

func findQualityGateStaticAnalysisStep(cfg PipelineConfig, jobID string, stepKey string) (PipelineJob, PipelineStep, bool) {
	jobID = strings.TrimSpace(jobID)
	stepKey = strings.TrimSpace(stepKey)
	if jobID == "" || stepKey == "" {
		return PipelineJob{}, PipelineStep{}, false
	}

	for _, job := range cfg.Jobs {
		if strings.TrimSpace(job.ID) != jobID {
			continue
		}
		if strings.TrimSpace(strings.ToLower(job.Type)) != "quality_gate" {
			return PipelineJob{}, PipelineStep{}, false
		}
		for _, step := range job.Steps {
			if strings.TrimSpace(step.ID) != stepKey {
				continue
			}
			if strings.TrimSpace(strings.ToLower(step.CheckType)) != "static_analysis" {
				return PipelineJob{}, PipelineStep{}, false
			}
			return job, step, true
		}
		return PipelineJob{}, PipelineStep{}, false
	}

	return PipelineJob{}, PipelineStep{}, false
}
