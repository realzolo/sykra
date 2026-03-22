package pipeline

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"spec-axis/conductor/internal/store"
)

func RunStudioCallbackLoop(ctx context.Context, st *store.Store, studioURL string, studioToken string, interval time.Duration) {
	if st == nil {
		return
	}
	if strings.TrimSpace(studioURL) == "" || strings.TrimSpace(studioToken) == "" {
		return
	}
	if interval <= 0 {
		interval = 2 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	process := func() {
		events, err := st.ClaimStudioCallbackEvents(ctx, 25)
		if err != nil {
			log.Printf("studio callback claim failed: %v", err)
			return
		}
		for _, event := range events {
			if err := deliverStudioCallback(ctx, studioURL, studioToken, event.Payload); err != nil {
				nextAttempt := time.Now().UTC().Add(backoffDuration(event.AttemptCount))
				if rescheduleErr := st.RescheduleStudioCallback(ctx, event.ID, nextAttempt, err.Error()); rescheduleErr != nil {
					log.Printf("studio callback reschedule failed: id=%s err=%v", event.ID, rescheduleErr)
				}
				continue
			}
			if err := st.MarkStudioCallbackSent(ctx, event.ID); err != nil {
				log.Printf("studio callback mark sent failed: id=%s err=%v", event.ID, err)
			}
		}
	}

	process()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			process()
		}
	}
}

func deliverStudioCallback(ctx context.Context, studioURL string, studioToken string, payload []byte) error {
	requestCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	url := strings.TrimRight(studioURL, "/") + "/api/conductor/events"
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Conductor-Token", studioToken)

	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("status=%d", res.StatusCode)
	}
	return nil
}

func backoffDuration(attempt int) time.Duration {
	switch {
	case attempt <= 1:
		return 2 * time.Second
	case attempt == 2:
		return 5 * time.Second
	case attempt == 3:
		return 15 * time.Second
	case attempt == 4:
		return 30 * time.Second
	default:
		return 60 * time.Second
	}
}
