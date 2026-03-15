package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"spec-axis/runner/internal/domain"
)

type Store struct {
	pool *pgxpool.Pool
}

type Project struct {
	ID               string
	Repo             string
	IgnorePatterns   []string
	QualityThreshold *int
	WebhookURL       *string
	OrgID            string
	VCSIntegrationID *string
	AIIntegrationID  *string
}

type Report struct {
	ID              string
	ProjectID       string
	OrgID           string
	RulesetSnapshot json.RawMessage
	Commits         json.RawMessage
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
	Status               string
	Score                int
	CategoryScores       json.RawMessage
	Issues               json.RawMessage
	Summary              string
	ComplexityMetrics    json.RawMessage
	DuplicationMetrics   json.RawMessage
	DependencyMetrics    json.RawMessage
	SecurityFindings     json.RawMessage
	PerformanceFindings  json.RawMessage
	AISuggestions        json.RawMessage
	CodeExplanations     json.RawMessage
	ContextAnalysis      json.RawMessage
	TotalFiles           int
	TotalAdditions       int
	TotalDeletions       int
	AnalysisDurationMs   int
	ModelVersion         string
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
	var webhookURL pgtype.Text
	var vcsID pgtype.UUID
	var aiID pgtype.UUID

	row := s.pool.QueryRow(
		ctx,
		`select id, repo, ignore_patterns, quality_threshold, webhook_url, org_id, vcs_integration_id, ai_integration_id
		 from projects where id=$1`,
		projectID,
	)

	var project Project
	err := row.Scan(
		&project.ID,
		&project.Repo,
		&project.IgnorePatterns,
		&qualityThreshold,
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
		`select id, project_id, org_id, ruleset_snapshot, commits
		 from reports where id=$1`,
		reportID,
	)

	var report Report
	err := row.Scan(
		&report.ID,
		&report.ProjectID,
		&report.OrgID,
		&report.RulesetSnapshot,
		&report.Commits,
	)
	if err != nil {
		return nil, err
	}
	return &report, nil
}

func (s *Store) UpdateReportStatus(ctx context.Context, reportID string, status string, errorMessage *string) error {
	_, err := s.pool.Exec(
		ctx,
		`update reports set status=$2, error_message=$3 where id=$1`,
		reportID,
		status,
		errorMessage,
	)
	return err
}

func (s *Store) MarkReportFailed(ctx context.Context, reportID string, message string) error {
	return s.UpdateReportStatus(ctx, reportID, "failed", &message)
}

func (s *Store) UpdateReportAnalysis(ctx context.Context, reportID string, update ReportAnalysisUpdate) error {
	_, err := s.pool.Exec(
		ctx,
		`update reports set
			status=$2,
			score=$3,
			category_scores=$4,
			issues=$5,
			summary=$6,
			complexity_metrics=$7,
			duplication_metrics=$8,
			dependency_metrics=$9,
			security_findings=$10,
			performance_findings=$11,
			ai_suggestions=$12,
			code_explanations=$13,
			context_analysis=$14,
			total_files=$15,
			total_additions=$16,
			total_deletions=$17,
			analysis_duration_ms=$18,
			model_version=$19,
			error_message=null
		  where id=$1`,
		reportID,
		update.Status,
		update.Score,
		update.CategoryScores,
		update.Issues,
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
	)
	return err
}

func (s *Store) UpdateProjectLastAnalyzedAt(ctx context.Context, projectID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update projects set last_analyzed_at=$2 where id=$1`,
		projectID,
		time.Now().UTC(),
	)
	return err
}

func (s *Store) ReplaceReportIssues(ctx context.Context, reportID string, issues []domain.ReviewIssue) error {
	_, err := s.pool.Exec(ctx, `delete from report_issues where report_id=$1`, reportID)
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
			`insert into report_issues
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
		 from user_integrations where id=$1`,
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
		 from user_integrations
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
