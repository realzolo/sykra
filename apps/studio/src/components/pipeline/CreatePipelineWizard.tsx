"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { useProject } from "@/lib/projectContext";
import { useProjectBranches } from "@/lib/useProjectBranches";
import type {
  PipelineConfig,
  PipelineEnvironment,
  PipelineEnvironmentDefinition,
  PipelineConfigDefaults,
  PipelineJobDiagnostic,
  PipelineTrigger,
} from "@/services/pipelineTypes";
import {
  analyzePipelineConfig,
  DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS,
  createDefaultPipelineConfig,
  enforceProductionDeployManualGate,
  getSourceBranch,
  normalizePipelineEnvironmentDefinitions,
  normalizePipelineJobs,
  normalizeStageSettings,
} from "@/services/pipelineTypes";
import StageBuilder from "@/components/pipeline/StageBuilder";
import PipelineScheduleField from "@/components/pipeline/PipelineScheduleField";
import BuildImageField from "@/components/pipeline/BuildImageField";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (pipelineId: string) => void;
  projectId: string;
  dict: Dictionary;
};

type WizardStep = "basic" | "jobs" | "notifications";
type ConcurrencyMode = (typeof CONCURRENCY_MODES)[number];
type WizardPipelineConfig = PipelineConfig & { concurrencyMode: ConcurrencyMode };

const WIZARD_STEPS: WizardStep[] = ["basic", "jobs", "notifications"];
const CONCURRENCY_MODES = ["allow", "queue", "cancel_previous"] as const;

function getDefaultConcurrencyMode(environment: PipelineEnvironment): ConcurrencyMode {
  switch (environment) {
    case "development":
      return "cancel_previous";
    case "preview":
    case "production":
      return "queue";
    default:
      return "allow";
  }
}

function normalizeBranchValue(branch: string | undefined, fallback: string): string {
  const value = branch?.trim();
  return value && value.length > 0 ? value : fallback;
}

function getConcurrencyOptionLabel(dict: Dictionary["pipelines"], mode: ConcurrencyMode): string {
  switch (mode) {
    case "allow":
      return dict.concurrencyMode.allow;
    case "queue":
      return dict.concurrencyMode.queue;
    case "cancel_previous":
      return dict.concurrencyMode.cancelPrevious;
  }
}

function getConcurrencyOptionHelp(dict: Dictionary["pipelines"], mode: ConcurrencyMode): string {
  switch (mode) {
    case "allow":
      return dict.concurrencyMode.allowHelp;
    case "queue":
      return dict.concurrencyMode.queueHelp;
    case "cancel_previous":
      return dict.concurrencyMode.cancelPreviousHelp;
  }
}

function getSourceBranchSource(branch: string, defaultBranch: string): "project_default" | "custom" {
  return normalizeBranchValue(branch, defaultBranch) === normalizeBranchValue(defaultBranch, defaultBranch)
    ? "project_default"
    : "custom";
}

function updateSourceBranch(config: WizardPipelineConfig, branch: string): WizardPipelineConfig {
  return {
    ...config,
    jobs: config.jobs.map((job) =>
      (job.type ?? "shell") === "source_checkout" ? { ...job, branch } : job
    ),
  };
}

function updateEnvironmentWithRecommendedConcurrency(
  current: WizardPipelineConfig,
  environment: PipelineEnvironment
): WizardPipelineConfig {
  const next = { ...current, environment };
  if (environment === "production" && current.concurrencyMode === "allow") {
    return { ...next, concurrencyMode: "queue" };
  }
  const recommendedMode = getDefaultConcurrencyMode(environment);
  if (current.environment === environment || getDefaultConcurrencyMode(current.environment ?? "production") !== current.concurrencyMode) {
    return next;
  }
  return { ...next, concurrencyMode: recommendedMode };
}

function isDualTriggerMode(trigger: PipelineTrigger): boolean {
  return trigger.autoTrigger && Boolean(trigger.schedule?.trim());
}

function normalizeTriggerForEdit(trigger: PipelineTrigger, patch: Partial<PipelineTrigger>): PipelineTrigger {
  const next: PipelineTrigger = { ...trigger, ...patch };
  if (!isDualTriggerMode(next)) {
    delete next.purpose;
  }
  return next;
}

function normalizeTriggerForPersist(trigger: PipelineTrigger): PipelineTrigger {
  const schedule = trigger.schedule?.trim() ?? "";
  const purpose = trigger.purpose?.trim() ?? "";
  const mixed = trigger.autoTrigger && schedule.length > 0;
  return {
    autoTrigger: trigger.autoTrigger,
    ...(schedule ? { schedule } : {}),
    ...(mixed && purpose ? { purpose } : {}),
  };
}

function normalizePipelineConfigForCreate(config: PipelineConfig, defaultBranch: string): PipelineConfig {
  const gatedConfig = enforceProductionDeployManualGate(config);
  const finalJobs = normalizePipelineJobs(gatedConfig.jobs, gatedConfig.stages, defaultBranch);
  return {
    ...gatedConfig,
    buildImage: gatedConfig.buildImage?.trim() ?? "",
    trigger: normalizeTriggerForPersist(gatedConfig.trigger),
    stages: normalizeStageSettings(gatedConfig.stages),
    jobs: finalJobs,
  };
}

function createInitialConfig(
  defaultBranch: string,
  defaults?: PipelineConfigDefaults | undefined
): WizardPipelineConfig {
  const base = enforceProductionDeployManualGate(createDefaultPipelineConfig("", defaultBranch, defaults));
  return {
    ...base,
    concurrencyMode: getDefaultConcurrencyMode(base.environment ?? "production"),
  } as PipelineConfig & { concurrencyMode: ConcurrencyMode };
}

export default function CreatePipelineWizard({
  open,
  onClose,
  onCreated,
  projectId,
  dict,
}: Props) {
  const { project } = useProject();
  const p = dict.pipelines;

  const [wizardStep, setWizardStep] = useState<WizardStep>("basic");
  const [selectedJobId, setSelectedJobId] = useState<string | null>("source");
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<WizardPipelineConfig>(() => createInitialConfig(project.default_branch));
  const availableBranches = useProjectBranches(project.id, project.default_branch);
  const sourceBranch = useMemo(
    () => getSourceBranch(config.jobs),
    [config.jobs]
  );
  const sourceBranchSource = useMemo(
    () => getSourceBranchSource(sourceBranch, project.default_branch),
    [project.default_branch, sourceBranch]
  );
  const branchOptions = useMemo(
    () =>
      Array.from(new Set([project.default_branch, ...availableBranches, sourceBranch])).map((branch) => ({
        value: branch,
        label: branch,
        keywords: [branch],
      })),
    [availableBranches, project.default_branch, sourceBranch]
  );
  const [inferredDefaults, setInferredDefaults] = useState<PipelineConfigDefaults | null>(null);
  const [environmentOptions, setEnvironmentOptions] = useState<PipelineEnvironmentDefinition[]>(
    DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map((item) => ({ ...item }))
  );
  const configDirtyRef = useRef(false);

  const normalizedJobs = useMemo(
    () => normalizePipelineJobs(config.jobs, config.stages, project.default_branch),
    [config.jobs, config.stages, project.default_branch]
  );
  const diagnostics = useMemo(
    () => analyzePipelineConfig(config, normalizedJobs),
    [config, normalizedJobs]
  );
  const hasBlockingErrors = useMemo(
    () => diagnostics.some((item) => item.level === "error"),
    [diagnostics]
  );

  useEffect(() => {
    if (config.jobs.length === 0) return;
    if (!selectedJobId || !config.jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(config.jobs[0]!.id);
    }
  }, [config.jobs, selectedJobId]);

  useEffect(() => {
    if (!open) return;

    let active = true;
    const controller = new AbortController();

    const loadInferredDefaults = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/pipeline-defaults`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const defaults = (data?.defaults ?? null) as PipelineConfigDefaults | null;
        if (!defaults || !defaults.buildImage) return;
        if (!active) return;

        setInferredDefaults(defaults);
        if (!configDirtyRef.current) {
          setConfig(createInitialConfig(project.default_branch, defaults));
        }
      } catch {
        // ignore inference failures and fall back to the generic template
      }
    };

    void loadInferredDefaults();

    return () => {
      active = false;
      controller.abort();
    };
  }, [open, projectId, project.default_branch]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/runtime-settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        const nextOptions = normalizePipelineEnvironmentDefinitions(payload?.settings?.pipelineEnvironments);
        setEnvironmentOptions(nextOptions);
      } catch {
        if (active) {
          setEnvironmentOptions(DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map((item) => ({ ...item })));
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [open]);

  useEffect(() => {
    if (environmentOptions.length === 0) return;
    const environmentKeys = environmentOptions.map((item) => item.key);
    if (!config.environment || !environmentKeys.includes(config.environment)) {
      setConfig((current) =>
        updateEnvironmentWithRecommendedConcurrency(current, environmentKeys[0] ?? "production")
      );
    }
  }, [config.environment, environmentOptions]);

  function updateConfig(updater: (current: WizardPipelineConfig) => WizardPipelineConfig) {
    configDirtyRef.current = true;
    setConfig((current) => {
      const next = updater(current);
      return {
        ...enforceProductionDeployManualGate(next),
        concurrencyMode: next.concurrencyMode,
      };
    });
  }

  function resetForm() {
    configDirtyRef.current = false;
    setWizardStep("basic");
    setSubmitting(false);
    setName("");
    setDescription("");
    const initialConfig = createInitialConfig(project.default_branch, inferredDefaults ?? undefined);
    setConfig(initialConfig);
    setSelectedJobId(initialConfig.jobs[0]?.id ?? null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function goNext() {
    const index = WIZARD_STEPS.indexOf(wizardStep);
    const next = WIZARD_STEPS[index + 1];
    if (next) {
      setWizardStep(next);
    }
  }

  function goBack() {
    const index = WIZARD_STEPS.indexOf(wizardStep);
    const previous = WIZARD_STEPS[index - 1];
    if (previous) {
      setWizardStep(previous);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const trimmedName = name.trim();
      const trimmedDescription = description.trim();
      const normalizedConfig = normalizePipelineConfigForCreate(config, project.default_branch);
      const jobDiagnostics = analyzePipelineConfig(normalizedConfig, normalizedConfig.jobs);
      const firstError = jobDiagnostics.find((item) => item.level === "error");

      if (!trimmedName) {
        toast.error(p.basic.nameRequired);
        return;
      }

      if (firstError) {
        toast.error(firstError.message ?? p.jobs.invalidConfigError);
        return;
      }

      const finalConfig: PipelineConfig = {
        ...normalizedConfig,
        name: trimmedName,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      };

      const response = await fetch("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: trimmedName,
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          config: finalConfig,
          concurrency_mode: config.concurrencyMode,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || "Create failed");
      }

      const data = await response.json();
      const pipelineId = typeof data?.pipeline?.id === "string" ? data.pipeline.id : null;
      toast.success(p.createSuccess);
      handleClose();
      if (pipelineId) {
        onCreated(pipelineId);
      }
    } catch {
      toast.error(p.createFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const stepIndex = WIZARD_STEPS.indexOf(wizardStep);
  const isLastStep = wizardStep === "notifications";

  return (
    <Dialog open={open} onOpenChange={(value) => !value && handleClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-[hsl(var(--ds-border-1))] px-6 pb-4 pt-6">
          <DialogTitle className="text-heading-sm">{p.new}</DialogTitle>
          <div className="mt-3 flex items-center gap-2">
            {WIZARD_STEPS.map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <button
                  type="button"
                  className="group flex items-center gap-1.5"
                  onClick={() => index < stepIndex && setWizardStep(step)}
                  disabled={index > stepIndex}
                >
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-[4px] text-[12px] font-medium transition-colors ${
                      index <= stepIndex
                        ? "bg-foreground text-background"
                        : "bg-muted text-[hsl(var(--ds-text-2))]"
                    }`}
                  >
                    {index < stepIndex ? "✓" : index + 1}
                  </div>
                  <span
                    className={`text-[13px] ${
                      index === stepIndex
                        ? "font-medium text-foreground"
                        : "text-[hsl(var(--ds-text-2))]"
                    }`}
                  >
                    {
                      p.wizard[
                        `step${step.charAt(0).toUpperCase() + step.slice(1) as "Basic" | "Jobs" | "Notifications"}`
                      ]
                    }
                  </span>
                </button>
                {index < WIZARD_STEPS.length - 1 && <div className="h-px w-6 bg-border" />}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {wizardStep === "basic" && (
            <div className="max-w-2xl space-y-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">
                  {p.basic.name}
                  <span className="ml-0.5 text-danger">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={p.basic.namePlaceholder}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">{p.basic.description}</label>
                <Input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={p.basic.descriptionPlaceholder}
                />
              </div>

              <div className="max-w-sm space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">{p.basic.environment}</label>
                <Select
                  value={config.environment ?? "production"}
                  onValueChange={(value) =>
                    updateConfig((current) =>
                      updateEnvironmentWithRecommendedConcurrency(current, value as PipelineEnvironment)
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {environmentOptions.map((environment) => (
                      <SelectItem key={environment.key} value={environment.key}>
                        {environment.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                  {p.basic.environmentHelp}
                </div>
              </div>

              <BuildImageField
                dict={p.basic}
                buildImage={config.buildImage ?? ""}
                required
                onChange={(patch) => updateConfig((current) => ({ ...current, ...patch }))}
              />

              <div className="space-y-2 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium text-foreground">{p.basic.branch}</div>
                    <div className="mt-0.5 text-[12px] text-[hsl(var(--ds-text-2))]">{p.basic.branchHelp}</div>
                  </div>
                  <div className="shrink-0 rounded-full border border-[hsl(var(--ds-border-1))] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--ds-text-2))]">
                    {sourceBranchSource === "project_default"
                      ? p.basic.sourceBranchProjectDefault
                      : p.basic.sourceBranchCustom}
                  </div>
                </div>
                <Combobox
                  value={normalizeBranchValue(sourceBranch, project.default_branch)}
                  options={branchOptions}
                  placeholder={p.basic.branchPlaceholder}
                  heading={p.basic.branchListHeading}
                  emptyLabel={p.basic.branchListEmpty}
                  onChange={(value) =>
                    updateConfig((current) => updateSourceBranch(current, value))
                  }
                />
                <div className="flex items-center justify-between gap-3 text-[12px] text-[hsl(var(--ds-text-2))]">
                  <span>{p.basic.projectDefaultBranch.replace("{{branch}}", project.default_branch)}</span>
                  <button
                      type="button"
                      className="font-medium text-[hsl(var(--ds-text-2))] transition-colors hover:text-foreground"
                      onClick={() => updateConfig((current) => updateSourceBranch(current, project.default_branch))}
                  >
                    {p.basic.resetToProjectDefaultBranch}
                  </button>
                </div>
              </div>

              <div className="space-y-2 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
                <div className="text-[13px] font-medium text-foreground">{p.concurrencyMode.label}</div>
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.concurrencyMode.help}</div>
                <div className="grid gap-2 md:grid-cols-3">
                  {CONCURRENCY_MODES.map((mode) => {
                    const active = config.concurrencyMode === mode;
                    const isBlockedByProductionPolicy =
                      (config.environment ?? "production") === "production" && mode === "allow";
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          if (isBlockedByProductionPolicy) return;
                          updateConfig((current) => ({ ...current, concurrencyMode: mode }));
                        }}
                        disabled={isBlockedByProductionPolicy}
                        className={`rounded-[8px] border px-3 py-2 text-left text-[13px] transition-colors ${
                          active
                            ? "border-foreground bg-background text-foreground"
                            : "border-[hsl(var(--ds-border-1))] bg-background text-[hsl(var(--ds-text-2))] hover:border-foreground/40"
                        } ${isBlockedByProductionPolicy ? "cursor-not-allowed opacity-50 hover:border-[hsl(var(--ds-border-1))]" : ""}`}
                      >
                        <div className="font-medium">{getConcurrencyOptionLabel(p, mode)}</div>
                        <div className="mt-0.5 text-[12px] opacity-70">{getConcurrencyOptionHelp(p, mode)}</div>
                      </button>
                    );
                  })}
                </div>
                {(config.environment ?? "production") === "production" && (
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                    {p.concurrencyMode.productionPolicyHelp}
                  </div>
                )}
              </div>
              {inferredDefaults && (
                <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-3 py-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                  <div className="font-medium text-foreground">{p.basic.autoDetected}</div>
                  <div className="mt-0.5">{p.basic.autoDetectedHelp}</div>
                </div>
              )}

              <div className="flex items-start gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
                <Switch
                  checked={config.trigger.autoTrigger}
                  onCheckedChange={(checked) =>
                    updateConfig((current) => ({
                      ...current,
                      trigger: normalizeTriggerForEdit(current.trigger, { autoTrigger: checked }),
                    }))
                  }
                />
                <div>
                  <div className="text-sm font-medium text-foreground">{p.basic.autoTrigger}</div>
                  <div className="mt-0.5 text-[12px] text-[hsl(var(--ds-text-2))]">
                    {p.basic.autoTriggerHelp}
                  </div>
                </div>
              </div>

              <div className="max-w-2xl">
                <PipelineScheduleField
                  value={config.trigger.schedule ?? ""}
                  onChange={(value) =>
                    updateConfig((current) => ({
                      ...current,
                      trigger: normalizeTriggerForEdit(current.trigger, { schedule: value }),
                    }))
                  }
                />
              </div>
              {isDualTriggerMode(config.trigger) && (
                <div className="max-w-2xl space-y-1.5">
                  <label className="text-[13px] font-medium text-foreground">
                    {p.basic.mixedTriggerPurposeLabel}
                  </label>
                  <Input
                    value={config.trigger.purpose ?? ""}
                    onChange={(event) =>
                      updateConfig((current) => ({
                        ...current,
                        trigger: normalizeTriggerForEdit(current.trigger, { purpose: event.target.value }),
                      }))
                    }
                    placeholder={p.basic.mixedTriggerPurposePlaceholder}
                  />
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                    {p.basic.mixedTriggerPurposeHelp}
                  </div>
                </div>
              )}
            </div>
          )}

          {wizardStep === "jobs" && (
            <div className="space-y-6 pb-2">
              <DiagnosticsPanel diagnostics={diagnostics} dict={p} />

              <StageBuilder
                jobs={config.jobs}
                stageSettings={config.stages}
                dict={p}
                artifactLoadFailedMessage={dict.artifacts.loadFailed}
                isAdmin
                selectedJobId={selectedJobId}
                onSelectJob={setSelectedJobId}
                onJobsChange={(jobs) => updateConfig((current) => ({ ...current, jobs }))}
                onStageSettingsChange={(stages) => updateConfig((current) => ({ ...current, stages }))}
              />
            </div>
          )}

          {wizardStep === "notifications" && (
            <div className="max-w-2xl space-y-4">
              <div>
                <div className="text-sm font-medium text-foreground">{p.notifications.title}</div>
                <div className="mt-0.5 text-[12px] text-[hsl(var(--ds-text-2))]">
                  {p.notifications.description}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-[8px] border border-[hsl(var(--ds-border-1))] px-4 py-3">
                  <span className="text-sm text-foreground">{p.notifications.onSuccess}</span>
                  <Switch
                    checked={config.notifications.onSuccess}
                    onCheckedChange={(checked) =>
                      updateConfig((current) => ({
                        ...current,
                        notifications: {
                          ...current.notifications,
                          onSuccess: checked,
                        },
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between rounded-[8px] border border-[hsl(var(--ds-border-1))] px-4 py-3">
                  <span className="text-sm text-foreground">{p.notifications.onFailure}</span>
                  <Switch
                    checked={config.notifications.onFailure}
                    onCheckedChange={(checked) =>
                      updateConfig((current) => ({
                        ...current,
                        notifications: {
                          ...current.notifications,
                          onFailure: checked,
                        },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[13px] font-medium text-foreground">{p.notifications.channels}</div>
                <div className="flex gap-3">
                  {(["inapp", "email"] as const).map((channel) => {
                    const active = config.notifications.channels.includes(channel);
                    return (
                      <button
                        type="button"
                        key={channel}
                        onClick={() =>
                          updateConfig((current) => ({
                            ...current,
                            notifications: {
                              ...current.notifications,
                              channels: active
                                ? current.notifications.channels.filter((item) => item !== channel)
                                : [...current.notifications.channels, channel],
                            },
                          }))
                        }
                        className={`flex-1 rounded-[8px] border py-2 text-[13px] font-medium transition-colors ${
                          active
                            ? "border-foreground bg-muted text-foreground"
                            : "border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:border-foreground/40"
                        }`}
                      >
                        {p.notifications[channel]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[hsl(var(--ds-border-1))] px-6 py-4">
          <Button variant="ghost" size="sm" onClick={stepIndex === 0 ? handleClose : goBack}>
            {stepIndex === 0 ? (
              dict.common.cancel
            ) : (
              <span className="flex items-center gap-1">
                <ChevronLeft className="size-3.5" />
                {p.wizard.back}
              </span>
            )}
          </Button>

          {isLastStep ? (
            <Button variant="default" size="sm" onClick={handleSubmit} disabled={submitting}>
              {submitting ? dict.common.loading : p.wizard.finish}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={goNext}
              disabled={(wizardStep === "basic" && !name.trim()) || (wizardStep === "jobs" && hasBlockingErrors)}
            >
              <span className="flex items-center gap-1">
                {p.wizard.next}
                <ChevronRight className="size-3.5" />
              </span>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiagnosticsPanel({
  diagnostics,
  dict,
}: {
  diagnostics: PipelineJobDiagnostic[];
  dict: Dictionary["pipelines"];
}) {
  const errors = diagnostics.filter((item) => item.level === "error");
  const warnings = diagnostics.filter((item) => item.level === "warning");
  const suggestions = diagnostics.filter((item) => item.level === "suggestion");

  return (
    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
      <div className="text-[13px] font-medium text-foreground">{dict.jobs.diagnosticsTitle}</div>
      <div className="mt-2 space-y-1.5">
        {diagnostics.length === 0 && (
          <div className="text-[12px] text-success">{dict.jobs.diagnosticsHealthy}</div>
        )}
        {errors.map((item, index) => (
          <div key={`error-${index}`} className="text-[12px] text-danger">
            {dict.jobs.diagnosticsErrorPrefix}: {item.message}
          </div>
        ))}
        {warnings.map((item, index) => (
          <div key={`warning-${index}`} className="text-[12px] text-warning">
            {dict.jobs.diagnosticsWarningPrefix}: {item.message}
          </div>
        ))}
        {suggestions.map((item, index) => (
          <div key={`suggestion-${index}`} className="text-[12px] text-[hsl(var(--ds-text-2))]">
            {dict.jobs.diagnosticsSuggestionPrefix}: {item.message}
          </div>
        ))}
      </div>
    </div>
  );
}
