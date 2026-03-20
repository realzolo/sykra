"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageLoading } from "@/components/ui/page-loading";
import { toast } from "sonner";
import {
  Play,
  RotateCcw,
  Settings,
  History,
  ChevronRight,
  ChevronDown,
  GitBranch,
  GitCommit,
  Clock,
  CheckCircle,
  XCircle,
  Circle,
  RefreshCw,
  Plus,
  Trash2,
  Package,
} from "lucide-react";
import type { Dictionary } from "@/i18n";
import type {
  PipelineConfig,
  PipelineEnvironment,
  PipelineJobDiagnostic,
  PipelineJob,
  PipelineJobType,
  PipelineRunDetail,
  PipelineRunStatus,
  PipelineSummary,
  PipelineStep,
} from "@/services/pipelineTypes";
import {
  analyzePipelineJobs,
  createDefaultJob,
  createDefaultPipelineConfig,
  createUniqueJobId,
  createDefaultStep,
  durationLabel,
  ENV_LABELS,
  renameJobId,
  STATUS_VARIANTS,
} from "@/services/pipelineTypes";
import { useOrgRole } from "@/lib/useOrgRole";
import { formatLocalDateTime } from "@/lib/dateFormat";
import { pipelineConfigSchema } from "@/services/validation";

type Tab = "runs" | "configure";
type ConfigureSection = "jobs" | "settings";

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_ICON: Record<PipelineRunStatus, React.ReactNode> = {
  success: <CheckCircle className="size-4 text-success" />,
  failed: <XCircle className="size-4 text-danger" />,
  timed_out: <XCircle className="size-4 text-danger" />,
  running: <RefreshCw className="size-4 text-warning animate-spin" />,
  queued: <Clock className="size-4 text-[hsl(var(--ds-text-2))]" />,
  canceled: <Circle className="size-4 text-[hsl(var(--ds-text-2))]" />,
  skipped: <Circle className="size-4 text-[hsl(var(--ds-text-2))]" />,
};

const STATUS_ICON_SM: Record<PipelineRunStatus, React.ReactNode> = {
  success: <CheckCircle className="size-3 text-success" />,
  failed: <XCircle className="size-3 text-danger" />,
  timed_out: <XCircle className="size-3 text-danger" />,
  running: <RefreshCw className="size-3 text-warning animate-spin" />,
  queued: <Clock className="size-3 text-[hsl(var(--ds-text-2))]" />,
  canceled: <Circle className="size-3 text-[hsl(var(--ds-text-2))]" />,
  skipped: <Circle className="size-3 text-[hsl(var(--ds-text-2))]" />,
};

type PipelineRun = PipelineRunDetail["run"];

function deriveDefaultNeeds(type: PipelineJobType, jobs: PipelineJob[], selectedId: string | null): string[] {
  if (type === "source_checkout") return [];
  if (selectedId && jobs.some((job) => job.id === selectedId)) return [selectedId];
  if (type === "review_gate") {
    const sourceJob = jobs.find((job) => (job.type ?? "shell") === "source_checkout");
    if (sourceJob) return [sourceJob.id];
  }
  const hasDependents = new Set<string>();
  for (const job of jobs) {
    for (const need of job.needs ?? []) {
      hasDependents.add(need);
    }
  }
  const terminalJob = [...jobs].reverse().find((job) => !hasDependents.has(job.id));
  return terminalJob ? [terminalJob.id] : [];
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PipelineDetailClient({
  dict,
  pipelineId,
}: {
  dict: Dictionary;
  pipelineId: string;
}) {
  const searchParams = useSearchParams();
  const p = dict.pipelines;
  const { isAdmin } = useOrgRole();

  const initialTab = (searchParams.get("tab") as Tab) ?? "runs";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [pipeline, setPipeline] = useState<PipelineSummary | null>(null);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const initialRunId = searchParams.get("runId");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);
  const [runDetail, setRunDetail] = useState<PipelineRunDetail | null>(null);
  const [logText, setLogText] = useState("");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [configSection, setConfigSection] = useState<ConfigureSection>("jobs");
  const [selectedConfigJobId, setSelectedConfigJobId] = useState<string | null>(null);
  const [jobCreateOpen, setJobCreateOpen] = useState(false);
  const [jobCreateType, setJobCreateType] = useState<PipelineJobType>("shell");
  const [jobCreateName, setJobCreateName] = useState("");
  const [jobCreateNeeds, setJobCreateNeeds] = useState<string[]>([]);
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarValue, setNewVarValue] = useState("");

  const [secretsLoading, setSecretsLoading] = useState(false);
  const [secrets, setSecrets] = useState<Array<{ name: string; created_at: string; updated_at: string }>>([]);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretSaving, setSecretSaving] = useState(false);
  const [secretDeleting, setSecretDeleting] = useState<string | null>(null);
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  type Artifact = {
    id: string;
    job_id: string | null;
    step_id: string | null;
    path: string;
    storage_path: string;
    size_bytes: string;
    sha256: string | null;
    created_at: string;
    expires_at: string | null;
  };
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const selectedConfigJob = useMemo(
    () =>
      Array.isArray(config?.jobs)
        ? (config?.jobs.find((job) => job.id === selectedConfigJobId) ?? null)
        : null,
    [config?.jobs, selectedConfigJobId]
  );
  const configDiagnostics = useMemo(
    () => analyzePipelineJobs(config?.jobs ?? []),
    [config?.jobs]
  );
  const hasConfigErrors = useMemo(
    () => configDiagnostics.some((item) => item.level === "error"),
    [configDiagnostics]
  );
  const jobCreateCandidates = useMemo(
    () => config?.jobs ?? [],
    [config?.jobs]
  );
  const jobCreateTargetLayer = useMemo(() => {
    if (!config || jobCreateNeeds.length === 0) return 1;
    const preview = buildExecutionPreview(config.jobs);
    const layerByJobId = new Map<string, number>();
    preview.layers.forEach((layer, layerIndex) => {
      layer.forEach((jobId) => layerByJobId.set(jobId, layerIndex));
    });
    const maxDependencyLayer = jobCreateNeeds.reduce((max, dependencyId) => {
      return Math.max(max, layerByJobId.get(dependencyId) ?? -1);
    }, -1);
    return Math.max(1, maxDependencyLayer + 2);
  }, [config, jobCreateNeeds]);

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadPipeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}`);
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      const loadedPipeline = (data?.pipeline ?? null) as PipelineSummary | null;
      setPipeline(loadedPipeline);
      setConfig(normalizeLoadedPipelineConfig(data?.version?.config, loadedPipeline));
    } catch {
      toast.error(p.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, p.loadFailed]);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/runs`);
      const data = res.ok ? await res.json() : [];
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
    }
  }, [pipelineId]);

  const loadSecrets = useCallback(async () => {
    setSecretsLoading(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/secrets`, {
        method: "GET",
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json().catch(() => ({}));
      setSecrets(Array.isArray(data?.secrets) ? data.secrets : []);
    } catch {
      toast.error(p.settingsTab.loadFailed);
    } finally {
      setSecretsLoading(false);
    }
  }, [pipelineId, p.settingsTab.loadFailed]);

  const loadArtifacts = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/pipeline-runs/${runId}/artifacts`);
      if (!res.ok) return;
      const data = await res.json();
      setArtifacts(Array.isArray(data?.artifacts) ? data.artifacts : []);
    } catch {/* ignore */}
  }, []);

  useEffect(() => {
    loadPipeline();
    loadRuns();
  }, [loadPipeline, loadRuns]);
  useEffect(() => {
    if (tab !== "configure") return;
    if (configSection !== "settings") return;
    void loadSecrets();
  }, [tab, configSection, loadSecrets]);

  useEffect(() => {
    if (!config || !Array.isArray(config.jobs) || config.jobs.length === 0) return;
    if (!selectedConfigJobId || !config.jobs.some((job) => job.id === selectedConfigJobId)) {
      setSelectedConfigJobId(config.jobs[0]!.id);
    }
  }, [config, selectedConfigJobId]);

  useEffect(() => {
    if (!jobCreateOpen || !config) return;
    const validIds = new Set(config.jobs.map((job) => job.id));
    setJobCreateNeeds((prev) => {
      if (jobCreateType === "source_checkout") return prev.length === 0 ? prev : [];
      const filtered = prev.filter((dependencyId) => validIds.has(dependencyId));
      if (filtered.length > 0) return filtered;
      return deriveDefaultNeeds(jobCreateType, config.jobs, selectedConfigJobId);
    });
  }, [jobCreateOpen, jobCreateType, config, selectedConfigJobId]);

  // Auto-select the most recent run
  useEffect(() => {
    if (runs.length === 0) return;
    if (!selectedRunId || !runs.some((r) => r.id === selectedRunId)) {
      const latestRun = runs[0];
      if (latestRun) setSelectedRunId(latestRun.id);
    }
  }, [runs, selectedRunId]);

  // Load artifacts when run changes
  useEffect(() => {
    if (!selectedRunId) return;
    setArtifacts([]);
    void loadArtifacts(selectedRunId);
  }, [selectedRunId, loadArtifacts]);

  // Poll run detail while running
  useEffect(() => {
    if (!selectedRunId) return;
    let active = true;

    async function fetchDetail() {
      try {
        const res = await fetch(`/api/pipeline-runs/${selectedRunId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setRunDetail(data);
        // Auto-expand first job
        if (data?.jobs?.length > 0 && !expandedJobId) {
          setExpandedJobId(data.jobs[0].id);
        }
      } catch {/* ignore */}
    }

    fetchDetail();
    const isActive =
      runs.find((r) => r.id === selectedRunId)?.status === "running" ||
      runs.find((r) => r.id === selectedRunId)?.status === "queued";
    if (!isActive) return;

    const interval = setInterval(fetchDetail, 2500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [selectedRunId, runs, expandedJobId]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logText]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function loadLog(stepId: string) {
    setSelectedStepId(stepId);
    setLogText("");
    try {
      const res = await fetch(
        `/api/pipeline-runs/${selectedRunId}/logs/${stepId}?offset=0&limit=500000`
      );
      const text = res.ok ? await res.text() : "";
      setLogText(text);
    } catch {
      setLogText("");
    }
  }

  async function handleRun() {
    setRunning(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerType: "manual" }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(p.runQueued);
      await loadRuns();
      setTab("runs");
    } catch {
      toast.error(p.runFailed);
    } finally {
      setRunning(false);
    }
  }

  async function handleRollback(runId: string) {
    setRollingBack(runId);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerType: "rollback", rollbackOf: runId }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(p.rollbackSuccess);
      await loadRuns();
    } catch {
      toast.error(p.rollbackFailed);
    } finally {
      setRollingBack(null);
    }
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const normalizedConfig = normalizePipelineConfigForSave(config);
      const diagnostics = analyzePipelineJobs(normalizedConfig.jobs);
      const firstError = diagnostics.find((item) => item.level === "error");
      if (firstError) {
        toast.error(`${p.jobs.diagnosticsErrorPrefix}: ${firstError.message}`);
        return;
      }

      const res = await fetch(`/api/pipelines/${pipelineId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pipeline?.name ?? normalizedConfig.name,
          description: pipeline?.description ?? normalizedConfig.description,
          environment: pipeline?.environment ?? "production",
          config: normalizedConfig,
        }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(p.saveSuccess);
      await loadPipeline();
    } catch {
      toast.error(p.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  function addVariable() {
    if (!config) return;
    const key = newVarKey.trim();
    if (!key) return;
    const next = { ...(config.variables ?? {}) };
    if (Object.prototype.hasOwnProperty.call(next, key)) return;
    next[key] = newVarValue;
    setConfig({ ...config, variables: next });
    setNewVarKey("");
    setNewVarValue("");
  }

  function removeVariable(key: string) {
    if (!config) return;
    const next = { ...(config.variables ?? {}) };
    delete next[key];
    setConfig({ ...config, variables: next });
  }

  function updateVariable(key: string, value: string) {
    if (!config) return;
    const next = { ...(config.variables ?? {}) };
    next[key] = value;
    setConfig({ ...config, variables: next });
  }

  async function saveSecret() {
    const name = secretName.trim().toUpperCase();
    if (!name) {
      toast.error(p.settingsTab.keyRequired);
      return;
    }
    if (!secretValue) {
      toast.error(p.settingsTab.valueRequired);
      return;
    }

    setSecretSaving(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value: secretValue }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(p.settingsTab.saveSuccess);
      setSecretName(name);
      setSecretValue("");
      await loadSecrets();
    } catch {
      toast.error(p.settingsTab.saveFailed);
    } finally {
      setSecretSaving(false);
    }
  }

  async function deleteSecret(name: string) {
    setSecretDeleting(name);
    try {
      const res = await fetch(
        `/api/pipelines/${pipelineId}/secrets?name=${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("failed");
      toast.success(p.settingsTab.deleteSuccess);
      await loadSecrets();
    } catch {
      toast.error(p.settingsTab.deleteFailed);
    } finally {
      setSecretDeleting(null);
    }
  }

  async function downloadArtifact(artifactId: string) {
    if (!selectedRunId) return;
    setDownloadingArtifactId(artifactId);
    try {
      const response = await fetch(`/api/pipeline-runs/${selectedRunId}/artifacts/${artifactId}/download-token`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data?.url !== "string") {
        throw new Error(data?.error ?? "Failed to prepare artifact download");
      }
      window.location.assign(data.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Artifact download failed");
    } finally {
      setDownloadingArtifactId(null);
    }
  }

  // ── Config step helpers ────────────────────────────────────────────────────

  function updateJob(jobId: string, patch: Partial<PipelineJob>) {
    if (!config) return;
    setConfig({
      ...config,
      jobs: config.jobs.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
    });
  }

  function updateJobId(oldId: string, nextRawId: string) {
    if (!config) return;
    const nextId = createUniqueJobId(
      nextRawId,
      config.jobs.filter((job) => job.id !== oldId).map((job) => job.id)
    );
    setConfig({
      ...config,
      jobs: renameJobId(config.jobs, oldId, nextRawId),
    });
    setSelectedConfigJobId(nextId);
  }

  function setJobType(jobId: string, type: PipelineJobType) {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        jobs: prev.jobs.map((job) => {
          if (job.id !== jobId) return job;
          if (type === "source_checkout") {
            return {
              ...job,
              type,
              branch: job.branch ?? prev.trigger.branch,
              steps: job.steps.length > 0 ? job.steps : [{ id: "checkout", name: "Checkout", script: "" }],
            };
          }
          if (type === "review_gate") {
            return {
              ...job,
              type,
              minScore: job.minScore ?? 60,
              steps: job.steps.length > 0 ? job.steps : [{ id: "gate", name: "Quality Gate", script: "" }],
            };
          }
          return {
            ...job,
            type,
            steps: job.steps.length > 0 ? job.steps : [createDefaultStep("Run command")],
          };
        }),
      };
    });
  }

  function openCreateJobDialog() {
    if (!config) return;
    const nextType: PipelineJobType = "shell";
    setJobCreateType(nextType);
    setJobCreateName("");
    setJobCreateNeeds(deriveDefaultNeeds(nextType, config.jobs, selectedConfigJobId));
    setJobCreateOpen(true);
  }

  function createJobFromDialog() {
    if (!config) return;
    const existingIds = config.jobs.map((item) => item.id);
    const fallbackName =
      jobCreateType === "source_checkout"
        ? p.jobs.typeLabel.source_checkout
        : jobCreateType === "review_gate"
        ? p.jobs.typeLabel.review_gate
        : `Job ${config.jobs.length + 1}`;
    const name = jobCreateName.trim() || fallbackName;
    const baseJob = createDefaultJob(name, existingIds);
    const uniqueNeeds = Array.from(
      new Set(jobCreateNeeds.filter((dependencyId) => existingIds.includes(dependencyId)))
    );

    let nextJob: PipelineJob;
    if (jobCreateType === "source_checkout") {
      nextJob = {
        ...baseJob,
        type: "source_checkout",
        branch: config.trigger.branch,
        needs: [],
        steps: [{ id: "checkout", name: "Checkout", script: "" }],
      };
    } else if (jobCreateType === "review_gate") {
      nextJob = {
        ...baseJob,
        type: "review_gate",
        minScore: 60,
        needs: uniqueNeeds,
        steps: [{ id: "gate", name: "Quality Gate", script: "" }],
      };
    } else {
      nextJob = {
        ...baseJob,
        type: "shell",
        needs: uniqueNeeds,
        steps: baseJob.steps.length > 0 ? baseJob.steps : [createDefaultStep("Run command")],
      };
    }

    setConfig({
      ...config,
      jobs: [...config.jobs, nextJob],
    });
    setSelectedConfigJobId(nextJob.id);
    setJobCreateOpen(false);
  }

  function removeJob(jobId: string) {
    if (!config || config.jobs.length <= 1) return;
    setConfig({
      ...config,
      jobs: config.jobs.filter((job) => job.id !== jobId),
    });
  }

  function toggleNeed(jobId: string, dependencyId: string) {
    if (!config) return;
    const target = config.jobs.find((job) => job.id === jobId);
    if (!target) return;
    const current = target.needs ?? [];
    const active = current.includes(dependencyId);
    updateJob(jobId, {
      needs: active ? current.filter((item) => item !== dependencyId) : [...current, dependencyId],
    });
  }

  function addDependency(jobId: string, dependencyId: string) {
    if (!config) return;
    if (jobId === dependencyId) return;
    const target = config.jobs.find((job) => job.id === jobId);
    if (!target) return;
    const current = target.needs ?? [];
    if (current.includes(dependencyId)) return;
    updateJob(jobId, { needs: [...current, dependencyId] });
  }

  function removeDependency(jobId: string, dependencyId: string) {
    if (!config) return;
    const target = config.jobs.find((job) => job.id === jobId);
    if (!target) return;
    const current = target.needs ?? [];
    if (!current.includes(dependencyId)) return;
    updateJob(jobId, { needs: current.filter((item) => item !== dependencyId) });
  }

  function addStep(jobId: string) {
    if (!config) return;
    const target = config.jobs.find((job) => job.id === jobId);
    if (!target || (target.type ?? "shell") !== "shell") return;
    updateJob(jobId, { steps: [...target.steps, createDefaultStep()] });
  }

  function removeStep(jobId: string, stepId: string) {
    if (!config) return;
    const target = config.jobs.find((job) => job.id === jobId);
    if (!target || (target.type ?? "shell") !== "shell") return;
    if (target.steps.length <= 1) return;
    updateJob(jobId, { steps: target.steps.filter((step) => step.id !== stepId) });
  }

  function updateStep(jobId: string, stepId: string, patch: Partial<PipelineStep>) {
    if (!config) return;
    const target = config.jobs.find((job) => job.id === jobId);
    if (!target || (target.type ?? "shell") !== "shell") return;
    updateJob(jobId, {
      steps: target.steps.map((step) =>
        step.id === stepId
          ? (() => {
              const next = { ...step, ...patch };
              if (patch.type === "shell") {
                delete next.dockerImage;
              }
              return next;
            })()
          : step
      ),
    });
  }

  // ── Job progress bar ───────────────────────────────────────────────────────

  function StagePipeline({ run }: { run: PipelineRun | undefined }) {
    const jobs = config?.jobs ?? [];
    const runJobStatus = new Map((runDetail?.jobs ?? []).map((job) => [job.job_key, job.status]));

    if (jobs.length === 0) return null;

    function dotClass(jobId: string): string {
      const status = runJobStatus.get(jobId);
      if (!run || !status) return "bg-border";
      if (status === "success") return "bg-success";
      if (status === "running") return "bg-warning animate-pulse";
      if (status === "failed" || status === "timed_out") return "bg-danger";
      return "bg-border";
    }

    return (
      <div className="flex items-center gap-0">
        {jobs.map((job, i) => {
          const dot = dotClass(job.id);
          return (
            <div key={job.id} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div className={`size-2.5 rounded-[4px] ${dot}`} />
                <span className="text-[10px] text-[hsl(var(--ds-text-2))] whitespace-nowrap">
                  {job.name}
                </span>
              </div>
              {i < jobs.length - 1 && (
                <div className="h-px w-12 mx-1 mb-3 bg-border" />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <PageLoading label={dict.common.loading} />;
  }

  const currentRun = runs.find((r) => r.id === selectedRunId);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[hsl(var(--ds-border-1))] bg-background shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[16px] font-semibold text-foreground truncate">
                {pipeline?.name ?? p.title}
              </span>
              {pipeline?.environment && (
                <Badge
                  variant={
                    pipeline.environment === "production"
                      ? "danger"
                      : pipeline.environment === "staging"
                      ? "warning"
                      : "muted"
                  }
                  size="sm"
                >
                  {ENV_LABELS[pipeline.environment]}
                </Badge>
              )}
            </div>
            {pipeline?.description && (
              <div className="text-[13px] text-[hsl(var(--ds-text-2))] truncate mt-0.5">
                {pipeline.description}
              </div>
            )}
            <div className="flex items-center gap-3 mt-1.5 text-[12px] text-[hsl(var(--ds-text-2))]">
              <div className="flex items-center gap-1">
                <GitBranch className="size-3" />
                {config?.trigger?.branch ?? "main"}
              </div>
              {config?.trigger?.autoTrigger && (
                <span className="text-accent text-[11px]">
                  {p.basic.autoTrigger}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTab("configure")}
              className={tab === "configure" ? "bg-muted" : ""}
            >
              <Settings className="size-3.5 mr-1" />
              {p.detail.configure}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleRun}
              disabled={running}
            >
              <Play className="size-3.5 mr-1" />
              {running ? dict.common.loading : p.runPipeline}
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[hsl(var(--ds-border-1))] bg-background shrink-0">
        <div className="flex px-6 gap-1">
          {(["runs", "configure"] as Tab[]).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-foreground text-foreground"
                  : "border-transparent text-[hsl(var(--ds-text-2))] hover:text-foreground"
              }`}
            >
              {t === "runs" ? (
                <History className="size-3.5" />
              ) : (
                <Settings className="size-3.5" />
              )}
              {t === "runs" ? p.detail.runHistory : p.detail.configure}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {/* ── Runs tab ──────────────────────────────────────────────────── */}
        {tab === "runs" && (
          <div className="flex h-full flex-col lg:flex-row">
            {/* Left: run list */}
            <div className="w-full lg:w-64 h-56 lg:h-auto shrink-0 border-b lg:border-b-0 lg:border-r border-[hsl(var(--ds-border-1))] flex flex-col overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[hsl(var(--ds-border-1))] flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {p.detail.runHistory}
                </span>
                <button
                  type="button"
                  onClick={loadRuns}
                  className="text-[hsl(var(--ds-text-2))] hover:text-foreground transition-colors"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {runs.length === 0 && (
                  <div className="px-4 py-8 text-[12px] text-[hsl(var(--ds-text-2))] text-center">
                    {p.detail.noRuns}
                  </div>
                )}
                {runs.map((run, idx) => (
                  <button
                    key={run.id}
                    onClick={() => {
                      setSelectedRunId(run.id);
                      setRunDetail(null);
                      setSelectedStepId(null);
                      setLogText("");
                      setExpandedJobId(null);
                    }}
                    className={`w-full text-left px-4 py-3 border-b border-[hsl(var(--ds-border-1))] transition-colors ${
                      selectedRunId === run.id
                        ? "bg-[hsl(var(--ds-surface-1))]"
                        : "hover:bg-[hsl(var(--ds-surface-1))]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {STATUS_ICON_SM[run.status as PipelineRunStatus]}
                        <span className="text-xs font-medium">
                          #{runs.length - idx}
                        </span>
                      </div>
                      <Badge
                        variant={STATUS_VARIANTS[run.status as PipelineRunStatus]}
                        size="sm"
                      >
                        {p.status[run.status as PipelineRunStatus]}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-[hsl(var(--ds-text-2))]">
                      {p.detail.trigger[
                        run.trigger_type as keyof typeof p.detail.trigger
                      ] ?? run.trigger_type}
                      {run.branch && (
                        <span className="ml-1">· {run.branch}</span>
                      )}
                    </div>
                      <div className="text-[11px] text-[hsl(var(--ds-text-2))]">
                      {formatLocalDateTime(run.created_at)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: run detail */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {!selectedRunId && (
                <div className="flex-1 flex items-center justify-center text-[13px] text-[hsl(var(--ds-text-2))]">
                  {p.detail.noRuns}
                </div>
              )}

              {selectedRunId && (
                <>
                  {/* Run header */}
                  <div className="px-6 py-4 border-b border-[hsl(var(--ds-border-1))] shrink-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          {currentRun &&
                            STATUS_ICON[currentRun.status as PipelineRunStatus]}
                          <span className="text-sm font-semibold">
                            {p.detail.runId.replace(
                              "{{num}}",
                              String(
                                runs.length -
                                  runs.findIndex((r) => r.id === selectedRunId)
                              )
                            )}
                          </span>
                          {currentRun && (
                            <Badge
                              variant={
                                STATUS_VARIANTS[
                                  currentRun.status as PipelineRunStatus
                                ]
                              }
                              size="sm"
                            >
                              {p.status[currentRun.status as PipelineRunStatus]}
                            </Badge>
                          )}
                        </div>

                        {currentRun && (
                          <div className="flex items-center gap-4 text-[12px] text-[hsl(var(--ds-text-2))]">
                            {currentRun.branch && (
                              <div className="flex items-center gap-1">
                                <GitBranch className="size-3" />
                                {currentRun.branch}
                              </div>
                            )}
                            {currentRun.commit_sha && (
                              <div className="flex items-center gap-1">
                                <GitCommit className="size-3" />
                                {currentRun.commit_sha.slice(0, 7)}
                              </div>
                            )}
                            {currentRun.started_at && (
                              <div className="flex items-center gap-1">
                                <Clock className="size-3" />
                                {durationLabel(
                                  currentRun.started_at,
                                  currentRun.finished_at ?? undefined
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Stage progress */}
                        <StagePipeline run={currentRun} />
                      </div>

                      {/* Rollback / retry */}
                      {currentRun &&
                        (currentRun.status === "success" ||
                          currentRun.status === "failed") && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRollback(selectedRunId)}
                            disabled={rollingBack === selectedRunId}
                          >
                            <RotateCcw className="size-3.5 mr-1" />
                            {currentRun.status === "success"
                              ? p.rollback
                              : p.retry}
                          </Button>
                        )}
                    </div>
                  </div>

                  {/* Jobs + logs */}
                  <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
                    {/* Job/step tree */}
                    <div className="w-full xl:w-56 max-h-48 xl:max-h-none shrink-0 border-b xl:border-b-0 xl:border-r border-[hsl(var(--ds-border-1))] overflow-y-auto">
                      {!runDetail && (
                        <div className="px-4 py-6 text-[12px] text-[hsl(var(--ds-text-2))]">
                          {dict.common.loading}
                        </div>
                      )}
                      {runDetail?.jobs.map((job) => (
                        <div key={job.id}>
                          <button
                            type="button"
                            className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[hsl(var(--ds-surface-1))] transition-colors"
                            onClick={() =>
                              setExpandedJobId(
                                expandedJobId === job.id ? null : job.id
                              )
                            }
                          >
                            {STATUS_ICON_SM[job.status as PipelineRunStatus]}
                            <span className="text-xs font-medium flex-1 text-left truncate">
                              {job.name}
                            </span>
                            {expandedJobId === job.id ? (
                              <ChevronDown className="size-3 text-[hsl(var(--ds-text-2))]" />
                            ) : (
                              <ChevronRight className="size-3 text-[hsl(var(--ds-text-2))]" />
                            )}
                          </button>
                          {expandedJobId === job.id &&
                            runDetail.steps
                              .filter((s) => s.job_id === job.id)
                              .map((step) => (
                                <button
                                  type="button"
                                  key={step.id}
                                  onClick={() => loadLog(step.id)}
                                  className={`w-full flex items-center gap-2 pl-8 pr-4 py-1.5 transition-colors text-left ${
                                    selectedStepId === step.id
                                      ? "bg-[hsl(var(--ds-surface-1))]"
                                      : "hover:bg-muted/20"
                                  }`}
                                >
                                  {STATUS_ICON_SM[
                                    step.status as PipelineRunStatus
                                  ]}
                                  <span className="text-[11px] truncate text-[hsl(var(--ds-text-2))]">
                                    {step.name}
                                  </span>
                                </button>
                              ))}
                        </div>
                      ))}
                    </div>

                    {/* Log viewer */}
                    <div className="flex-1 flex flex-col overflow-hidden bg-terminal">
                      {!selectedStepId && (
                        <div className="flex-1 flex items-center justify-center text-[12px] text-terminal-muted">
                          {p.log.selectStep}
                        </div>
                      )}
                      {selectedStepId && (
                        <div
                          ref={logRef}
                          className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-terminal leading-relaxed whitespace-pre-wrap"
                        >
                          {logText || (
                            <span className="text-terminal-muted">
                              {p.log.noLogs}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Artifacts panel */}
                    {artifacts.length > 0 && (
                      <div className="border-t border-[hsl(var(--ds-border-1))] bg-terminal">
                        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[hsl(var(--ds-border-1))]">
                          <Package className="size-3 text-[hsl(var(--ds-text-2))]" />
                          <span className="text-[11px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wide">
                            {p.artifactsLabel.replace("{{count}}", String(artifacts.length))}
                          </span>
                        </div>
                        <div className="max-h-40 overflow-y-auto">
                          {artifacts.map((a) => {
                            const sizeKb = Math.round(Number(a.size_bytes) / 1024);
                            const sizeLabel = sizeKb >= 1024
                              ? `${(sizeKb / 1024).toFixed(1)} MB`
                              : `${sizeKb} KB`;
                            const filename = a.path.split('/').pop() ?? a.path;
                            return (
                              <div
                                key={a.id}
                                className="flex items-center gap-3 px-4 py-2 border-b border-[hsl(var(--ds-border-1))]/30 hover:bg-white/5 transition-colors"
                              >
                                <Package className="size-3 text-[hsl(var(--ds-text-2))] shrink-0" />
                                <span className="flex-1 font-mono text-[11px] text-terminal truncate" title={a.path}>
                                  {filename}
                                </span>
                                <span className="text-[10px] text-[hsl(var(--ds-text-2))] shrink-0 w-16 text-right">
                                  {sizeLabel}
                                </span>
                                {a.sha256 && (
                                  <span className="text-[10px] font-mono text-[hsl(var(--ds-text-2))] shrink-0 w-16 text-right" title={a.sha256}>
                                    {a.sha256.slice(0, 8)}
                                  </span>
                                )}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-[10px]"
                                  onClick={() => downloadArtifact(a.id)}
                                  disabled={downloadingArtifactId === a.id}
                                >
                                  {downloadingArtifactId === a.id ? dict.common.loading : dict.common.download}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Configure tab ──────────────────────────────────────────────── */}
        {tab === "configure" && config && (
          <div className="flex h-full flex-col">
            <div className="flex flex-1 overflow-hidden">
              <div className="w-56 shrink-0 border-r border-[hsl(var(--ds-border-1))] py-4 space-y-1 px-3">
                <button
                  type="button"
                  onClick={() => setConfigSection("jobs")}
                  className={`w-full flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-xs transition-colors ${
                    configSection === "jobs"
                      ? "bg-muted text-foreground font-medium"
                      : "text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-surface-1))] hover:text-foreground"
                  }`}
                >
                  <span className="w-4 h-4 rounded-[4px] bg-muted/80 text-[10px] flex items-center justify-center shrink-0">
                    J
                  </span>
                  {p.jobs.title}
                </button>
                <button
                  type="button"
                  onClick={() => setConfigSection("settings")}
                  className={`w-full flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-xs transition-colors ${
                    configSection === "settings"
                      ? "bg-muted text-foreground font-medium"
                      : "text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-surface-1))] hover:text-foreground"
                  }`}
                >
                  <span className="w-4 h-4 rounded-[4px] bg-muted/80 text-[10px] flex items-center justify-center shrink-0">
                    S
                  </span>
                  {p.settingsTab.title}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {configSection === "jobs" && (
                  <div className="space-y-6 pb-8">
                    <DiagnosticsPanel diagnostics={configDiagnostics} dict={p} />
                    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 max-w-3xl">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">{p.basic.environment}</label>
                        <Select
                          value={config.environment ?? "production"}
                          onValueChange={(value) =>
                            setConfig({ ...config, environment: value as PipelineEnvironment })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(["development", "staging", "production"] as const).map((env) => (
                              <SelectItem key={env} value={env}>
                                {p.env[env]}
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
                            setConfig({
                              ...config,
                              trigger: { ...config.trigger, branch: event.target.value },
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3 max-w-3xl">
                      <Switch
                        checked={config.trigger.autoTrigger}
                        onCheckedChange={(value) =>
                          setConfig({
                            ...config,
                            trigger: { ...config.trigger, autoTrigger: value },
                          })
                        }
                      />
                      <div>
                        <div className="text-sm font-medium">{p.basic.autoTrigger}</div>
                        <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                          {p.basic.autoTriggerHelp}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="text-sm font-medium text-foreground">{p.jobs.graphTitle}</div>
                        <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.jobs.graphHint}</div>
                      </div>
                      <ExecutionPreviewPanel jobs={config.jobs} dict={p} />
                      <PipelineDagOverview
                        jobs={config.jobs}
                        selectedJobId={selectedConfigJobId}
                        onSelectJob={(jobId) => setSelectedConfigJobId(jobId)}
                        editable={isAdmin}
                        onAddDependency={addDependency}
                        onRemoveDependency={removeDependency}
                        emptyLabel={p.jobs.empty}
                        linkHint={p.jobs.graphLinkHint}
                        feedbackDict={{
                          added: p.jobs.graphDependencyAdded,
                          removed: p.jobs.graphDependencyRemoved,
                          invalidSelf: p.jobs.graphInvalidSelf,
                          invalidDuplicate: p.jobs.graphInvalidDuplicate,
                          invalidCycle: p.jobs.graphInvalidCycle,
                        }}
                      />
                    </div>

                    <div className="flex gap-4 min-h-[440px]">
                      <aside className="w-64 shrink-0 border border-[hsl(var(--ds-border-1))] rounded-[8px] overflow-hidden bg-background">
                        <div className="px-3 py-2 border-b border-[hsl(var(--ds-border-1))] flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">{p.jobs.title}</span>
                          {isAdmin && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openCreateJobDialog}>
                              <Plus className="size-3.5" />
                            </Button>
                          )}
                        </div>
                        <div className="max-h-[380px] overflow-y-auto p-2 space-y-1">
                          {config.jobs.map((job) => (
                            <div
                              key={job.id}
                              onClick={() => setSelectedConfigJobId(job.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedConfigJobId(job.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              className={`w-full rounded-[6px] px-2.5 py-2 text-left border transition-colors ${
                                selectedConfigJobId === job.id
                                  ? "border-foreground bg-muted text-foreground"
                                  : "border-transparent hover:bg-[hsl(var(--ds-surface-1))]"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[12px] font-medium truncate">{job.name || job.id}</span>
                                {isAdmin && config.jobs.length > 1 && (
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
                                {p.jobs.typeLabel[(job.type ?? "shell") as "shell" | "source_checkout" | "review_gate"]}
                              </div>
                            </div>
                          ))}
                        </div>
                      </aside>

                      <Separator orientation="vertical" className="h-auto" />

                      <div className="flex-1 min-w-0">
                        {!selectedConfigJob ? (
                          <div className="h-full flex items-center justify-center text-[12px] text-[hsl(var(--ds-text-2))]">
                            {p.jobs.empty}
                          </div>
                        ) : (
                          <ConfigJobEditor
                            pipelineDict={p}
                            allJobs={config.jobs}
                            job={selectedConfigJob}
                            isAdmin={isAdmin}
                            onUpdateJob={updateJob}
                            onUpdateJobId={updateJobId}
                            onSetJobType={setJobType}
                            onToggleNeed={toggleNeed}
                            onAddStep={addStep}
                            onRemoveStep={removeStep}
                            onUpdateStep={updateStep}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {configSection === "settings" && (
                  <div className="space-y-6 max-w-2xl pb-8">
                    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-4 space-y-3">
                      <div>
                        <div className="text-sm font-medium">{p.settingsTab.variablesTitle}</div>
                        <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                          {p.settingsTab.variablesDescription}
                        </div>
                      </div>

                      <div className="space-y-2">
                        {Object.entries(config.variables ?? {})
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([k, v]) => (
                            <div key={k} className="flex items-center gap-2">
                              <Input value={k} disabled className="h-8 text-xs font-mono w-48" />
                              <Input
                                value={v}
                                onChange={(e) => updateVariable(k, e.target.value)}
                                className="h-8 text-xs font-mono flex-1"
                                disabled={!isAdmin}
                              />
                              {isAdmin && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => removeVariable(k)}
                                  aria-label={dict.common.delete}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              )}
                            </div>
                          ))}
                        {Object.keys(config.variables ?? {}).length === 0 && (
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] py-2">
                            {dict.common.none}
                          </div>
                        )}
                      </div>

                      {isAdmin && (
                        <>
                          <Separator />
                          <div className="flex items-center gap-2">
                            <Input
                              value={newVarKey}
                              onChange={(e) => setNewVarKey(e.target.value)}
                              placeholder={p.settingsTab.varKey}
                              className="h-8 text-xs font-mono w-48"
                            />
                            <Input
                              value={newVarValue}
                              onChange={(e) => setNewVarValue(e.target.value)}
                              placeholder={p.settingsTab.varValue}
                              className="h-8 text-xs font-mono flex-1"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={addVariable}
                              disabled={!newVarKey.trim()}
                            >
                              <Plus className="size-3.5 mr-1" />
                              {p.settingsTab.addVar}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-4 space-y-3">
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
                              setConfig({
                                ...config,
                                notifications: { ...config.notifications, onSuccess: v },
                              })
                            }
                            disabled={!isAdmin}
                          />
                        </div>
                        <div className="flex items-center justify-between rounded-[8px] border border-[hsl(var(--ds-border-1))] px-4 py-3">
                          <span className="text-sm">{p.notifications.onFailure}</span>
                          <Switch
                            checked={config.notifications.onFailure}
                            onCheckedChange={(v) =>
                              setConfig({
                                ...config,
                                notifications: { ...config.notifications, onFailure: v },
                              })
                            }
                            disabled={!isAdmin}
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
                                onClick={() => {
                                  if (!isAdmin) return;
                                  setConfig({
                                    ...config,
                                    notifications: {
                                      ...config.notifications,
                                      channels: active
                                        ? config.notifications.channels.filter((item) => item !== channel)
                                        : [...config.notifications.channels, channel],
                                    },
                                  });
                                }}
                                className={`flex-1 py-2 rounded-[8px] border text-xs font-medium transition-colors ${
                                  active
                                    ? "border-foreground bg-muted text-foreground"
                                    : "border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:border-foreground/40"
                                } ${!isAdmin ? "opacity-60 cursor-not-allowed" : ""}`}
                                disabled={!isAdmin}
                              >
                                {p.notifications[channel]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{p.settingsTab.secretsTitle}</div>
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                            {p.settingsTab.secretsDescription}
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => loadSecrets()} disabled={secretsLoading}>
                          {dict.common.refresh}
                        </Button>
                      </div>

                      <div className="space-y-2">
                        {secretsLoading && (
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] py-2">
                            {dict.common.loading}
                          </div>
                        )}
                        {!secretsLoading && secrets.length === 0 && (
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] py-2">
                            {dict.common.none}
                          </div>
                        )}
                        {!secretsLoading &&
                          secrets.map((s) => (
                            <div key={s.name} className="flex items-center gap-2">
                              <Input value={s.name} disabled className="h-8 text-xs font-mono w-48" />
                              <div className="flex-1">
                                <Badge variant="muted" size="sm">{p.settingsTab.saved}</Badge>
                              </div>
                              {isAdmin && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => deleteSecret(s.name)}
                                  disabled={secretDeleting === s.name}
                                  aria-label={dict.common.delete}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              )}
                            </div>
                          ))}
                      </div>

                      {isAdmin && (
                        <>
                          <Separator />
                          <div className="grid gap-2 md:grid-cols-[200px_1fr_auto] items-center">
                            <Input
                              value={secretName}
                              onChange={(e) => setSecretName(e.target.value)}
                              placeholder={p.settingsTab.secretKey}
                              className="h-8 text-xs font-mono"
                            />
                            <Input
                              type="password"
                              value={secretValue}
                              onChange={(e) => setSecretValue(e.target.value)}
                              placeholder={p.settingsTab.secretValue}
                              className="h-8 text-xs font-mono"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={saveSecret}
                              disabled={secretSaving || !secretName.trim() || !secretValue}
                            >
                              {p.settingsTab.saveSecret}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-4 space-y-3">
                      <div>
                        <div className="text-sm font-medium">{p.concurrencyMode.label}</div>
                        <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                          {p.concurrencyMode.help}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {(["allow", "queue", "cancel_previous"] as const).map((mode) => {
                          const active = (pipeline?.concurrency_mode ?? "allow") === mode;
                          const label =
                            mode === "allow"
                              ? p.concurrencyMode.allow
                              : mode === "queue"
                              ? p.concurrencyMode.queue
                              : p.concurrencyMode.cancelPrevious;
                          const help =
                            mode === "allow"
                              ? p.concurrencyMode.allowHelp
                              : mode === "queue"
                              ? p.concurrencyMode.queueHelp
                              : p.concurrencyMode.cancelPreviousHelp;
                          return (
                            <button
                              type="button"
                              key={mode}
                              onClick={async () => {
                                if (!isAdmin || !pipeline) return;
                                try {
                                  const res = await fetch(`/api/pipelines/${pipelineId}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ concurrency_mode: mode }),
                                  });
                                  if (!res.ok) throw new Error("save failed");
                                  setPipeline((prev) => (prev ? { ...prev, concurrency_mode: mode } : prev));
                                  toast.success(p.saveSuccess);
                                } catch {
                                  toast.error(p.saveFailed);
                                }
                              }}
                              disabled={!isAdmin}
                              className={`flex-1 min-w-[120px] py-2 px-3 rounded-[8px] border text-left text-xs transition-colors ${
                                active
                                  ? "border-foreground bg-muted text-foreground"
                                  : "border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:border-foreground/40"
                              } ${!isAdmin ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                              <div className="font-medium">{label}</div>
                              <div className="text-[11px] opacity-70 mt-0.5">{help}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-[hsl(var(--ds-border-1))] bg-background px-6 py-3 flex justify-end">
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={saving || !isAdmin || hasConfigErrors}
              >
                {saving ? dict.common.loading : p.savePipeline}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={jobCreateOpen} onOpenChange={setJobCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{p.jobs.addDialogTitle}</DialogTitle>
            <DialogDescription>{p.jobs.addDialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{p.jobs.addDialogType}</label>
              <Select
                value={jobCreateType}
                onValueChange={(value) => setJobCreateType(value as PipelineJobType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["source_checkout", "review_gate", "shell"] as const).map((type) => (
                    <SelectItem key={type} value={type}>
                      {p.jobs.typeLabel[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{p.jobs.addDialogName}</label>
              <Input
                value={jobCreateName}
                onChange={(event) => setJobCreateName(event.target.value)}
                placeholder={p.jobs.addDialogNamePlaceholder}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{p.jobs.addDialogNeeds}</label>
              <div className="max-h-48 overflow-y-auto rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-2.5 space-y-2">
                {jobCreateCandidates.length === 0 && (
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.jobs.noDependencyCandidates}</div>
                )}
                {jobCreateCandidates.map((candidate) => {
                  const active = jobCreateNeeds.includes(candidate.id);
                  return (
                    <button
                      type="button"
                      key={candidate.id}
                      onClick={() => {
                        if (jobCreateType === "source_checkout") return;
                        setJobCreateNeeds((prev) =>
                          prev.includes(candidate.id)
                            ? prev.filter((item) => item !== candidate.id)
                            : [...prev, candidate.id]
                        );
                      }}
                      disabled={jobCreateType === "source_checkout"}
                      className={`w-full flex items-center justify-between rounded-[6px] px-2.5 py-1.5 border text-xs transition-colors ${
                        active
                          ? "border-foreground bg-muted text-foreground"
                          : "border-transparent hover:bg-[hsl(var(--ds-surface-1))] text-[hsl(var(--ds-text-2))]"
                      } ${jobCreateType === "source_checkout" ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      <span className="truncate">{candidate.name || candidate.id}</span>
                      <span className="font-mono text-[11px]">{candidate.id}</span>
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">
                {p.jobs.addDialogNeedsHelp}
              </div>
            </div>

            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2 text-[12px] text-[hsl(var(--ds-text-2))]">
              {p.jobs.addDialogTargetLayer.replace("{{layer}}", String(jobCreateTargetLayer))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setJobCreateOpen(false)}>
              {dict.common.cancel}
            </Button>
            <Button onClick={createJobFromDialog}>{p.jobs.addDialogCreate}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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
    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5 space-y-2 max-w-3xl">
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

function normalizeLoadedPipelineConfig(rawConfig: unknown, pipeline: PipelineSummary | null): PipelineConfig {
  const parsed = pipelineConfigSchema.safeParse(rawConfig);
  if (parsed.success) {
    return normalizePipelineConfigForSave(parsed.data as PipelineConfig);
  }

  const fallback = createDefaultPipelineConfig(pipeline?.name ?? "");
  if (pipeline?.description) {
    fallback.description = pipeline.description;
  }
  return fallback;
}

type DagLayoutNode = {
  key: string;
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function computeDagLayout(jobs: PipelineJob[]) {
  const byId = new Map<string, PipelineJob>();
  for (const job of jobs) {
    if (!byId.has(job.id)) byId.set(job.id, job);
  }

  const allIds = Array.from(byId.keys());
  const orderIndex = new Map<string, number>();
  allIds.forEach((id, index) => orderIndex.set(id, index));
  const compareByOrder = (a: string, b: string) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
  const needsMap = new Map<string, string[]>();
  const dependentsMap = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const id of allIds) {
    indegree.set(id, 0);
    dependentsMap.set(id, []);
  }

  for (const id of allIds) {
    const job = byId.get(id)!;
    const validNeeds = (job.needs ?? []).filter((need) => need !== id && byId.has(need));
    needsMap.set(id, validNeeds);
    indegree.set(id, validNeeds.length);
    for (const need of validNeeds) {
      const list = dependentsMap.get(need);
      if (list) list.push(id);
    }
  }

  const queue = allIds.filter((id) => (indegree.get(id) ?? 0) === 0).sort(compareByOrder);
  const topo: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topo.push(id);
    for (const dep of dependentsMap.get(id) ?? []) {
      const next = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, next);
      if (next === 0) {
        queue.push(dep);
        queue.sort(compareByOrder);
      }
    }
  }

  for (const id of allIds) {
    if (!topo.includes(id)) topo.push(id);
  }

  const levels = new Map<string, number>();
  for (const id of topo) {
    const needs = needsMap.get(id) ?? [];
    const maxDepLevel = needs.reduce((max, need) => Math.max(max, levels.get(need) ?? 0), 0);
    levels.set(id, needs.length === 0 ? 0 : maxDepLevel + 1);
  }

  const columns = new Map<number, string[]>();
  for (const id of topo) {
    const level = levels.get(id) ?? 0;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level)!.push(id);
  }

  const nodeWidth = 170;
  const nodeHeight = 58;
  const hGap = 74;
  const vGap = 22;
  const margin = 20;

  const positioned = new Map<string, DagLayoutNode>();
  const maxLevel = Math.max(0, ...Array.from(columns.keys()));
  let maxRows = 1;
  for (const [, ids] of columns) {
    maxRows = Math.max(maxRows, ids.length);
  }

  for (const [level, ids] of columns) {
    ids.forEach((id, index) => {
      const job = byId.get(id)!;
      positioned.set(id, {
        key: `${id}-${index}`,
        id,
        name: job.name || id,
        x: margin + level * (nodeWidth + hGap),
        y: margin + index * (nodeHeight + vGap),
        width: nodeWidth,
        height: nodeHeight,
      });
    });
  }

  const width = margin * 2 + (maxLevel + 1) * nodeWidth + maxLevel * hGap;
  const height = margin * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * vGap;

  const edges: Array<{ key: string; from: string; to: string }> = [];
  for (const id of allIds) {
    for (const need of needsMap.get(id) ?? []) {
      edges.push({ key: `${need}->${id}`, from: need, to: id });
    }
  }

  return { nodes: Array.from(positioned.values()), nodeMap: positioned, edges, width, height };
}

function buildExecutionPreview(jobs: PipelineJob[]) {
  const byId = new Map<string, PipelineJob>();
  for (const job of jobs) {
    if (!byId.has(job.id)) byId.set(job.id, job);
  }

  const allIds = Array.from(byId.keys());
  const orderIndex = new Map<string, number>();
  allIds.forEach((id, index) => orderIndex.set(id, index));
  const compareByOrder = (a: string, b: string) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
  const dependentsMap = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const id of allIds) {
    indegree.set(id, 0);
    dependentsMap.set(id, []);
  }

  for (const id of allIds) {
    const job = byId.get(id);
    if (!job) continue;
    const validNeeds = (job.needs ?? []).filter((need) => need !== id && byId.has(need));
    indegree.set(id, validNeeds.length);
    for (const need of validNeeds) {
      const list = dependentsMap.get(need);
      if (list) list.push(id);
    }
  }

  const layers: string[][] = [];
  const localIndegree = new Map(indegree);
  const processed = new Set<string>();

  let frontier = allIds
    .filter((id) => (localIndegree.get(id) ?? 0) === 0)
    .sort(compareByOrder);

  while (frontier.length > 0) {
    const currentLayer = [...frontier];
    layers.push(currentLayer);
    frontier = [];

    for (const id of currentLayer) {
      processed.add(id);
      for (const dependent of dependentsMap.get(id) ?? []) {
        const next = (localIndegree.get(dependent) ?? 0) - 1;
        localIndegree.set(dependent, next);
      }
    }

    for (const id of allIds) {
      if (processed.has(id)) continue;
      if ((localIndegree.get(id) ?? 0) === 0) {
        frontier.push(id);
      }
    }
    frontier.sort(compareByOrder);
  }

  const cyclicIds = allIds.filter((id) => !processed.has(id)).sort((a, b) => a.localeCompare(b));
  if (cyclicIds.length > 0) {
    layers.push(cyclicIds);
  }

  return {
    order: layers.flat(),
    layers,
    hasCycle: cyclicIds.length > 0,
  };
}

function ExecutionPreviewPanel({
  jobs,
  dict,
}: {
  jobs: PipelineJob[];
  dict: Dictionary["pipelines"];
}) {
  const preview = useMemo(() => buildExecutionPreview(jobs), [jobs]);

  return (
    <div className="mb-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5 space-y-2">
      <div className="text-xs font-medium text-foreground">{dict.jobs.executionPreviewTitle}</div>
      <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
        {dict.jobs.executionPreviewOrder}: {preview.order.join(" -> ")}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {preview.layers.map((layer, index) => (
          <div
            key={`${index}-${layer.join("-")}`}
            className="rounded-[6px] border border-[hsl(var(--ds-border-1))] bg-background px-2 py-1"
          >
            <div className="text-[10px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wide">
              {dict.jobs.executionPreviewLayer.replace("{{index}}", String(index + 1))}
            </div>
            <div className="text-[11px] text-foreground">{layer.join(", ")}</div>
          </div>
        ))}
      </div>
      {preview.hasCycle && (
        <div className="text-[12px] text-danger">{dict.jobs.executionPreviewCycleWarning}</div>
      )}
    </div>
  );
}

function PipelineDagOverview({
  jobs,
  selectedJobId,
  onSelectJob,
  editable,
  onAddDependency,
  onRemoveDependency,
  emptyLabel,
  linkHint,
  feedbackDict,
}: {
  jobs: PipelineJob[];
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
  editable: boolean;
  onAddDependency: (jobId: string, dependencyId: string) => void;
  onRemoveDependency: (jobId: string, dependencyId: string) => void;
  emptyLabel: string;
  linkHint: string;
  feedbackDict: {
    added: string;
    removed: string;
    invalidSelf: string;
    invalidDuplicate: string;
    invalidCycle: string;
  };
}) {
  const layout = useMemo(() => computeDagLayout(jobs), [jobs]);
  const boardRef = useRef<HTMLDivElement>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ level: "info" | "error"; message: string } | null>(null);
  const dependencyMap = useMemo(() => {
    const map = new Map<string, string[]>();
    const validIds = new Set(jobs.map((job) => job.id));
    for (const job of jobs) {
      map.set(job.id, (job.needs ?? []).filter((need) => need !== job.id && validIds.has(need)));
    }
    return map;
  }, [jobs]);

  function createsCycle(targetId: string, dependencyId: string): boolean {
    const stack = [dependencyId];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      if (current === targetId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of dependencyMap.get(current) ?? []) {
        stack.push(next);
      }
    }
    return false;
  }

  function validateLink(targetId: string, dependencyId: string): { level: "info" | "error"; message: string } | null {
    if (targetId === dependencyId) {
      return { level: "error", message: feedbackDict.invalidSelf };
    }
    const currentNeeds = dependencyMap.get(targetId) ?? [];
    if (currentNeeds.includes(dependencyId)) {
      return { level: "info", message: feedbackDict.invalidDuplicate };
    }
    if (createsCycle(targetId, dependencyId)) {
      return { level: "error", message: feedbackDict.invalidCycle };
    }
    return null;
  }

  function toLocalPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function stopLinking() {
    setLinkFrom(null);
    setCursor(null);
    setHoverTarget(null);
  }

  if (layout.nodes.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-[12px] text-[hsl(var(--ds-text-2))]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-3">
      {editable && (
        <div className="mb-2 text-[11px] text-[hsl(var(--ds-text-2))]">{linkHint}</div>
      )}
      {feedback && (
        <div
          className={`mb-2 text-[11px] ${
            feedback.level === "error" ? "text-danger" : "text-[hsl(var(--ds-text-2))]"
          }`}
        >
          {feedback.message}
        </div>
      )}
      <div
        ref={boardRef}
        className="relative"
        style={{ width: layout.width, height: layout.height }}
        onMouseMove={(event) => {
          if (!linkFrom) return;
          const point = toLocalPoint(event.clientX, event.clientY);
          if (!point) return;
          setCursor(point);
        }}
        onMouseUp={() => {
          if (!linkFrom) return;
          stopLinking();
        }}
        onMouseLeave={() => {
          if (!linkFrom) return;
          stopLinking();
        }}
      >
        <svg className="absolute inset-0" width={layout.width} height={layout.height}>
          {layout.edges.map((edge) => {
            const from = layout.nodeMap.get(edge.from);
            const to = layout.nodeMap.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + from.width;
            const y1 = from.y + from.height / 2;
            const x2 = to.x;
            const y2 = to.y + to.height / 2;
            const c1 = x1 + 28;
            const c2 = x2 - 28;
            return (
              <g key={edge.key}>
                <path
                  d={`M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="12"
                  className={editable ? "cursor-pointer" : ""}
                  onClick={(event) => {
                    if (!editable) return;
                    event.stopPropagation();
                    onRemoveDependency(edge.to, edge.from);
                    setFeedback({ level: "info", message: feedbackDict.removed });
                  }}
                />
                <path
                  d={`M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="hsl(var(--ds-border-2))"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {linkFrom && cursor && (() => {
            const fromNode = layout.nodeMap.get(linkFrom);
            if (!fromNode) return null;
            const x1 = fromNode.x + fromNode.width;
            const y1 = fromNode.y + fromNode.height / 2;
            const x2 = cursor.x;
            const y2 = cursor.y;
            const c1 = x1 + 28;
            const c2 = x2 - 28;
            return (
              <path
                d={`M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="hsl(var(--ds-accent-7))"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="5 5"
              />
            );
          })()}
        </svg>

        {layout.nodes.map((node) => {
          const selected = selectedJobId === node.id;
          const linkTargetActive = linkFrom !== null && node.id !== linkFrom;
          const invalidLink = linkFrom ? validateLink(node.id, linkFrom) : null;
          return (
            <button
              key={node.key}
              type="button"
              onClick={() => onSelectJob(node.id)}
              className={`absolute rounded-[8px] border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-foreground bg-background shadow-sm"
                  : "border-[hsl(var(--ds-border-1))] bg-background/95 hover:bg-background"
              }`}
              style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
            >
              {editable && (
                <span
                  className={`absolute -left-2 top-1/2 -translate-y-1/2 size-3 rounded-full border ${
                    linkTargetActive && hoverTarget === node.id && invalidLink
                      ? "border-danger bg-danger"
                      : linkTargetActive && hoverTarget === node.id
                      ? "border-[hsl(var(--ds-accent-7))] bg-[hsl(var(--ds-accent-7))]"
                      : "border-[hsl(var(--ds-border-2))] bg-background"
                  }`}
                  onMouseEnter={() => {
                    if (!linkFrom) return;
                    setHoverTarget(node.id);
                  }}
                  onMouseLeave={() => {
                    if (!linkFrom) return;
                    setHoverTarget(null);
                  }}
                  onMouseUp={(event) => {
                    if (!editable || !linkFrom) return;
                    event.stopPropagation();
                    const issue = validateLink(node.id, linkFrom);
                    if (issue) {
                      setFeedback(issue);
                      stopLinking();
                      return;
                    }
                    onAddDependency(node.id, linkFrom);
                    setFeedback({ level: "info", message: feedbackDict.added });
                    stopLinking();
                  }}
                />
              )}
              <div className="text-[12px] font-medium text-foreground truncate">{node.name}</div>
              <div className="text-[11px] text-[hsl(var(--ds-text-2))] truncate">{node.id}</div>
              {editable && (
                <span
                  className={`absolute -right-2 top-1/2 -translate-y-1/2 size-3 rounded-full border ${
                    linkFrom === node.id
                      ? "border-[hsl(var(--ds-accent-7))] bg-[hsl(var(--ds-accent-7))]"
                      : "border-[hsl(var(--ds-border-2))] bg-background"
                  }`}
                  onMouseDown={(event) => {
                    if (!editable) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const point = toLocalPoint(event.clientX, event.clientY);
                    setFeedback(null);
                    setLinkFrom(node.id);
                    setCursor(point);
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function normalizePipelineConfigForSave(config: PipelineConfig): PipelineConfig {
  const triggerBranch = config.trigger.branch.trim() || "main";
  const ids = new Set(config.jobs.map((job) => job.id));
  return {
    ...config,
    trigger: {
      ...config.trigger,
      branch: triggerBranch,
    },
    jobs: config.jobs.map((job) => {
      const type = (job.type ?? "shell") as PipelineJobType;
      const needs = (job.needs ?? []).filter((item) => item !== job.id && ids.has(item));
      if (type === "source_checkout") {
        return {
          ...job,
          type,
          needs,
          branch: job.branch?.trim() || triggerBranch,
          steps: job.steps.length > 0 ? job.steps : [{ id: "checkout", name: "Checkout", script: "" }],
        };
      }
      if (type === "review_gate") {
        return {
          ...job,
          type,
          needs,
          minScore: Math.min(100, Math.max(0, job.minScore ?? 60)),
          steps: job.steps.length > 0 ? job.steps : [{ id: "gate", name: "Quality Gate", script: "" }],
        };
      }
      return {
        ...job,
        type: "shell",
        needs,
        steps: job.steps.length > 0 ? job.steps : [createDefaultStep("Run command")],
      };
    }),
  };
}

function ConfigJobEditor({
  pipelineDict,
  allJobs,
  job,
  isAdmin,
  onUpdateJob,
  onUpdateJobId,
  onSetJobType,
  onToggleNeed,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
}: {
  pipelineDict: Dictionary["pipelines"];
  allJobs: PipelineJob[];
  job: PipelineJob;
  isAdmin: boolean;
  onUpdateJob: (jobId: string, patch: Partial<PipelineJob>) => void;
  onUpdateJobId: (oldId: string, nextRawId: string) => void;
  onSetJobType: (jobId: string, type: PipelineJobType) => void;
  onToggleNeed: (jobId: string, dependencyId: string) => void;
  onAddStep: (jobId: string) => void;
  onRemoveStep: (jobId: string, stepId: string) => void;
  onUpdateStep: (jobId: string, stepId: string, patch: Partial<PipelineStep>) => void;
}) {
  const jobType = (job.type ?? "shell") as PipelineJobType;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{pipelineDict.jobs.id}</label>
          <Input
            value={job.id}
            onChange={(event) => onUpdateJobId(job.id, event.target.value)}
            placeholder="build"
            disabled={!isAdmin}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{pipelineDict.jobs.name}</label>
          <Input
            value={job.name}
            onChange={(event) => onUpdateJob(job.id, { name: event.target.value })}
            placeholder="Build"
            disabled={!isAdmin}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{pipelineDict.jobs.type}</label>
          <Select
            value={jobType}
            onValueChange={(value) => onSetJobType(job.id, value as PipelineJobType)}
            disabled={!isAdmin}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["source_checkout", "review_gate", "shell"] as const).map((type) => (
                <SelectItem key={type} value={type}>
                  {pipelineDict.jobs.typeLabel[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{pipelineDict.jobs.needs}</label>
          <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-2.5 space-y-2">
            {allJobs
              .filter((candidate) => candidate.id !== job.id)
              .map((candidate) => {
                const active = (job.needs ?? []).includes(candidate.id);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => onToggleNeed(job.id, candidate.id)}
                    disabled={!isAdmin}
                    className={`w-full flex items-center justify-between rounded-[6px] px-2.5 py-1.5 border text-xs transition-colors ${
                      active
                        ? "border-foreground bg-muted text-foreground"
                        : "border-transparent hover:bg-[hsl(var(--ds-surface-1))] text-[hsl(var(--ds-text-2))]"
                    } ${!isAdmin ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <span className="truncate">{candidate.name || candidate.id}</span>
                    <span className="font-mono text-[11px]">{candidate.id}</span>
                  </button>
                );
              })}
            {allJobs.length <= 1 && (
              <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{pipelineDict.jobs.noDependencyCandidates}</div>
            )}
          </div>
          <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{pipelineDict.jobs.needsHelp}</div>
        </div>
      </div>

      {jobType === "source_checkout" && (
        <div className="space-y-1.5 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
          <label className="text-xs font-medium text-foreground">{pipelineDict.jobs.sourceBranch}</label>
          <Input
            value={job.branch ?? "main"}
            onChange={(event) => onUpdateJob(job.id, { branch: event.target.value })}
            placeholder={pipelineDict.basic.branchPlaceholder}
            disabled={!isAdmin}
          />
        </div>
      )}

      {jobType === "review_gate" && (
        <div className="space-y-1.5 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3">
          <label className="text-xs font-medium text-foreground">{pipelineDict.jobs.reviewMinScore}</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={100}
              className="w-24"
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
        <div className="space-y-3">
          <div className="text-sm font-medium">{pipelineDict.jobs.steps}</div>
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
                  onChange={(event) => onUpdateStep(job.id, step.id, { name: event.target.value })}
                  placeholder={pipelineDict.step.namePlaceholder}
                  className="h-7 text-xs flex-1"
                  disabled={!isAdmin}
                />
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => onRemoveStep(job.id, step.id)}
                    className="text-[hsl(var(--ds-text-2))] hover:text-danger transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[hsl(var(--ds-text-2))] w-20 shrink-0">{pipelineDict.steps.typeLabel}</span>
                <div className="flex gap-1">
                  {(["shell", "docker"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onUpdateStep(job.id, step.id, { type })}
                      className={`px-2.5 py-1 text-[11px] rounded-[4px] border transition-colors ${
                        (step.type ?? "shell") === type
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:bg-muted/40"
                      } ${!isAdmin ? "pointer-events-none opacity-60" : ""}`}
                    >
                      {type === "shell" ? pipelineDict.steps.typeShell : pipelineDict.steps.typeDocker}
                    </button>
                  ))}
                </div>
              </div>

              {step.type === "docker" && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[hsl(var(--ds-text-2))] w-20 shrink-0">{pipelineDict.steps.dockerImage}</span>
                  <Input
                    value={step.dockerImage ?? ""}
                    onChange={(event) => onUpdateStep(job.id, step.id, { dockerImage: event.target.value })}
                    placeholder={pipelineDict.steps.dockerImagePlaceholder}
                    className="h-7 text-xs flex-1"
                    disabled={!isAdmin}
                  />
                </div>
              )}

              <Textarea
                value={step.script}
                onChange={(event) => onUpdateStep(job.id, step.id, { script: event.target.value })}
                placeholder={pipelineDict.step.scriptPlaceholder}
                rows={3}
                className="text-xs font-mono resize-none"
                disabled={!isAdmin}
              />

              <div className="space-y-1.5">
                <span className="text-[11px] text-[hsl(var(--ds-text-2))]">
                  {pipelineDict.steps.artifactPathsLabel}
                </span>
                <Textarea
                  value={(step.artifactPaths ?? []).join("\n")}
                  onChange={(event) =>
                    onUpdateStep(job.id, step.id, { artifactPaths: toLines(event.target.value) })
                  }
                  placeholder={pipelineDict.steps.artifactPathsPlaceholder}
                  rows={2}
                  className="text-xs font-mono resize-none"
                  disabled={!isAdmin}
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
                    onUpdateStep(job.id, step.id, { artifactInputs: toLines(event.target.value) })
                  }
                  placeholder={pipelineDict.steps.artifactInputsPlaceholder}
                  rows={2}
                  className="text-xs font-mono resize-none"
                  disabled={!isAdmin}
                />
                <span className="text-[11px] text-[hsl(var(--ds-text-2))]">
                  {pipelineDict.steps.artifactInputsHelp}
                </span>
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={() => onAddStep(job.id)}
            className="w-full"
            disabled={!isAdmin}
          >
            <Plus className="size-3.5 mr-1" />
            {pipelineDict.jobs.addStep}
          </Button>
        </div>
      )}

      {jobType !== "shell" && (
        <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3 text-[12px] text-[hsl(var(--ds-text-2))]">
          {pipelineDict.jobs.builtinHint}
        </div>
      )}
    </div>
  );
}
