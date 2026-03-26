package pipeline

import (
	"context"

	"sykra/conductor/internal/store"
)

// EnsureRunGraph creates or repairs the job and step records for a run.
// It uses the InternalPlan (built from the four-stage PipelineConfig) to determine
// the canonical jobs and steps that must exist for the run.
func EnsureRunGraph(ctx context.Context, st *store.Store, runID string, cfg PipelineConfig, projectID string) error {
	plan := BuildInternalPlan(cfg, projectID)

	for _, job := range plan.Jobs {
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
