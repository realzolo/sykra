package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"spec-axis/scheduler/internal/domain"
)

var ErrCodeReviewRunNotRunning = errors.New("code review run is not in running status")

type CodeReviewRun struct {
	ID               string
	ProjectID        string
	OrgID            string
	ProfileID        string
	ProfileVersionID string
	ScopeMode        string
	BaseRef          *string
	HeadRef          *string
	Status           string
}

type CodeReviewStageUpsert struct {
	RunID        string
	Stage        string
	Status       string
	Payload      json.RawMessage
	ErrorMessage *string
	CompletedAt  *time.Time
}

type CodeReviewToolRunUpsert struct {
	RunID         string
	Tool          string
	Version       *string
	Status        string
	Command       *string
	ExitCode      *int
	DurationMs    *int
	ArtifactPath  *string
	StdoutExcerpt *string
	StderrExcerpt *string
	Metadata      json.RawMessage
	CompletedAt   *time.Time
}

type CodeReviewRunUpdate struct {
	Status     string
	GateStatus string
	Score      *int
	RiskLevel  *string
	Summary    *string
	Result     json.RawMessage
	Progress   json.RawMessage
}

func (s *Store) GetCodeReviewRun(ctx context.Context, runID string) (*CodeReviewRun, error) {
	row := s.pool.QueryRow(
		ctx,
		`select id, project_id, org_id, profile_id, profile_version_id, scope_mode, base_ref, head_ref, status
		   from code_review_runs
		  where id = $1`,
		runID,
	)

	var run CodeReviewRun
	var baseRef pgtype.Text
	var headRef pgtype.Text
	if err := row.Scan(
		&run.ID,
		&run.ProjectID,
		&run.OrgID,
		&run.ProfileID,
		&run.ProfileVersionID,
		&run.ScopeMode,
		&baseRef,
		&headRef,
		&run.Status,
	); err != nil {
		return nil, err
	}
	if baseRef.Valid {
		value := baseRef.String
		run.BaseRef = &value
	}
	if headRef.Valid {
		value := headRef.String
		run.HeadRef = &value
	}
	return &run, nil
}

func (s *Store) MarkCodeReviewRunRunning(ctx context.Context, runID string) error {
	result, err := s.pool.Exec(
		ctx,
		`update code_review_runs
		    set status = 'running',
		        gate_status = 'pending',
		        progress = null,
		        sse_seq = sse_seq + 1,
		        updated_at = now()
		  where id = $1
		    and status in ('pending', 'running')`,
		runID,
	)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrCodeReviewRunNotRunning
	}
	return nil
}

func (s *Store) MarkCodeReviewRunFailed(ctx context.Context, runID string, message string) error {
	result, err := s.pool.Exec(
		ctx,
		`update code_review_runs
		    set status = 'failed',
		        gate_status = 'warning',
		        progress = jsonb_build_object(
		          'stage', 'failed',
		          'message', $2::text,
		          'updatedAt', now()
		        ),
		        result = jsonb_build_object('error', $2::text),
		        sse_seq = sse_seq + 1,
		        updated_at = now()
		  where id = $1
		    and status in ('pending', 'running')`,
		runID,
		message,
	)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrCodeReviewRunNotRunning
	}
	return nil
}

func (s *Store) UpdateCodeReviewProgress(ctx context.Context, runID string, progress domain.CodeReviewProgress) error {
	raw, err := json.Marshal(progress)
	if err != nil {
		return err
	}
	result, err := s.pool.Exec(
		ctx,
		`update code_review_runs
		    set progress = $2,
		        sse_seq = sse_seq + 1,
		        updated_at = now()
		  where id = $1
		    and status in ('pending', 'running')`,
		runID,
		raw,
	)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrCodeReviewRunNotRunning
	}
	return nil
}

func (s *Store) UpsertCodeReviewStage(ctx context.Context, stage CodeReviewStageUpsert) error {
	_, err := s.pool.Exec(
		ctx,
		`with upserted as (
		   insert into code_review_stages
		     (run_id, stage, status, payload, error_message, completed_at, updated_at)
		   values
		     ($1, $2, $3, $4, $5, $6, now())
		   on conflict (run_id, stage)
		   do update set
		     status = excluded.status,
		     payload = excluded.payload,
		     error_message = excluded.error_message,
		     completed_at = excluded.completed_at,
		     updated_at = now()
		   returning run_id
		 )
		 update code_review_runs
		    set sse_seq = sse_seq + 1,
		        updated_at = now()
		  where id = (select run_id from upserted limit 1)`,
		stage.RunID,
		stage.Stage,
		stage.Status,
		stage.Payload,
		stage.ErrorMessage,
		stage.CompletedAt,
	)
	return err
}

func (s *Store) UpsertCodeReviewToolRun(ctx context.Context, toolRun CodeReviewToolRunUpsert) error {
	_, err := s.pool.Exec(
		ctx,
		`with inserted as (
		   insert into code_review_tool_runs
		     (run_id, tool, version, status, command, exit_code, duration_ms, artifact_path, stdout_excerpt, stderr_excerpt, metadata, completed_at, updated_at)
		   values
		     ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
		   returning run_id
		 )
		 update code_review_runs
		    set sse_seq = sse_seq + 1,
		        updated_at = now()
		  where id = $1`,
		toolRun.RunID,
		toolRun.Tool,
		toolRun.Version,
		toolRun.Status,
		toolRun.Command,
		toolRun.ExitCode,
		toolRun.DurationMs,
		toolRun.ArtifactPath,
		toolRun.StdoutExcerpt,
		toolRun.StderrExcerpt,
		toolRun.Metadata,
		toolRun.CompletedAt,
	)
	return err
}

func (s *Store) ReplaceCodeReviewFindings(ctx context.Context, runID string, findings []domain.CodeReviewFinding) error {
	_, err := s.pool.Exec(ctx, `delete from code_review_findings where run_id = $1`, runID)
	if err != nil {
		return err
	}
	if len(findings) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	now := time.Now().UTC()
	for _, finding := range findings {
		stage := finding.Stage
		if stage == "" {
			stage = "fusion"
		}
		source := finding.Source
		if source == "" {
			source = "ai"
		}
		category := finding.Category
		if category == "" {
			category = "maintainability"
		}
		severity := finding.Severity
		if !isValidSeverity(severity) {
			severity = "medium"
		}
		title := finding.Title
		if title == "" {
			title = finding.Message
		}
		if title == "" {
			title = "Issue detected"
		}
		message := finding.Message
		if message == "" {
			message = title
		}
		file := finding.File
		if file == "" {
			file = "unknown"
		}

		batch.Queue(
			`insert into code_review_findings
			  (run_id, stage, source, tool, rule_id, fingerprint, category, severity, confidence, title, message, file, line, end_line, suggestion, fix_patch, priority, impact_scope, metadata, status, created_at, updated_at)
			 values
			  ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'open',$20,$20)`,
			runID,
			stage,
			source,
			finding.Tool,
			finding.RuleID,
			finding.Fingerprint,
			category,
			severity,
			finding.Confidence,
			title,
			message,
			file,
			finding.Line,
			finding.EndLine,
			finding.Suggestion,
			finding.FixPatch,
			finding.Priority,
			finding.ImpactScope,
			finding.Metadata,
			now,
		)
	}

	br := s.pool.SendBatch(ctx, batch)
	defer br.Close()

	for range findings {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) FinalizeCodeReviewRun(ctx context.Context, runID string, update CodeReviewRunUpdate) error {
	result, err := s.pool.Exec(
		ctx,
		`update code_review_runs
		    set status = $2,
		        gate_status = $3,
		        score = $4,
		        risk_level = $5,
		        summary = $6,
		        result = $7,
		        progress = $8,
		        sse_seq = sse_seq + 1,
		        updated_at = now()
		  where id = $1
		    and status = 'running'`,
		runID,
		update.Status,
		update.GateStatus,
		update.Score,
		update.RiskLevel,
		update.Summary,
		update.Result,
		update.Progress,
	)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrCodeReviewRunNotRunning
	}
	return nil
}
