package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"spec-axis/conductor/internal/analysis"
	"spec-axis/conductor/internal/domain"
	"spec-axis/conductor/internal/events"
	"spec-axis/conductor/internal/pipeline"
	"spec-axis/conductor/internal/store"
)

type taskLimiter struct {
	sem chan struct{}
}

func newTaskLimiter(limit int) *taskLimiter {
	if limit <= 0 {
		limit = 1
	}
	return &taskLimiter{sem: make(chan struct{}, limit)}
}

func (l *taskLimiter) available() int {
	return cap(l.sem) - len(l.sem)
}

func (l *taskLimiter) tryAcquire() bool {
	select {
	case l.sem <- struct{}{}:
		return true
	default:
		return false
	}
}

func (l *taskLimiter) release() {
	select {
	case <-l.sem:
	default:
	}
}

func RunAnalysisLoop(
	ctx context.Context,
	st *store.Store,
	publisher *events.Publisher,
	timeout time.Duration,
	maxConcurrent int,
	interval time.Duration,
) {
	limiter := newTaskLimiter(maxConcurrent)
	runPollLoop(ctx, interval, func(ctx context.Context) error {
		return claimAndRunAnalysisBatch(ctx, st, publisher, timeout, limiter)
	})
}

func RunPipelineLoop(
	ctx context.Context,
	st *store.Store,
	engine *pipeline.Engine,
	maxConcurrent int,
	interval time.Duration,
) {
	limiter := newTaskLimiter(maxConcurrent)
	runPollLoop(ctx, interval, func(ctx context.Context) error {
		return claimAndRunPipelineBatch(ctx, st, engine, limiter)
	})
}

func runPollLoop(ctx context.Context, interval time.Duration, step func(context.Context) error) {
	if interval <= 0 {
		interval = 2 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		if err := step(ctx); err != nil {
			log.Printf("dispatch loop error: %v", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func claimAndRunAnalysisBatch(
	ctx context.Context,
	st *store.Store,
	publisher *events.Publisher,
	timeout time.Duration,
	limiter *taskLimiter,
) error {
	available := limiter.available()
	if available <= 0 {
		return nil
	}

	reports, err := st.ClaimPendingAnalysisReports(ctx, available)
	if err != nil {
		return err
	}

	for _, report := range reports {
		if !limiter.tryAcquire() {
			break
		}
		report := report
		go func() {
			defer limiter.release()
			if err := runAnalyzeReport(ctx, st, publisher, timeout, report); err != nil {
				log.Printf("analyze report %s failed: %v", report.ID, err)
			}
		}()
	}

	return nil
}

func claimAndRunPipelineBatch(
	ctx context.Context,
	st *store.Store,
	engine *pipeline.Engine,
	limiter *taskLimiter,
) error {
	available := limiter.available()
	if available <= 0 {
		return nil
	}

	runs, err := st.ClaimQueuedPipelineRuns(ctx, available)
	if err != nil {
		return err
	}

	for _, run := range runs {
		if !limiter.tryAcquire() {
			break
		}
		run := run
		go func() {
			defer limiter.release()
			if err := engine.Execute(ctx, run.ID); err != nil {
				if isPipelineRunCanceled(ctx, st, run.ID) {
					return
				}
				log.Printf("pipeline run %s failed: %v", run.ID, err)
			}
		}()
	}

	return nil
}

func runAnalyzeReport(
	ctx context.Context,
	st *store.Store,
	publisher *events.Publisher,
	timeout time.Duration,
	report store.Report,
) error {
	payload, err := buildAnalyzeRequest(report)
	if err != nil {
		return err
	}

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	stopWatch := make(chan struct{})
	defer close(stopWatch)
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopWatch:
				return
			case <-runCtx.Done():
				return
			case <-ticker.C:
				checkCtx, checkCancel := context.WithTimeout(context.Background(), 2*time.Second)
				canceled, err := st.IsReportCanceled(checkCtx, report.ID)
				checkCancel()
				if err == nil && canceled {
					cancel()
					return
				}
			}
		}
	}()

	err = analysis.RunAnalyzeTask(runCtx, st, publisher, payload, timeout)
	if err == nil || errors.Is(err, store.ErrReportNotRunning) {
		return nil
	}

	canceled, cancelErr := st.IsReportCanceled(ctx, report.ID)
	if cancelErr == nil && canceled {
		return nil
	}

	markErr := st.MarkReportFailed(ctx, report.ID, humanAnalyzeError(err, timeout))
	if errors.Is(markErr, store.ErrReportNotRunning) {
		return nil
	}
	if markErr != nil {
		return markErr
	}
	if publisher != nil {
		publisher.ReportStatus(report.ID, "failed", nil)
	}
	return nil
}

func buildAnalyzeRequest(report store.Report) (domain.AnalyzeRequest, error) {
	var snapshot struct {
		Repo           string          `json:"repo"`
		SelectedHashes []string        `json:"selectedHashes"`
		PreviousReport json.RawMessage `json:"previousReport"`
		UseIncremental bool            `json:"useIncremental"`
	}
	if err := json.Unmarshal(report.AnalysisSnapshot, &snapshot); err != nil {
		return domain.AnalyzeRequest{}, fmt.Errorf("invalid analysis snapshot for report %s: %w", report.ID, err)
	}

	var rules []domain.Rule
	if len(report.RulesetSnapshot) > 0 {
		if err := json.Unmarshal(report.RulesetSnapshot, &rules); err != nil {
			return domain.AnalyzeRequest{}, fmt.Errorf("invalid rule snapshot for report %s: %w", report.ID, err)
		}
	}

	return domain.AnalyzeRequest{
		ProjectID:      report.ProjectID,
		ReportID:       report.ID,
		Repo:           snapshot.Repo,
		Hashes:         snapshot.SelectedHashes,
		Rules:          rules,
		PreviousReport: snapshot.PreviousReport,
		UseIncremental: snapshot.UseIncremental,
	}, nil
}

func humanAnalyzeError(err error, timeout time.Duration) string {
	if err == nil {
		return "analysis failed"
	}
	low := strings.ToLower(err.Error())
	if errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(low, "context deadline exceeded") ||
		strings.Contains(low, "client.timeout") {
		return fmt.Sprintf(
			"AI request timed out after %s. Increase conductor analyze_timeout/ANALYZE_TIMEOUT or reduce Max Tokens/reasoning effort.",
			timeout.String(),
		)
	}
	if strings.Contains(low, "unexpected eof") || strings.Contains(low, "eof") {
		return "AI upstream connection dropped unexpectedly (EOF). Please retry; if this persists, verify conductor network egress and AI endpoint stability."
	}
	if strings.Contains(low, "truncated because max tokens") || strings.Contains(low, "max_output_tokens was reached") {
		return "AI output was truncated due token limit. Increase the model Max Tokens in Settings > Integrations, or reduce diff size and retry."
	}
	if strings.Contains(low, "returned empty response body") {
		return "AI upstream returned an empty response body. Verify the configured API base URL/gateway and retry."
	}
	return err.Error()
}

func isPipelineRunCanceled(ctx context.Context, st *store.Store, runID string) bool {
	checkCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	canceled, err := st.IsPipelineRunCanceled(checkCtx, runID)
	return err == nil && canceled
}
