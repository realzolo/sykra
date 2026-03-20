package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type OrgStorageSettings struct {
	OrgID     string          `json:"org_id"`
	Provider  string          `json:"provider"`
	Config    json.RawMessage `json:"config"`
	UpdatedBy *string         `json:"updated_by,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func (s *Store) GetOrgStorageSettings(ctx context.Context, orgID string) (*OrgStorageSettings, error) {
	row := s.pool.QueryRow(
		ctx,
		`select org_id, provider, config, updated_by, created_at, updated_at
		 from org_storage_settings
		 where org_id = $1`,
		orgID,
	)

	var out OrgStorageSettings
	var updatedBy pgtype.UUID
	if err := row.Scan(
		&out.OrgID,
		&out.Provider,
		&out.Config,
		&updatedBy,
		&out.CreatedAt,
		&out.UpdatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if updatedBy.Valid {
		value := updatedBy.String()
		out.UpdatedBy = &value
	}
	return &out, nil
}
