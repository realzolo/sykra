package events

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
)

type Publisher struct {
	conn *nats.Conn
}

func NewPublisher(url string) (*Publisher, error) {
	if url == "" {
		return nil, nil
	}
	conn, err := nats.Connect(url)
	if err != nil {
		return nil, err
	}
	return &Publisher{conn: conn}, nil
}

func (p *Publisher) Close() {
	if p == nil || p.conn == nil {
		return
	}
	p.conn.Close()
}

func (p *Publisher) ReportStatus(reportID string, status string, score *int) {
	if p == nil || p.conn == nil {
		return
	}
	payload := map[string]any{
		"type":      "status_update",
		"reportId":  reportID,
		"status":    status,
		"score":     score,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	raw, _ := json.Marshal(payload)
	subject := fmt.Sprintf("reports.%s.status", reportID)
	_ = p.conn.Publish(subject, raw)
}
