package pipeline

import (
	"context"

	"spec-axis/conductor/internal/store"
)

// EnsureRunGraph creates the job and step records for a run if they don't exist.
// It uses the InternalPlan (built from the four-stage PipelineConfig) to determine
// the jobs and steps to create.
func EnsureRunGraph(ctx context.Context, st *store.Store, runID string, cfg PipelineConfig, projectID, studioURL, studioToken string) error {
	existing, err := st.ListPipelineJobs(ctx, runID)
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		return nil
	}

	plan := BuildInternalPlan(cfg, projectID, studioURL, studioToken)

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
