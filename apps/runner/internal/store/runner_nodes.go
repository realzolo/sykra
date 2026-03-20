package store

import (
	"context"
	"encoding/json"
	"time"
)

type RunnerNode struct {
	ID             string            `json:"id"`
	Hostname       string            `json:"hostname"`
	Version        string            `json:"version"`
	Labels         map[string]string `json:"labels"`
	Capabilities   []string          `json:"capabilities"`
	Status         string            `json:"status"`
	MaxConcurrency int               `json:"max_concurrency"`
	CurrentLoad    int               `json:"current_load"`
	LastHeartbeat  time.Time         `json:"last_heartbeat_at"`
	ConnectedAt    *time.Time        `json:"connected_at,omitempty"`
	LastError      *string           `json:"last_error,omitempty"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
}

func (s *Store) UpsertRunnerNode(ctx context.Context, node RunnerNode) error {
	labelsRaw, err := json.Marshal(node.Labels)
	if err != nil {
		return err
	}
	capabilities := node.Capabilities
	if capabilities == nil {
		capabilities = []string{}
	}

	_, err = s.pool.Exec(
		ctx,
		`insert into runner_nodes
		 (id, hostname, version, labels, capabilities, status, max_concurrency, current_load, last_heartbeat_at, connected_at, last_error, created_at, updated_at)
		 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())
		 on conflict (id) do update set
		   hostname = excluded.hostname,
		   version = excluded.version,
		   labels = excluded.labels,
		   capabilities = excluded.capabilities,
		   status = excluded.status,
		   max_concurrency = excluded.max_concurrency,
		   current_load = excluded.current_load,
		   last_heartbeat_at = excluded.last_heartbeat_at,
		   connected_at = coalesce(excluded.connected_at, runner_nodes.connected_at),
		   last_error = excluded.last_error,
		   updated_at = now()`,
		node.ID,
		nullIfEmpty(node.Hostname),
		nullIfEmpty(node.Version),
		labelsRaw,
		capabilities,
		nullIfEmpty(node.Status),
		node.MaxConcurrency,
		node.CurrentLoad,
		node.LastHeartbeat,
		node.ConnectedAt,
		node.LastError,
	)
	return err
}

func (s *Store) MarkRunnerNodeOffline(ctx context.Context, workerID string, lastError *string) error {
	_, err := s.pool.Exec(
		ctx,
		`update runner_nodes
		 set status='offline',
		     current_load=0,
		     last_error=$2,
		     updated_at=now()
		 where id=$1`,
		workerID,
		lastError,
	)
	return err
}
