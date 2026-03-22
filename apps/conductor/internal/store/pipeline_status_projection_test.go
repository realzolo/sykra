package store

import "testing"

func TestDerivePipelineRunJobStatus(t *testing.T) {
	tests := []struct {
		name     string
		status   string
		steps    []PipelineStep
		expected string
	}{
		{
			name:     "running step upgrades queued job",
			status:   "queued",
			steps:    []PipelineStep{{Status: "running"}},
			expected: "running",
		},
		{
			name:     "failed step upgrades queued job",
			status:   "queued",
			steps:    []PipelineStep{{Status: "failed"}},
			expected: "failed",
		},
		{
			name:     "waiting manual is projected",
			status:   "queued",
			steps:    []PipelineStep{{Status: "waiting_manual"}},
			expected: "waiting_manual",
		},
		{
			name:     "all success projects to success",
			status:   "queued",
			steps:    []PipelineStep{{Status: "success"}, {Status: "success"}},
			expected: "success",
		},
		{
			name:     "non queued job keeps canonical status",
			status:   "running",
			steps:    []PipelineStep{{Status: "success"}},
			expected: "running",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := derivePipelineRunJobStatus(tt.status, tt.steps)
			if got != tt.expected {
				t.Fatalf("expected %q, got %q", tt.expected, got)
			}
		})
	}
}
