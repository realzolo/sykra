package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Pipeline struct {
	ID                 string     `json:"id"`
	OrgID              string     `json:"org_id"`
	ProjectID          *string    `json:"project_id"`
	Name               string     `json:"name"`
	Description        string     `json:"description"`
	IsActive           bool       `json:"is_active"`
	CurrentVersionID   *string    `json:"current_version_id,omitempty"`
	ConcurrencyMode    string     `json:"concurrency_mode"`
	TriggerSchedule    *string    `json:"trigger_schedule,omitempty"`
	LastScheduledAt    *time.Time `json:"last_scheduled_at,omitempty"`
	NextScheduledAt    *time.Time `json:"next_scheduled_at,omitempty"`
	SourceBranch       string     `json:"source_branch,omitempty"`
	SourceBranchSource string     `json:"source_branch_source,omitempty"`
	CreatedBy          *string    `json:"created_by,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	LatestVersion      int        `json:"latest_version"`
}

type PipelineVersion struct {
	ID         string          `json:"id"`
	PipelineID string          `json:"pipeline_id"`
	Version    int             `json:"version"`
	Config     json.RawMessage `json:"config"`
	CreatedBy  *string         `json:"created_by,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

func (v PipelineVersion) DecodeConfig(target any) error {
	if len(v.Config) == 0 {
		return fmt.Errorf("config is empty")
	}
	return json.Unmarshal(v.Config, target)
}

type PipelineSecret struct {
	Name           string    `json:"name"`
	ValueEncrypted string    `json:"value_encrypted"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type PipelineRun struct {
	ID             string          `json:"id"`
	PipelineID     string          `json:"pipeline_id"`
	VersionID      string          `json:"version_id"`
	OrgID          string          `json:"org_id"`
	ProjectID      *string         `json:"project_id"`
	Status         string          `json:"status"`
	TriggerType    string          `json:"trigger_type"`
	TriggeredBy    *string         `json:"triggered_by,omitempty"`
	IdempotencyKey *string         `json:"idempotency_key,omitempty"`
	RollbackOf     *string         `json:"rollback_of,omitempty"`
	Attempt        int             `json:"attempt"`
	ErrorCode      *string         `json:"error_code,omitempty"`
	ErrorMessage   *string         `json:"error_message,omitempty"`
	Metadata       json.RawMessage `json:"metadata,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	StartedAt      *time.Time      `json:"started_at,omitempty"`
	FinishedAt     *time.Time      `json:"finished_at,omitempty"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

type PipelineJob struct {
	ID           string     `json:"id"`
	RunID        string     `json:"run_id"`
	JobKey       string     `json:"job_key"`
	Name         string     `json:"name"`
	Status       string     `json:"status"`
	Attempt      int        `json:"attempt"`
	WorkerID     *string    `json:"worker_id,omitempty"`
	ErrorMessage *string    `json:"error_message,omitempty"`
	DurationMs   *int       `json:"duration_ms,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type PipelineStep struct {
	ID           string     `json:"id"`
	JobID        string     `json:"job_id"`
	StepKey      string     `json:"step_key"`
	Name         string     `json:"name"`
	Status       string     `json:"status"`
	ExitCode     *int       `json:"exit_code,omitempty"`
	TimeoutMs    *int       `json:"timeout_ms,omitempty"`
	DurationMs   *int       `json:"duration_ms,omitempty"`
	ErrorMessage *string    `json:"error_message,omitempty"`
	LogPath      *string    `json:"log_path,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type PipelineArtifact struct {
	ID          string     `json:"id,omitempty"`
	OrgID       string     `json:"org_id,omitempty"`
	RunID       string     `json:"run_id"`
	JobID       string     `json:"job_id,omitempty"`
	StepID      string     `json:"step_id,omitempty"`
	Path        string     `json:"path"`
	StoragePath string     `json:"storage_path"`
	SizeBytes   int64      `json:"size_bytes"`
	Sha256      string     `json:"sha256,omitempty"`
	CreatedAt   *time.Time `json:"created_at,omitempty"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
}

type ArtifactFile struct {
	ID           string     `json:"id"`
	OrgID        string     `json:"org_id"`
	ProjectID    string     `json:"project_id"`
	RepositoryID string     `json:"repository_id"`
	VersionID    string     `json:"version_id"`
	LogicalPath  string     `json:"logical_path"`
	FileName     string     `json:"file_name"`
	StoragePath  string     `json:"storage_path"`
	SizeBytes    int64      `json:"size_bytes"`
	Sha256       string     `json:"sha256,omitempty"`
	CreatedAt    *time.Time `json:"created_at,omitempty"`
}

type ArtifactVersion struct {
	ID             string     `json:"id"`
	OrgID          string     `json:"org_id"`
	ProjectID      string     `json:"project_id"`
	RepositoryID   string     `json:"repository_id"`
	RepositorySlug string     `json:"repository_slug"`
	Version        string     `json:"version"`
	ChannelName    string     `json:"channel_name,omitempty"`
	CreatedAt      *time.Time `json:"created_at,omitempty"`
}

type ArtifactVersionUsage struct {
	OrgID         string
	ProjectID     string
	RepositoryID  string
	VersionID     string
	PipelineRunID string
	PipelineJobID string
	Environment   string
	ChannelName   string
	UsageType     string
	CreatedBy     string
}

type RunEvent struct {
	ID         string          `json:"id"`
	RunID      string          `json:"run_id"`
	Seq        int64           `json:"seq"`
	Type       string          `json:"type"`
	Payload    json.RawMessage `json:"payload"`
	OccurredAt time.Time       `json:"occurred_at"`
}

type PipelineRunDetail struct {
	Run   PipelineRun    `json:"run"`
	Jobs  []PipelineJob  `json:"jobs"`
	Steps []PipelineStep `json:"steps"`
}

type PipelineDeletionRefs struct {
	RunIDs    []string
	Artifacts []PipelineArtifact
}

func (s *Store) CreatePipeline(ctx context.Context, pipeline Pipeline) (*Pipeline, error) {
	row := s.pool.QueryRow(
		ctx,
		`insert into pipelines
		 (org_id, project_id, name, description, is_active, trigger_schedule, last_scheduled_at, next_scheduled_at, created_by, created_at, updated_at)
		 values ($1,$2,$3,$4,true,null,null,null,$5,now(),now())
		 returning id, org_id, project_id, name, description, is_active, current_version_id,
		           concurrency_mode, trigger_schedule, last_scheduled_at, next_scheduled_at, created_by, created_at, updated_at,
		           coalesce((select default_branch from code_projects where id = $2), 'main') as project_default_branch`,
		pipeline.OrgID,
		nullIfEmptyPtr(pipeline.ProjectID),
		pipeline.Name,
		nullIfEmpty(pipeline.Description),
		nullIfEmptyPtr(pipeline.CreatedBy),
	)

	var projectID pgtype.UUID
	var currentVersion pgtype.UUID
	var triggerSchedule pgtype.Text
	var lastScheduledAt pgtype.Timestamptz
	var nextScheduledAt pgtype.Timestamptz
	var createdBy pgtype.UUID
	var desc pgtype.Text
	var projectDefaultBranch string
	var out Pipeline
	if err := row.Scan(
		&out.ID,
		&out.OrgID,
		&projectID,
		&out.Name,
		&desc,
		&out.IsActive,
		&currentVersion,
		&out.ConcurrencyMode,
		&triggerSchedule,
		&lastScheduledAt,
		&nextScheduledAt,
		&createdBy,
		&out.CreatedAt,
		&out.UpdatedAt,
		&projectDefaultBranch,
	); err != nil {
		return nil, err
	}
	if projectID.Valid {
		val := projectID.String()
		out.ProjectID = &val
	}
	if desc.Valid {
		out.Description = desc.String
	}
	if currentVersion.Valid {
		val := currentVersion.String()
		out.CurrentVersionID = &val
	}
	if createdBy.Valid {
		val := createdBy.String()
		out.CreatedBy = &val
	}
	if triggerSchedule.Valid {
		val := triggerSchedule.String
		out.TriggerSchedule = &val
	}
	if lastScheduledAt.Valid {
		out.LastScheduledAt = &lastScheduledAt.Time
	}
	if nextScheduledAt.Valid {
		out.NextScheduledAt = &nextScheduledAt.Time
	}
	out.SourceBranch = normalizeSourceValue(projectDefaultBranch, "main")
	out.SourceBranchSource = "project_default"
	return &out, nil
}

func (s *Store) UpdatePipelineMetadata(
	ctx context.Context,
	pipelineID string,
	name string,
	description string,
) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipelines
		 set name=coalesce($2, name),
		     description=coalesce($3, description),
		     updated_at=now()
		 where id=$1`,
		pipelineID,
		nullIfEmpty(name),
		nullIfEmpty(description),
	)
	return err
}

func (s *Store) UpdatePipelineSchedule(
	ctx context.Context,
	pipelineID string,
	triggerSchedule *string,
	nextScheduledAt *time.Time,
	lastScheduledAt *time.Time,
) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipelines
		 set trigger_schedule=$2,
		     next_scheduled_at=$3,
		     last_scheduled_at=coalesce($4, last_scheduled_at),
		     updated_at=now()
		 where id=$1`,
		pipelineID,
		nullIfEmptyPtr(triggerSchedule),
		nextScheduledAt,
		lastScheduledAt,
	)
	return err
}

func (s *Store) CreatePipelineVersion(ctx context.Context, pipelineID string, version int, config json.RawMessage, createdBy string) (*PipelineVersion, error) {
	row := s.pool.QueryRow(
		ctx,
		`insert into pipeline_versions (pipeline_id, version, config, created_by, created_at)
		 values ($1,$2,$3,$4,now())
		 returning id, pipeline_id, version, config, created_by, created_at`,
		pipelineID,
		version,
		config,
		nullIfEmpty(createdBy),
	)

	var createdByUUID pgtype.UUID
	var out PipelineVersion
	if err := row.Scan(
		&out.ID,
		&out.PipelineID,
		&out.Version,
		&out.Config,
		&createdByUUID,
		&out.CreatedAt,
	); err != nil {
		return nil, err
	}
	if createdByUUID.Valid {
		val := createdByUUID.String()
		out.CreatedBy = &val
	}
	return &out, nil
}

func (s *Store) SetPipelineCurrentVersion(ctx context.Context, pipelineID string, versionID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipelines set current_version_id=$2, updated_at=now() where id=$1`,
		pipelineID,
		versionID,
	)
	return err
}

func (s *Store) GetPipeline(ctx context.Context, pipelineID string) (*Pipeline, error) {
	row := s.pool.QueryRow(
		ctx,
		`select p.id, p.org_id, p.project_id, p.name, p.description, p.is_active, p.current_version_id,
		        p.concurrency_mode, p.trigger_schedule, p.last_scheduled_at, p.next_scheduled_at, p.created_by, p.created_at, p.updated_at,
		        coalesce((select max(version) from pipeline_versions where pipeline_id=p.id), 0) as latest_version,
		        coalesce(cp.default_branch, 'main') as project_default_branch,
		        cv.config as current_config
		 from pipelines p
		 left join code_projects cp on cp.id = p.project_id
		 left join pipeline_versions cv on cv.id = p.current_version_id
		 where p.id=$1`,
		pipelineID,
	)

	var currentVersion pgtype.UUID
	var createdBy pgtype.UUID
	var desc pgtype.Text
	var projectID pgtype.UUID
	var triggerSchedule pgtype.Text
	var lastScheduledAt pgtype.Timestamptz
	var nextScheduledAt pgtype.Timestamptz
	var projectDefaultBranch string
	var currentConfig json.RawMessage
	var out Pipeline
	if err := row.Scan(
		&out.ID,
		&out.OrgID,
		&projectID,
		&out.Name,
		&desc,
		&out.IsActive,
		&currentVersion,
		&out.ConcurrencyMode,
		&triggerSchedule,
		&lastScheduledAt,
		&nextScheduledAt,
		&createdBy,
		&out.CreatedAt,
		&out.UpdatedAt,
		&out.LatestVersion,
		&projectDefaultBranch,
		&currentConfig,
	); err != nil {
		return nil, err
	}
	if projectID.Valid {
		val := projectID.String()
		out.ProjectID = &val
	}
	if desc.Valid {
		out.Description = desc.String
	}
	if currentVersion.Valid {
		val := currentVersion.String()
		out.CurrentVersionID = &val
	}
	if createdBy.Valid {
		val := createdBy.String()
		out.CreatedBy = &val
	}
	if triggerSchedule.Valid {
		val := triggerSchedule.String
		out.TriggerSchedule = &val
	}
	if lastScheduledAt.Valid {
		out.LastScheduledAt = &lastScheduledAt.Time
	}
	if nextScheduledAt.Valid {
		out.NextScheduledAt = &nextScheduledAt.Time
	}
	branch, origin := deriveSourceBranch(currentConfig, projectDefaultBranch)
	out.SourceBranch = branch
	out.SourceBranchSource = origin
	return &out, nil
}

func (s *Store) GetPipelineWithCurrentVersion(ctx context.Context, pipelineID string) (*Pipeline, *PipelineVersion, error) {
	pipeline, err := s.GetPipeline(ctx, pipelineID)
	if err != nil {
		return nil, nil, err
	}
	if pipeline == nil || pipeline.CurrentVersionID == nil {
		return pipeline, nil, nil
	}
	version, err := s.GetPipelineVersion(ctx, *pipeline.CurrentVersionID)
	if err != nil {
		return pipeline, nil, err
	}
	return pipeline, version, nil
}

func (s *Store) ListDueScheduledPipelines(ctx context.Context, limit int) ([]Pipeline, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := s.pool.Query(
		ctx,
		`select p.id, p.org_id, p.project_id, p.name, p.description, p.is_active, p.current_version_id,
		        p.concurrency_mode, p.trigger_schedule, p.last_scheduled_at, p.next_scheduled_at, p.created_by, p.created_at, p.updated_at
		 from pipelines p
		 where p.is_active = true
		   and p.trigger_schedule is not null
		   and p.next_scheduled_at is not null
		   and p.next_scheduled_at <= now()
		 order by p.next_scheduled_at asc
		 limit $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Pipeline
	for rows.Next() {
		var currentVersion pgtype.UUID
		var createdBy pgtype.UUID
		var desc pgtype.Text
		var projectID pgtype.UUID
		var triggerSchedule pgtype.Text
		var lastScheduledAt pgtype.Timestamptz
		var nextScheduledAt pgtype.Timestamptz
		var item Pipeline
		if err := rows.Scan(
			&item.ID,
			&item.OrgID,
			&projectID,
			&item.Name,
			&desc,
			&item.IsActive,
			&currentVersion,
			&item.ConcurrencyMode,
			&triggerSchedule,
			&lastScheduledAt,
			&nextScheduledAt,
			&createdBy,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if projectID.Valid {
			val := projectID.String()
			item.ProjectID = &val
		}
		if desc.Valid {
			item.Description = desc.String
		}
		if currentVersion.Valid {
			val := currentVersion.String()
			item.CurrentVersionID = &val
		}
		if createdBy.Valid {
			val := createdBy.String()
			item.CreatedBy = &val
		}
		if triggerSchedule.Valid {
			val := triggerSchedule.String
			item.TriggerSchedule = &val
		}
		if lastScheduledAt.Valid {
			item.LastScheduledAt = &lastScheduledAt.Time
		}
		if nextScheduledAt.Valid {
			item.NextScheduledAt = &nextScheduledAt.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListPipelineSecrets(ctx context.Context, pipelineID string) ([]PipelineSecret, error) {
	rows, err := s.pool.Query(
		ctx,
		`select name, value_encrypted, created_at, updated_at
     from pipeline_secrets
     where pipeline_id=$1
     order by name asc`,
		pipelineID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PipelineSecret
	for rows.Next() {
		var row PipelineSecret
		if err := rows.Scan(&row.Name, &row.ValueEncrypted, &row.CreatedAt, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Store) GetPipelineVersion(ctx context.Context, versionID string) (*PipelineVersion, error) {
	row := s.pool.QueryRow(
		ctx,
		`select id, pipeline_id, version, config, created_by, created_at
     from pipeline_versions where id=$1`,
		versionID,
	)

	var createdBy pgtype.UUID
	var out PipelineVersion
	if err := row.Scan(
		&out.ID,
		&out.PipelineID,
		&out.Version,
		&out.Config,
		&createdBy,
		&out.CreatedAt,
	); err != nil {
		return nil, err
	}
	if createdBy.Valid {
		val := createdBy.String()
		out.CreatedBy = &val
	}
	return &out, nil
}

func (s *Store) ListPipelines(ctx context.Context, orgID string, projectID *string) ([]Pipeline, error) {
	var (
		rows pgx.Rows
		err  error
	)
	selectCols := `p.id, p.org_id, p.project_id, p.name, p.description, p.is_active, p.current_version_id,
		        p.concurrency_mode, p.trigger_schedule, p.last_scheduled_at, p.next_scheduled_at, p.created_by, p.created_at, p.updated_at,
		        coalesce((select max(version) from pipeline_versions where pipeline_id=p.id), 0) as latest_version,
		        coalesce(cp.default_branch, 'main') as project_default_branch,
		        cv.config as current_config`
	if projectID != nil && *projectID != "" {
		rows, err = s.pool.Query(
			ctx,
			`select `+selectCols+`
			 from pipelines p
			 left join code_projects cp on cp.id = p.project_id
			 left join pipeline_versions cv on cv.id = p.current_version_id
			 where p.org_id=$1 and p.project_id=$2
			 order by p.updated_at desc`,
			orgID,
			*projectID,
		)
	} else {
		rows, err = s.pool.Query(
			ctx,
			`select `+selectCols+`
			 from pipelines p
			 left join code_projects cp on cp.id = p.project_id
			 left join pipeline_versions cv on cv.id = p.current_version_id
			 where p.org_id=$1
			 order by p.updated_at desc`,
			orgID,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Pipeline
	for rows.Next() {
		var currentVersion pgtype.UUID
		var createdBy pgtype.UUID
		var desc pgtype.Text
		var pID pgtype.UUID
		var triggerSchedule pgtype.Text
		var lastScheduledAt pgtype.Timestamptz
		var nextScheduledAt pgtype.Timestamptz
		var projectDefaultBranch string
		var currentConfig json.RawMessage
		var item Pipeline
		if err := rows.Scan(
			&item.ID,
			&item.OrgID,
			&pID,
			&item.Name,
			&desc,
			&item.IsActive,
			&currentVersion,
			&item.ConcurrencyMode,
			&triggerSchedule,
			&lastScheduledAt,
			&nextScheduledAt,
			&createdBy,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.LatestVersion,
			&projectDefaultBranch,
			&currentConfig,
		); err != nil {
			return nil, err
		}
		if pID.Valid {
			val := pID.String()
			item.ProjectID = &val
		}
		if desc.Valid {
			item.Description = desc.String
		}
		if currentVersion.Valid {
			val := currentVersion.String()
			item.CurrentVersionID = &val
		}
		if createdBy.Valid {
			val := createdBy.String()
			item.CreatedBy = &val
		}
		if triggerSchedule.Valid {
			val := triggerSchedule.String
			item.TriggerSchedule = &val
		}
		if lastScheduledAt.Valid {
			item.LastScheduledAt = &lastScheduledAt.Time
		}
		if nextScheduledAt.Valid {
			item.NextScheduledAt = &nextScheduledAt.Time
		}
		branch, origin := deriveSourceBranch(currentConfig, projectDefaultBranch)
		item.SourceBranch = branch
		item.SourceBranchSource = origin
		items = append(items, item)
	}
	return items, nil
}

func (s *Store) DeletePipeline(ctx context.Context, pipelineID string) (*PipelineDeletionRefs, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var lockedPipelineID string
	if err := tx.QueryRow(
		ctx,
		`select id
		 from pipelines
		 where id = $1
		 for update`,
		pipelineID,
	).Scan(&lockedPipelineID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	var activeRunCount int
	if err := tx.QueryRow(
		ctx,
		`select count(*)
		 from pipeline_runs
		 where pipeline_id = $1
		   and status in ('queued', 'running', 'waiting_manual')`,
		pipelineID,
	).Scan(&activeRunCount); err != nil {
		return nil, err
	}
	if activeRunCount > 0 {
		return nil, fmt.Errorf("pipeline has active runs; cancel or wait for them to finish before deleting")
	}

	runRows, err := tx.Query(
		ctx,
		`select id
		 from pipeline_runs
		 where pipeline_id = $1`,
		pipelineID,
	)
	if err != nil {
		return nil, err
	}
	runIDs := make([]string, 0)
	for runRows.Next() {
		var runID string
		if err := runRows.Scan(&runID); err != nil {
			runRows.Close()
			return nil, err
		}
		runIDs = append(runIDs, runID)
	}
	if err := runRows.Err(); err != nil {
		runRows.Close()
		return nil, err
	}
	runRows.Close()

	artifactRows, err := tx.Query(
		ctx,
		`select a.id, r.org_id, a.run_id, a.job_id, a.step_id, a.path, a.storage_path, a.size_bytes, a.sha256, a.created_at, a.expires_at
		 from pipeline_artifacts a
		 join pipeline_runs r on r.id = a.run_id
		 where r.pipeline_id = $1`,
		pipelineID,
	)
	if err != nil {
		return nil, err
	}
	artifacts := make([]PipelineArtifact, 0)
	for artifactRows.Next() {
		var artifact PipelineArtifact
		var jobID pgtype.UUID
		var stepID pgtype.UUID
		var sha pgtype.Text
		var createdAt pgtype.Timestamptz
		var expiresAt pgtype.Timestamptz
		if err := artifactRows.Scan(
			&artifact.ID,
			&artifact.OrgID,
			&artifact.RunID,
			&jobID,
			&stepID,
			&artifact.Path,
			&artifact.StoragePath,
			&artifact.SizeBytes,
			&sha,
			&createdAt,
			&expiresAt,
		); err != nil {
			artifactRows.Close()
			return nil, err
		}
		if jobID.Valid {
			artifact.JobID = jobID.String()
		}
		if stepID.Valid {
			artifact.StepID = stepID.String()
		}
		if sha.Valid {
			artifact.Sha256 = sha.String
		}
		if createdAt.Valid {
			value := createdAt.Time
			artifact.CreatedAt = &value
		}
		if expiresAt.Valid {
			value := expiresAt.Time
			artifact.ExpiresAt = &value
		}
		artifacts = append(artifacts, artifact)
	}
	if err := artifactRows.Err(); err != nil {
		artifactRows.Close()
		return nil, err
	}
	artifactRows.Close()

	cmdTag, err := tx.Exec(
		ctx,
		`delete from pipelines where id = $1`,
		pipelineID,
	)
	if err != nil {
		return nil, err
	}
	if cmdTag.RowsAffected() == 0 {
		return nil, nil
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &PipelineDeletionRefs{
		RunIDs:    runIDs,
		Artifacts: artifacts,
	}, nil
}

type sourceBranchJob struct {
	Type   string `json:"type"`
	Branch string `json:"branch"`
}

type sourceBranchConfig struct {
	Jobs []sourceBranchJob `json:"jobs"`
}

func normalizeSourceValue(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	fallback = strings.TrimSpace(fallback)
	if fallback != "" {
		return fallback
	}
	return "main"
}

func deriveSourceBranch(config json.RawMessage, projectDefaultBranch string) (string, string) {
	defaultBranch := normalizeSourceValue(projectDefaultBranch, "main")
	if len(config) == 0 {
		return defaultBranch, "project_default"
	}

	var parsed sourceBranchConfig
	if err := json.Unmarshal(config, &parsed); err != nil {
		return defaultBranch, "project_default"
	}

	for _, job := range parsed.Jobs {
		if strings.TrimSpace(strings.ToLower(job.Type)) != "source_checkout" {
			continue
		}
		branch := normalizeSourceValue(job.Branch, defaultBranch)
		if branch == defaultBranch {
			return branch, "project_default"
		}
		return branch, "custom"
	}

	return defaultBranch, "project_default"
}

func (s *Store) CreatePipelineRun(ctx context.Context, run PipelineRun) (*PipelineRun, error) {
	meta := run.Metadata
	row := s.pool.QueryRow(
		ctx,
		`with inserted as (
		  insert into pipeline_runs
		   (pipeline_id, version_id, org_id, project_id, status, trigger_type, triggered_by, idempotency_key, rollback_of, attempt, error_code, error_message, metadata, created_at, updated_at)
		   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())
		   on conflict (pipeline_id, idempotency_key) where idempotency_key is not null do nothing
		   returning id, pipeline_id, version_id, org_id, project_id, status, trigger_type, triggered_by, idempotency_key, rollback_of, attempt, error_code, error_message, metadata, created_at, started_at, finished_at, updated_at
		)
		select id, pipeline_id, version_id, org_id, project_id, status, trigger_type, triggered_by, idempotency_key, rollback_of, attempt, error_code, error_message, metadata, created_at, started_at, finished_at, updated_at
		  from inserted
		union all
		select id, pipeline_id, version_id, org_id, project_id, status, trigger_type, triggered_by, idempotency_key, rollback_of, attempt, error_code, error_message, metadata, created_at, started_at, finished_at, updated_at
		  from pipeline_runs
		 where $8 is not null
		   and pipeline_id = $1
		   and idempotency_key = $8
		   and not exists (select 1 from inserted)
		 limit 1`,
		run.PipelineID,
		run.VersionID,
		run.OrgID,
		nullIfEmptyPtr(run.ProjectID),
		run.Status,
		run.TriggerType,
		nullIfEmptyPtr(run.TriggeredBy),
		nullIfEmptyPtr(run.IdempotencyKey),
		nullIfEmptyPtr(run.RollbackOf),
		run.Attempt,
		nullIfEmptyPtr(run.ErrorCode),
		nullIfEmptyPtr(run.ErrorMessage),
		meta,
	)

	var projectID pgtype.UUID
	var triggeredBy pgtype.UUID
	var idempotency pgtype.Text
	var rollbackOf pgtype.UUID
	var errorCode pgtype.Text
	var errorMessage pgtype.Text
	var startedAt pgtype.Timestamptz
	var finishedAt pgtype.Timestamptz
	var out PipelineRun
	if err := row.Scan(
		&out.ID,
		&out.PipelineID,
		&out.VersionID,
		&out.OrgID,
		&projectID,
		&out.Status,
		&out.TriggerType,
		&triggeredBy,
		&idempotency,
		&rollbackOf,
		&out.Attempt,
		&errorCode,
		&errorMessage,
		&out.Metadata,
		&out.CreatedAt,
		&startedAt,
		&finishedAt,
		&out.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if projectID.Valid {
		val := projectID.String()
		out.ProjectID = &val
	}
	if triggeredBy.Valid {
		val := triggeredBy.String()
		out.TriggeredBy = &val
	}
	if idempotency.Valid {
		val := idempotency.String
		out.IdempotencyKey = &val
	}
	if rollbackOf.Valid {
		val := rollbackOf.String()
		out.RollbackOf = &val
	}
	if errorCode.Valid {
		val := errorCode.String
		out.ErrorCode = &val
	}
	if errorMessage.Valid {
		val := errorMessage.String
		out.ErrorMessage = &val
	}
	if startedAt.Valid {
		out.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		out.FinishedAt = &finishedAt.Time
	}
	return &out, nil
}

func (s *Store) GetPipelineRunWithVersion(ctx context.Context, runID string) (*PipelineRun, *PipelineVersion, error) {
	row := s.pool.QueryRow(
		ctx,
		`select r.id, r.pipeline_id, r.version_id, r.org_id, r.project_id, r.status, r.trigger_type, r.triggered_by, r.idempotency_key, r.attempt,
		        r.error_code, r.error_message, r.metadata, r.created_at, r.started_at, r.finished_at, r.updated_at,
		        v.id, v.pipeline_id, v.version, v.config, v.created_by, v.created_at
		 from pipeline_runs r
		 join pipeline_versions v on v.id = r.version_id
		 where r.id=$1`,
		runID,
	)

	var projectID pgtype.UUID
	var triggeredBy pgtype.UUID
	var idempotency pgtype.Text
	var errorCode pgtype.Text
	var errorMessage pgtype.Text
	var startedAt pgtype.Timestamptz
	var finishedAt pgtype.Timestamptz
	var run PipelineRun
	var version PipelineVersion
	var createdBy pgtype.UUID

	if err := row.Scan(
		&run.ID,
		&run.PipelineID,
		&run.VersionID,
		&run.OrgID,
		&projectID,
		&run.Status,
		&run.TriggerType,
		&triggeredBy,
		&idempotency,
		&run.Attempt,
		&errorCode,
		&errorMessage,
		&run.Metadata,
		&run.CreatedAt,
		&startedAt,
		&finishedAt,
		&run.UpdatedAt,
		&version.ID,
		&version.PipelineID,
		&version.Version,
		&version.Config,
		&createdBy,
		&version.CreatedAt,
	); err != nil {
		return nil, nil, err
	}
	if projectID.Valid {
		val := projectID.String()
		run.ProjectID = &val
	}
	if triggeredBy.Valid {
		val := triggeredBy.String()
		run.TriggeredBy = &val
	}
	if idempotency.Valid {
		val := idempotency.String
		run.IdempotencyKey = &val
	}
	if errorCode.Valid {
		val := errorCode.String
		run.ErrorCode = &val
	}
	if errorMessage.Valid {
		val := errorMessage.String
		run.ErrorMessage = &val
	}
	if startedAt.Valid {
		run.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		run.FinishedAt = &finishedAt.Time
	}
	if createdBy.Valid {
		val := createdBy.String()
		version.CreatedBy = &val
	}
	return &run, &version, nil
}

func (s *Store) ClaimQueuedPipelineRuns(ctx context.Context, limit int) ([]PipelineRun, error) {
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
		     from pipeline_runs
		    where status = 'queued'
		    order by created_at asc
		    for update skip locked
		    limit $1
		 )
		 update pipeline_runs r
		    set status = 'running',
		        error_message = null,
		        started_at = coalesce(started_at, now()),
		        updated_at = now()
		   from claimed
		  where r.id = claimed.id
		  returning r.id, r.pipeline_id, r.version_id, r.org_id, r.project_id, r.status, r.trigger_type,
		            r.triggered_by, r.idempotency_key, r.rollback_of, r.attempt, r.error_code, r.error_message,
		            r.metadata, r.created_at, r.started_at, r.finished_at, r.updated_at`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	claimed := make([]PipelineRun, 0, limit)
	for rows.Next() {
		var run PipelineRun
		var projectID pgtype.UUID
		var triggeredBy pgtype.UUID
		var idempotency pgtype.Text
		var rollbackOf pgtype.UUID
		var errorCode pgtype.Text
		var errorMessage pgtype.Text
		var startedAt pgtype.Timestamptz
		var finishedAt pgtype.Timestamptz
		if err := rows.Scan(
			&run.ID,
			&run.PipelineID,
			&run.VersionID,
			&run.OrgID,
			&projectID,
			&run.Status,
			&run.TriggerType,
			&triggeredBy,
			&idempotency,
			&rollbackOf,
			&run.Attempt,
			&errorCode,
			&errorMessage,
			&run.Metadata,
			&run.CreatedAt,
			&startedAt,
			&finishedAt,
			&run.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if projectID.Valid {
			value := projectID.String()
			run.ProjectID = &value
		}
		if triggeredBy.Valid {
			value := triggeredBy.String()
			run.TriggeredBy = &value
		}
		if idempotency.Valid {
			value := idempotency.String
			run.IdempotencyKey = &value
		}
		if rollbackOf.Valid {
			value := rollbackOf.String()
			run.RollbackOf = &value
		}
		if errorCode.Valid {
			value := errorCode.String
			run.ErrorCode = &value
		}
		if errorMessage.Valid {
			value := errorMessage.String
			run.ErrorMessage = &value
		}
		if startedAt.Valid {
			run.StartedAt = &startedAt.Time
		}
		if finishedAt.Valid {
			run.FinishedAt = &finishedAt.Time
		}
		claimed = append(claimed, run)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return claimed, nil
}

func (s *Store) GetPipelineRun(ctx context.Context, runID string) (*PipelineRun, error) {
	row := s.pool.QueryRow(
		ctx,
		`select id, pipeline_id, version_id, org_id, project_id, status, trigger_type, triggered_by, idempotency_key, rollback_of, attempt,
		        error_code, error_message, metadata, created_at, started_at, finished_at, updated_at
		 from pipeline_runs
		 where id=$1`,
		runID,
	)

	var run PipelineRun
	var projectID pgtype.UUID
	var triggeredBy pgtype.UUID
	var idempotency pgtype.Text
	var rollbackOf pgtype.UUID
	var errorCode pgtype.Text
	var errorMessage pgtype.Text
	var metadata []byte
	if err := row.Scan(
		&run.ID,
		&run.PipelineID,
		&run.VersionID,
		&run.OrgID,
		&projectID,
		&run.Status,
		&run.TriggerType,
		&triggeredBy,
		&idempotency,
		&rollbackOf,
		&run.Attempt,
		&errorCode,
		&errorMessage,
		&metadata,
		&run.CreatedAt,
		&run.StartedAt,
		&run.FinishedAt,
		&run.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if projectID.Valid {
		value := projectID.String()
		run.ProjectID = &value
	}
	if triggeredBy.Valid {
		value := triggeredBy.String()
		run.TriggeredBy = &value
	}
	if idempotency.Valid {
		value := idempotency.String
		run.IdempotencyKey = &value
	}
	if rollbackOf.Valid {
		value := rollbackOf.String()
		run.RollbackOf = &value
	}
	if errorCode.Valid {
		value := errorCode.String
		run.ErrorCode = &value
	}
	if errorMessage.Valid {
		value := errorMessage.String
		run.ErrorMessage = &value
	}
	if len(metadata) > 0 {
		run.Metadata = metadata
	}
	return &run, nil
}

func (s *Store) ListPipelineRuns(ctx context.Context, pipelineID string, limit int) ([]PipelineRun, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.pool.Query(
		ctx,
		`select id, pipeline_id, version_id, org_id, project_id, status, trigger_type, triggered_by, idempotency_key, attempt,
		        error_code, error_message, metadata, created_at, started_at, finished_at, updated_at
		 from pipeline_runs
		 where pipeline_id=$1
		 order by created_at desc
		 limit $2`,
		pipelineID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []PipelineRun
	for rows.Next() {
		var projectID pgtype.UUID
		var triggeredBy pgtype.UUID
		var idempotency pgtype.Text
		var errorCode pgtype.Text
		var errorMessage pgtype.Text
		var startedAt pgtype.Timestamptz
		var finishedAt pgtype.Timestamptz
		var run PipelineRun

		if err := rows.Scan(
			&run.ID,
			&run.PipelineID,
			&run.VersionID,
			&run.OrgID,
			&projectID,
			&run.Status,
			&run.TriggerType,
			&triggeredBy,
			&idempotency,
			&run.Attempt,
			&errorCode,
			&errorMessage,
			&run.Metadata,
			&run.CreatedAt,
			&startedAt,
			&finishedAt,
			&run.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if projectID.Valid {
			val := projectID.String()
			run.ProjectID = &val
		}
		if triggeredBy.Valid {
			val := triggeredBy.String()
			run.TriggeredBy = &val
		}
		if idempotency.Valid {
			val := idempotency.String
			run.IdempotencyKey = &val
		}
		if errorCode.Valid {
			val := errorCode.String
			run.ErrorCode = &val
		}
		if errorMessage.Valid {
			val := errorMessage.String
			run.ErrorMessage = &val
		}
		if startedAt.Valid {
			run.StartedAt = &startedAt.Time
		}
		if finishedAt.Valid {
			run.FinishedAt = &finishedAt.Time
		}
		items = append(items, run)
	}
	return items, nil
}

func (s *Store) GetPipelineRunDetail(ctx context.Context, runID string) (*PipelineRunDetail, error) {
	run, _, err := s.GetPipelineRunWithVersion(ctx, runID)
	if err != nil {
		return nil, err
	}

	jobs, err := s.ListPipelineJobs(ctx, runID)
	if err != nil {
		return nil, err
	}

	var steps []PipelineStep
	for _, job := range jobs {
		jobSteps, err := s.ListPipelineSteps(ctx, job.ID)
		if err != nil {
			return nil, err
		}
		steps = append(steps, jobSteps...)
	}

	return &PipelineRunDetail{
		Run:   *run,
		Jobs:  jobs,
		Steps: steps,
	}, nil
}

func (s *Store) ListPipelineJobs(ctx context.Context, runID string) ([]PipelineJob, error) {
	rows, err := s.pool.Query(
		ctx,
		`select id, run_id, job_key, name, status, attempt, worker_id, error_message, duration_ms, created_at, started_at, finished_at, updated_at
		 from pipeline_jobs where run_id=$1 order by created_at asc`,
		runID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []PipelineJob
	for rows.Next() {
		var workerID pgtype.Text
		var errorMessage pgtype.Text
		var duration pgtype.Int4
		var startedAt pgtype.Timestamptz
		var finishedAt pgtype.Timestamptz
		var job PipelineJob
		if err := rows.Scan(
			&job.ID,
			&job.RunID,
			&job.JobKey,
			&job.Name,
			&job.Status,
			&job.Attempt,
			&workerID,
			&errorMessage,
			&duration,
			&job.CreatedAt,
			&startedAt,
			&finishedAt,
			&job.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if workerID.Valid {
			val := workerID.String
			job.WorkerID = &val
		}
		if errorMessage.Valid {
			val := errorMessage.String
			job.ErrorMessage = &val
		}
		if duration.Valid {
			val := int(duration.Int32)
			job.DurationMs = &val
		}
		if startedAt.Valid {
			job.StartedAt = &startedAt.Time
		}
		if finishedAt.Valid {
			job.FinishedAt = &finishedAt.Time
		}
		jobs = append(jobs, job)
	}
	return jobs, nil
}

func (s *Store) ListPipelineSteps(ctx context.Context, jobID string) ([]PipelineStep, error) {
	rows, err := s.pool.Query(
		ctx,
		`select id, job_id, step_key, name, status, exit_code, timeout_ms, duration_ms, error_message, log_path, created_at, started_at, finished_at, updated_at
		 from pipeline_steps where job_id=$1 order by created_at asc`,
		jobID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var steps []PipelineStep
	for rows.Next() {
		var exitCode pgtype.Int4
		var timeout pgtype.Int4
		var duration pgtype.Int4
		var errorMessage pgtype.Text
		var logPath pgtype.Text
		var startedAt pgtype.Timestamptz
		var finishedAt pgtype.Timestamptz
		var step PipelineStep
		if err := rows.Scan(
			&step.ID,
			&step.JobID,
			&step.StepKey,
			&step.Name,
			&step.Status,
			&exitCode,
			&timeout,
			&duration,
			&errorMessage,
			&logPath,
			&step.CreatedAt,
			&startedAt,
			&finishedAt,
			&step.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if exitCode.Valid {
			val := int(exitCode.Int32)
			step.ExitCode = &val
		}
		if timeout.Valid {
			val := int(timeout.Int32)
			step.TimeoutMs = &val
		}
		if duration.Valid {
			val := int(duration.Int32)
			step.DurationMs = &val
		}
		if errorMessage.Valid {
			val := errorMessage.String
			step.ErrorMessage = &val
		}
		if logPath.Valid {
			val := logPath.String
			step.LogPath = &val
		}
		if startedAt.Valid {
			step.StartedAt = &startedAt.Time
		}
		if finishedAt.Valid {
			step.FinishedAt = &finishedAt.Time
		}
		steps = append(steps, step)
	}
	return steps, nil
}

func (s *Store) GetPipelineStepByKey(ctx context.Context, jobID string, stepKey string) (PipelineStep, error) {
	row := s.pool.QueryRow(
		ctx,
		`select id, job_id, step_key, name, status, exit_code, timeout_ms, duration_ms, error_message, log_path, created_at, started_at, finished_at, updated_at
		 from pipeline_steps where job_id=$1 and step_key=$2`,
		jobID,
		stepKey,
	)
	var exitCode pgtype.Int4
	var timeout pgtype.Int4
	var duration pgtype.Int4
	var errorMessage pgtype.Text
	var logPath pgtype.Text
	var startedAt pgtype.Timestamptz
	var finishedAt pgtype.Timestamptz
	var step PipelineStep
	if err := row.Scan(
		&step.ID,
		&step.JobID,
		&step.StepKey,
		&step.Name,
		&step.Status,
		&exitCode,
		&timeout,
		&duration,
		&errorMessage,
		&logPath,
		&step.CreatedAt,
		&startedAt,
		&finishedAt,
		&step.UpdatedAt,
	); err != nil {
		return PipelineStep{}, err
	}
	if exitCode.Valid {
		val := int(exitCode.Int32)
		step.ExitCode = &val
	}
	if timeout.Valid {
		val := int(timeout.Int32)
		step.TimeoutMs = &val
	}
	if duration.Valid {
		val := int(duration.Int32)
		step.DurationMs = &val
	}
	if errorMessage.Valid {
		val := errorMessage.String
		step.ErrorMessage = &val
	}
	if logPath.Valid {
		val := logPath.String
		step.LogPath = &val
	}
	if startedAt.Valid {
		step.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		step.FinishedAt = &finishedAt.Time
	}
	return step, nil
}

func (s *Store) GetPipelineStep(ctx context.Context, stepID string) (*PipelineStep, error) {
	row := s.pool.QueryRow(
		ctx,
		`select id, job_id, step_key, name, status, exit_code, timeout_ms, duration_ms, error_message, log_path, created_at, started_at, finished_at, updated_at
		 from pipeline_steps where id=$1`,
		stepID,
	)
	var exitCode pgtype.Int4
	var timeout pgtype.Int4
	var duration pgtype.Int4
	var errorMessage pgtype.Text
	var logPath pgtype.Text
	var startedAt pgtype.Timestamptz
	var finishedAt pgtype.Timestamptz
	var step PipelineStep
	if err := row.Scan(
		&step.ID,
		&step.JobID,
		&step.StepKey,
		&step.Name,
		&step.Status,
		&exitCode,
		&timeout,
		&duration,
		&errorMessage,
		&logPath,
		&step.CreatedAt,
		&startedAt,
		&finishedAt,
		&step.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if exitCode.Valid {
		val := int(exitCode.Int32)
		step.ExitCode = &val
	}
	if timeout.Valid {
		val := int(timeout.Int32)
		step.TimeoutMs = &val
	}
	if duration.Valid {
		val := int(duration.Int32)
		step.DurationMs = &val
	}
	if errorMessage.Valid {
		val := errorMessage.String
		step.ErrorMessage = &val
	}
	if logPath.Valid {
		val := logPath.String
		step.LogPath = &val
	}
	if startedAt.Valid {
		step.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		step.FinishedAt = &finishedAt.Time
	}
	return &step, nil
}

func (s *Store) CreatePipelineJob(ctx context.Context, runID string, jobKey string, name string) (PipelineJob, error) {
	row := s.pool.QueryRow(
		ctx,
		`insert into pipeline_jobs (run_id, job_key, name, status, attempt, created_at, updated_at)
		 values ($1,$2,$3,'queued',1,now(),now())
		 returning id, run_id, job_key, name, status, attempt, worker_id, error_message, duration_ms, created_at, started_at, finished_at, updated_at`,
		runID,
		jobKey,
		name,
	)

	var workerID pgtype.Text
	var errorMessage pgtype.Text
	var duration pgtype.Int4
	var startedAt pgtype.Timestamptz
	var finishedAt pgtype.Timestamptz
	var job PipelineJob
	if err := row.Scan(
		&job.ID,
		&job.RunID,
		&job.JobKey,
		&job.Name,
		&job.Status,
		&job.Attempt,
		&workerID,
		&errorMessage,
		&duration,
		&job.CreatedAt,
		&startedAt,
		&finishedAt,
		&job.UpdatedAt,
	); err != nil {
		return PipelineJob{}, err
	}
	if workerID.Valid {
		val := workerID.String
		job.WorkerID = &val
	}
	if errorMessage.Valid {
		val := errorMessage.String
		job.ErrorMessage = &val
	}
	if duration.Valid {
		val := int(duration.Int32)
		job.DurationMs = &val
	}
	if startedAt.Valid {
		job.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		job.FinishedAt = &finishedAt.Time
	}
	return job, nil
}

func (s *Store) CreatePipelineStep(ctx context.Context, jobID string, stepKey string, name string) (PipelineStep, error) {
	row := s.pool.QueryRow(
		ctx,
		`insert into pipeline_steps (job_id, step_key, name, status, created_at, updated_at)
		 values ($1,$2,$3,'queued',now(),now())
		 returning id, job_id, step_key, name, status, exit_code, timeout_ms, duration_ms, error_message, log_path, created_at, started_at, finished_at, updated_at`,
		jobID,
		stepKey,
		name,
	)

	var exitCode pgtype.Int4
	var timeout pgtype.Int4
	var duration pgtype.Int4
	var errorMessage pgtype.Text
	var logPath pgtype.Text
	var startedAt pgtype.Timestamptz
	var finishedAt pgtype.Timestamptz
	var step PipelineStep
	if err := row.Scan(
		&step.ID,
		&step.JobID,
		&step.StepKey,
		&step.Name,
		&step.Status,
		&exitCode,
		&timeout,
		&duration,
		&errorMessage,
		&logPath,
		&step.CreatedAt,
		&startedAt,
		&finishedAt,
		&step.UpdatedAt,
	); err != nil {
		return PipelineStep{}, err
	}
	if exitCode.Valid {
		val := int(exitCode.Int32)
		step.ExitCode = &val
	}
	if timeout.Valid {
		val := int(timeout.Int32)
		step.TimeoutMs = &val
	}
	if duration.Valid {
		val := int(duration.Int32)
		step.DurationMs = &val
	}
	if errorMessage.Valid {
		val := errorMessage.String
		step.ErrorMessage = &val
	}
	if logPath.Valid {
		val := logPath.String
		step.LogPath = &val
	}
	if startedAt.Valid {
		step.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		step.FinishedAt = &finishedAt.Time
	}
	return step, nil
}

func (s *Store) MarkPipelineRunRunning(ctx context.Context, runID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_runs
		 set status='running',
		     error_message=null,
		     started_at=coalesce(started_at, now()),
		     updated_at=now()
		 where id=$1`,
		runID,
	)
	return err
}

func (s *Store) MarkPipelineRunWaitingManual(ctx context.Context, runID string, message string, metadata json.RawMessage) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_runs
		 set status='waiting_manual',
		     error_message=$2,
		     metadata=$3,
		     started_at=coalesce(started_at, now()),
		     updated_at=now()
		 where id=$1`,
		runID,
		message,
		metadata,
	)
	return err
}

func (s *Store) MarkPipelineRunSuccess(ctx context.Context, runID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_runs
		 set status='success',
		     error_message=null,
		     finished_at=now(),
		     updated_at=now()
		 where id=$1`,
		runID,
	)
	return err
}

func (s *Store) MarkPipelineRunFailed(ctx context.Context, runID string, message string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_runs set status='failed', error_message=$2, finished_at=now(), updated_at=now() where id=$1`,
		runID,
		message,
	)
	return err
}

func (s *Store) MarkPipelineRunCanceled(ctx context.Context, runID string, message string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_runs
		 set status='canceled', error_message=$2, finished_at=now(), updated_at=now()
		 where id=$1`,
		runID,
		message,
	)
	return err
}

func (s *Store) IsPipelineRunCanceled(ctx context.Context, runID string) (bool, error) {
	row := s.pool.QueryRow(ctx, `select status from pipeline_runs where id=$1`, runID)
	var status string
	if err := row.Scan(&status); err != nil {
		return false, err
	}
	return status == "canceled", nil
}

func (s *Store) CancelPipelineRun(ctx context.Context, runID string, reason string) (bool, error) {
	// Mark run canceled if it is still active.
	// We also mark queued/running jobs and steps canceled for consistent UI behavior.
	cmdTag, err := s.pool.Exec(
		ctx,
		`update pipeline_runs
		 set status='canceled', error_message=$2, finished_at=now(), updated_at=now()
		 where id=$1 and status in ('queued','running','waiting_manual')`,
		runID,
		reason,
	)
	if err != nil {
		return false, err
	}
	if cmdTag.RowsAffected() == 0 {
		return false, nil
	}

	_, _ = s.pool.Exec(
		ctx,
		`update pipeline_jobs
		 set status='canceled', error_message=$2, finished_at=now(),
		     duration_ms=case when started_at is null then null else (extract(epoch from (now()-started_at))*1000)::int end,
		     updated_at=now()
		 where run_id=$1 and status in ('queued','running','waiting_manual')`,
		runID,
		reason,
	)
	_, _ = s.pool.Exec(
		ctx,
		`update pipeline_steps
		 set status='canceled', error_message=$2, finished_at=now(),
		     duration_ms=case when started_at is null then null else (extract(epoch from (now()-started_at))*1000)::int end,
		     updated_at=now()
		 where job_id in (select id from pipeline_jobs where run_id=$1) and status in ('queued','running','waiting_manual')`,
		runID,
		reason,
	)

	return true, nil
}

func (s *Store) MarkPipelineJobRunning(ctx context.Context, jobID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_jobs
		 set status='running',
		     error_message=null,
		     started_at=now(),
		     updated_at=now()
		 where id=$1`,
		jobID,
	)
	return err
}

func (s *Store) MarkPipelineJobWaitingManual(ctx context.Context, jobID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_jobs
		 set status='waiting_manual',
		     error_message=null,
		     updated_at=now()
		 where id=$1 and status='queued'`,
		jobID,
	)
	return err
}

func (s *Store) AssignPipelineJobWorker(ctx context.Context, jobID string, workerID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_jobs
		 set worker_id=$2, updated_at=now()
		 where id=$1`,
		jobID,
		nullIfEmpty(workerID),
	)
	return err
}

func (s *Store) MarkPipelineJobSuccess(ctx context.Context, jobID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_jobs
		 set status='success',
		     error_message=null,
		     finished_at=now(),
		     duration_ms=case when started_at is null then null else (extract(epoch from (now()-started_at))*1000)::int end,
		     updated_at=now()
		 where id=$1`,
		jobID,
	)
	return err
}

func (s *Store) MarkPipelineJobFailed(ctx context.Context, jobID string, message string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_jobs set status='failed', error_message=$2, finished_at=now(),
		 duration_ms=case when started_at is null then null else (extract(epoch from (now()-started_at))*1000)::int end,
		 updated_at=now() where id=$1`,
		jobID,
		message,
	)
	return err
}

func (s *Store) MarkPipelineJobCanceled(ctx context.Context, jobID string, message string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_jobs set status='canceled', error_message=$2, finished_at=now(),
		 duration_ms=case when started_at is null then null else (extract(epoch from (now()-started_at))*1000)::int end,
		 updated_at=now() where id=$1`,
		jobID,
		message,
	)
	return err
}

func (s *Store) MarkPipelineJobTimedOut(ctx context.Context, jobID string, message string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_jobs set status='timed_out', error_message=$2, finished_at=now(),
		 duration_ms=case when started_at is null then null else (extract(epoch from (now()-started_at))*1000)::int end,
		 updated_at=now() where id=$1`,
		jobID,
		message,
	)
	return err
}

func (s *Store) TriggerPipelineJob(ctx context.Context, runID string, jobKey string, metadata json.RawMessage) (*PipelineJob, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var runStatus string
	if err := tx.QueryRow(
		ctx,
		`select status from pipeline_runs where id=$1 for update`,
		runID,
	).Scan(&runStatus); err != nil {
		return nil, false, err
	}
	if runStatus != "waiting_manual" && runStatus != "queued" && runStatus != "running" {
		return nil, false, nil
	}

	row := tx.QueryRow(
		ctx,
		`update pipeline_jobs
		 set status='queued',
		     error_message=null,
		     updated_at=now()
		 where job_key=$1 and run_id=$2 and status='waiting_manual'
		 returning id, run_id, job_key, name, status, attempt, worker_id, error_message, duration_ms, created_at, started_at, finished_at, updated_at`,
		jobKey,
		runID,
	)

	var workerID pgtype.Text
	var errorMessage pgtype.Text
	var duration pgtype.Int4
	var startedAt pgtype.Timestamptz
	var finishedAt pgtype.Timestamptz
	var job PipelineJob
	if err := row.Scan(
		&job.ID,
		&job.RunID,
		&job.JobKey,
		&job.Name,
		&job.Status,
		&job.Attempt,
		&workerID,
		&errorMessage,
		&duration,
		&job.CreatedAt,
		&startedAt,
		&finishedAt,
		&job.UpdatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, false, nil
		}
		return nil, false, err
	}
	if workerID.Valid {
		value := workerID.String
		job.WorkerID = &value
	}
	if errorMessage.Valid {
		value := errorMessage.String
		job.ErrorMessage = &value
	}
	if duration.Valid {
		value := int(duration.Int32)
		job.DurationMs = &value
	}
	if startedAt.Valid {
		job.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		job.FinishedAt = &finishedAt.Time
	}

	if _, err := tx.Exec(
		ctx,
		`update pipeline_runs
		 set status='queued',
		     error_message=null,
		     metadata=$2,
		     updated_at=now()
		 where id=$1`,
		runID,
		metadata,
	); err != nil {
		return nil, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return &job, true, nil
}

func (s *Store) MarkPipelineStepRunning(ctx context.Context, stepID string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_steps set status='running', started_at=now(), updated_at=now() where id=$1`,
		stepID,
	)
	return err
}

func (s *Store) UpdatePipelineStepLogPath(ctx context.Context, stepID string, logPath string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_steps set log_path=$2, updated_at=now() where id=$1`,
		stepID,
		logPath,
	)
	return err
}

func (s *Store) MarkPipelineStepSuccess(ctx context.Context, stepID string, exitCode int) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_steps set status='success', exit_code=$2, finished_at=now(),
		 duration_ms=case when started_at is null then null else (extract(epoch from (now()-started_at))*1000)::int end,
		 updated_at=now() where id=$1`,
		stepID,
		exitCode,
	)
	return err
}

func (s *Store) MarkPipelineStepFailed(ctx context.Context, stepID string, status string, exitCode int, message string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_steps set status=$2, exit_code=$3, error_message=$4, finished_at=now(),
		 duration_ms=case when started_at is null then null else (extract(epoch from (now()-started_at))*1000)::int end,
		 updated_at=now() where id=$1`,
		stepID,
		status,
		exitCode,
		message,
	)
	return err
}

func (s *Store) MarkPipelineStepCanceled(ctx context.Context, stepID string, message string) error {
	_, err := s.pool.Exec(
		ctx,
		`update pipeline_steps set status='canceled', error_message=$2, finished_at=now(),
		 duration_ms=case when started_at is null then null else (extract(epoch from (now()-started_at))*1000)::int end,
		 updated_at=now() where id=$1`,
		stepID,
		message,
	)
	return err
}

func (s *Store) InsertPipelineArtifact(ctx context.Context, artifact PipelineArtifact) error {
	_, err := s.pool.Exec(
		ctx,
		`insert into pipeline_artifacts (run_id, job_id, step_id, path, storage_path, size_bytes, sha256, created_at, expires_at)
		 values ($1,$2,$3,$4,$5,$6,$7,now(),$8)`,
		artifact.RunID,
		nullIfEmpty(artifact.JobID),
		nullIfEmpty(artifact.StepID),
		artifact.Path,
		artifact.StoragePath,
		artifact.SizeBytes,
		nullIfEmpty(artifact.Sha256),
		artifact.ExpiresAt,
	)
	return err
}

func (s *Store) GetPipelineArtifact(ctx context.Context, runID string, artifactID string) (*PipelineArtifact, error) {
	row := s.pool.QueryRow(
		ctx,
		`select a.id, r.org_id, a.run_id, a.job_id, a.step_id, a.path, a.storage_path, a.size_bytes, a.sha256, a.created_at, a.expires_at
		 from pipeline_artifacts a
		 join pipeline_runs r on r.id = a.run_id
		 where a.run_id = $1 and a.id = $2`,
		runID,
		artifactID,
	)

	var out PipelineArtifact
	var jobID pgtype.UUID
	var stepID pgtype.UUID
	var sha pgtype.Text
	var createdAt pgtype.Timestamptz
	var expiresAt pgtype.Timestamptz
	if err := row.Scan(
		&out.ID,
		&out.OrgID,
		&out.RunID,
		&jobID,
		&stepID,
		&out.Path,
		&out.StoragePath,
		&out.SizeBytes,
		&sha,
		&createdAt,
		&expiresAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if jobID.Valid {
		out.JobID = jobID.String()
	}
	if stepID.Valid {
		out.StepID = stepID.String()
	}
	if sha.Valid {
		out.Sha256 = sha.String
	}
	if createdAt.Valid {
		value := createdAt.Time
		out.CreatedAt = &value
	}
	if expiresAt.Valid {
		value := expiresAt.Time
		out.ExpiresAt = &value
	}
	return &out, nil
}

func (s *Store) ListPipelineArtifactsForRun(ctx context.Context, runID string) ([]PipelineArtifact, error) {
	rows, err := s.pool.Query(
		ctx,
		`select a.id, r.org_id, a.run_id, a.job_id, a.step_id, a.path, a.storage_path, a.size_bytes, a.sha256, a.created_at, a.expires_at
		 from pipeline_artifacts a
		 join pipeline_runs r on r.id = a.run_id
		 where a.run_id = $1
		   and (a.expires_at is null or a.expires_at > now())
		 order by a.created_at asc`,
		runID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]PipelineArtifact, 0)
	for rows.Next() {
		var out PipelineArtifact
		var jobID pgtype.UUID
		var stepID pgtype.UUID
		var sha pgtype.Text
		var createdAt pgtype.Timestamptz
		var expiresAt pgtype.Timestamptz
		if err := rows.Scan(
			&out.ID,
			&out.OrgID,
			&out.RunID,
			&jobID,
			&stepID,
			&out.Path,
			&out.StoragePath,
			&out.SizeBytes,
			&sha,
			&createdAt,
			&expiresAt,
		); err != nil {
			return nil, err
		}
		if jobID.Valid {
			out.JobID = jobID.String()
		}
		if stepID.Valid {
			out.StepID = stepID.String()
		}
		if sha.Valid {
			out.Sha256 = sha.String
		}
		if createdAt.Valid {
			value := createdAt.Time
			out.CreatedAt = &value
		}
		if expiresAt.Valid {
			value := expiresAt.Time
			out.ExpiresAt = &value
		}
		items = append(items, out)
	}
	return items, rows.Err()
}

func (s *Store) ListExpiredPipelineArtifacts(ctx context.Context, now time.Time, limit int) ([]PipelineArtifact, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.pool.Query(
		ctx,
		`select a.id, r.org_id, a.run_id, a.job_id, a.step_id, a.path, a.storage_path, a.size_bytes, a.sha256, a.created_at, a.expires_at
		 from pipeline_artifacts a
		 join pipeline_runs r on r.id = a.run_id
		 where a.expires_at is not null and a.expires_at <= $1
		   and not exists (
		     select 1
		     from artifact_blobs b
		     where b.org_id = r.org_id
		       and (b.sha256 = a.sha256 or b.storage_path = a.storage_path)
		   )
		 order by a.expires_at asc
		 limit $2`,
		now,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]PipelineArtifact, 0, limit)
	for rows.Next() {
		var artifact PipelineArtifact
		var jobID pgtype.UUID
		var stepID pgtype.UUID
		var sha pgtype.Text
		var createdAt pgtype.Timestamptz
		var expiresAt pgtype.Timestamptz
		if err := rows.Scan(
			&artifact.ID,
			&artifact.OrgID,
			&artifact.RunID,
			&jobID,
			&stepID,
			&artifact.Path,
			&artifact.StoragePath,
			&artifact.SizeBytes,
			&sha,
			&createdAt,
			&expiresAt,
		); err != nil {
			return nil, err
		}
		if jobID.Valid {
			artifact.JobID = jobID.String()
		}
		if stepID.Valid {
			artifact.StepID = stepID.String()
		}
		if sha.Valid {
			artifact.Sha256 = sha.String
		}
		if createdAt.Valid {
			value := createdAt.Time
			artifact.CreatedAt = &value
		}
		if expiresAt.Valid {
			value := expiresAt.Time
			artifact.ExpiresAt = &value
		}
		out = append(out, artifact)
	}
	return out, nil
}

func (s *Store) DeletePipelineArtifactsByID(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := s.pool.Exec(
		ctx,
		`delete from pipeline_artifacts where id = any($1::uuid[])`,
		ids,
	)
	return err
}

func (s *Store) GetArtifactFile(ctx context.Context, fileID string) (*ArtifactFile, error) {
	row := s.pool.QueryRow(
		ctx,
		`select f.id, f.org_id, v.project_id, v.repository_id, f.version_id, f.logical_path, f.file_name,
		        b.storage_path, b.size_bytes, b.sha256, f.created_at
		   from artifact_files f
		   join artifact_versions v on v.id = f.version_id
		   join artifact_blobs b on b.id = f.blob_id
		  where f.id = $1`,
		fileID,
	)

	var out ArtifactFile
	var sha pgtype.Text
	var createdAt pgtype.Timestamptz
	if err := row.Scan(
		&out.ID,
		&out.OrgID,
		&out.ProjectID,
		&out.RepositoryID,
		&out.VersionID,
		&out.LogicalPath,
		&out.FileName,
		&out.StoragePath,
		&out.SizeBytes,
		&sha,
		&createdAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if sha.Valid {
		out.Sha256 = sha.String
	}
	if createdAt.Valid {
		value := createdAt.Time
		out.CreatedAt = &value
	}
	return &out, nil
}

func (s *Store) ResolveArtifactVersionForDeployment(
	ctx context.Context,
	projectID string,
	repositorySlug string,
	version string,
	channel string,
) (*ArtifactVersion, error) {
	repositorySlug = strings.TrimSpace(repositorySlug)
	version = strings.TrimSpace(version)
	channel = strings.TrimSpace(channel)
	if repositorySlug == "" {
		return nil, fmt.Errorf("repository slug is required")
	}

	var (
		row         pgx.Row
		out         ArtifactVersion
		createdAt   pgtype.Timestamptz
		channelName pgtype.Text
	)
	if channel != "" {
		row = s.pool.QueryRow(
			ctx,
			`select v.id, v.org_id, v.project_id, v.repository_id, r.slug, v.version, c.name, v.created_at
			   from artifact_channels c
			   join artifact_versions v on v.id = c.version_id
			   join artifact_repositories r on r.id = c.repository_id
			  where c.project_id = $1
			    and r.slug = $2
			    and c.name = $3`,
			projectID,
			repositorySlug,
			channel,
		)
	} else {
		row = s.pool.QueryRow(
			ctx,
			`select v.id, v.org_id, v.project_id, v.repository_id, r.slug, v.version, null::text as channel_name, v.created_at
			   from artifact_versions v
			   join artifact_repositories r on r.id = v.repository_id
			  where v.project_id = $1
			    and r.slug = $2
			    and v.version = $3`,
			projectID,
			repositorySlug,
			version,
		)
	}
	if err := row.Scan(
		&out.ID,
		&out.OrgID,
		&out.ProjectID,
		&out.RepositoryID,
		&out.RepositorySlug,
		&out.Version,
		&channelName,
		&createdAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if channelName.Valid {
		out.ChannelName = channelName.String
	}
	if createdAt.Valid {
		value := createdAt.Time
		out.CreatedAt = &value
	}
	return &out, nil
}

func (s *Store) ListArtifactFilesForVersion(ctx context.Context, versionID string) ([]ArtifactFile, error) {
	rows, err := s.pool.Query(
		ctx,
		`select f.id, f.org_id, v.project_id, v.repository_id, f.version_id, f.logical_path, f.file_name,
		        b.storage_path, b.size_bytes, b.sha256, f.created_at
		   from artifact_files f
		   join artifact_versions v on v.id = f.version_id
		   join artifact_blobs b on b.id = f.blob_id
		  where f.version_id = $1
		  order by f.logical_path asc`,
		versionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]ArtifactFile, 0)
	for rows.Next() {
		var item ArtifactFile
		var sha pgtype.Text
		var createdAt pgtype.Timestamptz
		if err := rows.Scan(
			&item.ID,
			&item.OrgID,
			&item.ProjectID,
			&item.RepositoryID,
			&item.VersionID,
			&item.LogicalPath,
			&item.FileName,
			&item.StoragePath,
			&item.SizeBytes,
			&sha,
			&createdAt,
		); err != nil {
			return nil, err
		}
		if sha.Valid {
			item.Sha256 = sha.String
		}
		if createdAt.Valid {
			value := createdAt.Time
			item.CreatedAt = &value
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) InsertArtifactVersionUsage(ctx context.Context, usage ArtifactVersionUsage) error {
	_, err := s.pool.Exec(
		ctx,
		`insert into artifact_version_usages
		   (org_id, project_id, repository_id, version_id, pipeline_run_id, pipeline_job_id, environment, channel_name, usage_type, created_by, created_at)
		 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
		usage.OrgID,
		usage.ProjectID,
		usage.RepositoryID,
		usage.VersionID,
		nullIfEmpty(usage.PipelineRunID),
		nullIfEmpty(usage.PipelineJobID),
		nullIfEmpty(usage.Environment),
		nullIfEmpty(usage.ChannelName),
		usage.UsageType,
		nullIfEmpty(usage.CreatedBy),
	)
	return err
}

func (s *Store) AppendRunEvent(ctx context.Context, runID string, eventType string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := s.pool.Exec(
		ctx,
		`insert into pipeline_run_events (run_id, type, payload, occurred_at) values ($1,$2,$3,now())`,
		runID,
		eventType,
		raw,
	)
	return err
}

func (s *Store) ListRunEvents(ctx context.Context, runID string, afterSeq int64, limit int) ([]RunEvent, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.pool.Query(
		ctx,
		`select id, run_id, seq, type, payload, occurred_at
		 from pipeline_run_events
		 where run_id=$1 and seq>$2
		 order by seq asc
		 limit $3`,
		runID,
		afterSeq,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []RunEvent
	for rows.Next() {
		var event RunEvent
		if err := rows.Scan(
			&event.ID,
			&event.RunID,
			&event.Seq,
			&event.Type,
			&event.Payload,
			&event.OccurredAt,
		); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, nil
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullIfEmptyPtr(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}
