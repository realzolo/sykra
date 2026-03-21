"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { useProject } from "@/lib/projectContext";
import { Plus, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n";
import type { ArtifactRepositorySummary } from "@/services/artifactRegistry";
import type { PipelineJob, PipelineStep } from "@/services/pipelineTypes";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

function formatVersionLabel(version: { version: string; file_count: number }) {
  return `${version.version} · ${version.file_count} files`;
}

function getRepositorySummary(repository: ArtifactRepositorySummary) {
  const latest = repository.versions[0];
  return latest ? `${repository.name} · ${latest.version}` : repository.name;
}

export function getBuildTemplateSteps(template: BuildTemplateKey): Array<Omit<PipelineStep, "id">> {
  return BUILD_TEMPLATES[template];
}

export default function PipelineStepEditor({
  dict,
  artifactLoadFailedMessage,
  job,
  isAdmin,
  showTemplates = false,
  onApplyTemplate,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
}: {
  dict: Dictionary["pipelines"];
  artifactLoadFailedMessage: string;
  job: PipelineJob;
  isAdmin: boolean;
  showTemplates?: boolean;
  onApplyTemplate?: (template: BuildTemplateKey) => void;
  onAddStep: () => void;
  onRemoveStep: (stepId: string) => void;
  onUpdateStep: (stepId: string, patch: Partial<PipelineStep>) => void;
}) {
  const { project } = useProject();
  const [artifactRepositories, setArtifactRepositories] = useState<ArtifactRepositorySummary[]>([]);
  const [artifactRepositoriesLoading, setArtifactRepositoriesLoading] = useState(false);

  useEffect(() => {
    if ((job.stage ?? "build") !== "deploy") {
      return;
    }
    let alive = true;
    async function loadArtifactRepositories() {
      setArtifactRepositoriesLoading(true);
      try {
        const response = await fetch(`/api/projects/${project.id}/artifacts`, { cache: "no-store" });
        const payload = response.ok ? await response.json() : null;
        if (!alive) return;
        setArtifactRepositories(Array.isArray(payload?.repositories) ? payload.repositories : []);
      } catch {
        if (alive) {
          setArtifactRepositories([]);
          toast.error(artifactLoadFailedMessage);
        }
      } finally {
        if (alive) setArtifactRepositoriesLoading(false);
      }
    }
    void loadArtifactRepositories();
    return () => {
      alive = false;
    };
  }, [artifactLoadFailedMessage, job.stage, project.id]);

  const repositoryOptions = useMemo(
    () =>
      artifactRepositories.map((repository) => ({
        value: repository.slug,
        label: getRepositorySummary(repository),
        keywords: [repository.slug, repository.name, ...(repository.description ? [repository.description] : [])],
      })),
    [artifactRepositories]
  );

  function updateDeployStep(stepId: string, patch: Partial<PipelineStep>) {
    const currentStep = job.steps.find((step) => step.id === stepId);
    if (!currentStep) return;
    const nextStep = { ...currentStep, ...patch };
    if (patch.artifactSource === "run") {
      delete nextStep.registryRepository;
      delete nextStep.registryVersion;
      delete nextStep.registryChannel;
    }
    if (patch.artifactSource === "registry") {
      delete nextStep.artifactInputs;
    }
    if (patch.registryRepository !== undefined) {
      delete nextStep.registryVersion;
      delete nextStep.registryChannel;
    }
    if (patch.registryVersion !== undefined) {
      delete nextStep.registryChannel;
    }
    if (patch.registryChannel !== undefined) {
      delete nextStep.registryVersion;
    }
    onUpdateStep(stepId, nextStep);
  }

  const isDeployStage = (job.stage ?? "build") === "deploy";

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
                className={`rounded-[6px] border px-2 py-1.5 text-[13px] transition-colors ${
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
              className="h-9 flex-1 text-[13px]"
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
              <span className="w-20 shrink-0 text-[12px] text-[hsl(var(--ds-text-2))]">
                {dict.steps.typeLabel}
              </span>
              <div className="flex gap-1">
                {(["shell", "docker"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onUpdateStep(step.id, { type })}
                    disabled={!isAdmin}
                    className={`rounded-[4px] border px-2.5 py-1.5 text-[12px] transition-colors ${
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
              <span className="w-20 shrink-0 text-[12px] text-[hsl(var(--ds-text-2))]">
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
                className="h-9 text-[13px]"
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
              <span className="w-20 shrink-0 text-[12px] text-[hsl(var(--ds-text-2))]">
                {dict.steps.dockerImage}
              </span>
              <Input
                value={step.dockerImage ?? ""}
                onChange={(event) => onUpdateStep(step.id, { dockerImage: event.target.value })}
                placeholder={dict.steps.dockerImagePlaceholder}
                className="h-9 flex-1 text-[13px]"
                disabled={!isAdmin}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <span className="text-[12px] font-medium text-foreground">{dict.step.script}</span>
            <Textarea
              value={step.script}
              onChange={(event) => onUpdateStep(step.id, { script: event.target.value })}
              placeholder={dict.step.scriptPlaceholder}
              rows={3}
              className="resize-none font-mono text-[12px]"
              disabled={!isAdmin}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.steps.artifactPathsLabel}</span>
            <Textarea
              value={(step.artifactPaths ?? []).join("\n")}
              onChange={(event) =>
                onUpdateStep(step.id, { artifactPaths: splitLines(event.target.value) })
              }
              placeholder={dict.steps.artifactPathsPlaceholder}
              rows={2}
              className="resize-none font-mono text-[12px]"
              disabled={!isAdmin}
            />
            <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.steps.artifactPathsHelp}</span>
          </div>

          {isDeployStage ? (
            <div className="space-y-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]/60 p-3">
              {(() => {
                const stepDeployMode = (step.artifactSource ?? "run") as "run" | "registry";
                const selectedRepository =
                  artifactRepositories.find((repository) => repository.slug === step.registryRepository) ?? null;
                const versionOptions = selectedRepository
                  ? selectedRepository.versions.map((version) => ({
                      value: version.version,
                      label: formatVersionLabel(version),
                      keywords: [version.version, version.source_branch ?? "", version.source_commit_sha ?? ""],
                    }))
                  : [];
                const channelOptions = selectedRepository
                  ? selectedRepository.channels.map((channel) => ({
                      value: channel.name,
                      label: `${channel.name} → ${channel.target_version}`,
                      keywords: [channel.name, channel.target_version],
                    }))
                  : [];

                return (
                  <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-foreground">{dict.steps.deploySourceLabel}</div>
                  <div className="mt-0.5 text-[12px] text-[hsl(var(--ds-text-2))]">
                    {dict.steps.deploySourceHelp}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-1">
                  {([
                    { value: "run", label: dict.steps.deploySourceRun },
                    { value: "registry", label: dict.steps.deploySourceRegistry },
                  ] as const).map((option) => {
                    const active = stepDeployMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateDeployStep(step.id, { artifactSource: option.value })}
                        disabled={!isAdmin}
                        className={cn(
                          "rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors",
                          active
                            ? "bg-[hsl(var(--ds-accent-9))] text-white"
                            : "text-[hsl(var(--ds-text-2))] hover:text-foreground",
                          !isAdmin && "cursor-not-allowed opacity-60"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {stepDeployMode === "run" && (
                <div className="space-y-1.5">
                  <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.steps.artifactInputsLabel}</span>
                  <Textarea
                    value={(step.artifactInputs ?? []).join("\n")}
                    onChange={(event) =>
                      updateDeployStep(step.id, { artifactInputs: splitLines(event.target.value) })
                    }
                    placeholder={dict.steps.artifactInputsPlaceholder}
                    rows={2}
                    className="resize-none font-mono text-[12px]"
                    disabled={!isAdmin}
                  />
                  <span className="text-[12px] text-[hsl(var(--ds-text-2))]">
                    {dict.steps.artifactInputsHelp}
                  </span>
                </div>
              )}

              {stepDeployMode === "registry" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.steps.registryRepositoryLabel}</span>
                    <Combobox
                      value={step.registryRepository ?? ""}
                      options={repositoryOptions}
                      placeholder={dict.steps.registryRepositoryPlaceholder}
                      searchPlaceholder={dict.steps.registryRepositorySearchPlaceholder}
                      heading={dict.steps.registryRepositoryListHeading}
                      emptyLabel={artifactRepositoriesLoading ? dict.steps.loading : dict.steps.registryRepositoryEmpty}
                      disabled={!isAdmin || artifactRepositoriesLoading}
                      className="h-9"
                      contentClassName="w-[360px]"
                      onChange={(value) => updateDeployStep(step.id, { registryRepository: value })}
                    />
                    <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.steps.registryRepositoryHelp}</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.steps.registryVersionLabel}</span>
                      <Combobox
                        value={step.registryVersion ?? ""}
                        options={versionOptions}
                        placeholder={dict.steps.registryVersionPlaceholder}
                        searchPlaceholder={dict.steps.registryVersionSearchPlaceholder}
                        heading={dict.steps.registryVersionListHeading}
                        emptyLabel={dict.steps.registryVersionEmpty}
                        disabled={!isAdmin || !selectedRepository}
                        className="h-9"
                        contentClassName="w-[320px]"
                        onChange={(value) => updateDeployStep(step.id, { registryVersion: value })}
                      />
                      <span className="text-[12px] text-[hsl(var(--ds-text-2))]">
                        {dict.steps.registryVersionHelp}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.steps.registryChannelLabel}</span>
                      <Combobox
                        value={step.registryChannel ?? ""}
                        options={channelOptions}
                        placeholder={dict.steps.registryChannelPlaceholder}
                        searchPlaceholder={dict.steps.registryChannelSearchPlaceholder}
                        heading={dict.steps.registryChannelListHeading}
                        emptyLabel={dict.steps.registryChannelEmpty}
                        disabled={!isAdmin || !selectedRepository}
                        className="h-9"
                        contentClassName="w-[320px]"
                        onChange={(value) => updateDeployStep(step.id, { registryChannel: value })}
                      />
                      <span className="text-[12px] text-[hsl(var(--ds-text-2))]">
                        {dict.steps.registryChannelHelp}
                      </span>
                    </div>
                  </div>
                </div>
              )}
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="space-y-1.5">
              <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.steps.artifactInputsLabel}</span>
              <Textarea
                value={(step.artifactInputs ?? []).join("\n")}
                onChange={(event) =>
                  onUpdateStep(step.id, { artifactInputs: splitLines(event.target.value) })
                }
                placeholder={dict.steps.artifactInputsPlaceholder}
                rows={2}
                className="resize-none font-mono text-[12px]"
                disabled={!isAdmin}
              />
              <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.steps.artifactInputsHelp}</span>
            </div>
          )}
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={onAddStep} className="h-9 w-full" disabled={!isAdmin}>
        <Plus className="mr-1 size-3.5" />
        {dict.jobs.addStep}
      </Button>
    </div>
  );
}
