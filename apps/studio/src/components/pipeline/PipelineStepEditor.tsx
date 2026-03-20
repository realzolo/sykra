"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n";
import type { PipelineJob, PipelineStep } from "@/services/pipelineTypes";

type BuildTemplateKey = "node" | "python" | "go";

const BUILD_TEMPLATES: Record<BuildTemplateKey, Array<Omit<PipelineStep, "id">>> = {
  node: [
    { name: "Install dependencies", script: "npm install" },
    { name: "Build", script: "npm run build" },
  ],
  python: [
    { name: "Install dependencies", script: "pip install -r requirements.txt" },
    { name: "Build", script: "python setup.py build" },
  ],
  go: [
    { name: "Download modules", script: "go mod download" },
    { name: "Build", script: "go build ./..." },
  ],
};

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function getBuildTemplateSteps(template: BuildTemplateKey): Array<Omit<PipelineStep, "id">> {
  return BUILD_TEMPLATES[template];
}

export default function PipelineStepEditor({
  dict,
  job,
  isAdmin,
  showTemplates = false,
  onApplyTemplate,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
}: {
  dict: Dictionary["pipelines"];
  job: PipelineJob;
  isAdmin: boolean;
  showTemplates?: boolean;
  onApplyTemplate?: (template: BuildTemplateKey) => void;
  onAddStep: () => void;
  onRemoveStep: (stepId: string) => void;
  onUpdateStep: (stepId: string, patch: Partial<PipelineStep>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground">{dict.jobs.steps}</div>
        {showTemplates && onApplyTemplate && (
          <div className="flex items-center gap-2">
            {(["node", "python", "go"] as const).map((template) => (
              <button
                key={template}
                type="button"
                onClick={() => onApplyTemplate(template)}
                disabled={!isAdmin}
                className={`rounded-[6px] border px-2 py-1 text-xs transition-colors ${
                  isAdmin
                    ? "border-[hsl(var(--ds-border-1))] hover:bg-[hsl(var(--ds-surface-1))]"
                    : "cursor-not-allowed opacity-60"
                }`}
              >
                {dict.jobs.templateLabel[template]}
              </button>
            ))}
          </div>
        )}
      </div>

      {job.steps.map((step, index) => (
        <div
          key={step.id}
          className="space-y-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-3"
        >
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
              {index + 1}.
            </span>
            <Input
              value={step.name}
              onChange={(event) => onUpdateStep(step.id, { name: event.target.value })}
              placeholder={dict.step.namePlaceholder}
              className="h-8 flex-1 text-xs"
              disabled={!isAdmin}
            />
            {isAdmin && job.steps.length > 1 && (
              <button
                type="button"
                onClick={() => onRemoveStep(step.id)}
                className="text-[hsl(var(--ds-text-2))] transition-colors hover:text-danger"
                aria-label={dict.step.delete}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="flex items-center gap-2 lg:min-w-[220px]">
              <span className="w-20 shrink-0 text-[11px] text-[hsl(var(--ds-text-2))]">
                {dict.steps.typeLabel}
              </span>
              <div className="flex gap-1">
                {(["shell", "docker"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onUpdateStep(step.id, { type })}
                    disabled={!isAdmin}
                    className={`rounded-[4px] border px-2.5 py-1 text-[11px] transition-colors ${
                      (step.type ?? "shell") === type
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))]"
                    } ${!isAdmin ? "cursor-not-allowed opacity-60" : "hover:bg-muted/40"}`}
                  >
                    {type === "shell" ? dict.steps.typeShell : dict.steps.typeDocker}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 lg:min-w-[220px]">
              <span className="w-20 shrink-0 text-[11px] text-[hsl(var(--ds-text-2))]">
                {dict.step.timeout}
              </span>
              <Input
                type="number"
                min={1}
                value={step.timeoutSeconds ?? ""}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  onUpdateStep(step.id, {
                    timeoutSeconds: Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined,
                  });
                }}
                placeholder="600"
                className="h-8 text-xs"
                disabled={!isAdmin}
              />
            </div>

            <div className="flex items-center gap-2 lg:min-w-[220px]">
              <Switch
                checked={step.continueOnError ?? false}
                onCheckedChange={(checked) => onUpdateStep(step.id, { continueOnError: checked })}
                disabled={!isAdmin}
              />
              <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.step.continueOnError}</span>
            </div>
          </div>

          {(step.type ?? "shell") === "docker" && (
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] text-[hsl(var(--ds-text-2))]">
                {dict.steps.dockerImage}
              </span>
              <Input
                value={step.dockerImage ?? ""}
                onChange={(event) => onUpdateStep(step.id, { dockerImage: event.target.value })}
                placeholder={dict.steps.dockerImagePlaceholder}
                className="h-8 flex-1 text-xs"
                disabled={!isAdmin}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">{dict.step.script}</span>
            <Textarea
              value={step.script}
              onChange={(event) => onUpdateStep(step.id, { script: event.target.value })}
              placeholder={dict.step.scriptPlaceholder}
              rows={3}
              className="resize-none font-mono text-xs"
              disabled={!isAdmin}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.steps.artifactPathsLabel}</span>
            <Textarea
              value={(step.artifactPaths ?? []).join("\n")}
              onChange={(event) =>
                onUpdateStep(step.id, { artifactPaths: splitLines(event.target.value) })
              }
              placeholder={dict.steps.artifactPathsPlaceholder}
              rows={2}
              className="resize-none font-mono text-xs"
              disabled={!isAdmin}
            />
            <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.steps.artifactPathsHelp}</span>
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.steps.artifactInputsLabel}</span>
            <Textarea
              value={(step.artifactInputs ?? []).join("\n")}
              onChange={(event) =>
                onUpdateStep(step.id, { artifactInputs: splitLines(event.target.value) })
              }
              placeholder={dict.steps.artifactInputsPlaceholder}
              rows={2}
              className="resize-none font-mono text-xs"
              disabled={!isAdmin}
            />
            <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.steps.artifactInputsHelp}</span>
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={onAddStep} className="w-full" disabled={!isAdmin}>
        <Plus className="mr-1 size-3.5" />
        {dict.jobs.addStep}
      </Button>
    </div>
  );
}
