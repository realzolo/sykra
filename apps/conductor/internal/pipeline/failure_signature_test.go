package pipeline

import "testing"

func TestClassifyFailureSignature(t *testing.T) {
	tests := []struct {
		name     string
		message  string
		status   RunStatus
		expected string
	}{
		{
			name:     "docker unavailable",
			message:  "docker daemon unavailable: cannot connect to the Docker daemon",
			status:   StatusFailed,
			expected: "docker_daemon_unavailable",
		},
		{
			name:     "worker mismatch",
			message:  "no available worker matches pipeline constraints",
			status:   StatusFailed,
			expected: "worker_capacity_or_capability_mismatch",
		},
		{
			name:     "quality gate blocking",
			message:  "static analysis reported 3 blocking finding(s) in quality-gate.sarif",
			status:   StatusFailed,
			expected: "quality_gate_blocking_findings",
		},
		{
			name:     "timeout",
			message:  "context deadline exceeded",
			status:   StatusTimedOut,
			expected: "job_or_step_timeout",
		},
		{
			name:     "command failed",
			message:  "exit status 1",
			status:   StatusFailed,
			expected: "command_execution_failed",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			signature := classifyFailureSignature(tc.message, failureSignatureEventInput{
				Scope:  "step",
				Status: tc.status,
			})
			if signature == nil {
				t.Fatalf("expected signature for message %q", tc.message)
			}
			if signature.Code != tc.expected {
				t.Fatalf("expected signature code %s, got %s", tc.expected, signature.Code)
			}
			if signature.RunbookID == "" || signature.RunbookTitle == "" || len(signature.Actions) == 0 {
				t.Fatalf("expected runbook metadata in signature: %#v", signature)
			}
		})
	}
}

func TestFailureSignatureFingerprintDeterministic(t *testing.T) {
	first := failureSignatureFingerprint("command_execution_failed", "step", "build", "unit-tests", "build")
	second := failureSignatureFingerprint("command_execution_failed", "step", "build", "unit-tests", "build")
	if first != second {
		t.Fatalf("expected deterministic fingerprint, got %s and %s", first, second)
	}
	if first == "" {
		t.Fatal("expected non-empty fingerprint")
	}
}
