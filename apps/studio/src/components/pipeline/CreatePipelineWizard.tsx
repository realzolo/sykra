"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, ChevronRight, ChevronLeft } from "lucide-react";
import type { Dictionary } from "@/i18n";
import type {
  PipelineConfig,
  PipelineEnvironment,
  PipelineStep,
} from "@/services/pipelineTypes";
import {
  createDefaultPipelineConfig,
  createDefaultStep,
  newId,
} from "@/services/pipelineTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (pipelineId: string) => void;
  projectId: string;
  dict: Dictionary;
};

type WizardStep = "basic" | "stages" | "notifications";
const WIZARD_STEPS: WizardStep[] = ["basic", "stages", "notifications"];

type StageTab = "source" | "review" | "build" | "deploy";
const STAGE_TABS: StageTab[] = ["source", "review", "build", "deploy"];

const ENV_OPTIONS: PipelineEnvironment[] = [
  "development",
  "staging",
  "production",
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

export default function CreatePipelineWizard({
  open,
  onClose,
  onCreated,
  projectId,
  dict,
}: Props) {
  const p = dict.pipelines;

  const [wizardStep, setWizardStep] = useState<WizardStep>("basic");
  const [stageTab, setStageTab] = useState<StageTab>("source");
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState<PipelineEnvironment>('production');

  // Config derived from createDefaultPipelineConfig but managed locally
  const [config, setConfig] = useState<PipelineConfig>(() =>
    createDefaultPipelineConfig("")
  );

  function resetForm() {
    setWizardStep('basic');
    setStageTab('source');
    setName('');
    setDescription('');
    setEnvironment('production');
    setConfig(createDefaultPipelineConfig(''));
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  // ── Step navigation ────────────────────────────────────────────────────────

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

  // ── Config helpers ─────────────────────────────────────────────────────────

  function addStep(stage: "build" | "deploy") {
    setConfig((prev) => ({
      ...prev,
      [stage]: {
        ...prev[stage],
        steps: [...prev[stage].steps, createDefaultStep()],
      },
    }));
  }

  function removeStep(stage: "build" | "deploy", stepId: string) {
    setConfig((prev) => ({
      ...prev,
      [stage]: {
        ...prev[stage],
        steps: prev[stage].steps.filter((s) => s.id !== stepId),
      },
    }));
  }

  function updateStep(
    stage: "build" | "deploy",
    stepId: string,
    patch: Partial<PipelineStep>
  ) {
    setConfig((prev) => ({
      ...prev,
      [stage]: {
        ...prev[stage],
        steps: prev[stage].steps.map((s) =>
          s.id === stepId
            ? (() => {
                const next = { ...s, ...patch };
                if (patch.type === "shell") {
                  delete next.dockerImage;
                }
                return next;
              })()
            : s
        ),
      },
    }));
  }

  function applyTemplate(template: keyof typeof BUILD_TEMPLATES) {
    const templateConfig = BUILD_TEMPLATES[template];
    if (!templateConfig) return;
    const { steps } = templateConfig;
    setConfig((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        steps: steps.map((s) => ({ ...s, id: newId("step") })),
      },
    }));
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const trimmedDescription = description.trim();
      const finalConfig: PipelineConfig = {
        ...config,
        name: name.trim(),
        source: { ...config.source },
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      };

      const res = await fetch("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: name.trim(),
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          environment,
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

  // ── Render ─────────────────────────────────────────────────────────────────

  const stepIndex = WIZARD_STEPS.indexOf(wizardStep);
  const isLastStep = wizardStep === "notifications";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-[hsl(var(--ds-border-1))] shrink-0">
          <DialogTitle className="text-heading-sm">{p.new}</DialogTitle>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mt-3">
            {WIZARD_STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <button
                  className="flex items-center gap-1.5 group"
                  onClick={() => i < stepIndex && setWizardStep(s)}
                  disabled={i > stepIndex}
                >
                  <div
                    className={`w-5 h-5 rounded-[4px] flex items-center justify-center text-[11px] font-medium transition-colors ${
                      i < stepIndex
                        ? "bg-foreground text-background"
                        : i === stepIndex
                        ? "bg-foreground text-background"
                        : "bg-muted text-[hsl(var(--ds-text-2))]"
                    }`}
                  >
                    {i < stepIndex ? "✓" : i + 1}
                  </div>
                  <span
                    className={`text-xs ${
                      i === stepIndex
                        ? "text-foreground font-medium"
                        : "text-[hsl(var(--ds-text-2))]"
                    }`}
                  >
                    {p.wizard[`step${s.charAt(0).toUpperCase() + s.slice(1) as "Basic" | "Stages" | "Notifications"}`]}
                  </span>
                </button>
                {i < WIZARD_STEPS.length - 1 && (
                  <div className="w-6 h-px bg-border" />
                )}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* ── Step 1: Basic ─────────────────────────────────────────── */}
          {wizardStep === "basic" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  {p.basic.name}
                  <span className="text-danger ml-0.5">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={p.basic.namePlaceholder}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  {p.basic.description}
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={p.basic.descriptionPlaceholder}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {p.basic.environment}
                  </label>
                  <Select
                    value={environment}
                    onValueChange={(v) =>
                      setEnvironment(v as PipelineEnvironment)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENV_OPTIONS.map((e) => (
                        <SelectItem key={e} value={e}>
                          {p.env[e]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {p.basic.branch}
                  </label>
                  <Input
                    value={config.source.branch}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        source: { ...prev.source, branch: e.target.value },
                      }))
                    }
                    placeholder={p.basic.branchPlaceholder}
                  />
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
                <Switch
                  checked={config.source.autoTrigger}
                  onCheckedChange={(v) =>
                    setConfig((prev) => ({
                      ...prev,
                      source: { ...prev.source, autoTrigger: v },
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

          {/* ── Step 2: Stages ────────────────────────────────────────── */}
          {wizardStep === "stages" && (
            <div className="flex gap-4 h-full">
              {/* Stage tabs (vertical) */}
              <div className="w-32 shrink-0 space-y-1">
                {STAGE_TABS.map((tab, i) => (
                  <button
                    key={tab}
                    onClick={() => setStageTab(tab)}
                    className={`w-full flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-xs transition-colors ${
                      stageTab === tab
                        ? "bg-muted text-foreground font-medium"
                        : "text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-surface-1))] hover:text-foreground"
                    }`}
                  >
                    <span className="w-4 h-4 rounded-[4px] bg-muted/80 text-[10px] flex items-center justify-center text-[hsl(var(--ds-text-2))] shrink-0">
                      {i + 1}
                    </span>
                    {p.stageTab[tab]}
                  </button>
                ))}
              </div>

              <Separator orientation="vertical" className="h-auto" />

              {/* Stage content */}
              <div className="flex-1 space-y-4">
                {/* Source */}
                {stageTab === "source" && (
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm font-medium">{p.source.title}</div>
                      <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                        {p.source.description}
                      </div>
                    </div>
                    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 p-4 space-y-2">
                      <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                        {dict.projects.repository}
                      </div>
                      <div className="text-sm font-medium">
                        {dict.nav.project.commits}
                      </div>
                      <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-2">
                        {p.basic.branch}
                      </div>
                      <div className="text-sm font-medium">
                        {config.source.branch || "main"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Review */}
                {stageTab === "review" && (
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm font-medium">{p.review.title}</div>
                      <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                        {p.review.description}
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-[8px] border border-[hsl(var(--ds-border-1))] px-4 py-3">
                      <div className="text-sm font-medium">{p.review.enabled}</div>
                      <Switch
                        checked={config.review.enabled}
                        onCheckedChange={(v) =>
                          setConfig((prev) => ({
                            ...prev,
                            review: { ...prev.review, enabled: v },
                          }))
                        }
                      />
                    </div>

                    {config.review.enabled && (
                      <div className="space-y-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">
                              {p.review.qualityGateEnabled}
                            </div>
                            <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                              {p.review.qualityGateHelp}
                            </div>
                          </div>
                          <Switch
                            checked={config.review.qualityGateEnabled}
                            onCheckedChange={(v) =>
                              setConfig((prev) => ({
                                ...prev,
                                review: {
                                  ...prev.review,
                                  qualityGateEnabled: v,
                                },
                              }))
                            }
                          />
                        </div>
                        {config.review.qualityGateEnabled && (
                          <div className="space-y-1.5 pt-2 border-t border-[hsl(var(--ds-border-1))]">
                            <label className="text-xs font-medium text-foreground">
                              {p.review.minScore}
                            </label>
                            <div className="flex items-center gap-3">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                value={config.review.qualityGateMinScore}
                                onChange={(e) =>
                                  setConfig((prev) => ({
                                    ...prev,
                                    review: {
                                      ...prev.review,
                                      qualityGateMinScore: Math.min(
                                        100,
                                        Math.max(0, Number(e.target.value))
                                      ),
                                    },
                                  }))
                                }
                                className="w-24"
                              />
                              <span className="text-[12px] text-[hsl(var(--ds-text-2))]">
                                / 100
                              </span>
                            </div>
                            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                              {p.review.minScoreHelp}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Build */}
                {stageTab === "build" && (
                  <StepEditor
                    title={p.build.title}
                    description={p.build.description}
                    enabled={config.build.enabled}
                    onToggle={(v) =>
                      setConfig((prev) => ({
                        ...prev,
                        build: { ...prev.build, enabled: v },
                      }))
                    }
                    enabledLabel={p.build.enabled}
                    steps={config.build.steps}
                    onAdd={() => addStep("build")}
                    onRemove={(id) => removeStep("build", id)}
                    onUpdate={(id, patch) => updateStep("build", id, patch)}
                    addLabel={p.build.addStep}
                    noStepsLabel={p.build.noSteps}
                    dict={p}
                    templates={
                      <div className="flex flex-wrap gap-2 pb-1">
                        <span className="text-[12px] text-[hsl(var(--ds-text-2))] self-center">
                          {p.build.templates}:
                        </span>
                        {(
                          ["node", "python", "go"] as Array<
                            keyof typeof BUILD_TEMPLATES
                          >
                        ).map((t) => (
                          <button
                            key={t}
                            onClick={() => applyTemplate(t)}
                            className="text-xs px-2 py-0.5 rounded border border-[hsl(var(--ds-border-1))] hover:bg-[hsl(var(--ds-surface-1))] transition-colors"
                          >
                            {p.build[`template${t.charAt(0).toUpperCase() + t.slice(1) as "Node" | "Python" | "Go"}`]}
                          </button>
                        ))}
                      </div>
                    }
                  />
                )}

                {/* Deploy */}
                {stageTab === "deploy" && (
                  <div className="space-y-4">
                    <StepEditor
                      title={p.deploy.title}
                      description={p.deploy.description}
                      enabled={config.deploy.enabled}
                      onToggle={(v) =>
                        setConfig((prev) => ({
                          ...prev,
                          deploy: { ...prev.deploy, enabled: v },
                        }))
                      }
                      enabledLabel={p.deploy.enabled}
                      steps={config.deploy.steps}
                      onAdd={() => addStep("deploy")}
                      onRemove={(id) => removeStep("deploy", id)}
                      onUpdate={(id, patch) => updateStep("deploy", id, patch)}
                      addLabel={p.deploy.addStep}
                      noStepsLabel={p.deploy.noSteps}
                      dict={p}
                    />
                    {config.deploy.enabled && (
                      <div className="flex items-start gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
                        <Switch
                          checked={config.deploy.rollbackEnabled}
                          onCheckedChange={(v) =>
                            setConfig((prev) => ({
                              ...prev,
                              deploy: { ...prev.deploy, rollbackEnabled: v },
                            }))
                          }
                        />
                        <div>
                          <div className="text-sm font-medium">
                            {p.deploy.rollbackEnabled}
                          </div>
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                            {p.deploy.rollbackHelp}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: Notifications ─────────────────────────────────── */}
          {wizardStep === "notifications" && (
            <div className="space-y-4">
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
                    onCheckedChange={(v) =>
                      setConfig((prev) => ({
                        ...prev,
                        notifications: {
                          ...prev.notifications,
                          onSuccess: v,
                        },
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-[8px] border border-[hsl(var(--ds-border-1))] px-4 py-3">
                  <span className="text-sm">{p.notifications.onFailure}</span>
                  <Switch
                    checked={config.notifications.onFailure}
                    onCheckedChange={(v) =>
                      setConfig((prev) => ({
                        ...prev,
                        notifications: {
                          ...prev.notifications,
                          onFailure: v,
                        },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-foreground">
                  {p.notifications.channels}
                </div>
                <div className="flex gap-3">
                  {(["inapp", "email"] as const).map((ch) => {
                    const active = config.notifications.channels.includes(ch);
                    return (
                      <button
                        key={ch}
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              channels: active
                                ? prev.notifications.channels.filter(
                                    (c) => c !== ch
                                  )
                                : [...prev.notifications.channels, ch],
                            },
                          }))
                        }
                        className={`flex-1 py-2 rounded-[8px] border text-xs font-medium transition-colors ${
                          active
                            ? "border-foreground bg-muted text-foreground"
                            : "border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:border-foreground/40"
                        }`}
                      >
                        {p.notifications[ch]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[hsl(var(--ds-border-1))] shrink-0 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={stepIndex === 0 ? handleClose : goBack}
          >
            {stepIndex === 0 ? dict.common.cancel : (
              <span className="flex items-center gap-1">
                <ChevronLeft className="size-3.5" />
                {p.wizard.back}
              </span>
            )}
          </Button>

          {isLastStep ? (
            <Button
              variant="default"
              size="sm"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? dict.common.loading : p.wizard.finish}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={goNext}
              disabled={wizardStep === "basic" && !canAdvanceBasic()}
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

// ── Shared step editor ─────────────────────────────────────────────────────

type StepEditorProps = {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  enabledLabel: string;
  steps: PipelineStep[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<PipelineStep>) => void;
  addLabel: string;
  noStepsLabel: string;
  dict: Dictionary["pipelines"];
  templates?: React.ReactNode;
};

function StepEditor({
  title,
  description,
  enabled,
  onToggle,
  enabledLabel,
  steps,
  onAdd,
  onRemove,
  onUpdate,
  addLabel,
  noStepsLabel,
  dict,
  templates,
}: StepEditorProps) {
  function toArtifactPaths(value: string): string[] {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">{description}</div>
      </div>

      <div className="flex items-center justify-between rounded-[8px] border border-[hsl(var(--ds-border-1))] px-4 py-3">
        <div className="text-sm font-medium">{enabledLabel}</div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>

      {enabled && (
        <div className="space-y-3">
          {templates && <div>{templates}</div>}

          {steps.length === 0 && (
            <div className="text-[12px] text-[hsl(var(--ds-text-2))] py-4 text-center">
              {noStepsLabel}
            </div>
          )}

          {steps.map((step, idx) => (
            <div
              key={step.id}
              className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-3 space-y-2.5"
            >
              <div className="flex items-center gap-2">
                <GripVertical className="size-3.5 text-[hsl(var(--ds-text-2))]/40 shrink-0" />
                <span className="text-[12px] text-[hsl(var(--ds-text-2))] font-medium w-4">
                  {idx + 1}
                </span>
                <Input
                  value={step.name}
                  onChange={(e) => onUpdate(step.id, { name: e.target.value })}
                  placeholder={dict.step.namePlaceholder}
                  className="h-7 text-xs flex-1"
                />
                <button
                  onClick={() => onRemove(step.id)}
                  className="text-[hsl(var(--ds-text-2))] hover:text-danger transition-colors"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <Textarea
                value={step.script}
                onChange={(e) => onUpdate(step.id, { script: e.target.value })}
                placeholder={dict.step.scriptPlaceholder}
                rows={3}
                className="text-xs font-mono resize-none"
              />
              <div className="space-y-1.5">
                <div className="text-[11px] text-[hsl(var(--ds-text-2))]">
                  {dict.steps.artifactPathsLabel}
                </div>
                <Textarea
                  value={(step.artifactPaths ?? []).join("\n")}
                  onChange={(e) =>
                    onUpdate(step.id, { artifactPaths: toArtifactPaths(e.target.value) })
                  }
                  placeholder={dict.steps.artifactPathsPlaceholder}
                  rows={2}
                  className="text-xs font-mono resize-none"
                />
                <div className="text-[11px] text-[hsl(var(--ds-text-2))]">
                  {dict.steps.artifactPathsHelp}
                </div>
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={onAdd}
            className="w-full"
          >
            <Plus className="size-3.5 mr-1" />
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
