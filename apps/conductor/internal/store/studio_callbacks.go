package store

import (
	"context"
	"encoding/json"
	"time"
)

type StudioCallbackEvent struct {
	ID            string
	Payload       json.RawMessage
	AttemptCount  int
	NextAttemptAt time.Time
	CreatedAt     time.Time
}

func (s *Store) EnqueueStudioCallback(ctx context.Context, payload json.RawMessage) error {
	_, err := s.pool.Exec(
		ctx,
		`insert into studio_callback_outbox (payload, status, attempt_count, next_attempt_at, created_at, updated_at)
		 values ($1, 'pending', 0, now(), now(), now())`,
		payload,
	)
	return err
}

func (s *Store) ClaimStudioCallbackEvents(ctx context.Context, limit int) ([]StudioCallbackEvent, error) {
	if limit <= 0 {
		limit = 25
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
		`with picked as (
		   select id
		     from studio_callback_outbox
		    where next_attempt_at <= now()
		      and status in ('pending', 'sending')
		    order by next_attempt_at asc, created_at asc
		    limit $1
		    for update skip locked
		 )
		 update studio_callback_outbox o
		    set status='sending',
		        attempt_count=o.attempt_count + 1,
		        next_attempt_at=now() + interval '1 minute',
		        updated_at=now()
		   from picked
		  where o.id = picked.id
		 returning o.id, o.payload, o.attempt_count, o.next_attempt_at, o.created_at`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]StudioCallbackEvent, 0, limit)
	for rows.Next() {
		var item StudioCallbackEvent
		if err := rows.Scan(&item.ID, &item.Payload, &item.AttemptCount, &item.NextAttemptAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) MarkStudioCallbackSent(ctx context.Context, id string) error {
	_, err := s.pool.Exec(
		ctx,
		`update studio_callback_outbox
		 set status='sent',
		     sent_at=now(),
		     updated_at=now()
		 where id=$1`,
		id,
	)
	return err
}

func (s *Store) RescheduleStudioCallback(ctx context.Context, id string, nextAttemptAt time.Time, lastError string) error {
	_, err := s.pool.Exec(
		ctx,
		`update studio_callback_outbox
		 set status='pending',
		     next_attempt_at=$2,
		     last_error=$3,
		     updated_at=now()
		 where id=$1`,
		id,
		nextAttemptAt,
		lastError,
	)
	return err
}
