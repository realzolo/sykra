package pipeline

import (
	"context"

	"spec-axis/runner/internal/store"
)

func EnsureRunGraph(ctx context.Context, st *store.Store, runID string, cfg PipelineConfig) error {
	existing, err := st.ListPipelineJobs(ctx, runID)
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		return nil
	}

	for _, job := range cfg.Jobs {
		jobRecord, err := st.CreatePipelineJob(ctx, runID, job.ID, job.Name)
		if err != nil {
			return err
		}
		for _, step := range job.Steps {
			if _, err := st.CreatePipelineStep(ctx, jobRecord.ID, step.ID, step.Name); err != nil {
				return err
			}
		}
	}
	return nil
}
