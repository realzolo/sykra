"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n";
import type {
  PipelineConfig,
  PipelineEnvironment,
  PipelineJobDiagnostic,
  PipelineJob,
  PipelineJobType,
  PipelineStep,
} from "@/services/pipelineTypes";
import {
  analyzePipelineJobs,
  createDefaultJob,
  createDefaultPipelineConfig,
  createUniqueJobId,
  createDefaultStep,
  newId,
  renameJobId,
} from "@/services/pipelineTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (pipelineId: string) => void;
  projectId: string;
  dict: Dictionary;
};

type WizardStep = "basic" | "jobs" | "notifications";
const WIZARD_STEPS: WizardStep[] = ["basic", "jobs", "notifications"];

const ENV_OPTIONS: PipelineEnvironment[] = [
  "development",
  "staging",
  "production",
];

const JOB_TYPE_OPTIONS: PipelineJobType[] = [
  "source_checkout",
  "review_gate",
  "shell",
];

const BUILD_TEMPLATES: Record<
  string,
  { steps: Array<Omit<PipelineStep, "id">> }
> = {
  node: {
    steps: [
      { name: "Install dependencies", script: "npm install" },
      { name: "Build", script: "npm run build" },
    ],
  },
  python: {
    steps: [
      { name: "Install dependencies", script: "pip install -r requirements.txt" },
      { name: "Build", script: "python setup.py build" },
    ],
  },
  go: {
    steps: [
      { name: "Download modules", script: "go mod download" },
      { name: "Build", script: "go build ./..." },
    ],
  },
};

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function ensureBuiltinSteps(job: PipelineJob): PipelineJob {
  if (job.type === "source_checkout") {
    return {
      ...job,
      steps: job.steps.length > 0 ? job.steps : [{ id: "checkout", name: "Checkout", script: "" }],
    };
  }
  if (job.type === "review_gate") {
    return {
      ...job,
      steps: job.steps.length > 0 ? job.steps : [{ id: "gate", name: "Quality Gate", script: "" }],
    };
  }
  return {
    ...job,
    type: "shell",
    steps: job.steps.length > 0 ? job.steps : [createDefaultStep("Run command")],
  };
}

function normalizeJobs(jobs: PipelineJob[], triggerBranch: string): PipelineJob[] {
  const validIds = new Set(jobs.map((job) => job.id));
  return jobs.map((item) => {
    const job = ensureBuiltinSteps(item);
    const needs = (job.needs ?? []).filter((need) => need !== job.id && validIds.has(need));
    if (job.type === "source_checkout") {
      return { ...job, needs, branch: job.branch?.trim() || triggerBranch || "main" };
    }
    if (job.type === "review_gate") {
      return { ...job, needs, minScore: Math.min(100, Math.max(0, job.minScore ?? 60)) };
    }
    return { ...job, needs };
  });
}

export default function CreatePipelineWizard({
  open,
  onClose,
  onCreated,
  projectId,
  dict,
}: Props) {
  const p = dict.pipelines;

  const [wizardStep, setWizardStep] = useState<WizardStep>("basic");
  const [selectedJobId, setSelectedJobId] = useState<string>("source");
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<PipelineConfig>(() => createDefaultPipelineConfig(""));

  const selectedJob = useMemo(
    () => config.jobs.find((job) => job.id === selectedJobId) ?? null,
    [config.jobs, selectedJobId]
  );
  const diagnostics = useMemo(() => analyzePipelineJobs(config.jobs), [config.jobs]);
  const hasBlockingErrors = useMemo(
    () => diagnostics.some((item) => item.level === "error"),
    [diagnostics]
  );

  useEffect(() => {
    if (config.jobs.length === 0) return;
    if (!config.jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(config.jobs[0]!.id);
    }
  }, [config.jobs, selectedJobId]);

  function resetForm() {
    setWizardStep("basic");
    setName("");
    setDescription("");
    setConfig(createDefaultPipelineConfig(""));
    setSelectedJobId("source");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function canAdvanceBasic() {
    return name.trim().length > 0;
  }

  function goNext() {
    const idx = WIZARD_STEPS.indexOf(wizardStep);
    if (idx < WIZARD_STEPS.length - 1) {
      const next = WIZARD_STEPS[idx + 1];
      if (next) setWizardStep(next);
    }
  }

  function goBack() {
    const idx = WIZARD_STEPS.indexOf(wizardStep);
    if (idx > 0) {
      const prev = WIZARD_STEPS[idx - 1];
      if (prev) setWizardStep(prev);
    }
  }

  function updateJob(jobId: string, patch: Partial<PipelineJob>) {
    setConfig((prev) => ({
      ...prev,
      jobs: prev.jobs.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
    }));
  }

  function updateJobId(oldId: string, nextRawId: string) {
    const nextId = createUniqueJobId(
      nextRawId,
      config.jobs.filter((job) => job.id !== oldId).map((job) => job.id)
    );
    setConfig((prev) => ({
      ...prev,
      jobs: renameJobId(prev.jobs, oldId, nextRawId),
    }));
    setSelectedJobId(nextId);
  }

  function setJobType(jobId: string, type: PipelineJobType) {
    setConfig((prev) => ({
      ...prev,
      jobs: prev.jobs.map((job) => {
        if (job.id !== jobId) return job;
        if (type === "source_checkout") {
          return ensureBuiltinSteps({
            ...job,
            type,
            branch: job.branch ?? prev.trigger.branch,
          });
        }
        if (type === "review_gate") {
          return ensureBuiltinSteps({
            ...job,
            type,
            minScore: job.minScore ?? 60,
          });
        }
        return ensureBuiltinSteps({ ...job, type });
      }),
    }));
  }

  function addJob() {
    const next = createDefaultJob(
      `Job ${config.jobs.length + 1}`,
      config.jobs.map((job) => job.id)
    );
    setConfig((prev) => ({ ...prev, jobs: [...prev.jobs, next] }));
    setSelectedJobId(next.id);
  }

  function removeJob(jobId: string) {
    if (config.jobs.length <= 1) return;
    setConfig((prev) => ({
      ...prev,
      jobs: prev.jobs.filter((job) => job.id !== jobId),
    }));
  }

  function toggleNeed(jobId: string, dependencyId: string) {
    const target = config.jobs.find((job) => job.id === jobId);
    if (!target) return;
    const current = target.needs ?? [];
    const active = current.includes(dependencyId);
    updateJob(jobId, {
      needs: active ? current.filter((item) => item !== dependencyId) : [...current, dependencyId],
    });
  }

  function addStep(jobId: string) {
    const job = config.jobs.find((item) => item.id === jobId);
    if (!job || job.type !== "shell") return;
    updateJob(jobId, { steps: [...job.steps, createDefaultStep()] });
  }

  function removeStep(jobId: string, stepId: string) {
    const job = config.jobs.find((item) => item.id === jobId);
    if (!job || job.type !== "shell") return;
    updateJob(jobId, { steps: job.steps.filter((step) => step.id !== stepId) });
  }

  function updateStep(jobId: string, stepId: string, patch: Partial<PipelineStep>) {
    const job = config.jobs.find((item) => item.id === jobId);
    if (!job || job.type !== "shell") return;
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

  function applyTemplate(template: keyof typeof BUILD_TEMPLATES) {
    if (!selectedJob || selectedJob.type !== "shell") return;
    const tpl = BUILD_TEMPLATES[template];
    if (!tpl) return;
    updateJob(selectedJob.id, {
      steps: tpl.steps.map((step) => ({ ...step, id: newId("step") })),
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const trimmedName = name.trim();
      const trimmedDescription = description.trim();
      const triggerBranch = config.trigger.branch.trim() || "main";
      const jobs = normalizeJobs(config.jobs, triggerBranch);
      const jobDiagnostics = analyzePipelineJobs(jobs);

      if (jobDiagnostics.some((item) => item.level === "error")) {
        const firstError = jobDiagnostics.find((item) => item.level === "error");
        toast.error(firstError?.message ?? p.jobs.invalidConfigError);
        return;
      }

      const finalConfig: PipelineConfig = {
        ...config,
        name: trimmedName,
        trigger: {
          ...config.trigger,
          branch: triggerBranch,
        },
        jobs,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      };

      const res = await fetch("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: trimmedName,
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          config: finalConfig,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Create failed");
      }

      const data = await res.json();
      const id = data?.pipeline?.id;
      toast.success(p.createSuccess);
      handleClose();
      if (id) onCreated(id);
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
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-[hsl(var(--ds-border-1))] shrink-0">
          <DialogTitle className="text-heading-sm">{p.new}</DialogTitle>
          <div className="flex items-center gap-2 mt-3">
            {WIZARD_STEPS.map((step, idx) => (
              <div key={step} className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 group"
                  onClick={() => idx < stepIndex && setWizardStep(step)}
                  disabled={idx > stepIndex}
                >
                  <div
                    className={`w-5 h-5 rounded-[4px] flex items-center justify-center text-[11px] font-medium transition-colors ${
                      idx <= stepIndex
                        ? "bg-foreground text-background"
                        : "bg-muted text-[hsl(var(--ds-text-2))]"
                    }`}
                  >
                    {idx < stepIndex ? "✓" : idx + 1}
                  </div>
                  <span
                    className={`text-xs ${
                      idx === stepIndex
                        ? "text-foreground font-medium"
                        : "text-[hsl(var(--ds-text-2))]"
                    }`}
                  >
                    {p.wizard[
                      `step${step.charAt(0).toUpperCase() + step.slice(1) as "Basic" | "Jobs" | "Notifications"}`
                    ]}
                  </span>
                </button>
                {idx < WIZARD_STEPS.length - 1 && <div className="w-6 h-px bg-border" />}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {wizardStep === "basic" && (
            <div className="space-y-4 max-w-2xl">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  {p.basic.name}
                  <span className="text-danger ml-0.5">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={p.basic.namePlaceholder}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">{p.basic.description}</label>
                <Input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={p.basic.descriptionPlaceholder}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">{p.basic.environment}</label>
                  <Select
                    value={config.environment ?? "production"}
                    onValueChange={(value) =>
                      setConfig((prev) => ({ ...prev, environment: value as PipelineEnvironment }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENV_OPTIONS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {p.env[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">{p.basic.branch}</label>
                  <Input
                    value={config.trigger.branch}
                    onChange={(event) =>
                      setConfig((prev) => ({
                        ...prev,
                        trigger: { ...prev.trigger, branch: event.target.value },
                      }))
                    }
                    placeholder={p.basic.branchPlaceholder}
                  />
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
                <Switch
                  checked={config.trigger.autoTrigger}
                  onCheckedChange={(value) =>
                    setConfig((prev) => ({
                      ...prev,
                      trigger: { ...prev.trigger, autoTrigger: value },
                    }))
                  }
                />
                <div>
                  <div className="text-sm font-medium">{p.basic.autoTrigger}</div>
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                    {p.basic.autoTriggerHelp}
                  </div>
                </div>
              </div>
            </div>
          )}

          {wizardStep === "jobs" && (
            <div className="flex h-full min-h-[480px] gap-4">
              <aside className="w-64 shrink-0 border border-[hsl(var(--ds-border-1))] rounded-[8px] overflow-hidden bg-background">
                <div className="px-3 py-2 border-b border-[hsl(var(--ds-border-1))] flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{p.jobs.title}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={addJob}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <div className="max-h-[420px] overflow-y-auto p-2 space-y-1">
                  {config.jobs.map((job) => (
                    <div
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedJobId(job.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={`w-full rounded-[6px] px-2.5 py-2 text-left border transition-colors ${
                        selectedJobId === job.id
                          ? "border-foreground bg-muted text-foreground"
                          : "border-transparent hover:bg-[hsl(var(--ds-surface-1))]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium truncate">{job.name || job.id}</span>
                        {config.jobs.length > 1 && (
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
                      <div className="mt-0.5 text-[11px] text-[hsl(var(--ds-text-2))]">
                        {(job.type ?? "shell").replace("_", " ")}
                      </div>
                    </div>
                  ))}
                </div>
              </aside>

              <Separator orientation="vertical" className="h-auto" />

              <div className="flex-1 min-w-0">
                {!selectedJob ? (
                  <div className="h-full flex items-center justify-center text-[12px] text-[hsl(var(--ds-text-2))]">
                    {p.jobs.empty}
                  </div>
                ) : (
                  <div className="space-y-4 max-w-3xl">
                    <DiagnosticsPanel diagnostics={diagnostics} dict={p} />
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">{p.jobs.id}</label>
                        <Input
                          value={selectedJob.id}
                          onChange={(event) => updateJobId(selectedJob.id, event.target.value)}
                          placeholder="build"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">{p.jobs.name}</label>
                        <Input
                          value={selectedJob.name}
                          onChange={(event) => updateJob(selectedJob.id, { name: event.target.value })}
                          placeholder="Build"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">{p.jobs.type}</label>
                        <Select
                          value={selectedJob.type ?? "shell"}
                          onValueChange={(value) => setJobType(selectedJob.id, value as PipelineJobType)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {JOB_TYPE_OPTIONS.map((type) => (
                              <SelectItem key={type} value={type}>
                                {p.jobs.typeLabel[type]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">{p.jobs.needs}</label>
                        <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-2.5 space-y-2">
                          {config.jobs
                            .filter((job) => job.id !== selectedJob.id)
                            .map((job) => {
                              const active = (selectedJob.needs ?? []).includes(job.id);
                              return (
                                <button
                                  key={job.id}
                                  type="button"
                                  onClick={() => toggleNeed(selectedJob.id, job.id)}
                                  className={`w-full flex items-center justify-between rounded-[6px] px-2.5 py-1.5 border text-xs transition-colors ${
                                    active
                                      ? "border-foreground bg-muted text-foreground"
                                      : "border-transparent hover:bg-[hsl(var(--ds-surface-1))] text-[hsl(var(--ds-text-2))]"
                                  }`}
                                >
                                  <span className="truncate">{job.name || job.id}</span>
                                  <span className="font-mono text-[11px]">{job.id}</span>
                                </button>
                              );
                            })}
                          {config.jobs.length <= 1 && (
                            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.jobs.noDependencyCandidates}</div>
                          )}
                        </div>
                        <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.jobs.needsHelp}</div>
                      </div>
                    </div>

                    {(selectedJob.type ?? "shell") === "source_checkout" && (
                      <div className="space-y-1.5 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
                        <label className="text-xs font-medium text-foreground">{p.jobs.sourceBranch}</label>
                        <Input
                          value={selectedJob.branch ?? config.trigger.branch}
                          onChange={(event) => updateJob(selectedJob.id, { branch: event.target.value })}
                          placeholder={p.basic.branchPlaceholder}
                        />
                      </div>
                    )}

                    {(selectedJob.type ?? "shell") === "review_gate" && (
                      <div className="space-y-1.5 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
                        <label className="text-xs font-medium text-foreground">{p.jobs.reviewMinScore}</label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            className="w-24"
                            value={selectedJob.minScore ?? 60}
                            onChange={(event) =>
                              updateJob(selectedJob.id, {
                                minScore: Math.min(100, Math.max(0, Number(event.target.value))),
                              })
                            }
                          />
                          <span className="text-[12px] text-[hsl(var(--ds-text-2))]">/ 100</span>
                        </div>
                      </div>
                    )}

                    {(selectedJob.type ?? "shell") === "shell" && (
                      <JobStepEditor
                        dict={dict}
                        pipelineDict={p}
                        job={selectedJob}
                        onAddStep={() => addStep(selectedJob.id)}
                        onRemoveStep={(stepId) => removeStep(selectedJob.id, stepId)}
                        onUpdateStep={(stepId, patch) => updateStep(selectedJob.id, stepId, patch)}
                        onApplyTemplate={applyTemplate}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {wizardStep === "notifications" && (
            <div className="space-y-4 max-w-2xl">
              <div>
                <div className="text-sm font-medium">{p.notifications.title}</div>
                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                  {p.notifications.description}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-[8px] border border-[hsl(var(--ds-border-1))] px-4 py-3">
                  <span className="text-sm">{p.notifications.onSuccess}</span>
                  <Switch
                    checked={config.notifications.onSuccess}
                    onCheckedChange={(value) =>
                      setConfig((prev) => ({
                        ...prev,
                        notifications: { ...prev.notifications, onSuccess: value },
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-[8px] border border-[hsl(var(--ds-border-1))] px-4 py-3">
                  <span className="text-sm">{p.notifications.onFailure}</span>
                  <Switch
                    checked={config.notifications.onFailure}
                    onCheckedChange={(value) =>
                      setConfig((prev) => ({
                        ...prev,
                        notifications: { ...prev.notifications, onFailure: value },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-foreground">{p.notifications.channels}</div>
                <div className="flex gap-3">
                  {(["inapp", "email"] as const).map((channel) => {
                    const active = config.notifications.channels.includes(channel);
                    return (
                      <button
                        type="button"
                        key={channel}
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              channels: active
                                ? prev.notifications.channels.filter((item) => item !== channel)
                                : [...prev.notifications.channels, channel],
                            },
                          }))
                        }
                        className={`flex-1 py-2 rounded-[8px] border text-xs font-medium transition-colors ${
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

        <div className="px-6 py-4 border-t border-[hsl(var(--ds-border-1))] shrink-0 flex items-center justify-between">
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
              disabled={(wizardStep === "basic" && !canAdvanceBasic()) || (wizardStep === "jobs" && hasBlockingErrors)}
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
  const hasAny = diagnostics.length > 0;

  return (
    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5 space-y-2">
      <div className="text-xs font-medium text-foreground">{dict.jobs.diagnosticsTitle}</div>
      {!hasAny && (
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
  );
}

function JobStepEditor({
  dict,
  pipelineDict,
  job,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
  onApplyTemplate,
}: {
  dict: Dictionary;
  pipelineDict: Dictionary["pipelines"];
  job: PipelineJob;
  onAddStep: () => void;
  onRemoveStep: (stepId: string) => void;
  onUpdateStep: (stepId: string, patch: Partial<PipelineStep>) => void;
  onApplyTemplate: (template: keyof typeof BUILD_TEMPLATES) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{pipelineDict.jobs.steps}</div>
        <div className="flex items-center gap-2">
          {(["node", "python", "go"] as const).map((template) => (
            <button
              key={template}
              type="button"
              onClick={() => onApplyTemplate(template)}
              className="text-xs px-2 py-1 rounded border border-[hsl(var(--ds-border-1))] hover:bg-[hsl(var(--ds-surface-1))]"
            >
              {pipelineDict.jobs.templateLabel[template]}
            </button>
          ))}
        </div>
      </div>

      {job.steps.map((step, idx) => (
        <div
          key={step.id}
          className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-3 space-y-2.5"
        >
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[hsl(var(--ds-text-2))] font-medium w-5 shrink-0">
              {idx + 1}.
            </span>
            <Input
              value={step.name}
              onChange={(event) => onUpdateStep(step.id, { name: event.target.value })}
              placeholder={pipelineDict.step.namePlaceholder}
              className="h-7 text-xs flex-1"
            />
            <button
              type="button"
              onClick={() => onRemoveStep(step.id)}
              className="text-[hsl(var(--ds-text-2))] hover:text-danger transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[hsl(var(--ds-text-2))] w-20 shrink-0">
              {pipelineDict.steps.typeLabel}
            </span>
            <div className="flex gap-1">
              {(["shell", "docker"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onUpdateStep(step.id, { type })}
                  className={`px-2.5 py-1 text-[11px] rounded-[4px] border transition-colors ${
                    (step.type ?? "shell") === type
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:bg-muted/40"
                  }`}
                >
                  {type === "shell" ? pipelineDict.steps.typeShell : pipelineDict.steps.typeDocker}
                </button>
              ))}
            </div>
          </div>

          {step.type === "docker" && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[hsl(var(--ds-text-2))] w-20 shrink-0">
                {pipelineDict.steps.dockerImage}
              </span>
              <Input
                value={step.dockerImage ?? ""}
                onChange={(event) => onUpdateStep(step.id, { dockerImage: event.target.value })}
                placeholder={pipelineDict.steps.dockerImagePlaceholder}
                className="h-7 text-xs flex-1"
              />
            </div>
          )}

          <Textarea
            value={step.script}
            onChange={(event) => onUpdateStep(step.id, { script: event.target.value })}
            placeholder={pipelineDict.step.scriptPlaceholder}
            rows={3}
            className="text-xs font-mono resize-none"
          />

          <div className="space-y-1.5">
            <span className="text-[11px] text-[hsl(var(--ds-text-2))]">
              {pipelineDict.steps.artifactPathsLabel}
            </span>
            <Textarea
              value={(step.artifactPaths ?? []).join("\n")}
              onChange={(event) =>
                onUpdateStep(step.id, { artifactPaths: splitLines(event.target.value) })
              }
              placeholder={pipelineDict.steps.artifactPathsPlaceholder}
              rows={2}
              className="text-xs font-mono resize-none"
            />
            <span className="text-[11px] text-[hsl(var(--ds-text-2))]">
              {pipelineDict.steps.artifactPathsHelp}
            </span>
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] text-[hsl(var(--ds-text-2))]">
              {pipelineDict.steps.artifactInputsLabel}
            </span>
            <Textarea
              value={(step.artifactInputs ?? []).join("\n")}
              onChange={(event) =>
                onUpdateStep(step.id, { artifactInputs: splitLines(event.target.value) })
              }
              placeholder={pipelineDict.steps.artifactInputsPlaceholder}
              rows={2}
              className="text-xs font-mono resize-none"
            />
            <span className="text-[11px] text-[hsl(var(--ds-text-2))]">
              {pipelineDict.steps.artifactInputsHelp}
            </span>
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={onAddStep} className="w-full">
        <Plus className="size-3.5 mr-1" />
        {dict.pipelines.build.addStep}
      </Button>
    </div>
  );
}
