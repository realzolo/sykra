package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"sykra/conductor/internal/domain"
)

type Store struct {
	pool *pgxpool.Pool
}

var ErrReportNotRunning = errors.New("report is not in running status")

type Project struct {
	ID                    string
	Repo                  string
	IgnorePatterns        []string
	QualityThreshold      *int
	ArtifactRetentionDays *int
	WebhookURL            *string
	OrgID                 string
	VCSIntegrationID      *string
	AIIntegrationID       *string
}

type Report struct {
	ID               string
	ProjectID        string
	OrgID            string
	Status           string
	RulesetSnapshot  json.RawMessage
	Commits          json.RawMessage
	AnalysisSnapshot json.RawMessage
}

type IntegrationRow struct {
	ID              string
	OrgID           string
	Type            string
	Provider        string
	Config          json.RawMessage
	VaultSecretName string
	IsDefault       bool
}

type ReportAnalysisUpdate struct {
	Status              string
	Score               int
	CategoryScores      json.RawMessage
	Summary             string
	ComplexityMetrics   json.RawMessage
	DuplicationMetrics  json.RawMessage
	DependencyMetrics   json.RawMessage
	SecurityFindings    json.RawMessage
	PerformanceFindings json.RawMessage
	AISuggestions       json.RawMessage
	CodeExplanations    json.RawMessage
	ContextAnalysis     json.RawMessage
	TotalFiles          int
	TotalAdditions      int
	TotalDeletions      int
	AnalysisDurationMs  int
	ModelVersion        string
	TokensUsed          *int
	TokenUsage          json.RawMessage
	AnalysisProgress    json.RawMessage
	ErrorMessage        *string
}

type ReportSectionUpsert struct {
	ReportID     string
	Phase        string
	Attempt      int
	Status       string
	Payload      json.RawMessage
	ErrorMessage *string
	DurationMs   *int
	TokensUsed   *int
	TokenUsage   json.RawMessage
	CostUSD      *float64
	CompletedAt  *time.Time
}

type ReportSection struct {
	ReportID     string
	Phase        string
	Attempt      int
	Status       string
	Payload      json.RawMessage
	ErrorMessage *string
	DurationMs   *int
	TokensUsed   *int
	TokenUsage   json.RawMessage
	CompletedAt  *time.Time
}

func New(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}

func (s *Store) GetProject(ctx context.Context, projectID string) (*Project, error) {
	var qualityThreshold pgtype.Int4
	var artifactRetentionDays pgtype.Int4
	var webhookURL pgtype.Text
	var vcsID pgtype.UUID
	var aiID pgtype.UUID

	row := s.pool.QueryRow(
		ctx,
		`select id, repo, ignore_patterns, quality_threshold, artifact_retention_days, webhook_url, org_id, vcs_integration_id, ai_integration_id
		 from code_projects where id=$1`,
		projectID,
	)

	var project Project
	err := row.Scan(
		&project.ID,
		&project.Repo,
		&project.IgnorePatterns,
		&qualityThreshold,
		&artifactRetentionDays,
		&webhookURL,
		&project.OrgID,
		&vcsID,
		&aiID,
	)
	if err != nil {
		return nil, err
	}

	if qualityThreshold.Valid {
		value := int(qualityThreshold.Int32)
		project.QualityThreshold = &value
	}
	if artifactRetentionDays.Valid {
		value := int(artifactRetentionDays.Int32)
		project.ArtifactRetentionDays = &value
	}
	if webhookURL.Valid {
		value := webhookURL.String
		project.WebhookURL = &value
	}
	if vcsID.Valid {
		value := vcsID.String()
		project.VCSIntegrationID = &value
	}
	if aiID.Valid {
		value := aiID.String()
		project.AIIntegrationID = &value
	}

	return &project, nil
}

func (s *Store) GetReport(ctx context.Context, reportID string) (*Report, error) {
	row := s.pool.QueryRow(
		ctx,
		`select id, project_id, org_id, status, ruleset_snapshot, commits, analysis_snapshot
		 from analysis_reports where id=$1`,
		reportID,
	)

	var report Report
	err := row.Scan(
		&report.ID,
		&report.ProjectID,
		&report.OrgID,
		&report.Status,
		&report.RulesetSnapshot,
		&report.Commits,
		&report.AnalysisSnapshot,
	)
	if err != nil {
		return nil, err
	}
	return &report, nil
}

func (s *Store) GetLatestProjectReviewScore(ctx context.Context, projectID string) (*int, error) {
	row := s.pool.QueryRow(
		ctx,
		`select score
		 from analysis_reports
		 where project_id = $1
		   and status = 'done'
		   and score is not null
		 order by created_at desc
		 limit 1`,
		projectID,
	)

	var score pgtype.Int4
	if err := row.Scan(&score); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if !score.Valid {
		return nil, nil
	}
	value := int(score.Int32)
	return &value, nil
}

func (s *Store) IsReportCanceled(ctx context.Context, reportID string) (bool, error) {
	row := s.pool.QueryRow(ctx, `select status from analysis_reports where id = $1`, reportID)
	var status string
	if err := row.Scan(&status); err != nil {
		return false, err
	}
	return status == "canceled", nil
}

func (s *Store) ClaimPendingAnalysisReports(ctx context.Context, limit int) ([]Report, error) {
	if limit <= 0 {
		return nil, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	rows, err := tx.Query(
		ctx,
		`with claimed as (
		   select id
		     from analysis_reports
		    where status = 'pending'
		    order by created_at asc
		    for update skip locked
		    limit $1
		 )
		 update analysis_reports r
		    set status = 'running',
		        error_message = null,
		        analysis_progress = null,
		        sse_seq = sse_seq + 1,
		        updated_at = now()
		   from claimed
		  where r.id = claimed.id
		  returning r.id, r.project_id, r.org_id, r.status, r.ruleset_snapshot, r.commits, r.analysis_snapshot`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	claimed := make([]Report, 0, limit)
	for rows.Next() {
		var report Report
		if err := rows.Scan(
			&report.ID,
			&report.ProjectID,
			&report.OrgID,
			&report.Status,
			&report.RulesetSnapshot,
			&report.Commits,
			&report.AnalysisSnapshot,
		); err != nil {
			return nil, err
		}
		claimed = append(claimed, report)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return claimed, nil
}

func (s *Store) UpdateReportStatus(ctx context.Context, reportID string, status string, errorMessage *string) error {
	_, err := s.pool.Exec(
		ctx,
		`update analysis_reports
		    set status=$2,
		        error_message=$3,
		        sse_seq=sse_seq+1,
		        updated_at=now()
		  where id=$1`,
		reportID,
		status,
		errorMessage,
	)
	return err
}

func (s *Store) MarkReportRunning(ctx context.Context, reportID string) error {
	result, err := s.pool.Exec(
		ctx,
		`update analysis_reports
		 set status='running',
		     error_message=null,
		     analysis_progress=null,
		     sse_seq=sse_seq+1,
		     updated_at=now()
		 where id=$1
		   and status in ('pending', 'running')`,
		reportID,
	)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrReportNotRunning
	}
	return nil
}

func (s *Store) MarkReportFailed(ctx context.Context, reportID string, message string) error {
	result, err := s.pool.Exec(
		ctx,
		`update analysis_reports
		 set status='failed',
		     error_message=$2::text,
		     analysis_progress=jsonb_build_object(
		     	'phase', 'failed',
		     	'message', $2::text,
		     	'updatedAt', now()
		     ),
		     sse_seq=sse_seq+1,
		     updated_at=now()
		 where id=$1
		   and status in ('pending', 'running')`,
		reportID,
		message,
	)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrReportNotRunning
	}
	return nil
}

func (s *Store) UpdateReportProgress(ctx context.Context, reportID string, progress domain.AnalysisProgress) error {
	raw, err := json.Marshal(progress)
	if err != nil {
		return err
	}
	result, err := s.pool.Exec(
		ctx,
		`update analysis_reports
		 set analysis_progress=$2,
		     sse_seq=sse_seq+1,
		     updated_at=now()
		 where id=$1
		   and status in ('pending', 'running')`,
		reportID,
		raw,
	)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrReportNotRunning
	}
	return nil
}

func (s *Store) UpdateReportAnalysis(ctx context.Context, reportID string, update ReportAnalysisUpdate) error {
	result, err := s.pool.Exec(
		ctx,
		`update analysis_reports set
			status=$2,
			score=$3,
			category_scores=$4,
			summary=$5,
			complexity_metrics=$6,
			duplication_metrics=$7,
			dependency_metrics=$8,
			security_findings=$9,
			performance_findings=$10,
			ai_suggestions=$11,
			code_explanations=$12,
			context_analysis=$13,
			total_files=$14,
			total_additions=$15,
			total_deletions=$16,
			analysis_duration_ms=$17,
			model_version=$18,
			tokens_used=$19,
			token_usage=$20,
			analysis_progress=$21,
			error_message=$22,
			sse_seq=sse_seq+1,
			updated_at=now()
		  where id=$1 and status='running'`,
		reportID,
		update.Status,
		update.Score,
		update.CategoryScores,
		update.Summary,
		update.ComplexityMetrics,
		update.DuplicationMetrics,
		update.DependencyMetrics,
		update.SecurityFindings,
		update.PerformanceFindings,
		update.AISuggestions,
		update.CodeExplanations,
		update.ContextAnalysis,
		update.TotalFiles,
		update.TotalAdditions,
		update.TotalDeletions,
		update.AnalysisDurationMs,
		update.ModelVersion,
		update.TokensUsed,
		update.TokenUsage,
		update.AnalysisProgress,
		update.ErrorMessage,
	)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrReportNotRunning
	}
	return nil
}

func (s *Store) UpsertReportSection(ctx context.Context, section ReportSectionUpsert) error {
	if section.Attempt <= 0 {
		section.Attempt = 1
	}

	_, err := s.pool.Exec(
		ctx,
		`with upserted as (
		   insert into analysis_report_sections
		     (report_id, phase, attempt, status, payload, error_message, duration_ms, tokens_used, token_usage, estimated_cost_usd, completed_at, updated_at)
		   values
		     ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
		   on conflict (report_id, phase, attempt)
		   do update set
		     status = excluded.status,
		     payload = excluded.payload,
		     error_message = excluded.error_message,
		     duration_ms = excluded.duration_ms,
		     tokens_used = excluded.tokens_used,
		     token_usage = excluded.token_usage,
		     estimated_cost_usd = excluded.estimated_cost_usd,
		     completed_at = excluded.completed_at,
		     updated_at = now()
		   returning report_id
		 )
		 update analysis_reports
		    set sse_seq = sse_seq + 1,
		        updated_at = now()
		  where id = (select report_id from upserted limit 1)`,
		section.ReportID,
		section.Phase,
		section.Attempt,
		section.Status,
		section.Payload,
		section.ErrorMessage,
		section.DurationMs,
		section.TokensUsed,
		section.TokenUsage,
		section.CostUSD,
		section.CompletedAt,
	)
	return err
}

func (s *Store) GetLatestReportSection(ctx context.Context, reportID string, phase string) (*ReportSection, error) {
	row := s.pool.QueryRow(
		ctx,
		`select report_id,
		        phase,
		        attempt,
		        status,
		        payload,
		        error_message,
		        duration_ms,
		        tokens_used,
		        token_usage,
		        completed_at
		   from analysis_report_sections
		  where report_id=$1 and phase=$2
		  order by attempt desc
		  limit 1`,
		reportID,
		phase,
	)

	var section ReportSection
	var errorMessage pgtype.Text
	var durationMs pgtype.Int4
	var tokensUsed pgtype.Int4
	var completedAt pgtype.Timestamptz
	err := row.Scan(
		&section.ReportID,
		&section.Phase,
		&section.Attempt,
		&section.Status,
		&section.Payload,
		&errorMessage,
		&durationMs,
		&tokensUsed,
		&section.TokenUsage,
		&completedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if errorMessage.Valid {
		msg := errorMessage.String
		section.ErrorMessage = &msg
	}
	if durationMs.Valid {
		value := int(durationMs.Int32)
		section.DurationMs = &value
	}
	if tokensUsed.Valid {
		value := int(tokensUsed.Int32)
		section.TokensUsed = &value
	}
	if completedAt.Valid {
		value := completedAt.Time
		section.CompletedAt = &value
	}
	return &section, nil
}

func (s *Store) UpdateProjectLastAnalyzedAt(ctx context.Context, projectID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update code_projects set last_analyzed_at=$2 where id=$1`,
		projectID,
		time.Now().UTC(),
	)
	return err
}

func (s *Store) ReplaceReportIssues(ctx context.Context, reportID string, issues []domain.ReviewIssue) error {
	_, err := s.pool.Exec(ctx, `delete from analysis_issues where report_id=$1`, reportID)
	if err != nil {
		return err
	}

	if len(issues) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	now := time.Now().UTC()
	for _, issue := range issues {
		file := issue.File
		if file == "" {
			file = "unknown"
		}
		severity := issue.Severity
		if !isValidSeverity(severity) {
			severity = "medium"
		}
		category := issue.Category
		if category == "" {
			category = "unknown"
		}
		rule := issue.Rule
		if rule == "" {
			rule = "unspecified"
		}
		message := issue.Message
		if message == "" {
			message = "issue detected"
		}

		batch.Queue(
			`insert into analysis_issues
			(report_id, file, line, severity, category, rule, message, suggestion, code_snippet, fix_patch, priority, impact_scope, estimated_effort, status, updated_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
			reportID,
			file,
			issue.Line,
			severity,
			category,
			rule,
			message,
			issue.Suggestion,
			issue.CodeSnippet,
			issue.FixPatch,
			issue.Priority,
			issue.ImpactScope,
			issue.EstimatedEffort,
			"open",
			now,
		)
	}

	br := s.pool.SendBatch(ctx, batch)
	defer br.Close()

	for range issues {
		_, err := br.Exec()
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) GetIntegrationByID(ctx context.Context, integrationID string) (*IntegrationRow, error) {
	row := s.pool.QueryRow(
		ctx,
		`select id, org_id, type, provider, config, vault_secret_name, is_default
		 from org_integrations where id=$1`,
		integrationID,
	)

	var integration IntegrationRow
	err := row.Scan(
		&integration.ID,
		&integration.OrgID,
		&integration.Type,
		&integration.Provider,
		&integration.Config,
		&integration.VaultSecretName,
		&integration.IsDefault,
	)
	if err != nil {
		return nil, err
	}
	return &integration, nil
}

func (s *Store) GetDefaultIntegration(ctx context.Context, orgID string, integrationType string) (*IntegrationRow, error) {
	row := s.pool.QueryRow(
		ctx,
		`select id, org_id, type, provider, config, vault_secret_name, is_default
		 from org_integrations
		 where org_id=$1 and type=$2 and is_default=true
		 limit 1`,
		orgID,
		integrationType,
	)

	var integration IntegrationRow
	err := row.Scan(
		&integration.ID,
		&integration.OrgID,
		&integration.Type,
		&integration.Provider,
		&integration.Config,
		&integration.VaultSecretName,
		&integration.IsDefault,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &integration, nil
}

func (s *Store) RecordAudit(ctx context.Context, action string, entityType string, entityID string, changes json.RawMessage) error {
	_, err := s.pool.Exec(
		ctx,
		`insert into audit_logs (action, entity_type, entity_id, changes, created_at)
		 values ($1,$2,$3,$4,$5)`,
		action,
		entityType,
		entityID,
		changes,
		time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("audit insert failed: %w", err)
	}
	return nil
}

func isValidSeverity(value string) bool {
	switch value {
	case "critical", "high", "medium", "low", "info":
		return true
	default:
		return false
	}
}
