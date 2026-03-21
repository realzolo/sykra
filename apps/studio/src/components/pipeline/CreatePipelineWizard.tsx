"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import type {
  PipelineConfig,
  PipelineEnvironment,
  PipelineJobDiagnostic,
} from "@/services/pipelineTypes";
import {
  analyzePipelineJobs,
  createDefaultPipelineConfig,
  normalizePipelineJobs,
  normalizeStageSettings,
} from "@/services/pipelineTypes";
import StageBuilder from "@/components/pipeline/StageBuilder";
import PipelineScheduleField from "@/components/pipeline/PipelineScheduleField";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (pipelineId: string) => void;
  projectId: string;
  dict: Dictionary;
};

type WizardStep = "basic" | "jobs" | "notifications";

const WIZARD_STEPS: WizardStep[] = ["basic", "jobs", "notifications"];
const ENV_OPTIONS: PipelineEnvironment[] = ["development", "staging", "production"];

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
  const [config, setConfig] = useState<PipelineConfig>(() => createDefaultPipelineConfig("", project.default_branch));

  const normalizedJobs = useMemo(
    () => normalizePipelineJobs(config.jobs, config.stages, project.default_branch),
    [config.jobs, config.stages, project.default_branch]
  );
  const diagnostics = useMemo(
    () => analyzePipelineJobs(normalizedJobs),
    [normalizedJobs]
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

  function resetForm() {
    const initialConfig = createDefaultPipelineConfig("", project.default_branch);
    setWizardStep("basic");
    setSelectedJobId(initialConfig.jobs[0]?.id ?? null);
    setSubmitting(false);
    setName("");
    setDescription("");
    setConfig(initialConfig);
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
      const finalJobs = normalizePipelineJobs(config.jobs, config.stages, project.default_branch);
      const jobDiagnostics = analyzePipelineJobs(finalJobs);
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
        ...config,
        name: trimmedName,
        trigger: {
          autoTrigger: config.trigger.autoTrigger,
          ...(config.trigger.schedule?.trim()
            ? { schedule: config.trigger.schedule.trim() }
            : {}),
        },
        stages: normalizeStageSettings(config.stages),
        jobs: finalJobs,
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
                    setConfig((current) => ({
                      ...current,
                      environment: value as PipelineEnvironment,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENV_OPTIONS.map((environment) => (
                      <SelectItem key={environment} value={environment}>
                        {p.env[environment]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                  {p.basic.environmentHelp}
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
                <Switch
                  checked={config.trigger.autoTrigger}
                  onCheckedChange={(checked) =>
                    setConfig((current) => ({
                      ...current,
                      trigger: {
                        ...current.trigger,
                        autoTrigger: checked,
                      },
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
                    setConfig((current) => ({
                      ...current,
                      trigger: { ...current.trigger, schedule: value },
                    }))
                  }
                />
              </div>
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
                onJobsChange={(jobs) => setConfig((current) => ({ ...current, jobs }))}
                onStageSettingsChange={(stages) => setConfig((current) => ({ ...current, stages }))}
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
                      setConfig((current) => ({
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
                      setConfig((current) => ({
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
                          setConfig((current) => ({
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
