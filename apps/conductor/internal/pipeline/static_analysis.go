package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path"
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
	RuleID   string `json:"ruleId,omitempty"`
	Level    string `json:"level,omitempty"`
	Severity string `json:"severity,omitempty"`
	Message  string `json:"message,omitempty"`
	File     string `json:"file,omitempty"`
	Line     int    `json:"line,omitempty"`
	Column   int    `json:"column,omitempty"`
	Blocking bool   `json:"blocking,omitempty"`
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
	return strings.EqualFold(path.Ext(trimmed), ".sarif") || strings.HasSuffix(strings.ToLower(trimmed), ".static-analysis.json")
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
			RuleID:   strings.TrimSpace(finding.RuleID),
			Level:    severity,
			Severity: severity,
			Message:  strings.TrimSpace(finding.Message),
			File:     strings.TrimSpace(finding.File),
			Line:     finding.Line,
			Column:   finding.Column,
			Blocking: blocking,
		})
	}
	summary.Findings = findings
	return summary, nil
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
