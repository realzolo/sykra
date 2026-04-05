"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
  Info,
  PanelLeftOpen,
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
  User,
  CheckCircle,
  XCircle,
  Circle,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
} from "lucide-react";
import type { Dictionary } from "@/i18n";
import type {
  PipelineConfig,
  PipelineEnvironment,
  PipelineEnvironmentDefinition,
  PipelineJobDiagnostic,
  PipelineRunDetail,
  PipelineRunStatus,
  PipelineSummary,
  PipelineTrigger,
  PipelineVersion,
} from "@/services/pipelineTypes";
import type { RunArtifactReleaseSummary } from "@/services/artifactRegistry";
import {
  analyzePipelineConfig,
  buildPipelineRunExecutionSummary,
  DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS,
  createDefaultPipelineConfig,
  detectPipelineSchedulePreset,
  durationLabel,
  diffPipelineConfigs,
  enforceProductionDeployManualGate,
  getPipelineEnvironmentLabel,
  normalizePipelineEnvironmentDefinitions,
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
import BuildImageField from "@/components/pipeline/BuildImageField";

type Tab = "runs" | "configure";
type ConfigureSection = "jobs" | "settings" | "versions";

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
type PipelineRunStep = PipelineRunDetail["steps"][number];
type PipelinePolicyRejection = {
  id: string;
  reason_code: string;
  operation: string;
  message: string;
  path: string | null;
  created_at: string;
  rejected_by: string | null;
  rejected_by_name: string | null;
  rejected_by_email: string | null;
};
type StepLogCacheEntry = {
  logPath: string;
  text: string;
  nextOffset: number;
  complete: boolean;
};
type TerminalLineTone = "default" | "system" | "warning" | "error";

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 60000) {
    return `${Math.max(1, Math.round(ms / 1000))}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatDurationSeconds(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds) || seconds === null || seconds === undefined || seconds <= 0) {
    return "—";
  }
  return formatDurationMs(seconds * 1000);
}

function normalizeArtifactRepositorySlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function deriveRuntimeJobStatus(
  jobStatus: string | null | undefined,
  steps: PipelineRunStep[],
  runStatus?: string | null
): PipelineRunStatus {
  if (isPipelineRunStatus(jobStatus) && jobStatus !== "queued") {
    return jobStatus;
  }

  const stepStatuses = steps.map((step) => step.status);
  if (stepStatuses.some((status) => status === "running")) {
    return "running";
  }
  if (stepStatuses.some((status) => status === "timed_out")) {
    return "timed_out";
  }
  if (stepStatuses.some((status) => status === "canceled")) {
    return "canceled";
  }
  if (stepStatuses.some((status) => status === "failed")) {
    return "failed";
  }
  if (stepStatuses.length > 0 && stepStatuses.every((status) => status === "success")) {
    return "success";
  }
  if (isTerminalPipelineRunStatus(runStatus) && (!jobStatus || jobStatus === "queued")) {
    return "canceled";
  }
  if (stepStatuses.some((status) => status === "waiting_manual")) {
    return "waiting_manual";
  }
  return isPipelineRunStatus(jobStatus) ? jobStatus : "queued";
}

const PIPELINE_RUN_STATUS_VALUES: PipelineRunStatus[] = [
  "queued",
  "running",
  "waiting_manual",
  "success",
  "failed",
  "canceled",
  "timed_out",
  "skipped",
];

function isPipelineRunStatus(value: string | null | undefined): value is PipelineRunStatus {
  return typeof value === "string" && PIPELINE_RUN_STATUS_VALUES.includes(value as PipelineRunStatus);
}

const TERMINAL_PIPELINE_RUN_STATUSES: PipelineRunStatus[] = ["success", "failed", "canceled", "timed_out"];

function isTerminalPipelineRunStatus(value: string | null | undefined): boolean {
  return typeof value === "string" && TERMINAL_PIPELINE_RUN_STATUSES.includes(value as PipelineRunStatus);
}

function getStepOutcomeLabel(step: PipelineRunStep, dict: Dictionary["pipelines"]["detail"]) {
  switch (step.status) {
    case "success":
      return dict.stepOutcome.succeeded;
    case "failed":
      return dict.stepOutcome.failed;
    case "timed_out":
      return dict.stepOutcome.timedOut;
    case "canceled":
      return dict.stepOutcome.canceled;
    case "skipped":
      return dict.stepOutcome.skipped;
    case "running":
      return dict.stepOutcome.running;
    case "waiting_manual":
      return dict.stepOutcome.waitingManual;
    case "queued":
    default:
      return dict.stepOutcome.queued;
  }
}

function getTerminalLineTone(line: string): TerminalLineTone {
  const trimmed = line.trim();
  if (!trimmed) return "default";

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("[system]")) {
    const systemBody = trimmed.replace(/^\[system\]\s*/i, "");
    if (/^(npm\s+warn|warn|warning)\b/i.test(systemBody) || /\bdeprecated\b/i.test(systemBody)) return "warning";
    if (/^(npm\s+error|npm\s+err!|err|error|fatal|panic)\b/i.test(systemBody) || /\berror\b/i.test(systemBody)) return "error";
    if (/permission denied|refused|exit status \d+|failed to|not found/i.test(systemBody)) return "error";
    return "system";
  }
  if (/^\[(warn|warning)\]/i.test(trimmed)) return "warning";
  if (/^\[(err|error)\]/i.test(trimmed)) return "error";
  if (/^(npm\s+warn|warn|warning)\b/i.test(trimmed) || /\bdeprecated\b/i.test(trimmed)) return "warning";
  if (/^(npm\s+error|npm\s+err!|err|error|fatal|panic)\b/i.test(trimmed)) return "error";
  if (/^sh:\s.*not found$/i.test(trimmed)) return "error";
  if (/permission denied|refused|exit status \d+|failed to/i.test(trimmed)) return "error";
  if (/\berror\b/i.test(trimmed)) return "error";
  return "default";
}

function getTerminalLineClassName(tone: TerminalLineTone) {
  switch (tone) {
    case "system":
      return "text-terminal-muted";
    case "warning":
      return "text-warning";
    case "error":
      return "text-danger";
    default:
      return "text-terminal";
  }
}

function getTerminalLineRowClassName(tone: TerminalLineTone) {
  switch (tone) {
    case "system":
      return "bg-[hsl(var(--terminal-line-system-bg))]";
    case "warning":
      return "bg-[hsl(var(--terminal-line-warning-bg))]";
    case "error":
      return "bg-[hsl(var(--terminal-line-error-bg))]";
    default:
      return "";
  }
}

function getTerminalLineMarkerClassName(tone: TerminalLineTone) {
  switch (tone) {
    case "warning":
      return "bg-[hsl(var(--terminal-line-warning-marker))]";
    case "error":
      return "bg-[hsl(var(--terminal-line-error-marker))]";
    default:
      return "bg-transparent";
  }
}

function getEnvironmentBadgeVariant(environment: string): "danger" | "warning" | "muted" {
  switch (environment) {
    case "production":
      return "danger";
    case "preview":
      return "warning";
    default:
      return "muted";
  }
}

function getRunActorLabel(run: PipelineRun, dict: Dictionary["pipelines"]): string {
  if (run.triggered_by_name?.trim()) {
    return run.triggered_by_name;
  }
  if (run.triggered_by_email?.trim()) {
    return run.triggered_by_email;
  }
  if (run.triggered_by?.trim()) {
    return run.triggered_by.slice(0, 8);
  }
  return dict.detail.trigger[run.trigger_type as keyof typeof dict.detail.trigger] ?? run.trigger_type;
}

function getVersionActorLabel(version: PipelineVersion): string {
  if (version.created_by_name?.trim()) {
    return version.created_by_name;
  }
  if (version.created_by_email?.trim()) {
    return version.created_by_email;
  }
  if (version.created_by?.trim()) {
    return version.created_by.slice(0, 8);
  }
  return "";
}

function getPolicyRejectionOperationLabel(
  operation: string,
  dict: Dictionary["pipelines"]["settingsTab"]
): string {
  switch (operation) {
    case "create":
      return dict.policyRejectionsOperationCreate;
    case "update":
      return dict.policyRejectionsOperationUpdate;
    case "concurrency_patch":
      return dict.policyRejectionsOperationConcurrencyPatch;
    default:
      return operation;
  }
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
  const a = dict.artifacts;
  const { isAdmin } = useOrgRole();

  const initialTab = (searchParams.get("tab") as Tab) ?? "runs";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [pipeline, setPipeline] = useState<PipelineSummary | null>(null);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [versions, setVersions] = useState<PipelineVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [environmentOptions, setEnvironmentOptions] = useState<PipelineEnvironmentDefinition[]>(
    DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map((item) => ({ ...item }))
  );
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const initialRunId = searchParams.get("runId");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);
  const [runDetail, setRunDetail] = useState<PipelineRunDetail | null>(null);
  const [logText, setLogText] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedRunJobKey, setSelectedRunJobKey] = useState<string | null>(null);
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cancelRunDialogOpen, setCancelRunDialogOpen] = useState(false);
  const [cancelingRunId, setCancelingRunId] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [triggeringJobKey, setTriggeringJobKey] = useState<string | null>(null);
  const [retryingJobKey, setRetryingJobKey] = useState<string | null>(null);
  const [retryDialogTarget, setRetryDialogTarget] = useState<{
    jobKey: string;
    jobName: string;
    stepCount: number;
  } | null>(null);
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
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishingArtifacts, setPublishingArtifacts] = useState(false);
  const [publishRepositoryName, setPublishRepositoryName] = useState(project.name);
  const [publishRepositorySlug, setPublishRepositorySlug] = useState(normalizeArtifactRepositorySlug(project.name));
  const [publishVersion, setPublishVersion] = useState("");
  const [publishChannels, setPublishChannels] = useState("");
  const [artifactReleases, setArtifactReleases] = useState<RunArtifactReleaseSummary[]>([]);
  const [promoteChannelName, setPromoteChannelName] = useState("");
  const [promotingChannel, setPromotingChannel] = useState(false);
  const [runStreamNonce, setRunStreamNonce] = useState(0);
  const [runHistoryDialogOpen, setRunHistoryDialogOpen] = useState(false);
  const [policyRejectionsLoading, setPolicyRejectionsLoading] = useState(false);
  const [policyRejections, setPolicyRejections] = useState<PipelinePolicyRejection[]>([]);

  const selectedRunIdRef = useRef<string | null>(initialRunId);
  const previousSelectedRunIdRef = useRef<string | null>(initialRunId);
  const previousRunStatusRef = useRef<PipelineRunStatus | null>(null);
  const runtimeBoardViewportRef = useRef<HTMLDivElement>(null);
  const runtimeBoardContentRef = useRef<HTMLDivElement>(null);
  const runtimeBoardRailRef = useRef<HTMLDivElement>(null);
  const runtimeBoardDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    dragging: boolean;
  } | null>(null);
  const runtimeBoardSuppressClickRef = useRef(false);
  const runtimeBoardDragThreshold = 6;
  const stepLogCacheRef = useRef<Map<string, StepLogCacheEntry>>(new Map());
  const normalizedSecretName = normalizePipelineSecretName(secretName);
  const secretNameError = validatePipelineSecretName(normalizedSecretName);
  const secretValueError = validatePipelineSecretValue(secretValue);
  const secretValueBytes = getPipelineSecretValueBytes(secretValue);
  const secretLimitReached =
    secrets.length >= PIPELINE_SECRET_MAX_COUNT &&
    !secrets.some((item) => item.name === normalizedSecretName);
  const logRef = useRef<HTMLDivElement>(null);
  const [runtimeBoardContentWidth, setRuntimeBoardContentWidth] = useState(0);
  const [runtimeBoardScrollLeft, setRuntimeBoardScrollLeft] = useState(0);
  const [runtimeBoardDragging, setRuntimeBoardDragging] = useState(false);
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
    () =>
      config
        ? analyzePipelineConfig(config, config.jobs ?? [])
        : [],
    [config]
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
      const loadedVersions = Array.isArray(data?.versions) ? (data.versions as PipelineVersion[]) : [];
      setVersions(loadedVersions);
      setSelectedVersionId(
        data?.pipeline?.current_version_id ??
          loadedVersions.find((version) => version.id === data?.pipeline?.current_version_id)?.id ??
          loadedVersions[loadedVersions.length - 1]?.id ??
          null
      );
      setConfig(normalizeLoadedPipelineConfig(data?.version?.config, loadedPipeline, project.default_branch));
    } catch {
      toast.error(p.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, p.loadFailed, project.default_branch]);

  const loadRuns = useCallback(async (selectLatest = false) => {
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/runs`);
      const data = res.ok ? await res.json() : [];
      const loadedRuns = Array.isArray(data) ? (data as PipelineRun[]) : [];
      setRuns(loadedRuns);
      if (selectLatest && loadedRuns[0]) {
        setSelectedRunId(loadedRuns[0].id);
      }
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

  const loadPolicyRejections = useCallback(async () => {
    setPolicyRejectionsLoading(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/policy-rejections?limit=20`, {
        method: "GET",
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json().catch(() => ({}));
      setPolicyRejections(Array.isArray(data?.items) ? data.items : []);
    } catch {
      toast.error(p.settingsTab.policyRejectionsLoadFailed);
    } finally {
      setPolicyRejectionsLoading(false);
    }
  }, [pipelineId, p.settingsTab.policyRejectionsLoadFailed]);

  const loadArtifacts = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/pipeline-runs/${runId}/artifacts`);
      if (!res.ok) return;
      const data = await res.json();
      setArtifacts(Array.isArray(data?.artifacts) ? data.artifacts : []);
      setArtifactReleases(Array.isArray(data?.releases) ? data.releases : []);
    } catch {/* ignore */}
  }, []);

  const applyRunDetail = useCallback((runId: string, detail: PipelineRunDetail) => {
    if (selectedRunIdRef.current === runId) {
      setRunDetail(detail);
    }
    const latestRun = detail.run;
    if (!latestRun) {
      return;
    }
    setRuns((currentRuns) =>
      currentRuns.map((run) => (run.id === latestRun.id ? { ...run, ...latestRun } : run))
    );
  }, []);

  const loadRunDetail = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/pipeline-runs/${runId}`);
      if (!res.ok) return;
      const data = await res.json();
      applyRunDetail(runId, data);
    } catch {
      // ignore
    }
  }, [applyRunDetail]);

  useEffect(() => {
    loadPipeline();
    loadRuns();
  }, [loadPipeline, loadRuns]);

  useEffect(() => {
    if (versions.length === 0) {
      setSelectedVersionId(null);
      return;
    }
    if (selectedVersionId && versions.some((version) => version.id === selectedVersionId)) {
      return;
    }
    const currentVersionId = pipeline?.current_version_id ?? null;
    const nextVersion =
      versions.find((version) => version.id === currentVersionId) ??
      versions[0] ??
      null;
    setSelectedVersionId(nextVersion?.id ?? null);
  }, [pipeline?.current_version_id, selectedVersionId, versions]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!config || environmentOptions.length === 0) return;
    const environmentKeys = environmentOptions.map((item) => item.key);
    if (!config.environment || !environmentKeys.includes(config.environment)) {
      setConfig((current) =>
        current
          ? enforceProductionDeployManualGate({
              ...current,
              environment: environmentKeys[0] ?? "production",
            })
          : current
      );
    }
  }, [config, environmentOptions]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);
  useEffect(() => {
    if (tab !== "configure") return;
    if (configSection !== "settings") return;
    void loadSecrets();
    void loadPolicyRejections();
  }, [tab, configSection, loadSecrets, loadPolicyRejections]);

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
    stepLogCacheRef.current.clear();
    setRunDetail(null);
    setSelectedRunJobKey(null);
    setSelectedStepId(null);
    setLogText("");
    setLogLoading(false);
    setLogError(null);
    setArtifacts([]);
    setArtifactReleases([]);
    void loadArtifacts(selectedRunId);
  }, [selectedRunId, loadArtifacts]);

  // Keep run detail synchronized through SSE, with polling fallback if the stream fails.
  useEffect(() => {
    if (!selectedRunId) return;

    let active = true;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let eventSource: EventSource | null = null;

    const stopFallback = () => {
      if (!fallbackInterval) return;
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    };

    const startFallback = () => {
      if (fallbackInterval) return;
      fallbackInterval = setInterval(() => {
        void loadRunDetail(selectedRunId);
      }, 1000);
    };

    void loadRunDetail(selectedRunId);

    try {
      eventSource = new EventSource(`/api/pipeline-runs/${selectedRunId}/stream`);
      eventSource.onmessage = (event) => {
        if (!event.data) return;
        try {
          const payload = JSON.parse(event.data) as {
            type?: string;
            runDetail?: PipelineRunDetail;
          };
          if (payload.type !== "run_update" || !payload.runDetail) {
            return;
          }

          const nextDetail = payload.runDetail;
          applyRunDetail(selectedRunId, nextDetail);

          if (
            nextDetail.run.status === "success" ||
            nextDetail.run.status === "failed" ||
            nextDetail.run.status === "canceled" ||
            nextDetail.run.status === "timed_out"
          ) {
            eventSource?.close();
            eventSource = null;
          }
        } catch {
          // ignore malformed messages
        }
      };
      eventSource.onerror = () => {
        if (!active) return;
        eventSource?.close();
        eventSource = null;
        stopFallback();
        startFallback();
      };
    } catch {
      startFallback();
    }

    return () => {
      active = false;
      stopFallback();
      eventSource?.close();
    };
  }, [selectedRunId, runStreamNonce, loadRunDetail, applyRunDetail]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logText]);

  useEffect(() => {
    setRuntimeBoardScrollLeft(0);
  }, [selectedRunId]);

  useEffect(() => {
    if (!runtimeBoardDragging) return;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previousUserSelect;
    };
  }, [runtimeBoardDragging]);

  useLayoutEffect(() => {
    const viewportEl = runtimeBoardViewportRef.current;
    const contentEl = runtimeBoardContentRef.current;
    if (!viewportEl || !contentEl) {
      return;
    }

    const measure = () => {
      const nextContentWidth = contentEl.scrollWidth;
      const nextViewportWidth = viewportEl.clientWidth;
      setRuntimeBoardContentWidth((current) => (current === nextContentWidth ? current : nextContentWidth));
      setRuntimeBoardScrollLeft((current) => {
        const maxScrollLeft = Math.max(0, nextContentWidth - nextViewportWidth);
        return Math.min(current, maxScrollLeft);
      });
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });

    observer.observe(viewportEl);
    observer.observe(contentEl);

    return () => {
      observer.disconnect();
    };
  }, [selectedRunId, runDetail?.jobs.length, runDetail?.steps.length]);

  useEffect(() => {
    const railEl = runtimeBoardRailRef.current;
    if (!railEl) return;
    if (Math.abs(railEl.scrollLeft - runtimeBoardScrollLeft) < 1) return;
    railEl.scrollLeft = runtimeBoardScrollLeft;
  }, [runtimeBoardScrollLeft]);

  const handleRuntimeBoardWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const railEl = runtimeBoardRailRef.current;
    if (!railEl) return;
    const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (!horizontalDelta) return;
    event.preventDefault();
    const nextScrollLeft = Math.max(0, railEl.scrollLeft + horizontalDelta);
    railEl.scrollLeft = nextScrollLeft;
    setRuntimeBoardScrollLeft(nextScrollLeft);
  }, []);

  const updateRuntimeBoardScroll = useCallback((nextScrollLeft: number) => {
    const viewportEl = runtimeBoardViewportRef.current;
    const maxScrollLeft = Math.max(0, runtimeBoardContentWidth - (viewportEl?.clientWidth ?? 0));
    const clamped = Math.min(Math.max(0, nextScrollLeft), maxScrollLeft);
    setRuntimeBoardScrollLeft(clamped);
  }, [runtimeBoardContentWidth]);

  const handleRuntimeBoardPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("[data-runtime-node='true']")) {
      return;
    }
    const viewportEl = runtimeBoardViewportRef.current;
    if (!viewportEl) return;
    runtimeBoardDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: runtimeBoardScrollLeft,
      dragging: false,
    };
    runtimeBoardSuppressClickRef.current = false;
    viewportEl.setPointerCapture(event.pointerId);
  }, [runtimeBoardScrollLeft]);

  const handleRuntimeBoardPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = runtimeBoardDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.dragging) {
      if (Math.abs(deltaX) < runtimeBoardDragThreshold && Math.abs(deltaY) < runtimeBoardDragThreshold) {
        return;
      }
      if (Math.abs(deltaX) < Math.abs(deltaY)) {
        return;
      }
      dragState.dragging = true;
      setRuntimeBoardDragging(true);
    }

    event.preventDefault();
    updateRuntimeBoardScroll(dragState.startScrollLeft - deltaX);
  }, [updateRuntimeBoardScroll]);

  const finishRuntimeBoardDrag = useCallback((pointerId: number) => {
    const dragState = runtimeBoardDragRef.current;
    if (!dragState || dragState.pointerId !== pointerId) return;
    runtimeBoardSuppressClickRef.current = dragState.dragging;
    runtimeBoardDragRef.current = null;
    setRuntimeBoardDragging(false);
  }, []);

  const handleRuntimeBoardPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewportEl = runtimeBoardViewportRef.current;
    if (viewportEl?.hasPointerCapture(event.pointerId)) {
      viewportEl.releasePointerCapture(event.pointerId);
    }
    finishRuntimeBoardDrag(event.pointerId);
  }, [finishRuntimeBoardDrag]);

  const handleRuntimeBoardPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewportEl = runtimeBoardViewportRef.current;
    if (viewportEl?.hasPointerCapture(event.pointerId)) {
      viewportEl.releasePointerCapture(event.pointerId);
    }
    finishRuntimeBoardDrag(event.pointerId);
  }, [finishRuntimeBoardDrag]);

  const openRuntimeNode = useCallback((jobKey: string) => {
    if (runtimeBoardSuppressClickRef.current) {
      runtimeBoardSuppressClickRef.current = false;
      return;
    }
    setSelectedRunJobKey(jobKey);
    setNodeDialogOpen(true);
    setSelectedStepId(null);
    setLogText("");
  }, []);

  const handleSelectRun = useCallback((runId: string) => {
    startTransition(() => {
      setSelectedRunId(runId);
      setRunDetail(null);
      setSelectedRunJobKey(null);
      setNodeDialogOpen(false);
      setSelectedStepId(null);
      setLogText("");
      setRunHistoryDialogOpen(false);
    });
  }, []);

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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "failed");
      toast.success(p.runQueued);
      if (typeof data?.id === "string") {
        setSelectedRunId(data.id);
      }
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "failed");
      toast.success(p.rollbackSuccess);
      if (typeof data?.id === "string") {
        setSelectedRunId(data.id);
      }
      await loadRuns();
    } catch {
      toast.error(p.rollbackFailed);
    } finally {
      setRollingBack(null);
    }
  }

  async function handleCancelRun(runId: string) {
    setCancelingRunId(runId);
    try {
      const res = await fetch(`/api/pipeline-runs/${runId}/cancel`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : p.cancelRunFailed);
      }
      toast.success(p.cancelRunSuccess);
      await Promise.all([loadRuns(), loadRunDetail(runId)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : p.cancelRunFailed);
    } finally {
      setCancelingRunId(null);
      setCancelRunDialogOpen(false);
    }
  }

  async function handleSave() {
    if (!config) return;
    if (
      (config.environment ?? "production") === "production" &&
      (pipeline?.concurrency_mode ?? "allow") === "allow"
    ) {
      toast.error(p.concurrencyMode.productionPolicyHelp);
      return;
    }
    setSaving(true);
    try {
      const normalizedConfig = normalizePipelineConfigForSave(config, project.default_branch);
      const diagnostics = analyzePipelineConfig(normalizedConfig, normalizedConfig.jobs);
      const firstError = diagnostics.find((item) => item.level === "error");
      if (firstError) {
        toast.error(firstError.message ?? p.jobs.invalidConfigError);
        return;
      }

      setConfig(normalizedConfig);
      setSelectedConfigJobId((current) =>
        current && normalizedConfig.jobs.some((job) => job.id === current)
          ? current
          : normalizedConfig.jobs[0]?.id ?? null
      );

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

  async function copyCurrentLog() {
    if (!logText) return;
    try {
      await navigator.clipboard.writeText(logText);
      toast.success(dict.common.copied);
    } catch {
      toast.error(dict.common.copyFailed);
    }
  }

  async function publishSelectedArtifacts() {
    if (!selectedRunId || selectedRunArtifacts.length === 0) return;
    setPublishingArtifacts(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: selectedRunId,
          artifactIds: selectedRunArtifacts.map((artifact) => artifact.id),
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
      if (selectedRunId) {
        await loadArtifacts(selectedRunId);
      }
      setPublishDialogOpen(false);
      setPublishChannels("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : p.publishFailed);
    } finally {
      setPublishingArtifacts(false);
    }
  }

  async function promoteSelectedRelease() {
    const latestRelease = selectedRunArtifactReleases[selectedRunArtifactReleases.length - 1];
    if (!latestRelease || !project.id || !promoteChannelName.trim()) return;
    setPromotingChannel(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/artifacts/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryId: latestRelease.repository_id,
          versionId: latestRelease.version_id,
          channelName: promoteChannelName.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? p.publishFailed);
      }
      toast.success(p.detail.publishChannelSuccess);
      setPromoteChannelName("");
      if (selectedRunId) {
        await loadArtifacts(selectedRunId);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : p.publishFailed);
    } finally {
      setPromotingChannel(false);
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
      setLogText("");
      setLogLoading(false);
      setLogError(null);
      const job = runJobsByKey.get(jobKey);
      if (job) {
        for (const step of runStepsByJobId.get(job.id) ?? []) {
          stepLogCacheRef.current.delete(step.id);
        }
      }
      await Promise.all([loadRuns(true), loadRunDetail(selectedRunId)]);
    } catch {
      toast.error(p.detail.manualTriggerFailed);
    } finally {
      setTriggeringJobKey(null);
    }
  }

  async function handleRetryJob(jobKey: string) {
    if (!selectedRunId) return;
    setRetryingJobKey(jobKey);
    try {
      const res = await fetch(
        `/api/pipeline-runs/${selectedRunId}/jobs/${encodeURIComponent(jobKey)}/retry`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : p.detail.retryFailed);
      }
      toast.success(p.detail.retrySuccess);
      setLogText("");
      setLogLoading(false);
      setLogError(null);
      const job = runJobsByKey.get(jobKey);
      if (job) {
        for (const step of runStepsByJobId.get(job.id) ?? []) {
          stepLogCacheRef.current.delete(step.id);
        }
      }
      await Promise.all([loadRuns(true), loadRunDetail(selectedRunId), loadArtifacts(selectedRunId)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : p.detail.retryFailed);
    } finally {
      setRetryingJobKey(null);
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
  const selectedRuntimeJobStatus = useMemo(
    () => deriveRuntimeJobStatus(selectedRuntimeJob?.status, selectedRuntimeSteps, runDetail?.run.status),
    [runDetail?.run.status, selectedRuntimeJob?.status, selectedRuntimeSteps]
  );
  const selectedRuntimeStep = useMemo(
    () => selectedRuntimeSteps.find((step) => step.id === selectedStepId) ?? null,
    [selectedRuntimeSteps, selectedStepId]
  );
  const selectedRuntimeStepIndex = useMemo(
    () => selectedRuntimeSteps.findIndex((step) => step.id === selectedStepId),
    [selectedRuntimeSteps, selectedStepId]
  );
  const activeRuntimeStep = useMemo(
    () =>
      selectedRuntimeSteps.find((step) => step.status === "running") ??
      selectedRuntimeSteps.find((step) => step.status === "waiting_manual") ??
      null,
    [selectedRuntimeSteps]
  );
  const terminalLogLines = useMemo(
    () => (logText ? logText.replace(/\r\n/g, "\n").split("\n") : []),
    [logText]
  );
  const terminalLogEntries = useMemo(
    () => terminalLogLines.map((line) => ({
      line,
      tone: getTerminalLineTone(line),
    })),
    [terminalLogLines]
  );

  useEffect(() => {
    if (!selectedRunId || !selectedStepId) {
      setLogText("");
      setLogLoading(false);
      setLogError(null);
      return;
    }

    const logPath = selectedRuntimeStep?.log_path?.trim() ?? "";
    if (!logPath) {
      setLogText("");
      setLogLoading(false);
      setLogError(null);
      return;
    }

    const existingCache = stepLogCacheRef.current.get(selectedStepId);
    const logCache =
      existingCache && existingCache.logPath === logPath
        ? existingCache
        : { logPath, text: "", nextOffset: 0, complete: false };
    if (!existingCache || existingCache.logPath !== logPath) {
      stepLogCacheRef.current.set(selectedStepId, logCache);
    }

    setLogText(logCache.text);
    setLogLoading(!logCache.complete);
    setLogError(null);

    if (logCache.complete) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    let accumulatedText = logCache.text;
    let nextOffset = logCache.nextOffset;

    const loadLogs = async () => {
      try {
        const res = await fetch(
          `/api/pipeline-runs/${selectedRunId}/logs/${selectedStepId}/stream?offset=${nextOffset}&limit=200000`,
          { signal: controller.signal }
        );
        if (!res.ok || !res.body) {
          throw new Error("load failed");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (active) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (!value || value.length === 0) {
            continue;
          }
          const text = decoder.decode(value, { stream: true });
          nextOffset += value.byteLength;
          if (text) {
            accumulatedText += text;
            stepLogCacheRef.current.set(selectedStepId, {
              logPath,
              text: accumulatedText,
              nextOffset,
              complete: false,
            });
            setLogText(accumulatedText);
          }
        }
        const tail = decoder.decode();
        if (tail && active) {
          accumulatedText += tail;
          stepLogCacheRef.current.set(selectedStepId, {
            logPath,
            text: accumulatedText,
            nextOffset,
            complete: false,
          });
          setLogText(accumulatedText);
        }
        if (active) {
          stepLogCacheRef.current.set(selectedStepId, {
            logPath,
            text: accumulatedText,
            nextOffset,
            complete: true,
          });
        }
      } catch {
        if (active) {
          stepLogCacheRef.current.set(selectedStepId, {
            logPath,
            text: accumulatedText,
            nextOffset,
            complete: false,
          });
          setLogError(p.log.loadFailed);
        }
      } finally {
        if (active) {
          setLogLoading(false);
        }
      }
    };

    void loadLogs();

    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedRunId, selectedStepId, selectedRuntimeStep?.log_path, p.log.loadFailed]);

  const runStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const job of runDetail?.jobs ?? []) {
      const steps = runStepsByJobId.get(job.id) ?? [];
      const displayStatus = deriveRuntimeJobStatus(job.status, steps, runDetail?.run.status);
      counts[displayStatus] = (counts[displayStatus] ?? 0) + 1;
    }
    return counts;
  }, [runDetail?.jobs, runDetail?.run.status, runStepsByJobId]);
  const runtimeStageCount = runtimeStages.length;
  const runtimeStageCardWidth = runtimeStageCount >= 5 ? 252 : 288;
  const runtimeConnectorWidth = runtimeStageCount >= 5 ? 48 : 72;
  const sourceBranch = useMemo(() => getSourceBranch(config?.jobs ?? []), [config?.jobs]);
  const runExecutionSummary = useMemo(
    () => buildPipelineRunExecutionSummary(runtimeJobs, runDetail),
    [runtimeJobs, runDetail]
  );
  const currentEnvironment = (pipeline?.environment ?? config?.environment ?? "production") as PipelineEnvironment;
  const currentRun =
    selectedRunId && runDetail?.run.id === selectedRunId
      ? runDetail.run
      : runs.find((r) => r.id === selectedRunId);
  const currentRunStatus = isPipelineRunStatus(currentRun?.status) ? currentRun.status : null;
  const currentRunIsTerminalFailure =
    currentRunStatus === "failed" || currentRunStatus === "canceled" || currentRunStatus === "timed_out";
  const currentRunLabel = currentRun
    ? p.detail.runId.replace(
        "{{num}}",
        String(runs.length - runs.findIndex((r) => r.id === selectedRunId))
      )
    : "";
  const runHistoryTitle = `${p.detail.runHistory} (${runs.length})`;
  const hasFailureSummary = Boolean(runExecutionSummary?.failure_summary || currentRunIsTerminalFailure);
  const orderedVersions = useMemo(
    () => [...versions].sort((a, b) => a.version - b.version),
    [versions]
  );
  const selectedVersion = useMemo(
    () =>
      orderedVersions.find((version) => version.id === selectedVersionId) ??
      orderedVersions[orderedVersions.length - 1] ??
      null,
    [orderedVersions, selectedVersionId]
  );
  const selectedVersionIndex = useMemo(
    () => orderedVersions.findIndex((version) => version.id === selectedVersion?.id),
    [orderedVersions, selectedVersion?.id]
  );
  const comparisonVersion = selectedVersionIndex > 0 ? orderedVersions[selectedVersionIndex - 1] ?? null : null;
  const selectedVersionConfig = useMemo(
    () =>
      selectedVersion
        ? normalizeLoadedPipelineConfig(selectedVersion.config, pipeline, project.default_branch)
        : null,
    [pipeline, project.default_branch, selectedVersion]
  );
  const comparisonVersionConfig = useMemo(
    () =>
      comparisonVersion
        ? normalizeLoadedPipelineConfig(comparisonVersion.config, pipeline, project.default_branch)
        : null,
    [comparisonVersion, pipeline, project.default_branch]
  );
  const versionChanges = useMemo(
    () =>
      selectedVersionConfig && comparisonVersionConfig
        ? diffPipelineConfigs(comparisonVersionConfig, selectedVersionConfig)
        : [],
    [comparisonVersionConfig, selectedVersionConfig]
  );
  const operationalGuidance = useMemo(() => {
    const stats = pipeline?.run_stats_7d;
    if (!stats) {
      return [] as string[];
    }
    const guidance: string[] = [];
    if (stats.active_runs > 0) {
      guidance.push(
        currentEnvironment === "development" ? p.detail.runStatsBacklogCancel : p.detail.runStatsBacklogQueue
      );
    }
    if ((stats.oldest_active_run_age_seconds ?? 0) >= 1800) {
      guidance.push(
        p.detail.runStatsBacklogStale.replace(
          "{{duration}}",
          formatDurationSeconds(stats.oldest_active_run_age_seconds ?? null)
        )
      );
    }
    if (stats.total_runs >= 3 && stats.success_rate < 80) {
      guidance.push(p.detail.runStatsLowSuccess);
    }
    if (stats.failed_runs >= 2) {
      guidance.push(p.detail.runStatsRepeatedFailures);
    }
    if (stats.failed_runs > 0 && (stats.median_first_failure_ms ?? 0) >= 10 * 60 * 1000) {
      guidance.push(
        p.detail.runStatsLateFailure.replace(
          "{{duration}}",
          formatDurationMs(stats.median_first_failure_ms ?? 0)
        )
      );
    }
    if ((stats.waiting_manual_dwell_p50_ms ?? 0) >= 15 * 60 * 1000) {
      guidance.push(
        p.detail.runStatsManualSlow.replace(
          "{{duration}}",
          formatDurationMs(stats.waiting_manual_dwell_p50_ms ?? 0)
        )
      );
    }
    if (guidance.length === 0) {
      guidance.push(p.detail.runStatsHealthy);
    }
    return guidance;
  }, [currentEnvironment, p.detail, pipeline?.run_stats_7d]);
  const runHealthMetrics = useMemo(() => {
    const stats = pipeline?.run_stats_7d;
    return [
      {
        key: "oldest-active",
        label: p.detail.runStatsOldestActive,
        value:
          (stats?.oldest_active_run_age_seconds ?? 0) > 0
            ? formatDurationSeconds(stats?.oldest_active_run_age_seconds ?? null)
            : p.detail.runStatsNoSignal,
      },
      {
        key: "first-failure",
        label: p.detail.runStatsMedianFirstFailure,
        value:
          (stats?.median_first_failure_ms ?? 0) > 0
            ? formatDurationMs(stats?.median_first_failure_ms ?? 0)
            : p.detail.runStatsNoSignal,
      },
      {
        key: "manual-dwell",
        label: p.detail.runStatsManualDwell,
        value:
          (stats?.waiting_manual_dwell_p50_ms ?? 0) > 0
            ? formatDurationMs(stats?.waiting_manual_dwell_p50_ms ?? 0)
            : p.detail.runStatsNoSignal,
      },
    ];
  }, [p.detail.runStatsManualDwell, p.detail.runStatsMedianFirstFailure, p.detail.runStatsNoSignal, p.detail.runStatsOldestActive, pipeline?.run_stats_7d]);
  const recommendedAction = useMemo(() => {
    if (currentRunStatus === "waiting_manual") {
      return p.detail.recommendedActionManual;
    }
    if (currentRunStatus === "failed" || currentRunStatus === "canceled" || currentRunStatus === "timed_out") {
      return versionChanges.length > 0 ? p.detail.recommendedActionNewRun : p.detail.recommendedActionRetry;
    }
    return p.detail.recommendedActionObserve;
  }, [currentRunStatus, p.detail, versionChanges.length]);

  useEffect(() => {
    const previousSelectedRunId = previousSelectedRunIdRef.current;
    const previousRunStatus = previousRunStatusRef.current;
    previousSelectedRunIdRef.current = selectedRunId;
    previousRunStatusRef.current = currentRunStatus;

    if (!selectedRunId || previousSelectedRunId !== selectedRunId) {
      return;
    }
    if (!previousRunStatus || !currentRunStatus) {
      return;
    }
    if (isTerminalPipelineRunStatus(previousRunStatus) && !isTerminalPipelineRunStatus(currentRunStatus)) {
      setRunStreamNonce((current) => current + 1);
    }
  }, [currentRunStatus, selectedRunId]);

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
    if (!selectedStepId || !activeRuntimeStep || !selectedRuntimeStep) return;
    if (activeRuntimeStep.id === selectedStepId) return;

    const selectedIsTerminal =
      selectedRuntimeStep.status === "success" ||
      selectedRuntimeStep.status === "failed" ||
      selectedRuntimeStep.status === "canceled" ||
      selectedRuntimeStep.status === "timed_out" ||
      selectedRuntimeStep.status === "skipped";
    if (!selectedIsTerminal) return;

    const activeIndex = selectedRuntimeSteps.findIndex((step) => step.id === activeRuntimeStep.id);
    if (activeIndex === -1) return;
    if (selectedRuntimeStepIndex !== -1 && activeIndex <= selectedRuntimeStepIndex) return;

    setSelectedStepId(activeRuntimeStep.id);
  }, [
    activeRuntimeStep,
    selectedRuntimeStep,
    selectedRuntimeStepIndex,
    selectedRuntimeSteps,
    selectedStepId,
  ]);

  const canRetrySelectedJob =
    isAdmin &&
    !!selectedRuntimeJob &&
    !!currentRun &&
    (currentRun.status === "failed" || currentRun.status === "canceled" || currentRun.status === "timed_out") &&
    (selectedRuntimeJobStatus === "failed" ||
      selectedRuntimeJobStatus === "canceled" ||
      selectedRuntimeJobStatus === "timed_out");

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
  const selectedRunArtifacts = artifacts;
  const selectedRunArtifactReleases = artifactReleases;

  useEffect(() => {
    setPublishRepositoryName(project.name);
    setPublishRepositorySlug(normalizeArtifactRepositorySlug(project.name));
  }, [project.name]);

  useEffect(() => {
    if (!publishDialogOpen) return;
    const repositoryName = pipeline?.name?.trim() || project.name;
    setPublishRepositoryName(repositoryName);
    setPublishRepositorySlug(normalizeArtifactRepositorySlug(repositoryName));
    const versionSeed = currentRun?.commit_sha?.slice(0, 12) || selectedRunId?.slice(0, 8) || "";
    setPublishVersion(versionSeed ? `build-${versionSeed}` : "");
    setPublishChannels("");
  }, [currentRun?.commit_sha, pipeline?.name, project.name, publishDialogOpen, selectedRunId]);

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
                  variant={getEnvironmentBadgeVariant(pipeline.environment)}
                  size="sm"
                >
                  {getPipelineEnvironmentLabel(pipeline.environment, environmentOptions)}
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
              <Badge variant={getEnvironmentBadgeVariant(currentEnvironment)} size="sm">
                {getPipelineEnvironmentLabel(currentEnvironment, environmentOptions)}
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
            {tab === "runs" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRunHistoryDialogOpen(true)}
                className="lg:hidden"
              >
                <PanelLeftOpen className="size-3.5 mr-1" />
                {p.detail.runHistory}
              </Button>
            )}
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
            <div className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-hidden lg:border-r border-[hsl(var(--ds-border-1))]">
              <div className="px-4 py-2.5 border-b border-[hsl(var(--ds-border-1))] flex items-center justify-between">
                <span className="text-[13px] font-medium text-foreground">
                  {runHistoryTitle}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void loadRuns();
                  }}
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
                    onClick={() => handleSelectRun(run.id)}
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
                      <span className="ml-1">· {p.detail.triggeredBy}: {getRunActorLabel(run, p)}</span>
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
                  <div className="px-4 py-4 sm:px-6 border-b border-[hsl(var(--ds-border-1))] shrink-0">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
                            <div className="flex items-center gap-1">
                              <User className="size-3" />
                              <span>{p.detail.triggeredBy}: {getRunActorLabel(currentRun, p)}</span>
                            </div>
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
                      <div className="flex w-full flex-col gap-3 lg:w-auto lg:items-end">
                      {currentRun && currentRun.status === "success" && (
                        <div className="flex flex-col gap-3 lg:items-end">
                          <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-[12px] font-medium text-foreground">
                                  {p.detail.releaseStatusTitle}
                                </div>
                                <div className="mt-0.5 text-[11px] text-[hsl(var(--ds-text-2))]">
                                  {selectedRunArtifactReleases.length > 0
                                    ? p.detail.releaseStatusPublished
                                    : p.detail.releaseStatusPending}
                                </div>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setPublishDialogOpen(true)}
                                disabled={selectedRunArtifacts.length === 0}
                              >
                                {selectedRunArtifactReleases.length > 0
                                  ? p.detail.releaseStatusManage
                                  : p.publishArtifacts}
                              </Button>
                            </div>
                            {selectedRunArtifactReleases.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {selectedRunArtifactReleases.map((release) => (
                                  <div
                                    key={release.version_id}
                                    className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="truncate text-[11px] font-medium text-foreground">
                                          {release.repository_name}
                                        </div>
                                        <div className="mt-0.5 text-[10px] text-[hsl(var(--ds-text-2))]">
                                          {release.version}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-1 justify-end">
                                        {release.channel_names.length > 0 ? (
                                          release.channel_names.map((channel) => (
                                            <Badge key={`${release.version_id}-${channel}`} variant="muted" size="sm">
                                              {channel}
                                            </Badge>
                                          ))
                                        ) : (
                                          <Badge variant="outline" size="sm">
                                            {p.detail.releaseStatusUnchanneled}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                    <div className="mt-2 grid gap-1 text-[10px] text-[hsl(var(--ds-text-2))] md:grid-cols-2">
                                      <div className="truncate">
                                        {p.versionsTab.savedBy}:{" "}
                                        <span className="text-foreground">
                                          {release.published_by_name ?? release.published_by_email ?? release.published_by?.slice(0, 8) ?? p.versionsTab.unknownAuthor}
                                        </span>
                                      </div>
                                      <div className="truncate md:text-right">
                                        {p.versionsTab.savedAt}:{" "}
                                        <span className="text-foreground">{formatLocalDateTime(release.published_at)}</span>
                                      </div>
                                      <div className="truncate">
                                        {p.detail.branch}:{" "}
                                        <span className="text-foreground">{release.source_branch ?? a.unknownBranch}</span>
                                      </div>
                                      <div className="truncate md:text-right">
                                        {p.detail.commit}:{" "}
                                        <span className="text-foreground">
                                          {release.source_commit_sha ? release.source_commit_sha.slice(0, 12) : a.unknownCommit}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-2 text-[11px] text-[hsl(var(--ds-text-2))]">
                                {p.detail.releaseStatusPendingHelp}
                              </div>
                            )}
                            {selectedRunArtifactReleases.length > 0 && (
                              <div className="mt-3 flex items-center gap-2">
                                <Input
                                  value={promoteChannelName}
                                  onChange={(event) => setPromoteChannelName(event.target.value)}
                                  placeholder={p.publishChannelsPlaceholder}
                                  className="h-8 w-40"
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void promoteSelectedRelease()}
                                  disabled={promotingChannel || !promoteChannelName.trim()}
                                >
                                  {promotingChannel ? dict.common.loading : p.detail.publishChannelAction}
                                </Button>
                              </div>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRollback(selectedRunId)}
                            disabled={rollingBack === selectedRunId}
                          >
                            <RotateCcw className="size-3.5 mr-1" />
                            {p.rollback}
                          </Button>
                        </div>
                      )}
                      {currentRun && currentRun.status === "failed" && (
                        <div className="flex flex-col gap-1 lg:items-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleRun()}
                            disabled={running}
                          >
                            <Play className="size-3.5 mr-1" />
                            {running ? dict.common.loading : p.runPipeline}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRollback(selectedRunId)}
                            disabled={rollingBack === selectedRunId}
                          >
                            <RotateCcw className="size-3.5 mr-1" />
                            {p.rollback}
                          </Button>
                          <TooltipProvider delayDuration={120}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={p.detail.retryVersionTooltip}
                                  className="inline-flex size-6 items-center justify-center rounded-[6px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] text-[hsl(var(--ds-text-2))] transition-colors hover:border-[hsl(var(--ds-border-2))] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-accent-7)/0.24)]"
                                >
                                  <Info className="size-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" align="end" className="max-w-[280px] text-left">
                                {p.detail.retryVersionTooltip}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      )}
                      {currentRun &&
                        (currentRun.status === "queued" ||
                          currentRun.status === "running" ||
                          currentRun.status === "waiting_manual") && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setCancelRunDialogOpen(true)}
                            disabled={cancelingRunId === selectedRunId}
                          >
                            <XCircle className="size-3.5 mr-1" />
                            {cancelingRunId === selectedRunId ? dict.common.loading : p.cancelRun}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="px-4 pt-3 sm:px-6 lg:hidden">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
                        <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.detail.runHistory}</div>
                        <div className="mt-1 text-sm font-medium text-foreground">
                          {p.detail.runHistoryCount.replace("{{count}}", String(runs.length))}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-1.5 h-7 px-0 text-[12px]"
                          onClick={() => setRunHistoryDialogOpen(true)}
                        >
                          <History className="mr-1 size-3.5" />
                          {p.detail.runHistory}
                        </Button>
                      </div>
                      {currentRun && (
                        <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
                          <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.detail.runId.replace("{{num}}", "")}</div>
                          <div className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
                            {STATUS_ICON[currentRun.status as PipelineRunStatus]}
                            <span>{currentRunLabel}</span>
                          </div>
                          <div className="mt-1.5 text-[12px] text-[hsl(var(--ds-text-2))]">
                            {formatLocalDateTime(currentRun.created_at)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-4 pt-3 pb-4 sm:px-6 lg:pb-5">
                    <div className="mb-3 grid gap-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                      <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
                        <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.detail.recommendedActionTitle}</div>
                        <div className="mt-1 text-[13px] text-foreground">{recommendedAction}</div>
                      </div>
                      <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
                        <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.detail.runStatsTitle}</div>
                        <div className="mt-1 space-y-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                          {operationalGuidance.map((item) => (
                            <div key={item}>• {item}</div>
                          ))}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {runHealthMetrics.map((metric) => (
                            <div
                              key={metric.key}
                              className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2"
                            >
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{metric.label}</div>
                              <div className="mt-1 text-[13px] font-medium text-foreground">{metric.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {runExecutionSummary ? (
                      <div className="space-y-2.5">
                        {hasFailureSummary ? (
                          <div className="rounded-[12px] border border-danger/25 bg-danger/[0.04] px-3 py-2.5">
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <Badge variant="danger" size="sm">
                                    {p.status[(currentRunStatus ?? "failed") as PipelineRunStatus]}
                                  </Badge>
                                  <span className="text-[13px] font-medium text-foreground">
                                    {runExecutionSummary.failure_summary?.job_name ?? p.detail.failureSummaryTitle}
                                  </span>
                                </div>
                                <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                                  {runExecutionSummary.failure_summary?.step_name
                                    ? p.detail.failureStep.replace("{{name}}", runExecutionSummary.failure_summary.step_name)
                                    : p.detail.failureNoStep}
                                </div>
                                {(runExecutionSummary.failure_summary?.message ?? runDetail?.run.error_message) && (
                                  <div className="text-[12px] text-danger break-words">
                                    {runExecutionSummary.failure_summary?.message ?? runDetail?.run.error_message}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-2 text-[11px] text-[hsl(var(--ds-text-2))]">
                                <span>{p.detail.totalDuration}</span>
                                <span className="font-medium text-foreground">
                                  {formatDurationMs(runExecutionSummary.total_duration_ms)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-[12px] border border-success/20 bg-success/[0.04] px-3 py-2.5">
                            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex items-center gap-2">
                                <Badge variant="success" size="sm">{p.detail.successSummary}</Badge>
                                <span className="text-[13px] text-foreground">{p.detail.failureNone}</span>
                              </div>
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">
                                {p.detail.totalDuration} <span className="font-medium text-foreground">{formatDurationMs(runExecutionSummary.total_duration_ms)}</span>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                            <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.detail.totalDuration}</div>
                            <div className="mt-1 text-[13px] font-medium text-foreground">
                              {formatDurationMs(runExecutionSummary.total_duration_ms)}
                            </div>
                          </div>
                          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                            <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.detail.criticalPathDuration}</div>
                            <div className="mt-1 text-[13px] font-medium text-foreground">
                              {formatDurationMs(runExecutionSummary.critical_path_duration_ms)}
                            </div>
                          </div>
                          {!!runStatusCounts.success && (
                            <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.status.success}</div>
                              <div className="mt-1 text-[13px] font-medium text-foreground">{runStatusCounts.success}</div>
                            </div>
                          )}
                          {!!runStatusCounts.failed && (
                            <div className="rounded-[10px] border border-danger/20 bg-danger/[0.03] px-3 py-2">
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.status.failed}</div>
                              <div className="mt-1 text-[13px] font-medium text-danger">{runStatusCounts.failed}</div>
                            </div>
                          )}
                          {!!runStatusCounts.running && (
                            <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.status.running}</div>
                              <div className="mt-1 text-[13px] font-medium text-foreground">{runStatusCounts.running}</div>
                            </div>
                          )}
                          {!!runStatusCounts.waiting_manual && (
                            <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.status.waiting_manual}</div>
                              <div className="mt-1 text-[13px] font-medium text-foreground">{runStatusCounts.waiting_manual}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2.5">
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-2">
                                <Skeleton className="h-4 w-40 bg-[hsl(var(--ds-border-1))]" />
                                <Skeleton className="h-3 w-32 bg-[hsl(var(--ds-border-1))]" />
                              </div>
                              <Skeleton className="h-6 w-20 rounded-full bg-[hsl(var(--ds-border-1))]" />
                            </div>
                            <Skeleton className="h-3 w-28 bg-[hsl(var(--ds-border-1))]" />
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                            <div className="space-y-2">
                              <Skeleton className="h-3 w-16 bg-[hsl(var(--ds-border-1))]" />
                              <Skeleton className="h-6 w-12 bg-[hsl(var(--ds-border-1))]" />
                            </div>
                          </div>
                          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                            <div className="space-y-2">
                              <Skeleton className="h-3 w-20 bg-[hsl(var(--ds-border-1))]" />
                              <Skeleton className="h-6 w-12 bg-[hsl(var(--ds-border-1))]" />
                            </div>
                          </div>
                          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                            <div className="space-y-2">
                              <Skeleton className="h-3 w-14 bg-[hsl(var(--ds-border-1))]" />
                              <Skeleton className="h-6 w-10 bg-[hsl(var(--ds-border-1))]" />
                            </div>
                          </div>
                          <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                            <div className="space-y-2">
                              <Skeleton className="h-3 w-14 bg-[hsl(var(--ds-border-1))]" />
                              <Skeleton className="h-6 w-10 bg-[hsl(var(--ds-border-1))]" />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="px-4 pb-3 sm:px-6 lg:pb-4">
                    <div className="flex items-center justify-between gap-3 pt-3 lg:pt-4">
                      <div>
                        <div className="text-[12px] font-semibold uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                          {p.detail.stagesLabel}
                        </div>
                        <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                          {p.detail.stagesDescription}
                        </div>
                      </div>
                      <Badge variant="muted" size="sm">{runtimeStages.length}</Badge>
                    </div>
                  </div>


                  <Dialog open={runHistoryDialogOpen} onOpenChange={setRunHistoryDialogOpen}>
                    <DialogContent className="max-w-lg p-0 sm:max-w-xl lg:hidden">
                      <DialogHeader className="border-b border-[hsl(var(--ds-border-1))] px-4 py-4 text-left">
                        <DialogTitle>{runHistoryTitle}</DialogTitle>
                        <DialogDescription>{p.detail.runHistory}</DialogDescription>
                      </DialogHeader>
                      <div className="max-h-[70vh] overflow-y-auto">
                        {runs.length === 0 && (
                          <div className="px-4 py-8 text-center text-[12px] text-[hsl(var(--ds-text-2))]">
                            {p.detail.noRuns}
                          </div>
                        )}
                        {runs.map((run, idx) => (
                          <button
                            key={run.id}
                            onClick={() => handleSelectRun(run.id)}
                            className={`w-full border-b border-[hsl(var(--ds-border-1))] px-4 py-3 text-left transition-colors ${
                              selectedRunId === run.id
                                ? "bg-[hsl(var(--ds-surface-1))]"
                                : "hover:bg-[hsl(var(--ds-surface-1))]"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                {STATUS_ICON_SM[run.status as PipelineRunStatus]}
                                <span className="text-[13px] font-medium">#{runs.length - idx}</span>
                              </div>
                              <Badge variant={STATUS_VARIANTS[run.status as PipelineRunStatus]} size="sm">
                                {p.status[run.status as PipelineRunStatus]}
                              </Badge>
                            </div>
                            <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                              {p.detail.trigger[run.trigger_type as keyof typeof p.detail.trigger] ?? run.trigger_type}
                              <span className="ml-1">· {p.detail.triggeredBy}: {getRunActorLabel(run, p)}</span>
                              {run.branch && <span className="ml-1">· {run.branch}</span>}
                            </div>
                            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                              {formatLocalDateTime(run.created_at)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </DialogContent>
                  </Dialog>

                  {runDetail && (
                    <div className="px-4 pb-4 sm:px-6 lg:hidden">
                      <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-background p-3">
                        <div className="space-y-3">
                          {runtimeStages.map((stage, stageIndex) => (
                            <div key={stage.key} className="space-y-3">
                              <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]/40 p-3">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">{stageLabel(stage.key)}</div>
                                    <div className="mt-0.5 text-[12px] text-[hsl(var(--ds-text-2))]">
                                      {p.detail.nodesCount.replace("{{count}}", String(stage.jobs.length))}
                                    </div>
                                  </div>
                                  <ModeBadgeGroup
                                    entryMode={getStageConfig(runtimeStageSettings, stage.key).entryMode ?? "auto"}
                                    dispatchMode={getStageConfig(runtimeStageSettings, stage.key).dispatchMode ?? "parallel"}
                                  />
                                </div>
                                <div className="h-px bg-[hsl(var(--ds-border-1))] mb-3" />
                                <div className="space-y-2">
                                  {stage.jobs.map((job) => {
                                    const runtimeJob = runJobsByKey.get(job.id);
                                    const runtimeSteps = runtimeJob ? runStepsByJobId.get(runtimeJob.id) ?? [] : [];
                                    const runtimeStatus = deriveRuntimeJobStatus(
                                      runtimeJob?.status,
                                      runtimeSteps,
                                      currentRun?.status
                                    );
                                    const selected = selectedRunJobKey === job.id;
                                    return (
                                      <button
                                        key={job.id}
                                        type="button"
                                        onClick={() => openRuntimeNode(job.id)}
                                        className={`w-full rounded-[10px] border p-3 text-left transition-all ${
                                          selected ? selectedStatusTone(runtimeStatus) : statusTone(runtimeStatus)
                                        }`}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                              {STATUS_ICON_SM[runtimeStatus]}
                                              <span className="truncate text-sm font-medium text-foreground">{job.name}</span>
                                            </div>
                                            <div className="mt-1 truncate text-[12px] text-[hsl(var(--ds-text-2))]">{job.id}</div>
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
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              {stageIndex < runtimeStages.length - 1 && (
                                <div className="flex items-center justify-center text-[hsl(var(--ds-border-2)/0.82)]">
                                  <ArrowDown className="size-4" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="hidden lg:flex flex-1 min-h-0 overflow-hidden">
                    <div className="flex h-full min-h-0 flex-col w-full">
                      <div
                        ref={runtimeBoardViewportRef}
                        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden touch-pan-y select-none ${
                          runtimeBoardDragging ? "cursor-grabbing" : "cursor-grab"
                        }`}
                        style={{ userSelect: "none" }}
                        onClick={(event) => {
                          if (event.target !== event.currentTarget) return;
                          setSelectedRunJobKey(null);
                          setSelectedStepId(null);
                        }}
                        onPointerDown={handleRuntimeBoardPointerDown}
                        onPointerMove={handleRuntimeBoardPointerMove}
                        onPointerUp={handleRuntimeBoardPointerUp}
                        onPointerCancel={handleRuntimeBoardPointerCancel}
                        onWheel={handleRuntimeBoardWheel}
                      >
                        {!runDetail && (
                          <div className="flex gap-4 px-5 py-4">
                            {Array.from({ length: Math.max(runtimeStageCount || 3, 3) }).map((_, index) => (
                              <div
                                key={`runtime-loading-${index}`}
                                className="flex shrink-0 flex-col rounded-[14px] border border-[hsl(var(--ds-border-1))] bg-background"
                                style={{ width: runtimeStageCardWidth }}
                              >
                                <div className="border-b border-[hsl(var(--ds-border-1))] px-4 py-2.5">
                                  <div className="space-y-1.5">
                                    <Skeleton className="h-4 w-28 bg-[hsl(var(--ds-border-1))]" />
                                    <Skeleton className="h-3 w-14 bg-[hsl(var(--ds-border-1))]" />
                                  </div>
                                </div>
                                <div className="flex flex-1 flex-col gap-3 p-3">
                                  <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] p-3">
                                    <div className="space-y-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1 space-y-2">
                                          <Skeleton className="h-4 w-24 bg-[hsl(var(--ds-border-1))]" />
                                          <Skeleton className="h-3 w-16 bg-[hsl(var(--ds-border-1))]" />
                                        </div>
                                        <Skeleton className="h-6 w-20 rounded-full bg-[hsl(var(--ds-border-1))]" />
                                      </div>
                                      <div className="flex items-center justify-between gap-3">
                                        <Skeleton className="h-3 w-14 bg-[hsl(var(--ds-border-1))]" />
                                        <Skeleton className="h-3 w-10 bg-[hsl(var(--ds-border-1))]" />
                                      </div>
                                    </div>
                                  </div>
                                  <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] p-3">
                                    <div className="space-y-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1 space-y-2">
                                          <Skeleton className="h-4 w-20 bg-[hsl(var(--ds-border-1))]" />
                                          <Skeleton className="h-3 w-12 bg-[hsl(var(--ds-border-1))]" />
                                        </div>
                                        <Skeleton className="h-6 w-16 rounded-full bg-[hsl(var(--ds-border-1))]" />
                                      </div>
                                      <div className="flex items-center justify-between gap-3">
                                        <Skeleton className="h-3 w-14 bg-[hsl(var(--ds-border-1))]" />
                                        <Skeleton className="h-3 w-10 bg-[hsl(var(--ds-border-1))]" />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {runDetail && (
                          <div
                            ref={runtimeBoardContentRef}
                            className="flex min-w-max snap-x snap-mandatory gap-4 px-5 py-4 will-change-transform select-none"
                            style={{
                              transform: runtimeBoardScrollLeft > 0 ? `translate3d(-${runtimeBoardScrollLeft}px, 0, 0)` : undefined,
                            }}
                          >
                            {runtimeStages.map((stage, stageIndex) => (
                              <div key={stage.key} className="contents">
                                <div
                                  className="flex shrink-0 snap-start flex-col rounded-[14px] border border-[hsl(var(--ds-border-1))] bg-background"
                                  style={{ width: runtimeStageCardWidth }}
                                >
                                  <div className="border-b border-[hsl(var(--ds-border-1))] px-4 py-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <div className="text-sm font-semibold leading-none text-foreground">
                                          {stageLabel(stage.key)}
                                        </div>
                                        <div className="mt-0.5 text-[11px] text-[hsl(var(--ds-text-2))]">
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
                                      const runtimeSteps = runtimeJob ? runStepsByJobId.get(runtimeJob.id) ?? [] : [];
                                      const runtimeStatus = deriveRuntimeJobStatus(
                                        runtimeJob?.status,
                                        runtimeSteps,
                                        currentRun?.status
                                      );
                                      const selected = selectedRunJobKey === job.id;
                                      return (
                                        <div key={job.id} className="space-y-3">
                                          <div
                                            role="button"
                                            tabIndex={0}
                                            data-runtime-node="true"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              openRuntimeNode(job.id);
                                            }}
                                            onKeyDown={(event) => {
                                              if (event.key !== "Enter" && event.key !== " ") return;
                                              event.preventDefault();
                                              event.stopPropagation();
                                              openRuntimeNode(job.id);
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
                                            {(currentRun?.status === "failed" ||
                                              currentRun?.status === "canceled" ||
                                              currentRun?.status === "timed_out") &&
                                              isAdmin &&
                                              (runtimeStatus === "failed" ||
                                                runtimeStatus === "canceled" ||
                                                runtimeStatus === "timed_out") && (
                                                <div className="mt-3">
                                                  <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full"
                                                    onClick={(event) => {
                                                      event.stopPropagation();
                                                      setRetryDialogTarget({
                                                        jobKey: job.id,
                                                        jobName: job.name,
                                                        stepCount: (runStepsByJobId.get(job.id) ?? []).length,
                                                      });
                                                    }}
                                                    disabled={retryingJobKey === job.id}
                                                  >
                                                    <RotateCcw className="mr-1 size-3.5" />
                                                    {retryingJobKey === job.id ? dict.common.loading : p.retry}
                                                  </Button>
                                                </div>
                                              )}
                                        </div>
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

                      <div className="shrink-0 bg-[hsl(var(--ds-surface-1))]/20 px-5 py-2.5">
                        <div
                          ref={runtimeBoardRailRef}
                          className="overflow-x-auto overflow-y-hidden pb-1 opacity-75 hover:opacity-100 transition-opacity"
                          onScroll={(event) => {
                            const nextScrollLeft = event.currentTarget.scrollLeft;
                            setRuntimeBoardScrollLeft(nextScrollLeft);
                          }}
                        >
                          <div
                            aria-hidden="true"
                            className="h-px"
                            style={{ width: runtimeBoardContentWidth > 0 ? runtimeBoardContentWidth : "100%" }}
                          />
                        </div>
                      </div>
                    </div>


                    <Dialog
                      open={nodeDialogOpen && selectedRunJobKey !== null}
                      onOpenChange={(open) => {
                        setNodeDialogOpen(open);
                        if (!open) {
                          setSelectedStepId(null);
                          setLogText("");
                        }
                      }}
                    >
                      <DialogContent className="max-w-6xl h-[min(88vh,880px)]">
                        <DialogHeader>
                          <DialogTitle>{selectedRuntimeJobConfig?.name ?? p.detail.nodeDialogTitle}</DialogTitle>
                          <DialogDescription>
                            {selectedRuntimeJobConfig && selectedRuntimeJob
                              ? `${stageLabel(selectedRuntimeJobConfig.stage ?? "build")} · ${selectedRuntimeJob.job_key}`
                              : p.detail.nodeDialogDescription}
                          </DialogDescription>
                        </DialogHeader>
                        <DialogBody className="flex min-h-0 flex-1 w-full overflow-hidden p-0">
                          {selectedRuntimeJobConfig && selectedRuntimeJob ? (
                            <div className="grid flex-1 h-full w-full min-h-0 min-w-0 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                              <div className="flex min-h-0 flex-col border-b border-[hsl(var(--ds-border-1))] lg:border-b-0 lg:border-r">
                                <div className="border-b border-[hsl(var(--ds-border-1))] px-5 py-4">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        {STATUS_ICON[selectedRuntimeJobStatus as PipelineRunStatus]}
                                        <span className="truncate text-sm font-semibold text-foreground">
                                          {selectedRuntimeJobConfig.name}
                                        </span>
                                      </div>
                                      <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                                        {currentRunLabel} · {selectedRuntimeJob.job_key}
                                      </div>
                                    </div>
                                    <Badge variant={STATUS_VARIANTS[selectedRuntimeJobStatus as PipelineRunStatus]} size="sm">
                                      {p.status[selectedRuntimeJobStatus as PipelineRunStatus]}
                                    </Badge>
                                  </div>
                                </div>

                                <div className="flex-1 min-h-0 overflow-auto px-5 py-4">
                                  <div className="space-y-4">
                                    <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]/30 p-3">
                                      <div className="text-[12px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                                        {p.detail.stepsTitle}
                                      </div>
                                      <div className="mt-3 space-y-2">
                                        {selectedRuntimeSteps.map((step) => (
                                          <button
                                            type="button"
                                            key={step.id}
                                            onClick={() =>
                                              startTransition(() => {
                                                setSelectedStepId(step.id);
                                              })
                                            }
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
                                            <span className="text-[12px] text-[hsl(var(--ds-text-2))]">
                                              {getStepOutcomeLabel(step, p.detail)}
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    {currentRun && (
                                      <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-background p-3">
                                        <div className="text-[12px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                                          {p.detail.currentRun}
                                        </div>
                                        <div className="mt-3 space-y-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                                          {currentRun.branch && <div>{p.detail.branch}: {currentRun.branch}</div>}
                                          {currentRun.commit_sha && <div>{p.detail.commit}: {currentRun.commit_sha.slice(0, 7)}</div>}
                                          {currentRun.started_at && (
                                            <div>{p.detail.duration}: {durationLabel(currentRun.started_at, currentRun.finished_at ?? undefined)}</div>
                                          )}
                                        </div>
                                        {selectedRuntimeJobStatus === "waiting_manual" && isAdmin && (
                                          <div className="mt-3">
                                            <Button
                                              type="button"
                                              size="sm"
                                              className="w-full"
                                              onClick={() => void handleTriggerJob(selectedRuntimeJob.job_key)}
                                              disabled={triggeringJobKey === selectedRuntimeJob.job_key}
                                            >
                                              <Play className="mr-1 size-3.5" />
                                              {triggeringJobKey === selectedRuntimeJob.job_key
                                                ? dict.common.loading
                                                : p.detail.manualTrigger}
                                            </Button>
                                          </div>
                                        )}
                                        {canRetrySelectedJob && (
                                          <div className="mt-3">
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="w-full"
                                              onClick={() =>
                                                setRetryDialogTarget({
                                                  jobKey: selectedRuntimeJob.job_key,
                                                  jobName: selectedRuntimeJobConfig?.name ?? selectedRuntimeJob.name,
                                                  stepCount: selectedRuntimeSteps.length,
                                                })
                                              }
                                              disabled={retryingJobKey === selectedRuntimeJob.job_key}
                                            >
                                              <RotateCcw className="mr-1 size-3.5" />
                                              {retryingJobKey === selectedRuntimeJob.job_key ? dict.common.loading : p.retry}
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden">
                                <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-4 px-5 py-4">
                                  <div className="flex min-h-0 w-full flex-1 self-stretch flex-col overflow-hidden rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--terminal-background))] shadow-[0_0_0_1px_hsl(var(--ds-border-1))]">
                                    <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--ds-border-1))] px-4 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex size-2 rounded-full bg-success/80" />
                                        <span className="text-[12px] uppercase tracking-wide text-terminal-muted">
                                          {selectedRuntimeStep ? selectedRuntimeStep.name : p.log.title}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <div className="text-[11px] uppercase tracking-wide text-terminal-muted">
                                          {selectedStepId ? `${terminalLogLines.length || 0} lines` : p.log.selectStep}
                                        </div>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 gap-1.5 px-2 text-[11px] uppercase tracking-wide text-terminal-muted hover:bg-white/5 hover:text-terminal"
                                          onClick={() => void copyCurrentLog()}
                                          disabled={!selectedStepId || !logText}
                                        >
                                          <Copy className="size-3.5" />
                                          {dict.common.copy}
                                        </Button>
                                      </div>
                                    </div>

                                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                                      {!selectedStepId ? (
                                        <div className="flex flex-1 items-center justify-center px-4 py-10 text-[12px] text-terminal-muted">
                                          {p.log.selectStep}
                                        </div>
                                      ) : (
                                        <div
                                          ref={logRef}
                                          className="flex-1 min-h-0 w-full overflow-auto px-4 py-4 font-mono text-[12px] leading-6 text-terminal"
                                        >
                                          {logError && !logText ? (
                                            <div className="rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-danger">
                                              {logError}
                                            </div>
                                          ) : logLoading && logText.length === 0 ? (
                                            <div className="space-y-2 py-1">
                                              <Skeleton className="terminal-skeleton h-3 w-3/5" />
                                              <Skeleton className="terminal-skeleton h-3 w-4/5" />
                                              <Skeleton className="terminal-skeleton h-3 w-2/3" />
                                              <Skeleton className="terminal-skeleton h-3 w-5/6" />
                                            </div>
                                          ) : logText ? (
                                            <div className="space-y-3">
                                              {logError && (
                                                <div className="rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-danger">
                                                  {logError}
                                                </div>
                                              )}
                                              <div className="space-y-0.5">
                                                {terminalLogEntries.map(({ line, tone }, index) => (
                                                  <div
                                                    key={`${selectedStepId}-${index}`}
                                                    className={[
                                                      "grid grid-cols-[2px_4rem_minmax(0,1fr)] gap-3 rounded-[6px] px-2 py-0.5",
                                                      getTerminalLineRowClassName(tone),
                                                    ]
                                                      .filter(Boolean)
                                                      .join(" ")}
                                                  >
                                                    <div className={["rounded-full", getTerminalLineMarkerClassName(tone)].join(" ")} />
                                                    <div className="select-none border-r border-[hsl(var(--terminal-divider))] pr-3 text-right tabular-nums text-[hsl(var(--terminal-muted)/0.72)]">
                                                      {String(index + 1)}
                                                    </div>
                                                    <div
                                                      className={[
                                                        "min-w-0 whitespace-pre-wrap break-words",
                                                        getTerminalLineClassName(tone),
                                                      ].join(" ")}
                                                    >
                                                      {line.length > 0 ? line : "\u00a0"}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="rounded-[8px] border border-dashed border-white/10 bg-white/[0.03] px-3 py-2 text-terminal-muted">
                                              {p.log.noLogs}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="w-full space-y-3 px-6 py-8">
                              <Skeleton className="h-5 w-44 bg-[hsl(var(--ds-border-1))]" />
                              <Skeleton className="h-4 w-72 bg-[hsl(var(--ds-border-1))]" />
                              <div className="grid w-full gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                                <div className="space-y-3">
                                  <Skeleton className="h-24 w-full rounded-[12px] bg-[hsl(var(--ds-border-1))]" />
                                  <Skeleton className="h-32 w-full rounded-[12px] bg-[hsl(var(--ds-border-1))]" />
                                </div>
                                <div className="space-y-3">
                                  <Skeleton className="h-32 w-full rounded-[12px] bg-[hsl(var(--ds-border-1))]" />
                                  <Skeleton className="h-48 w-full rounded-[12px] bg-[hsl(var(--ds-border-1))]" />
                                </div>
                              </div>
                            </div>
                          )}
                        </DialogBody>
                        <DialogFooter>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setNodeDialogOpen(false);
                              setSelectedStepId(null);
                              setLogText("");
                            }}
                          >
                            {dict.common.close}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
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
                <button
                  type="button"
                  onClick={() => setConfigSection("versions")}
                  className={`w-full flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-[13px] transition-colors ${
                    configSection === "versions"
                      ? "bg-muted text-foreground font-medium"
                      : "text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-surface-1))] hover:text-foreground"
                  }`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-muted/80 text-[11px]">
                    V
                  </span>
                  {p.versionsTab.title}
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
                          setConfig(
                            enforceProductionDeployManualGate({
                              ...config,
                              environment: value as PipelineEnvironment,
                            })
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {environmentOptions.map((env) => (
                            <SelectItem key={env.key} value={env.key}>
                              {env.label}
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
                      onChange={(patch) =>
                        setConfig((current) => (current ? { ...current, ...patch } : current))
                      }
                    />

                    <div className="flex items-start gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-4 py-3 max-w-3xl">
                      <Switch
                        checked={config.trigger.autoTrigger}
                        onCheckedChange={(value) =>
                          setConfig({
                            ...config,
                            trigger: normalizeTriggerForEdit(config.trigger, { autoTrigger: value }),
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
                            trigger: normalizeTriggerForEdit(config.trigger, { schedule: value }),
                          })
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
                            setConfig({
                              ...config,
                              trigger: normalizeTriggerForEdit(config.trigger, { purpose: event.target.value }),
                            })
                          }
                          placeholder={p.basic.mixedTriggerPurposePlaceholder}
                        />
                        <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                          {p.basic.mixedTriggerPurposeHelp}
                        </div>
                      </div>
                    )}
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

                {configSection === "versions" && (
                  <div className="space-y-6 pb-8">
                    <div className="max-w-6xl grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                      <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-4">
                        <div>
                          <div className="text-sm font-medium">{p.versionsTab.title}</div>
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                            {p.versionsTab.description}
                          </div>
                        </div>
                        <div className="mt-4 space-y-2">
                          {orderedVersions.length === 0 ? (
                            <div className="rounded-[8px] border border-dashed border-[hsl(var(--ds-border-1))] px-3 py-4 text-[12px] text-[hsl(var(--ds-text-2))]">
                              {p.versionsTab.noVersions}
                            </div>
                          ) : (
                            [...orderedVersions].reverse().map((version) => {
                              const isCurrent = pipeline?.current_version_id === version.id;
                              const isSelected = selectedVersion?.id === version.id;
                              return (
                                <button
                                  type="button"
                                  key={version.id}
                                  onClick={() => setSelectedVersionId(version.id)}
                                  className={`w-full rounded-[8px] border px-3 py-3 text-left transition-colors ${
                                    isSelected
                                      ? "border-foreground bg-muted"
                                      : "border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] hover:border-foreground/40"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <div className="text-[13px] font-medium text-foreground">
                                          v{version.version}
                                        </div>
                                        {isCurrent && (
                                          <Badge variant="accent" size="sm">
                                            {p.versionsTab.current}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="mt-1 text-[12px] text-[hsl(var(--ds-text-2))]">
                                        {getVersionActorLabel(version) || p.versionsTab.unknownAuthor}
                                      </div>
                                    </div>
                                    <div className="text-right text-[11px] text-[hsl(var(--ds-text-2))]">
                                      <div>{formatLocalDateTime(version.created_at)}</div>
                                    </div>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>

                      <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{p.versionsTab.diffTitle}</div>
                            <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                              {comparisonVersion
                                ? p.versionsTab.compareTo.replace("{{version}}", String(comparisonVersion.version))
                                : p.versionsTab.firstVersion}
                            </div>
                          </div>
                          {selectedVersion && (
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="muted" size="sm">
                                v{selectedVersion.version}
                              </Badge>
                              {pipeline?.current_version_id === selectedVersion.id && (
                                <Badge variant="accent" size="sm">
                                  {p.versionsTab.current}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>

                        {selectedVersionConfig && (
                          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.basic.environment}</div>
                              <div className="mt-1 text-[13px] font-medium text-foreground">
                                {getPipelineEnvironmentLabel(selectedVersionConfig.environment ?? "production", environmentOptions)}
                              </div>
                            </div>
                            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.basic.buildImage}</div>
                              <div className="mt-1 truncate text-[13px] font-medium text-foreground">
                                {selectedVersionConfig.buildImage || p.versionsTab.emptyBuildImage}
                              </div>
                            </div>
                            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.basic.autoTrigger}</div>
                              <div className="mt-1 text-[13px] font-medium text-foreground">
                                {selectedVersionConfig.trigger.autoTrigger
                                  ? p.versionsTab.enabled
                                  : p.versionsTab.disabled}
                              </div>
                            </div>
                            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5">
                              <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{p.versionsTab.jobsCountLabel}</div>
                              <div className="mt-1 text-[13px] font-medium text-foreground">
                                {p.versionsTab.jobsCount.replace("{{count}}", String(selectedVersionConfig.jobs.length))}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="mt-4 border-t border-[hsl(var(--ds-border-1))] pt-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[13px] font-medium text-foreground">
                                {p.versionsTab.changesTitle}
                              </div>
                              <div className="mt-0.5 text-[12px] text-[hsl(var(--ds-text-2))]">
                                {p.versionsTab.changesDescription}
                              </div>
                            </div>
                            {selectedVersion && (
                              <div className="text-right text-[12px] text-[hsl(var(--ds-text-2))]">
                                <div>
                                  {p.versionsTab.savedBy}:{" "}
                                  <span className="text-foreground">
                                    {getVersionActorLabel(selectedVersion) || p.versionsTab.unknownAuthor}
                                  </span>
                                </div>
                                <div>
                                  {p.versionsTab.savedAt}:{" "}
                                  <span className="text-foreground">{formatLocalDateTime(selectedVersion.created_at)}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          {!selectedVersion || orderedVersions.length === 0 ? (
                            <div className="mt-4 rounded-[8px] border border-dashed border-[hsl(var(--ds-border-1))] px-3 py-4 text-[12px] text-[hsl(var(--ds-text-2))]">
                              {p.versionsTab.noVersions}
                            </div>
                          ) : comparisonVersion ? (
                            versionChanges.length > 0 ? (
                              <div className="mt-4 space-y-2">
                                {versionChanges.map((change) => {
                                  const tone =
                                    change.kind === "added"
                                      ? "success"
                                      : change.kind === "removed"
                                        ? "danger"
                                        : "warning";
                                  return (
                                    <div
                                      key={change.path.join(".")}
                                      className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-3"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="text-[13px] font-medium text-foreground">
                                            {change.label}
                                          </div>
                                          <div className="mt-0.5 text-[11px] text-[hsl(var(--ds-text-2))]">
                                            {change.kind === "added"
                                              ? p.versionsTab.added
                                              : change.kind === "removed"
                                                ? p.versionsTab.removed
                                                : p.versionsTab.changed}
                                          </div>
                                        </div>
                                        <Badge variant={tone} size="sm">
                                          {change.kind === "added"
                                            ? p.versionsTab.added
                                            : change.kind === "removed"
                                              ? p.versionsTab.removed
                                              : p.versionsTab.changed}
                                        </Badge>
                                      </div>
                                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                                        <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                                          <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                                            {comparisonVersion.version}
                                          </div>
                                          <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] text-[hsl(var(--ds-text-2))]">
                                            {change.before || "—"}
                                          </div>
                                        </div>
                                        <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background px-3 py-2">
                                          <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                                            {selectedVersion.version}
                                          </div>
                                          <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] text-foreground">
                                            {change.after || "—"}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="mt-4 rounded-[8px] border border-dashed border-success/30 bg-success/5 px-3 py-4 text-[12px] text-success">
                                {p.versionsTab.noChanges}
                              </div>
                            )
                          ) : (
                            <div className="mt-4 rounded-[8px] border border-dashed border-[hsl(var(--ds-border-1))] px-3 py-4 text-[12px] text-[hsl(var(--ds-text-2))]">
                              {p.versionsTab.firstVersion}
                            </div>
                          )}
                        </div>
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
                          <div className="space-y-2 py-2">
                            <Skeleton className="h-8 w-full bg-[hsl(var(--ds-border-1))]" />
                            <Skeleton className="h-8 w-full bg-[hsl(var(--ds-border-1))]" />
                            <Skeleton className="h-8 w-full bg-[hsl(var(--ds-border-1))]" />
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
                          const isBlockedByProductionPolicy =
                            (pipeline?.environment ?? config.environment ?? "production") === "production" &&
                            mode === "allow";
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
                                if (!isAdmin || !pipeline || isBlockedByProductionPolicy) return;
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
                              disabled={!isAdmin || isBlockedByProductionPolicy}
                              className={`flex-1 min-w-[120px] rounded-[8px] border px-3 py-2 text-left text-[13px] transition-colors ${
                                active
                                  ? "border-foreground bg-muted text-foreground"
                                  : "border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:border-foreground/40"
                              } ${!isAdmin || isBlockedByProductionPolicy ? "opacity-60 cursor-not-allowed hover:border-[hsl(var(--ds-border-1))]" : ""}`}
                            >
                              <div className="font-medium">{label}</div>
                              <div className="mt-0.5 text-[12px] opacity-70">{help}</div>
                            </button>
                          );
                        })}
                      </div>
                      {(pipeline?.environment ?? config.environment ?? "production") === "production" && (
                        <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                          {p.concurrencyMode.productionPolicyHelp}
                        </div>
                      )}
                    </div>

                    <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{p.settingsTab.policyRejectionsTitle}</div>
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                            {p.settingsTab.policyRejectionsDescription}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void loadPolicyRejections();
                          }}
                          disabled={policyRejectionsLoading}
                        >
                          {dict.common.refresh}
                        </Button>
                      </div>

                      {policyRejectionsLoading && (
                        <div className="space-y-2 py-2">
                          <Skeleton className="h-10 w-full bg-[hsl(var(--ds-border-1))]" />
                          <Skeleton className="h-10 w-full bg-[hsl(var(--ds-border-1))]" />
                        </div>
                      )}

                      {!policyRejectionsLoading && policyRejections.length === 0 && (
                        <div className="rounded-[8px] border border-dashed border-[hsl(var(--ds-border-1))] px-3 py-4 text-[12px] text-[hsl(var(--ds-text-2))]">
                          {p.settingsTab.policyRejectionsEmpty}
                        </div>
                      )}

                      {!policyRejectionsLoading && policyRejections.length > 0 && (
                        <div className="space-y-2">
                          {policyRejections.map((item) => {
                            const actorLabel =
                              item.rejected_by_name?.trim() ||
                              item.rejected_by_email?.trim() ||
                              (item.rejected_by?.trim() ? item.rejected_by.slice(0, 8) : p.versionsTab.unknownAuthor);
                            return (
                              <div
                                key={item.id}
                                className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2.5"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="warning" size="sm">
                                        {item.reason_code}
                                      </Badge>
                                      <span className="text-[12px] text-[hsl(var(--ds-text-2))]">
                                        {getPolicyRejectionOperationLabel(item.operation, p.settingsTab)}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-[12px] text-foreground">
                                      {item.message}
                                    </div>
                                    {item.path && (
                                      <div className="mt-1 font-mono text-[11px] text-[hsl(var(--ds-text-2))]">
                                        {item.path}
                                      </div>
                                    )}
                                  </div>
                                  <div className="shrink-0 text-right text-[11px] text-[hsl(var(--ds-text-2))]">
                                    <div>{actorLabel}</div>
                                    <div>{formatLocalDateTime(item.created_at)}</div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
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
            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2 text-[12px] text-[hsl(var(--ds-text-2))]">
              {p.artifactsLabel.replace("{{count}}", String(selectedRunArtifacts.length))}
            </div>
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
                selectedRunArtifacts.length === 0 ||
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
        open={cancelRunDialogOpen}
        title={p.cancelRunDialogTitle}
        description={p.cancelRunDialogDescription.replace("{{run}}", currentRunLabel)}
        confirmLabel={p.cancelRun}
        cancelLabel={dict.common.cancel}
        onOpenChange={(open) => {
          if (!open) setCancelRunDialogOpen(false);
        }}
        onConfirm={() => {
          if (!selectedRunId) return;
          void handleCancelRun(selectedRunId);
        }}
        loading={cancelingRunId === selectedRunId}
        danger
        icon={<XCircle className="size-4 text-danger" />}
      />

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

      <ConfirmDialog
        open={retryDialogTarget !== null}
        title={p.detail.retryDialogTitle}
        description={p.detail.retryDialogDescription
          .replace("{{name}}", retryDialogTarget?.jobName ?? "")
          .replace("{{steps}}", String(retryDialogTarget?.stepCount ?? 0))}
        confirmLabel={p.detail.retryDialogConfirm}
        cancelLabel={dict.common.cancel}
        onOpenChange={(open) => {
          if (!open) setRetryDialogTarget(null);
        }}
        onConfirm={() => {
          if (!retryDialogTarget) return;
          void handleRetryJob(retryDialogTarget.jobKey).finally(() => {
            setRetryDialogTarget(null);
          });
        }}
        loading={retryingJobKey === retryDialogTarget?.jobKey}
        icon={<RotateCcw className="size-4 text-warning" />}
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

function normalizeTriggerForSave(trigger: PipelineTrigger): PipelineTrigger {
  const schedule = trigger.schedule?.trim() ?? "";
  const purpose = trigger.purpose?.trim() ?? "";
  const mixed = trigger.autoTrigger && schedule.length > 0;
  return {
    autoTrigger: trigger.autoTrigger,
    ...(schedule ? { schedule } : {}),
    ...(mixed && purpose ? { purpose } : {}),
  };
}

function normalizePipelineConfigForSave(config: PipelineConfig, defaultBranch: string): PipelineConfig {
  const gatedConfig = enforceProductionDeployManualGate(config);
  return {
    ...gatedConfig,
    buildImage: gatedConfig.buildImage?.trim() ?? "",
    trigger: normalizeTriggerForSave(gatedConfig.trigger),
    stages: normalizeStageSettings(gatedConfig.stages),
    jobs: normalizePipelineJobs(gatedConfig.jobs, gatedConfig.stages, defaultBranch),
  };
}

function withProjectPipelinesPath(pathname: string, projectId: string) {
  return pathname.replace(/\/projects\/[^/]+\/pipelines\/[^/]+$/, `/projects/${projectId}/pipelines`);
}
