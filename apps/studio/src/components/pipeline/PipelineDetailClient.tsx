"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageLoading } from "@/components/ui/page-loading";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import TypedConfirmDialog from "@/components/ui/typed-confirm-dialog";
import SettingsDangerZone from "@/components/settings/SettingsDangerZone";
import SettingsField from "@/components/settings/SettingsField";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowRight,
  Play,
  RotateCcw,
  Settings,
  History,
  Bot,
  GitBranch,
  GitCommit,
  Hand,
  ListOrdered,
  Clock,
  CheckCircle,
  XCircle,
  Circle,
  RefreshCw,
  Package,
  Plus,
  Trash2,
  Copy,
} from "lucide-react";
import type { Dictionary } from "@/i18n";
import type {
  PipelineConfig,
  PipelineEnvironment,
  PipelineJobDiagnostic,
  PipelineRunDetail,
  PipelineRunStatus,
  PipelineSummary,
} from "@/services/pipelineTypes";
import {
  analyzePipelineJobs,
  createDefaultPipelineConfig,
  detectPipelineSchedulePreset,
  durationLabel,
  ENV_LABELS,
  getSourceBranch,
  getStageConfig,
  normalizePipelineJobs,
  normalizeStageSettings,
  PIPELINE_STAGE_SEQUENCE,
  STATUS_VARIANTS,
} from "@/services/pipelineTypes";
import { useOrgRole } from "@/lib/useOrgRole";
import { useProject } from "@/lib/projectContext";
import { formatLocalDateTime } from "@/lib/dateFormat";
import { pipelineConfigSchema } from "@/services/validation";
import {
  getPipelineSecretValueBytes,
  normalizePipelineSecretName,
  PIPELINE_RESERVED_ENV_PREFIX,
  PIPELINE_SECRET_MAX_COUNT,
  PIPELINE_SECRET_VALUE_MAX_BYTES,
  validatePipelineSecretName,
  validatePipelineSecretValue,
} from "@/services/pipelineSecrets";
import StageBuilder from "@/components/pipeline/StageBuilder";
import PipelineScheduleField from "@/components/pipeline/PipelineScheduleField";

type Tab = "runs" | "configure";
type ConfigureSection = "jobs" | "settings";

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_ICON: Record<PipelineRunStatus, React.ReactNode> = {
  success: <CheckCircle className="size-4 text-success" />,
  failed: <XCircle className="size-4 text-danger" />,
  timed_out: <XCircle className="size-4 text-danger" />,
  running: <RefreshCw className="size-4 text-warning animate-spin" />,
  waiting_manual: <Clock className="size-4 text-warning" />,
  queued: <Clock className="size-4 text-[hsl(var(--ds-text-2))]" />,
  canceled: <Circle className="size-4 text-[hsl(var(--ds-text-2))]" />,
  skipped: <Circle className="size-4 text-[hsl(var(--ds-text-2))]" />,
};

const STATUS_ICON_SM: Record<PipelineRunStatus, React.ReactNode> = {
  success: <CheckCircle className="size-3 text-success" />,
  failed: <XCircle className="size-3 text-danger" />,
  timed_out: <XCircle className="size-3 text-danger" />,
  running: <RefreshCw className="size-3 text-warning animate-spin" />,
  waiting_manual: <Clock className="size-3 text-warning" />,
  queued: <Clock className="size-3 text-[hsl(var(--ds-text-2))]" />,
  canceled: <Circle className="size-3 text-[hsl(var(--ds-text-2))]" />,
  skipped: <Circle className="size-3 text-[hsl(var(--ds-text-2))]" />,
};

type PipelineRun = PipelineRunDetail["run"];

function normalizeArtifactRepositorySlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PipelineDetailClient({
  dict,
  pipelineId,
}: {
  dict: Dictionary;
  pipelineId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { project } = useProject();
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
  const [selectedRunJobKey, setSelectedRunJobKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [triggeringJobKey, setTriggeringJobKey] = useState<string | null>(null);
  const [configSection, setConfigSection] = useState<ConfigureSection>("jobs");
  const [selectedConfigJobId, setSelectedConfigJobId] = useState<string | null>(null);
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarValue, setNewVarValue] = useState("");

  const [secretsLoading, setSecretsLoading] = useState(false);
  const [secrets, setSecrets] = useState<Array<{ name: string; created_at: string; updated_at: string }>>([]);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretSaving, setSecretSaving] = useState(false);
  const [secretDeleting, setSecretDeleting] = useState<string | null>(null);
  const [secretToDelete, setSecretToDelete] = useState<string | null>(null);
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishingArtifacts, setPublishingArtifacts] = useState(false);
  const [publishRepositoryName, setPublishRepositoryName] = useState(project.name);
  const [publishRepositorySlug, setPublishRepositorySlug] = useState(normalizeArtifactRepositorySlug(project.name));
  const [publishVersion, setPublishVersion] = useState("");
  const [publishChannels, setPublishChannels] = useState("");

  const normalizedSecretName = normalizePipelineSecretName(secretName);
  const secretNameError = validatePipelineSecretName(normalizedSecretName);
  const secretValueError = validatePipelineSecretValue(secretValue);
  const secretValueBytes = getPipelineSecretValueBytes(secretValue);
  const secretLimitReached =
    secrets.length >= PIPELINE_SECRET_MAX_COUNT &&
    !secrets.some((item) => item.name === normalizedSecretName);
  const logRef = useRef<HTMLDivElement>(null);
  const schedulePreset = detectPipelineSchedulePreset(pipeline?.trigger_schedule);
  const scheduleLabel = schedulePreset
    ? schedulePreset === "custom"
      ? p.schedule.customPreset
      : p.schedule.presets[schedulePreset]
    : null;

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
  const configDiagnostics = useMemo(
    () => analyzePipelineJobs(config?.jobs ?? []),
    [config?.jobs]
  );
  const hasConfigErrors = useMemo(
    () => configDiagnostics.some((item) => item.level === "error"),
    [configDiagnostics]
  );

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadPipeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}`);
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      const loadedPipeline = (data?.pipeline ?? null) as PipelineSummary | null;
      setPipeline(loadedPipeline);
      setConfig(normalizeLoadedPipelineConfig(data?.version?.config, loadedPipeline, project.default_branch));
    } catch {
      toast.error(p.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, p.loadFailed, project.default_branch]);

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

  const loadRunDetail = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/pipeline-runs/${runId}`);
      if (!res.ok) return;
      const data = await res.json();
      setRunDetail(data);
    } catch {
      // ignore
    }
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
    void loadRunDetail(selectedRunId);
    const isActive =
      runs.find((r) => r.id === selectedRunId)?.status === "running" ||
      runs.find((r) => r.id === selectedRunId)?.status === "queued" ||
      runs.find((r) => r.id === selectedRunId)?.status === "waiting_manual";
    if (!isActive) return;

    const interval = setInterval(() => {
      void loadRunDetail(selectedRunId);
    }, 2500);
    return () => {
      clearInterval(interval);
    };
  }, [selectedRunId, runs, loadRunDetail]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logText]);

  function secretErrorMessage(code: string | null) {
    switch (code) {
      case "required":
      case "name_required":
        return p.settingsTab.keyRequired;
      case "invalid_format":
      case "invalid_name":
        return p.settingsTab.invalidName;
      case "too_long":
      case "name_too_long":
        return p.settingsTab.nameTooLong;
      case "reserved_name":
        return p.settingsTab.reservedName;
      case "value_required":
        return p.settingsTab.valueRequired;
      case "too_large":
      case "value_too_large":
        return p.settingsTab.valueTooLarge
          .replace("{{size}}", String(Math.floor(PIPELINE_SECRET_VALUE_MAX_BYTES / 1024)));
      case "secret_limit_exceeded":
        return p.settingsTab.maxSecretsReached.replace("{{count}}", String(PIPELINE_SECRET_MAX_COUNT));
      default:
        return null;
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

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
      const normalizedConfig = normalizePipelineConfigForSave(config, project.default_branch);
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
          description: normalizedConfig.description,
          environment: normalizedConfig.environment ?? "production",
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

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : p.deleteFailed);
      }
      toast.success(p.deleteSuccess);
      router.push(withProjectPipelinesPath(pathname, project.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : p.deleteFailed);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
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
    const name = normalizedSecretName;
    const currentNameError = secretErrorMessage(secretNameError);
    if (currentNameError) {
      toast.error(currentNameError);
      return;
    }
    const currentValueError = secretErrorMessage(secretValueError);
    if (currentValueError) {
      toast.error(currentValueError);
      return;
    }
    if (secretLimitReached) {
      toast.error(
        p.settingsTab.maxSecretsReached.replace("{{count}}", String(PIPELINE_SECRET_MAX_COUNT))
      );
      return;
    }

    setSecretSaving(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value: secretValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(secretErrorMessage(data?.error ?? null) ?? p.settingsTab.saveFailed);
      }
      toast.success(p.settingsTab.saveSuccess);
      setSecretName("");
      setSecretValue("");
      await loadSecrets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : p.settingsTab.saveFailed);
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

  async function copySecretName(name: string) {
    try {
      await navigator.clipboard.writeText(name);
      toast.success(dict.common.copied);
    } catch {
      toast.error(p.settingsTab.copyFailed);
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

  async function publishSelectedArtifacts() {
    if (!selectedRunId || selectedArtifacts.length === 0) return;
    setPublishingArtifacts(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: selectedRunId,
          artifactIds: selectedArtifacts.map((artifact) => artifact.id),
          repositoryName: publishRepositoryName,
          repositorySlug: publishRepositorySlug,
          version: publishVersion,
          channelNames: publishChannels
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? p.publishFailed);
      }
      toast.success(p.publishSuccess);
      setPublishDialogOpen(false);
      setPublishChannels("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : p.publishFailed);
    } finally {
      setPublishingArtifacts(false);
    }
  }

  async function handleTriggerJob(jobKey: string) {
    if (!selectedRunId) return;
    setTriggeringJobKey(jobKey);
    try {
      const res = await fetch(
        `/api/pipeline-runs/${selectedRunId}/jobs/${encodeURIComponent(jobKey)}/trigger`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("failed");
      toast.success(p.detail.manualTriggerSuccess);
      await Promise.all([loadRuns(), loadRunDetail(selectedRunId)]);
    } catch {
      toast.error(p.detail.manualTriggerFailed);
    } finally {
      setTriggeringJobKey(null);
    }
  }

  // ── Job progress bar ───────────────────────────────────────────────────────
  const runtimeJobs = useMemo(
    () => normalizePipelineJobs(config?.jobs ?? [], config?.stages, project.default_branch),
    [config?.jobs, config?.stages, project.default_branch]
  );
  const runtimeStageSettings = useMemo(
    () => normalizeStageSettings(config?.stages),
    [config?.stages]
  );
  const runJobsByKey = useMemo(
    () => new Map((runDetail?.jobs ?? []).map((job) => [job.job_key, job])),
    [runDetail?.jobs]
  );
  const runStepsByJobId = useMemo(() => {
    const map = new Map<string, PipelineRunDetail["steps"]>();
    for (const step of runDetail?.steps ?? []) {
      const items = map.get(step.job_id) ?? [];
      items.push(step);
      map.set(step.job_id, items);
    }
    return map;
  }, [runDetail?.steps]);
  const runtimeStages = useMemo(
    () =>
      PIPELINE_STAGE_SEQUENCE.filter((stage) => stage === "source" || runtimeJobs.some((job) => job.stage === stage)).map((stage) => ({
        key: stage,
        jobs: runtimeJobs.filter((job) => job.stage === stage),
        settings: runtimeStageSettings[stage],
      })),
    [runtimeJobs, runtimeStageSettings]
  );
  const selectedRuntimeJob = selectedRunJobKey ? runJobsByKey.get(selectedRunJobKey) ?? null : null;
  const selectedRuntimeJobConfig = selectedRunJobKey
    ? runtimeJobs.find((job) => job.id === selectedRunJobKey) ?? null
    : null;
  const selectedRuntimeSteps = useMemo(
    () => (selectedRuntimeJob ? runStepsByJobId.get(selectedRuntimeJob.id) ?? [] : []),
    [selectedRuntimeJob, runStepsByJobId]
  );
  const selectedRuntimeStep = useMemo(
    () => selectedRuntimeSteps.find((step) => step.id === selectedStepId) ?? null,
    [selectedRuntimeSteps, selectedStepId]
  );
  const runStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const job of runDetail?.jobs ?? []) {
      counts[job.status] = (counts[job.status] ?? 0) + 1;
    }
    return counts;
  }, [runDetail?.jobs]);
  const runtimeStageCardWidth = runtimeStages.length >= 5 ? 252 : 288;
  const runtimeConnectorWidth = runtimeStages.length >= 5 ? 48 : 72;
  const sourceBranch = useMemo(() => getSourceBranch(config?.jobs ?? []), [config?.jobs]);
  const sourceBranchSource =
    pipeline?.source_branch_source ?? (sourceBranch === project.default_branch ? "project_default" : "custom");

  useEffect(() => {
    const jobs = runDetail?.jobs ?? [];
    if (jobs.length === 0) {
      setSelectedRunJobKey(null);
      return;
    }
    if (selectedRunJobKey && jobs.some((job) => job.job_key === selectedRunJobKey)) {
      return;
    }
    const nextJob =
      jobs.find((job) => job.status === "running") ??
      jobs.find((job) => job.status === "waiting_manual") ??
      jobs.find((job) => job.status === "failed") ??
      jobs[0] ??
      null;
    setSelectedRunJobKey(nextJob?.job_key ?? null);
  }, [runDetail?.jobs, selectedRunJobKey]);

  useEffect(() => {
    if (selectedRuntimeSteps.length === 0) {
      setSelectedStepId(null);
      return;
    }
    if (selectedStepId && selectedRuntimeSteps.some((step) => step.id === selectedStepId)) {
      return;
    }
    setSelectedStepId(selectedRuntimeSteps[0]?.id ?? null);
  }, [selectedRuntimeSteps, selectedStepId]);

  useEffect(() => {
    if (!selectedRunId || !selectedStepId) {
      setLogText("");
      return;
    }
    let active = true;
    setLogText("");
    void (async () => {
      try {
        const res = await fetch(
          `/api/pipeline-runs/${selectedRunId}/logs/${selectedStepId}?offset=0&limit=500000`
        );
        const text = res.ok ? await res.text() : "";
        if (active) {
          setLogText(text);
        }
      } catch {
        if (active) {
          setLogText("");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedRunId, selectedStepId]);

  function stageLabel(stage: (typeof PIPELINE_STAGE_SEQUENCE)[number]) {
    switch (stage) {
      case "source":
        return p.stageTab.source;
      case "review":
        return p.stageTab.review;
      case "build":
        return p.stageTab.build;
      case "deploy":
        return p.stageTab.deploy;
      case "after_source":
        return p.jobs.slotLabelAfterSource;
      case "after_review":
        return p.jobs.slotLabelAfterReview;
      case "after_build":
        return p.jobs.slotLabelAfterBuild;
      case "after_deploy":
        return p.jobs.slotLabelAfterDeploy;
      default:
        return stage;
    }
  }

  function statusTone(status?: PipelineRunStatus | null) {
    switch (status) {
      case "success":
        return "border-success/30 bg-success/5";
      case "failed":
      case "timed_out":
        return "border-danger/30 bg-danger/5";
      case "running":
        return "border-warning/30 bg-warning/5";
      case "waiting_manual":
        return "border-warning/30 bg-warning/10";
      default:
        return "border-[hsl(var(--ds-border-1))] bg-background";
    }
  }

  function selectedStatusTone(status?: PipelineRunStatus | null) {
    switch (status) {
      case "success":
        return "border-success/50 bg-success/10 shadow-[0_0_0_1px_rgba(34,197,94,0.16)]";
      case "failed":
      case "timed_out":
        return "border-danger/50 bg-danger/10 shadow-[0_0_0_1px_rgba(239,68,68,0.16)]";
      case "running":
      case "waiting_manual":
        return "border-warning/50 bg-warning/12 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]";
      default:
        return "border-[hsl(var(--ds-accent-7))] bg-[hsl(var(--ds-accent-7)/0.08)] shadow-[0_0_0_1px_hsl(var(--ds-accent-7)/0.12)]";
    }
  }

  function ModeBadgeGroup({
    entryMode,
    dispatchMode,
  }: {
    entryMode: "auto" | "manual";
    dispatchMode: "parallel" | "serial";
  }) {
    return (
      <TooltipProvider delayDuration={120}>
        <div className="flex items-center gap-1.5 text-[hsl(var(--ds-text-2))]">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex size-6 items-center justify-center rounded-[6px] border border-[hsl(var(--ds-border-1))] bg-background">
                {entryMode === "manual" ? <Hand className="size-3.5" /> : <Bot className="size-3.5" />}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {entryMode === "manual" ? p.jobs.entryModeManual : p.jobs.entryModeAuto}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex size-6 items-center justify-center rounded-[6px] border border-[hsl(var(--ds-border-1))] bg-background">
                {dispatchMode === "serial" ? (
                  <ListOrdered className="size-3.5" />
                ) : (
                  <GitBranch className="size-3.5" />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {dispatchMode === "serial" ? p.jobs.dispatchModeSerial : p.jobs.dispatchModeParallel}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );
  }

  const currentRun = runs.find((r) => r.id === selectedRunId);
  const selectedArtifacts = selectedRuntimeJob
    ? artifacts.filter((artifact) => artifact.job_id === selectedRuntimeJob.id)
    : artifacts;

  useEffect(() => {
    setPublishRepositoryName(project.name);
    setPublishRepositorySlug(normalizeArtifactRepositorySlug(project.name));
  }, [project.name]);

  useEffect(() => {
    if (!publishDialogOpen) return;
    const repositoryName = selectedRuntimeJobConfig?.name?.trim() || project.name;
    setPublishRepositoryName(repositoryName);
    setPublishRepositorySlug(normalizeArtifactRepositorySlug(repositoryName));
    const versionSeed = currentRun?.commit_sha?.slice(0, 12) || selectedRunId?.slice(0, 8) || "";
    setPublishVersion(versionSeed ? `build-${versionSeed}` : "");
    setPublishChannels("");
  }, [currentRun?.commit_sha, project.name, publishDialogOpen, selectedRunId, selectedRuntimeJobConfig?.name]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <PageLoading label={dict.common.loading} />;
  }

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
              <div className="flex min-w-0 items-center gap-1">
                <GitBranch className="size-3" />
                <span className="truncate">{pipeline?.source_branch ?? sourceBranch}</span>
              </div>
              <Badge variant={sourceBranchSource === "project_default" ? "muted" : "outline"} size="sm">
                {sourceBranchSource === "project_default"
                  ? p.basic.sourceBranchProjectDefault
                  : p.basic.sourceBranchCustom}
              </Badge>
              {config?.trigger?.autoTrigger && (
                <span className="text-[12px] text-accent">
                  {p.basic.autoTrigger}
                </span>
              )}
              {scheduleLabel && (
                <Badge variant="outline" size="sm">
                  {scheduleLabel}
                </Badge>
              )}
            </div>
            {pipeline?.trigger_schedule && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                <span className="rounded-full border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-2 py-0.5 font-mono">
                  {pipeline.trigger_schedule}
                </span>
                {pipeline.next_scheduled_at && (
                  <span>
                    {p.detail.nextRun}: <span className="text-foreground">{formatLocalDateTime(pipeline.next_scheduled_at)}</span>
                  </span>
                )}
              </div>
            )}
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
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
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
                <span className="text-[13px] font-medium text-foreground">
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
                      setSelectedRunJobKey(null);
                      setSelectedStepId(null);
                      setLogText("");
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
                        <span className="text-[13px] font-medium">
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
                    <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                      {p.detail.trigger[
                        run.trigger_type as keyof typeof p.detail.trigger
                      ] ?? run.trigger_type}
                      {run.branch && (
                        <span className="ml-1">· {run.branch}</span>
                      )}
                    </div>
                    <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
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
                      <div className="space-y-3">
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
                          <div className="flex flex-wrap items-center gap-4 text-[12px] text-[hsl(var(--ds-text-2))]">
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
                            {!!runStatusCounts.success && (
                              <div>{runStatusCounts.success} {p.status.success}</div>
                            )}
                            {!!runStatusCounts.waiting_manual && (
                              <div>{runStatusCounts.waiting_manual} {p.status.waiting_manual}</div>
                            )}
                            {!!runStatusCounts.running && (
                              <div>{runStatusCounts.running} {p.status.running}</div>
                            )}
                            {!!runStatusCounts.failed && (
                              <div>{runStatusCounts.failed} {p.status.failed}</div>
                            )}
                          </div>
                        )}
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

                  {/* Runtime board */}
                  <div
                    className={`flex-1 min-h-0 overflow-hidden ${
                      selectedRuntimeJobConfig && selectedRuntimeJob
                        ? "grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]"
                        : "block"
                    }`}
                  >
                    <div
                      className="min-h-0 overflow-auto bg-[hsl(var(--ds-surface-1))]/30"
                      onClick={() => {
                        setSelectedRunJobKey(null);
                        setSelectedStepId(null);
                      }}
                    >
                      {!runDetail && (
                        <div className="px-6 py-6 text-[12px] text-[hsl(var(--ds-text-2))]">
                          {dict.common.loading}
                        </div>
                      )}
                      {runDetail && (
                        <div className="flex min-w-max snap-x snap-mandatory gap-3 px-5 py-4">
                          {runtimeStages.map((stage, stageIndex) => (
                            <div key={stage.key} className="contents">
                              <div
                                className="flex shrink-0 snap-start flex-col rounded-[14px] border border-[hsl(var(--ds-border-1))] bg-background"
                                style={{ width: runtimeStageCardWidth }}
                              >
                                <div className="border-b border-[hsl(var(--ds-border-1))] px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-foreground">
                                        {stageLabel(stage.key)}
                                      </div>
                                      <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                                        {p.detail.nodesCount.replace("{{count}}", String(stage.jobs.length))}
                                      </div>
                                    </div>
                                    <ModeBadgeGroup
                                      entryMode={getStageConfig(runtimeStageSettings, stage.key).entryMode ?? "auto"}
                                      dispatchMode={getStageConfig(runtimeStageSettings, stage.key).dispatchMode ?? "parallel"}
                                    />
                                  </div>
                                </div>
                                <div className="flex flex-1 flex-col gap-3 p-3">
                                  {stage.jobs.map((job, index) => {
                                    const runtimeJob = runJobsByKey.get(job.id);
                                    const runtimeStatus =
                                      (runtimeJob?.status as PipelineRunStatus | undefined) ?? "queued";
                                    const runtimeSteps = runtimeJob ? runStepsByJobId.get(runtimeJob.id) ?? [] : [];
                                    const selected = selectedRunJobKey === job.id;
                                    return (
                                      <div key={job.id} className="space-y-3">
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setSelectedRunJobKey(job.id);
                                          }}
                                          className={`w-full rounded-[12px] border p-3 text-left transition-all ${
                                            selected
                                              ? selectedStatusTone(runtimeStatus)
                                              : statusTone(runtimeStatus)
                                          }`}
                                        >
                                          <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-2">
                                                {STATUS_ICON_SM[runtimeStatus]}
                                                <span className="truncate text-sm font-medium text-foreground">
                                                  {job.name}
                                                </span>
                                              </div>
                                              <div className="mt-1 truncate text-[12px] text-[hsl(var(--ds-text-2))]">
                                                {job.id}
                                              </div>
                                            </div>
                                            <Badge variant={STATUS_VARIANTS[runtimeStatus]} size="sm">
                                              {p.status[runtimeStatus]}
                                            </Badge>
                                          </div>
                                          <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-[hsl(var(--ds-text-2))]">
                                            <span>{p.detail.stepsCount.replace("{{count}}", String(runtimeSteps.length))}</span>
                                            <span>
                                              {runtimeJob?.started_at
                                                ? durationLabel(runtimeJob.started_at, runtimeJob.finished_at ?? undefined)
                                                : p.detail.notStarted}
                                            </span>
                                          </div>
                                          {runtimeStatus === "waiting_manual" && isAdmin && (
                                            <div className="mt-3">
                                              <Button
                                                type="button"
                                                size="sm"
                                                className="w-full"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                void handleTriggerJob(job.id);
                                              }}
                                                disabled={triggeringJobKey === job.id}
                                              >
                                                <Play className="mr-1 size-3.5" />
                                                {triggeringJobKey === job.id
                                                  ? dict.common.loading
                                                  : p.detail.manualTrigger}
                                              </Button>
                                            </div>
                                        )}
                                      </button>
                                      {index < stage.jobs.length - 1 && (
                                          <div className="flex items-center justify-center py-0.5 text-[hsl(var(--ds-border-2)/0.82)]">
                                            <ArrowDown className="size-3.5" />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              {stageIndex < runtimeStages.length - 1 && (
                                <div
                                  className="flex shrink-0 items-center justify-center"
                                  style={{ width: runtimeConnectorWidth }}
                                >
                                  <div className="relative h-10 w-full text-[hsl(var(--ds-border-2)/0.82)]">
                                    <span className="absolute left-0 right-[15px] top-1/2 h-px -translate-y-1/2 bg-[hsl(var(--ds-border-2)/0.82)] mr-[-3px]" />
                                    <ArrowRight className="absolute right-0 top-1/2 size-4 -translate-y-1/2" />
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedRuntimeJobConfig && selectedRuntimeJob && (
                      <div className="min-h-0 border-t xl:border-t-0 xl:border-l border-[hsl(var(--ds-border-1))] bg-background">
                        <div className="flex h-full flex-col">
                          <div className="border-b border-[hsl(var(--ds-border-1))] px-5 py-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  {STATUS_ICON[selectedRuntimeJob.status as PipelineRunStatus]}
                                  <span className="truncate text-sm font-semibold text-foreground">
                                    {selectedRuntimeJobConfig.name}
                                  </span>
                                </div>
                                <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                                  {stageLabel(selectedRuntimeJobConfig.stage ?? "build")} · {selectedRuntimeJob.job_key}
                                </div>
                              </div>
                              <Badge variant={STATUS_VARIANTS[selectedRuntimeJob.status as PipelineRunStatus]} size="sm">
                                {p.status[selectedRuntimeJob.status as PipelineRunStatus]}
                              </Badge>
                            </div>
                          </div>

                          <div className="flex-1 min-h-0 overflow-auto">
                            <div className="space-y-4 px-5 py-4">
                              <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]/30 p-3">
                                <div className="text-[12px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                                  {p.detail.stepsTitle}
                                </div>
                                <div className="mt-3 space-y-2">
                                  {selectedRuntimeSteps.map((step) => (
                                    <button
                                      type="button"
                                      key={step.id}
                                      onClick={() => setSelectedStepId(step.id)}
                                      className={`flex w-full items-center gap-2 rounded-[8px] border px-3 py-2 text-left transition-colors ${
                                        selectedStepId === step.id
                                          ? "border-foreground bg-background"
                                          : "border-[hsl(var(--ds-border-1))] hover:bg-background"
                                      }`}
                                    >
                                      {STATUS_ICON_SM[step.status as PipelineRunStatus]}
                                      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                                        {step.name}
                                      </span>
                                      {step.exit_code !== null && step.exit_code !== undefined && (
                                        <span className="text-[12px] text-[hsl(var(--ds-text-2))]">
                                          {p.detail.exitCode.replace("{{code}}", String(step.exit_code))}
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] overflow-hidden bg-terminal">
                                <div className="border-b border-[hsl(var(--ds-border-1))] px-4 py-2.5 text-[12px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                                  {selectedRuntimeStep ? selectedRuntimeStep.name : p.log.title}
                                </div>
                                {!selectedStepId && (
                                  <div className="px-4 py-10 text-[12px] text-terminal-muted">
                                    {p.log.selectStep}
                                  </div>
                                )}
                                {selectedStepId && (
                                  <div
                                    ref={logRef}
                                    className="max-h-[320px] overflow-y-auto whitespace-pre-wrap p-4 font-mono text-[12px] leading-relaxed text-terminal"
                                  >
                                    {logText || (
                                      <span className="text-terminal-muted">
                                        {p.log.noLogs}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>

                              {selectedArtifacts.length > 0 && (
                                <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-background">
                                  <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--ds-border-1))] px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <Package className="size-3.5 text-[hsl(var(--ds-text-2))]" />
                                      <span className="text-[12px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                                        {p.artifactsLabel.replace("{{count}}", String(selectedArtifacts.length))}
                                      </span>
                                    </div>
                                    {isAdmin && (
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setPublishDialogOpen(true)}
                                      >
                                        {p.publishArtifacts}
                                      </Button>
                                    )}
                                  </div>
                                  <div className="divide-y divide-[hsl(var(--ds-border-1))]">
                                    {selectedArtifacts.map((artifact) => {
                                      const sizeKb = Math.round(Number(artifact.size_bytes) / 1024);
                                      const sizeLabel =
                                        sizeKb >= 1024
                                          ? `${(sizeKb / 1024).toFixed(1)} MB`
                                          : `${sizeKb} KB`;
                                      const filename = artifact.path.split("/").pop() ?? artifact.path;
                                      return (
                                        <div key={artifact.id} className="flex items-center gap-3 px-4 py-3">
                                          <Package className="size-3.5 shrink-0 text-[hsl(var(--ds-text-2))]" />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate text-[12px] font-medium text-foreground">
                                              {filename}
                                            </div>
                                            <div className="truncate text-[12px] text-[hsl(var(--ds-text-2))]">
                                              {artifact.path}
                                            </div>
                                          </div>
                                          <span className="text-[12px] text-[hsl(var(--ds-text-2))]">
                                            {sizeLabel}
                                          </span>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => downloadArtifact(artifact.id)}
                                            disabled={downloadingArtifactId === artifact.id}
                                          >
                                            {downloadingArtifactId === artifact.id
                                              ? dict.common.loading
                                              : dict.common.download}
                                          </Button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
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
                  className={`w-full flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-[13px] transition-colors ${
                    configSection === "jobs"
                      ? "bg-muted text-foreground font-medium"
                      : "text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-surface-1))] hover:text-foreground"
                  }`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-muted/80 text-[11px]">
                    J
                  </span>
                  {p.jobs.title}
                </button>
                <button
                  type="button"
                  onClick={() => setConfigSection("settings")}
                  className={`w-full flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-[13px] transition-colors ${
                    configSection === "settings"
                      ? "bg-muted text-foreground font-medium"
                      : "text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-surface-1))] hover:text-foreground"
                  }`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-muted/80 text-[11px]">
                    S
                  </span>
                  {p.settingsTab.title}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {configSection === "jobs" && (
                  <div className="space-y-6 pb-8">
                    <DiagnosticsPanel diagnostics={configDiagnostics} dict={p} />
                    <div className="max-w-sm space-y-1.5">
                      <label className="text-[13px] font-medium text-foreground">{p.basic.environment}</label>
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
                      <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                        {p.basic.environmentHelp}
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
                    <div className="max-w-2xl">
                      <PipelineScheduleField
                        value={config.trigger.schedule ?? ""}
                        nextScheduledAt={pipeline?.next_scheduled_at ?? null}
                        onChange={(value) =>
                          setConfig({
                            ...config,
                            trigger: { ...config.trigger, schedule: value },
                          })
                        }
                      />
                    </div>
                    <StageBuilder
                      jobs={config.jobs}
                      stageSettings={config.stages}
                      dict={p}
                      artifactLoadFailedMessage={dict.artifacts.loadFailed}
                      isAdmin={isAdmin}
                      selectedJobId={selectedConfigJobId}
                      onSelectJob={(jobId) => setSelectedConfigJobId(jobId)}
                      onJobsChange={(jobs) => setConfig({ ...config, jobs })}
                      onStageSettingsChange={(stages) => setConfig({ ...config, stages })}
                    />
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
                              <Input value={k} disabled className="h-8 w-48 font-mono text-[13px]" />
                              <Input
                                value={v}
                                onChange={(e) => updateVariable(k, e.target.value)}
                                className="h-8 flex-1 font-mono text-[13px]"
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
                              className="h-8 w-48 font-mono text-[13px]"
                            />
                            <Input
                              value={newVarValue}
                              onChange={(e) => setNewVarValue(e.target.value)}
                              placeholder={p.settingsTab.varValue}
                              className="h-8 flex-1 font-mono text-[13px]"
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
                        <div className="text-[13px] font-medium text-foreground">{p.notifications.channels}</div>
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
                                className={`flex-1 rounded-[8px] border py-2 text-[13px] font-medium transition-colors ${
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

                      <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-3">
                        <div className="text-[12px] font-medium text-foreground">
                          {p.settingsTab.usageTitle}
                        </div>
                        <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                          {p.settingsTab.usageDescription}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="muted" size="sm">{p.settingsTab.multilineSupported}</Badge>
                          <Badge variant="muted" size="sm">
                            {p.settingsTab.maxSecretsReached.replace("{{count}}", String(PIPELINE_SECRET_MAX_COUNT))}
                          </Badge>
                          <Badge variant="muted" size="sm">
                            {p.settingsTab.valueTooLarge.replace(
                              "{{size}}",
                              String(Math.floor(PIPELINE_SECRET_VALUE_MAX_BYTES / 1024))
                            )}
                          </Badge>
                        </div>
                        <div className="mt-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                          {p.settingsTab.precedenceHint}
                        </div>
                        <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                          {p.settingsTab.reservedPrefixHint.replace("{{prefix}}", PIPELINE_RESERVED_ENV_PREFIX)}
                        </div>
                      </div>

                      <div className="space-y-2">
                        {secretsLoading && (
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] py-2">
                            {dict.common.loading}
                          </div>
                        )}
                        {!secretsLoading && secrets.length === 0 && (
                          <div className="rounded-[8px] border border-dashed border-[hsl(var(--ds-border-1))] px-3 py-4 text-[12px] text-[hsl(var(--ds-text-2))]">
                            {p.settingsTab.empty}
                          </div>
                        )}
                        {!secretsLoading &&
                          secrets.map((s) => (
                            <div
                              key={s.name}
                              className="flex items-center justify-between gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] px-3 py-2.5"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div className="truncate font-mono text-[13px] text-foreground">{s.name}</div>
                                  <Badge variant="muted" size="sm">{p.settingsTab.saved}</Badge>
                                </div>
                                <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                                  {p.settingsTab.updatedAt.replace(
                                    "{{time}}",
                                    formatLocalDateTime(s.updated_at)
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="gap-1.5"
                                  onClick={() => {
                                    void copySecretName(s.name);
                                  }}
                                >
                                  <Copy className="size-3.5" />
                                  {p.settingsTab.copyName}
                                </Button>
                                {isAdmin && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setSecretToDelete(s.name)}
                                    disabled={secretDeleting === s.name}
                                    aria-label={dict.common.delete}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>

                      {isAdmin && (
                        <>
                          <Separator />
                          <div className="grid gap-3">
                            <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
                              <div className="space-y-2">
                                <Input
                                  value={secretName}
                                  onChange={(e) => setSecretName(normalizePipelineSecretName(e.target.value))}
                                  placeholder={p.settingsTab.secretKey}
                                  className="h-9 font-mono text-[13px]"
                                />
                                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                                  {secretErrorMessage(secretNameError) ?? p.settingsTab.secretKeyHint}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Textarea
                                  value={secretValue}
                                  onChange={(e) => setSecretValue(e.target.value)}
                                  placeholder={p.settingsTab.secretValue}
                                  className="min-h-[104px] font-mono text-[13px]"
                                />
                                <div className="flex items-center justify-between gap-3 text-[12px] text-[hsl(var(--ds-text-2))]">
                                  <span>
                                    {secretErrorMessage(secretValueError) ?? p.settingsTab.secretValueHint}
                                  </span>
                                  <span>
                                    {p.settingsTab.byteCount
                                      .replace("{{current}}", String(secretValueBytes))
                                      .replace("{{max}}", String(PIPELINE_SECRET_VALUE_MAX_BYTES))}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <Button
                                variant="default"
                                size="sm"
                                onClick={saveSecret}
                                disabled={
                                  secretSaving ||
                                  !!secretNameError ||
                                  !!secretValueError ||
                                  secretLimitReached
                                }
                              >
                                {p.settingsTab.saveSecret}
                              </Button>
                            </div>
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
                              className={`flex-1 min-w-[120px] rounded-[8px] border px-3 py-2 text-left text-[13px] transition-colors ${
                                active
                                  ? "border-foreground bg-muted text-foreground"
                                  : "border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:border-foreground/40"
                              } ${!isAdmin ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                              <div className="font-medium">{label}</div>
                              <div className="mt-0.5 text-[12px] opacity-70">{help}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {isAdmin && (
                      <SettingsDangerZone
                        title={p.settingsTab.dangerZoneTitle}
                        description={p.settingsTab.dangerZoneDescription}
                        warning={p.settingsTab.deletePipelineWarning}
                        action={
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setDeleteDialogOpen(true)}
                            disabled={deleting}
                          >
                            {p.deleteAction}
                          </Button>
                        }
                      />
                    )}
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

      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{p.publishArtifactsTitle}</DialogTitle>
            <DialogDescription>{p.publishArtifactsDescription}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <SettingsField label={p.publishRepositoryName}>
              <Input
                value={publishRepositoryName}
                onChange={(event) => {
                  const value = event.target.value;
                  setPublishRepositoryName(value);
                  setPublishRepositorySlug(normalizeArtifactRepositorySlug(value));
                }}
                placeholder={p.publishRepositoryNamePlaceholder}
              />
            </SettingsField>
            <SettingsField label={p.publishRepositorySlug}>
              <Input
                value={publishRepositorySlug}
                onChange={(event) => setPublishRepositorySlug(normalizeArtifactRepositorySlug(event.target.value))}
                placeholder={p.publishRepositorySlugPlaceholder}
              />
            </SettingsField>
            <SettingsField label={p.publishVersion}>
              <Input
                value={publishVersion}
                onChange={(event) => setPublishVersion(event.target.value)}
                placeholder={p.publishVersionPlaceholder}
              />
            </SettingsField>
            <SettingsField label={p.publishChannels}>
              <Input
                value={publishChannels}
                onChange={(event) => setPublishChannels(event.target.value)}
                placeholder={p.publishChannelsPlaceholder}
              />
            </SettingsField>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPublishDialogOpen(false)}
              disabled={publishingArtifacts}
            >
              {dict.common.cancel}
            </Button>
            <Button
              type="button"
              onClick={publishSelectedArtifacts}
              disabled={
                publishingArtifacts ||
                !publishRepositoryName.trim() ||
                !publishRepositorySlug.trim() ||
                !publishVersion.trim()
              }
            >
              {publishingArtifacts ? dict.common.loading : p.publishArtifacts}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={secretToDelete !== null}
        title={p.settingsTab.deleteDialogTitle}
        description={p.settingsTab.deleteDialogDescription.replace("{{name}}", secretToDelete ?? "")}
        confirmLabel={dict.common.delete}
        cancelLabel={dict.common.cancel}
        onOpenChange={(open) => {
          if (!open) setSecretToDelete(null);
        }}
        onConfirm={() => {
          if (!secretToDelete) return;
          void deleteSecret(secretToDelete).finally(() => {
            setSecretToDelete(null);
          });
        }}
        loading={secretDeleting === secretToDelete}
        danger
      />

      <TypedConfirmDialog
        open={deleteDialogOpen}
        title={p.deleteDialogTitle}
        description={p.deleteDialogDescription.replace("{{name}}", pipeline?.name ?? "")}
        confirmLabel={dict.common.delete}
        cancelLabel={dict.common.cancel}
        keyword={pipeline?.name ?? ""}
        keywordHint={p.settingsTab.deleteConfirmInstruction.replace("{{name}}", pipeline?.name ?? "")}
        inputLabel={p.settingsTab.deleteConfirmLabel}
        inputPlaceholder={p.settingsTab.deleteConfirmPlaceholder}
        mismatchText={p.settingsTab.deleteConfirmMismatch}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={() => {
          void handleDelete();
        }}
        loading={deleting}
        danger
      />

    </div>
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
    <div className="max-w-3xl rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
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

function normalizeLoadedPipelineConfig(
  rawConfig: unknown,
  pipeline: PipelineSummary | null,
  defaultBranch: string
): PipelineConfig {
  const parsed = pipelineConfigSchema.safeParse(rawConfig);
  if (parsed.success) {
    return normalizePipelineConfigForSave(parsed.data as PipelineConfig, defaultBranch);
  }

  const fallback = createDefaultPipelineConfig(pipeline?.name ?? "", defaultBranch);
  if (pipeline?.description) {
    fallback.description = pipeline.description;
  }
  return fallback;
}

function normalizePipelineConfigForSave(config: PipelineConfig, defaultBranch: string): PipelineConfig {
  const schedule = config.trigger.schedule?.trim();
  return {
    ...config,
    trigger: {
      autoTrigger: config.trigger.autoTrigger,
      ...(schedule ? { schedule } : {}),
    },
    stages: normalizeStageSettings(config.stages),
    jobs: normalizePipelineJobs(config.jobs, config.stages, defaultBranch),
  };
}

function withProjectPipelinesPath(pathname: string, projectId: string) {
  return pathname.replace(/\/projects\/[^/]+\/pipelines\/[^/]+$/, `/projects/${projectId}/pipelines`);
}
