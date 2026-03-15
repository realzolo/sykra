package domain

import "encoding/json"

type Rule struct {
	Category string `json:"category"`
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
	Severity string `json:"severity"`
}

type ReviewIssue struct {
	File            string  `json:"file"`
	Line            *int    `json:"line,omitempty"`
	Severity        string  `json:"severity"`
	Category        string  `json:"category"`
	Rule            string  `json:"rule"`
	Message         string  `json:"message"`
	Suggestion      *string `json:"suggestion,omitempty"`
	CodeSnippet     *string `json:"codeSnippet,omitempty"`
	FixPatch        *string `json:"fixPatch,omitempty"`
	Priority        *int    `json:"priority,omitempty"`
	ImpactScope     *string `json:"impactScope,omitempty"`
	EstimatedEffort *string `json:"estimatedEffort,omitempty"`
}

type ReviewResult struct {
	Score               int                `json:"score"`
	CategoryScores      map[string]float64 `json:"categoryScores"`
	Issues              []ReviewIssue      `json:"issues"`
	Summary             string             `json:"summary"`
	ComplexityMetrics   json.RawMessage    `json:"complexityMetrics"`
	DuplicationMetrics  json.RawMessage    `json:"duplicationMetrics"`
	DependencyMetrics   json.RawMessage    `json:"dependencyMetrics"`
	SecurityFindings    json.RawMessage    `json:"securityFindings"`
	PerformanceFindings json.RawMessage    `json:"performanceFindings"`
	AISuggestions       json.RawMessage    `json:"aiSuggestions"`
	CodeExplanations    json.RawMessage    `json:"codeExplanations"`
	ContextAnalysis     json.RawMessage    `json:"contextAnalysis"`
}

type DiffStats struct {
	TotalFiles     int
	TotalAdditions int
	TotalDeletions int
}
