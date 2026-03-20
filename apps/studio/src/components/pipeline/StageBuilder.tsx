"use client";

import { type ReactNode, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowDown, ArrowRight, Bot, GitBranch, Hand, ListOrdered, Plus, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n";
import type {
  PipelineJob,
  PipelineStageConfig,
  PipelineStageDispatchMode,
  PipelineStageEntryMode,
  PipelineStageKey,
  PipelineStageSettings,
  PipelineStep,
} from "@/services/pipelineTypes";
import {
  buildStageJobs,
  createDefaultStep,
  createStageJob,
  getStageConfig,
  inferPipelineJobStage,
} from "@/services/pipelineTypes";
import PipelineStepEditor, {
  getBuildTemplateSteps,
} from "@/components/pipeline/PipelineStepEditor";

type Props = {
  jobs: PipelineJob[];
  triggerBranch: string;
  stageSettings: PipelineStageSettings | undefined;
  dict: Dictionary["pipelines"];
  isAdmin: boolean;
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
  onJobsChange: (jobs: PipelineJob[]) => void;
  onStageSettingsChange: (settings: PipelineStageSettings) => void;
};

function getStageLabel(stage: PipelineStageKey, dict: Dictionary["pipelines"]): string {
  switch (stage) {
    case "source":
      return dict.stageTab.source;
    case "after_source":
      return dict.jobs.slotLabelAfterSource;
    case "review":
      return dict.stageTab.review;
    case "after_review":
      return dict.jobs.slotLabelAfterReview;
    case "build":
      return dict.stageTab.build;
    case "after_build":
      return dict.jobs.slotLabelAfterBuild;
    case "deploy":
      return dict.stageTab.deploy;
    case "after_deploy":
      return dict.jobs.slotLabelAfterDeploy;
  }
}

function isSourceStage(stage: PipelineStageKey): boolean {
  return stage === "source";
}

function getDefaultJobName(stage: PipelineStageKey, dict: Dictionary["pipelines"]): string {
  if (stage === "source") return dict.stageTab.source;
  if (stage === "review") return dict.stageTab.review;
  if (stage === "build") return dict.stageTab.build;
  if (stage === "deploy") return dict.stageTab.deploy;
  return dict.jobs.automationDefaultName;
}

const CORE_STAGE_SEQUENCE: PipelineStageKey[] = ["source", "review", "build", "deploy"];

function getAutomationStageAfter(stage: PipelineStageKey): PipelineStageKey | null {
  switch (stage) {
    case "source":
      return "after_source";
    case "review":
      return "after_review";
    case "build":
      return "after_build";
    case "deploy":
      return "after_deploy";
    default:
      return null;
  }
}

function StageModeToggle({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; icon: ReactNode }>;
  disabled: boolean;
  onChange?: ((value: string) => void) | undefined;
}) {
  return (
    <TooltipProvider delayDuration={120}>
      <div
        className="grid gap-1 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onChange?.(option.value)}
                  disabled={disabled || !onChange}
                  aria-label={option.label}
                  className={`rounded-[6px] px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-[hsl(var(--ds-text-2))]"
                  } ${disabled || !onChange ? "cursor-default" : "hover:text-foreground"}`}
                >
                  <span className="flex items-center justify-center">
                    {option.icon}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{option.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function StageFlowConnector({
  showAdd,
  addLabel,
  disabled,
  terminal,
  onAdd,
}: {
  showAdd: boolean;
  addLabel?: string;
  disabled: boolean;
  terminal: boolean;
  onAdd?: (() => void) | undefined;
}) {
  return (
    <div className="flex w-[72px] shrink-0 items-center justify-center">
      <div className="relative flex h-10 w-full items-center justify-center text-[hsl(var(--ds-border-2)/0.82)]">
        <span
          className={`absolute left-0 top-1/2 h-px -translate-y-1/2 bg-[hsl(var(--ds-border-2)/0.82)] mr-[-3px] ${
            terminal ? "right-0" : "right-[15px]"
          }`}
        />
        {!terminal && <ArrowRight className="absolute right-0 size-4" />}
        {showAdd && (
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            title={addLabel}
            aria-label={addLabel}
            className={`relative z-10 flex size-9 items-center justify-center rounded-full border border-[hsl(var(--ds-border-1))] bg-background transition-colors ${
              disabled
                ? "cursor-default text-[hsl(var(--ds-text-2))] opacity-60"
                : "text-[hsl(var(--ds-text-2))] hover:border-foreground/40 hover:text-foreground"
            }`}
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function StageBuilder({
  jobs,
  triggerBranch,
  stageSettings,
  dict,
  isAdmin,
  selectedJobId,
  onSelectJob,
  onJobsChange,
  onStageSettingsChange,
}: Props) {
  const grouped = useMemo(() => buildStageJobs(jobs), [jobs]);
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId]
  );

  function updateJob(jobId: string, patch: Partial<PipelineJob>) {
    onJobsChange(jobs.map((job) => (job.id === jobId ? { ...job, ...patch } : job)));
  }

  function updateStageConfig(stage: PipelineStageKey, patch: Partial<PipelineStageConfig>) {
    onStageSettingsChange({
      ...(stageSettings ?? {}),
      [stage]: {
        ...getStageConfig(stageSettings, stage),
        ...patch,
      },
    });
  }

  function addJob(stage: PipelineStageKey) {
    const nextJob = createStageJob(
      stage,
      jobs.map((job) => job.id),
      triggerBranch,
      getDefaultJobName(stage, dict)
    );
    onJobsChange([...jobs, nextJob]);
    onSelectJob(nextJob.id);
  }

  function removeJob(jobId: string) {
    if (jobs.length <= 1) return;
    const nextJobs = jobs.filter((job) => job.id !== jobId);
    onJobsChange(nextJobs);
    if (selectedJobId === jobId && nextJobs[0]) {
      onSelectJob(nextJobs[0].id);
    }
  }

  function addStep(jobId: string) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || (job.type ?? "shell") !== "shell") return;
    updateJob(jobId, { steps: [...job.steps, createDefaultStep()] });
  }

  function removeStep(jobId: string, stepId: string) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || (job.type ?? "shell") !== "shell" || job.steps.length <= 1) return;
    updateJob(jobId, { steps: job.steps.filter((step) => step.id !== stepId) });
  }

  function updateStep(jobId: string, stepId: string, patch: Partial<PipelineStep>) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || (job.type ?? "shell") !== "shell") return;
    updateJob(jobId, {
      steps: job.steps.map((step) => {
        if (step.id !== stepId) return step;
        const next = { ...step, ...patch };
        if (patch.type === "shell") {
          delete next.dockerImage;
        }
        return next;
      }),
    });
  }

  function applyTemplate(jobId: string, template: "node" | "python" | "go") {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || (job.type ?? "shell") !== "shell") return;
    updateJob(jobId, {
      steps: getBuildTemplateSteps(template).map((step) => ({
        ...step,
        id: createDefaultStep(step.name).id,
      })),
    });
  }

  function renderJobCard(job: PipelineJob, allowDelete: boolean) {
    const active = selectedJobId === job.id;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectJob(job.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectJob(job.id);
          }
        }}
        className={`rounded-[8px] border px-3 py-2.5 transition-colors ${
          active
            ? "border-foreground bg-muted"
            : "border-[hsl(var(--ds-border-1))] bg-background hover:bg-[hsl(var(--ds-surface-1))]"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-foreground">{job.name}</div>
          </div>
          {isAdmin && allowDelete && (
            <button
              type="button"
              className="text-[hsl(var(--ds-text-2))] hover:text-danger"
              onClick={(event) => {
                event.stopPropagation();
                removeJob(job.id);
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3">
        <div className="text-sm font-medium text-foreground">{dict.jobs.stageBuilderTitle}</div>
        <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">{dict.jobs.stageBuilderDescription}</div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background p-4">
        <div className="flex min-w-[1180px] items-stretch gap-3">
          {CORE_STAGE_SEQUENCE.map((stage, stageIndex) => {
            const stageJobs = grouped[stage];
            const config = getStageConfig(stageSettings, stage);
            const automationStage = getAutomationStageAfter(stage);
            const automationJobs = automationStage ? grouped[automationStage] : [];
            const canAddStageNode = !isSourceStage(stage);
            const hasNextCoreStage = stageIndex < CORE_STAGE_SEQUENCE.length - 1;

            return (
              <div key={stage} className="contents">
                <section className="w-[260px] shrink-0 overflow-hidden rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background">
                  <div className="space-y-3 border-b border-[hsl(var(--ds-border-1))] px-3 py-3">
                    <div className="space-y-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                          {getStageLabel(stage, dict)}
                        </div>
                        <div className="mt-1 text-[11px] text-[hsl(var(--ds-text-2))]">
                          {isSourceStage(stage)
                            ? dict.jobs.sourceStageDescription
                            : dict.jobs.coreStageDescription}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {isSourceStage(stage) && (
                          <>
                            <span className="rounded-full border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--ds-text-2))]">
                              {dict.jobs.fixedStageBadge}
                            </span>
                            <span className="rounded-full border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--ds-text-2))]">
                              {dict.jobs.systemStageBadge}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {!isSourceStage(stage) && (
                      <div className="flex items-center gap-2">
                        <StageModeToggle
                          value={config.entryMode ?? "auto"}
                          options={[
                            {
                              value: "auto",
                              label: dict.jobs.entryModeAuto,
                              icon: <Bot className="size-3.5" />,
                            },
                            {
                              value: "manual",
                              label: dict.jobs.entryModeManual,
                              icon: <Hand className="size-3.5" />,
                            },
                          ]}
                          disabled={!isAdmin}
                          onChange={(value) => updateStageConfig(stage, { entryMode: value as PipelineStageEntryMode })}
                        />

                        <StageModeToggle
                          value={config.dispatchMode ?? "parallel"}
                          options={[
                            {
                              value: "parallel",
                              label: dict.jobs.dispatchModeParallel,
                              icon: <GitBranch className="size-3.5" />,
                            },
                            {
                              value: "serial",
                              label: dict.jobs.dispatchModeSerial,
                              icon: <ListOrdered className="size-3.5" />,
                            },
                          ]}
                          disabled={!isAdmin}
                          onChange={(value) =>
                            updateStageConfig(stage, { dispatchMode: value as PipelineStageDispatchMode })
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 p-2">
                    {stageJobs.length === 0 && isSourceStage(stage) && (
                      <div className="space-y-3 rounded-[8px] border border-dashed border-[hsl(var(--ds-border-1))] px-3 py-6 text-center">
                        <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.jobs.sourceEmpty}</div>
                        {isAdmin && (
                          <div className="flex justify-center">
                            <Button variant="outline" size="sm" onClick={() => addJob("source")}>
                              <Plus className="mr-1 size-3.5" />
                              {dict.jobs.restoreSource}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {stageJobs.length === 0 && !isSourceStage(stage) && (
                      <div className="rounded-[8px] border border-dashed border-[hsl(var(--ds-border-1))] px-3 py-8 text-center text-[12px] text-[hsl(var(--ds-text-2))]">
                        {dict.jobs.stageEmpty}
                      </div>
                    )}

                    {stageJobs.map((job, index) => (
                      <div key={job.id} className="space-y-2">
                        {renderJobCard(job, !isSourceStage(stage))}
                        {index < stageJobs.length - 1 && (
                          <div className="flex items-center justify-center py-0.5 text-[hsl(var(--ds-border-2)/0.82)]">
                            <ArrowDown className="size-3.5" />
                          </div>
                        )}
                      </div>
                    ))}

                    {canAddStageNode && (
                      <div className="pt-1">
                        <Button variant="outline" size="sm" onClick={() => addJob(stage)} disabled={!isAdmin} className="w-full">
                          <Plus className="mr-1 size-3.5" />
                          {dict.jobs.addNode}
                        </Button>
                      </div>
                    )}
                  </div>
                </section>

                {automationStage && automationJobs.length > 0 && (
                  <>
                    <StageFlowConnector
                      showAdd={false}
                      disabled={!isAdmin}
                      terminal={false}
                    />
                    <section className="w-[220px] shrink-0 overflow-hidden rounded-[10px] border border-dashed border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]">
                      <div className="space-y-3 border-b border-[hsl(var(--ds-border-1))] px-3 py-3">
                        <div className="space-y-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                              {getStageLabel(automationStage, dict)}
                            </div>
                            <div className="mt-1 text-[11px] text-[hsl(var(--ds-text-2))]">
                              {dict.jobs.automationFixedHint}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="rounded-full border border-[hsl(var(--ds-border-1))] bg-background px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--ds-text-2))]">
                              <span className="flex items-center gap-1">
                                <Bot className="size-3" />
                                {dict.jobs.entryModeAuto}
                              </span>
                            </span>
                            <span className="rounded-full border border-[hsl(var(--ds-border-1))] bg-background px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--ds-text-2))]">
                              <span className="flex items-center gap-1">
                                <GitBranch className="size-3" />
                                {dict.jobs.dispatchModeParallel}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2 p-2">
                        {automationJobs.map((job, index) => (
                          <div key={job.id} className="space-y-2">
                          {renderJobCard(job, true)}
                          {index < automationJobs.length - 1 && (
                              <div className="flex items-center justify-center py-0.5 text-[hsl(var(--ds-border-2)/0.82)]">
                                <ArrowDown className="size-3.5" />
                              </div>
                            )}
                          </div>
                        ))}
                        <div className="pt-1">
                          <Button variant="outline" size="sm" onClick={() => addJob(automationStage)} disabled={!isAdmin} className="w-full">
                            <Plus className="mr-1 size-3.5" />
                            {dict.jobs.addAutomation}
                          </Button>
                        </div>
                      </div>
                    </section>
                    {hasNextCoreStage && (
                      <StageFlowConnector
                        showAdd={false}
                        disabled={!isAdmin}
                        terminal={false}
                      />
                    )}
                  </>
                )}

                {automationStage && automationJobs.length === 0 && (
                  <StageFlowConnector
                    showAdd={true}
                    addLabel={dict.jobs.addAutomation}
                    disabled={!isAdmin}
                    terminal={!hasNextCoreStage}
                    onAdd={() => addJob(automationStage)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background overflow-hidden">
        <div className="border-b border-[hsl(var(--ds-border-1))] px-4 py-3">
          <div className="text-sm font-medium text-foreground">{dict.jobs.inspectorTitle}</div>
          <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">{dict.jobs.inspectorDescription}</div>
        </div>

        {!selectedJob && (
          <div className="flex min-h-[320px] items-center justify-center px-6 text-[12px] text-[hsl(var(--ds-text-2))]">
            {dict.jobs.inspectorEmpty}
          </div>
        )}

        {selectedJob && (
          <StageJobInspector
            dict={dict}
            job={selectedJob}
            stage={inferPipelineJobStage(selectedJob, jobs)}
            isAdmin={isAdmin}
            onUpdateJob={updateJob}
            onAddStep={addStep}
            onRemoveStep={removeStep}
            onUpdateStep={updateStep}
            onApplyTemplate={applyTemplate}
          />
        )}
      </div>
    </div>
  );
}

function StageJobInspector({
  dict,
  job,
  stage,
  isAdmin,
  onUpdateJob,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
  onApplyTemplate,
}: {
  dict: Dictionary["pipelines"];
  job: PipelineJob;
  stage: PipelineStageKey;
  isAdmin: boolean;
  onUpdateJob: (jobId: string, patch: Partial<PipelineJob>) => void;
  onAddStep: (jobId: string) => void;
  onRemoveStep: (jobId: string, stepId: string) => void;
  onUpdateStep: (jobId: string, stepId: string, patch: Partial<PipelineStep>) => void;
  onApplyTemplate: (jobId: string, template: "node" | "python" | "go") => void;
}) {
  const jobType = job.type ?? "shell";

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{dict.jobs.name}</label>
          <Input
            value={job.name}
            onChange={(event) => onUpdateJob(job.id, { name: event.target.value })}
            disabled={!isAdmin || jobType === "source_checkout"}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{dict.jobs.stageFieldLabel}</label>
          <Input value={getStageLabel(stage, dict)} disabled />
        </div>
      </div>

      {jobType === "source_checkout" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{dict.jobs.sourceBranch}</label>
          <Input
            value={job.branch ?? "main"}
            onChange={(event) => onUpdateJob(job.id, { branch: event.target.value })}
            disabled={!isAdmin}
          />
        </div>
      )}

      {jobType === "review_gate" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{dict.jobs.reviewMinScore}</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={100}
              className="w-28"
              value={job.minScore ?? 60}
              onChange={(event) =>
                onUpdateJob(job.id, {
                  minScore: Math.min(100, Math.max(0, Number(event.target.value))),
                })
              }
              disabled={!isAdmin}
            />
            <span className="text-[12px] text-[hsl(var(--ds-text-2))]">/ 100</span>
          </div>
        </div>
      )}

      {jobType === "shell" && (
        <PipelineStepEditor
          dict={dict}
          job={job}
          isAdmin={isAdmin}
          showTemplates={stage === "build"}
          onApplyTemplate={(template) => onApplyTemplate(job.id, template)}
          onAddStep={() => onAddStep(job.id)}
          onRemoveStep={(stepId) => onRemoveStep(job.id, stepId)}
          onUpdateStep={(stepId, patch) => onUpdateStep(job.id, stepId, patch)}
        />
      )}
    </div>
  );
}
