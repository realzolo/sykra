package events

type Publisher struct{}

func NewPublisher() (*Publisher, error) {
	return &Publisher{}, nil
}

func (p *Publisher) Close() {}

func (p *Publisher) ReportStatus(_ string, _ string, _ *int) {}
