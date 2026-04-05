package pipeline

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"strings"
	"time"

	"sykra/conductor/internal/store"
)

type failureSignatureEventInput struct {
	Scope           string
	Status          RunStatus
	Message         string
	JobID           string
	JobKey          string
	StepID          string
	StepKey         string
	ExecutionTarget string
}

type failureSignature struct {
	Code         string
	Title        string
	Summary      string
	Severity     string
	RunbookID    string
	RunbookTitle string
	RunbookDoc   string
	Actions      []string
}

func appendFailureSignatureEvent(
	ctx context.Context,
	appender runEventAppender,
	run *store.PipelineRun,
	runID string,
	input failureSignatureEventInput,
) error {
	if appender == nil || strings.TrimSpace(runID) == "" {
		return nil
	}
	message := strings.TrimSpace(input.Message)
	if message == "" {
		return nil
	}

	signature := classifyFailureSignature(message, input)
	if signature == nil {
		return nil
	}

	fingerprint := failureSignatureFingerprint(signature.Code, input.Scope, input.JobKey, input.StepKey, input.ExecutionTarget)
	payload := map[string]any{
		"runId":         runID,
		"scope":         strings.TrimSpace(input.Scope),
		"status":        input.Status,
		"message":       message,
		"jobId":         strings.TrimSpace(input.JobID),
		"jobKey":        strings.TrimSpace(input.JobKey),
		"stepId":        strings.TrimSpace(input.StepID),
		"stepKey":       strings.TrimSpace(input.StepKey),
		"executionMode": strings.TrimSpace(strings.ToLower(input.ExecutionTarget)),
		"signature": map[string]any{
			"code":        signature.Code,
			"title":       signature.Title,
			"summary":     signature.Summary,
			"severity":    signature.Severity,
			"fingerprint": fingerprint,
		},
		"runbook": map[string]any{
			"id":      signature.RunbookID,
			"title":   signature.RunbookTitle,
			"docPath": signature.RunbookDoc,
			"actions": append([]string(nil), signature.Actions...),
		},
		"detectedAt": time.Now().UTC().Format(time.RFC3339),
	}
	if run != nil {
		if run.ProjectID != nil && strings.TrimSpace(*run.ProjectID) != "" {
			payload["projectId"] = strings.TrimSpace(*run.ProjectID)
		}
		if run.CommitSHA != nil && strings.TrimSpace(*run.CommitSHA) != "" {
			payload["commitSha"] = strings.TrimSpace(*run.CommitSHA)
		}
	}

	return appender.AppendRunEvent(ctx, runID, "run.failure_signature", payload)
}

func classifyFailureSignature(message string, input failureSignatureEventInput) *failureSignature {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if normalized == "" {
		return nil
	}

	if strings.Contains(normalized, "docker daemon unavailable") ||
		strings.Contains(normalized, "cannot connect to the docker daemon") ||
		strings.Contains(normalized, "docker not ready") ||
		strings.Contains(normalized, "start sandbox container") {
		return &failureSignature{
			Code:         "docker_daemon_unavailable",
			Title:        "Docker daemon unavailable",
			Summary:      "The pipeline runtime could not reach Docker, so sandbox execution could not start.",
			Severity:     "high",
			RunbookID:    "runbook.docker.daemon.unavailable",
			RunbookTitle: "Recover Docker runtime",
			RunbookDoc:   "docs/pipeline/pipeline-optimization-handbook.md",
			Actions: []string{
				"Verify Docker daemon is running and accessible to the Conductor host user.",
				"Check `docker info` and Conductor `/readyz` before retrying the run.",
				"Inspect Docker host resource pressure (disk, memory) if startup repeatedly fails.",
			},
		}
	}

	if strings.Contains(normalized, "no available worker matches pipeline constraints") ||
		strings.Contains(normalized, "no worker connected") ||
		strings.Contains(normalized, "no deploy worker node available") ||
		strings.Contains(normalized, "worker lease expired") {
		return &failureSignature{
			Code:         "worker_capacity_or_capability_mismatch",
			Title:        "No eligible worker available",
			Summary:      "The run could not be assigned to an online worker that satisfies environment/capability constraints.",
			Severity:     "high",
			RunbookID:    "runbook.worker.assignment.mismatch",
			RunbookTitle: "Fix worker assignment mismatch",
			RunbookDoc:   "docs/pipeline/pipeline-optimization-handbook.md",
			Actions: []string{
				"Review worker diagnostics in dispatch error (`draining`, `saturated`, `env_mismatch`, `capability_mismatch`).",
				"Bring matching workers online or adjust pipeline environment/capability requirements.",
				"Resume drained workers after maintenance and verify lease heartbeats are healthy.",
			},
		}
	}

	if strings.Contains(normalized, "source branch") && strings.Contains(normalized, "local mirror") ||
		strings.Contains(normalized, "resolve source snapshot") ||
		strings.Contains(normalized, "pinned source commit") {
		return &failureSignature{
			Code:         "source_snapshot_resolution_failed",
			Title:        "Source snapshot resolution failed",
			Summary:      "Conductor failed to resolve the required commit/branch from the repository mirror.",
			Severity:     "high",
			RunbookID:    "runbook.source.snapshot.failed",
			RunbookTitle: "Recover source snapshot resolution",
			RunbookDoc:   "docs/pipeline/pipeline-optimization-handbook.md",
			Actions: []string{
				"Confirm branch/commit still exists in the upstream repository.",
				"Check integration credentials and mirror fetch health.",
				"Warm or rebuild local mirror cache if refs are stale or corrupted.",
			},
		}
	}

	if strings.Contains(normalized, "static analysis reported") ||
		strings.Contains(normalized, "blocking finding") {
		return &failureSignature{
			Code:         "quality_gate_blocking_findings",
			Title:        "Quality gate blocked by findings",
			Summary:      "Structured static-analysis results reported blocking findings above policy threshold.",
			Severity:     "medium",
			RunbookID:    "runbook.quality.gate.blocked",
			RunbookTitle: "Resolve quality-gate blockers",
			RunbookDoc:   "docs/pipeline/pipeline-optimization-handbook.md",
			Actions: []string{
				"Open ingested quality findings for the failed node and fix blocking issues.",
				"Rerun the node after remediation or adjust policy thresholds with governance approval.",
				"Ensure analyzer scope uses changed-files manifest for faster feedback loops.",
			},
		}
	}

	if strings.Contains(normalized, "artifact checksum mismatch") ||
		strings.Contains(normalized, "artifact size mismatch") ||
		strings.Contains(normalized, "artifact pull failed") ||
		strings.Contains(normalized, "artifact open failed") {
		return &failureSignature{
			Code:         "artifact_integrity_or_transfer_failure",
			Title:        "Artifact transfer or integrity failure",
			Summary:      "Artifact download/upload could not complete with expected size/checksum guarantees.",
			Severity:     "high",
			RunbookID:    "runbook.artifact.transfer.failed",
			RunbookTitle: "Recover artifact transfer",
			RunbookDoc:   "docs/pipeline/pipeline-optimization-handbook.md",
			Actions: []string{
				"Verify artifact backend reachability and credentials.",
				"Inspect failed artifact path and checksum details in node events.",
				"Republish or regenerate the source artifact before retrying dependent steps.",
			},
		}
	}

	if input.Status == StatusTimedOut ||
		strings.Contains(normalized, "deadline exceeded") ||
		strings.Contains(normalized, "timed out") {
		return &failureSignature{
			Code:         "job_or_step_timeout",
			Title:        "Execution timed out",
			Summary:      "Job or step execution exceeded its timeout budget before completion.",
			Severity:     "medium",
			RunbookID:    "runbook.execution.timeout",
			RunbookTitle: "Handle execution timeout",
			RunbookDoc:   "docs/pipeline/pipeline-optimization-handbook.md",
			Actions: []string{
				"Review step log tail for the longest blocking command.",
				"Increase timeout only after identifying deterministic slow-path causes.",
				"Split heavy steps or add earlier fail-fast checks to reduce wasted runtime.",
			},
		}
	}

	if strings.Contains(normalized, "exit status") ||
		strings.Contains(normalized, "worker execution failed") ||
		strings.Contains(normalized, "job setup failed") ||
		strings.Contains(normalized, "command") {
		return &failureSignature{
			Code:         "command_execution_failed",
			Title:        "Command execution failed",
			Summary:      "A shell command or worker step returned a non-success exit status.",
			Severity:     "medium",
			RunbookID:    "runbook.command.failed",
			RunbookTitle: "Debug command failure",
			RunbookDoc:   "docs/pipeline/pipeline-optimization-handbook.md",
			Actions: []string{
				"Inspect node log output and reproduce the command in the same runner image locally.",
				"Validate required environment variables, secrets, and working directory paths.",
				"Retry only after fixing deterministic command or dependency failures.",
			},
		}
	}

	return &failureSignature{
		Code:         "unknown_runtime_failure",
		Title:        "Unknown runtime failure",
		Summary:      "The run failed with an uncategorized error signature.",
		Severity:     "medium",
		RunbookID:    "runbook.runtime.unknown",
		RunbookTitle: "Triage unknown runtime failure",
		RunbookDoc:   "docs/pipeline/pipeline-optimization-handbook.md",
		Actions: []string{
			"Inspect the failed node and recent run events for first-error context.",
			"Capture reproducible inputs (commit, image, env) before rerun.",
			"Add a signature mapping once the failure becomes recurrent.",
		},
	}
}

func failureSignatureFingerprint(code string, scope string, jobKey string, stepKey string, executionTarget string) string {
	joined := strings.Join([]string{
		strings.TrimSpace(strings.ToLower(code)),
		strings.TrimSpace(strings.ToLower(scope)),
		strings.TrimSpace(strings.ToLower(jobKey)),
		strings.TrimSpace(strings.ToLower(stepKey)),
		strings.TrimSpace(strings.ToLower(executionTarget)),
	}, "|")
	sum := sha1.Sum([]byte(joined))
	return hex.EncodeToString(sum[:8])
}
