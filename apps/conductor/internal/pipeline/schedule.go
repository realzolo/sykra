package pipeline

import (
	"fmt"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

var pipelineScheduleParser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
)

func parseSchedule(expr string) (cron.Schedule, error) {
	trimmed := strings.TrimSpace(expr)
	if trimmed == "" {
		return nil, fmt.Errorf("schedule is empty")
	}
	return pipelineScheduleParser.Parse(trimmed)
}

func nextScheduleAt(expr string, after time.Time) (time.Time, error) {
	schedule, err := parseSchedule(expr)
	if err != nil {
		return time.Time{}, err
	}
	return schedule.Next(after.UTC()), nil
}
