package domain

import "encoding/json"

type AnalyzeRequest struct {
	ProjectID      string          `json:"projectId"`
	ReportID       string          `json:"reportId"`
	Repo           string          `json:"repo"`
	Hashes         []string        `json:"hashes"`
	Rules          []Rule          `json:"rules"`
	PreviousReport json.RawMessage `json:"previousReport"`
	UseIncremental bool            `json:"useIncremental"`
}
