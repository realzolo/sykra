'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientDictionary } from '@/i18n/client';
import { useOrgRole } from '@/lib/useOrgRole';
import SettingsPageShell from '@/components/settings/SettingsPageShell';
import SettingsRow from '@/components/settings/SettingsRow';
import SettingsSection from '@/components/settings/SettingsSection';
import {
  DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS,
  normalizePipelineEnvironmentDefinitions,
  type PipelineEnvironmentDefinition,
} from '@/services/pipelineTypes';
import {
  DEFAULT_ORG_RUNTIME_SETTINGS,
  type OrgRuntimeSettings,
} from '@/services/runtimeSettings.shared';

function numberOrDefault(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(value);
}

function defaultState(): OrgRuntimeSettings {
  return {
    ...DEFAULT_ORG_RUNTIME_SETTINGS,
    pipelineEnvironments: DEFAULT_ORG_RUNTIME_SETTINGS.pipelineEnvironments.map((item) => ({ ...item })),
  };
}

function createPipelineEnvironmentCandidate(existing: PipelineEnvironmentDefinition[]): PipelineEnvironmentDefinition {
  const used = new Set(existing.map((item) => item.key));
  for (let index = 1; index <= 100; index += 1) {
    const key = index === 1 ? 'env' : `env-${index}`;
    if (!used.has(key)) {
      return { key, label: '', order: existing.length + 1 };
    }
  }
  return { key: `env-${existing.length + 1}`, label: '', order: existing.length + 1 };
}

const IMMUTABLE_PIPELINE_ENVIRONMENT_KEYS = new Set(
  DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map((item) => item.key)
);

function PageSkeleton() {
  return (
    <SettingsPageShell
      title={<Skeleton className="h-8 w-40 max-w-full" />}
      description={<Skeleton className="h-4 w-80 max-w-full" />}
    >
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={`runtime-skeleton-${index}`}
            className="space-y-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4"
          >
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </SettingsPageShell>
  );
}

export default function RuntimeScreen() {
  const dict = useClientDictionary();
  const i18n = dict.settings.runtimePage;
  const { isAdmin } = useOrgRole();

  const [state, setState] = useState<OrgRuntimeSettings>(() => defaultState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/runtime-settings', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? i18n.loadFailed);
        }
        if (!active) return;
        const settings = data?.settings ?? {};
        setState({
          analyzeRateWindowMs: numberOrDefault(settings.analyzeRateWindowMs, DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateWindowMs),
          analyzeRateUserProjectMax: numberOrDefault(settings.analyzeRateUserProjectMax, DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateUserProjectMax),
          analyzeRateOrgMax: numberOrDefault(settings.analyzeRateOrgMax, DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateOrgMax),
          analyzeRateIpMax: numberOrDefault(settings.analyzeRateIpMax, DEFAULT_ORG_RUNTIME_SETTINGS.analyzeRateIpMax),
          analyzeDedupeTtlSec: numberOrDefault(settings.analyzeDedupeTtlSec, DEFAULT_ORG_RUNTIME_SETTINGS.analyzeDedupeTtlSec),
          analyzeDedupeLockTtlSec: numberOrDefault(settings.analyzeDedupeLockTtlSec, DEFAULT_ORG_RUNTIME_SETTINGS.analyzeDedupeLockTtlSec),
          analyzeBackpressureProjectActiveMax: numberOrDefault(
            settings.analyzeBackpressureProjectActiveMax,
            DEFAULT_ORG_RUNTIME_SETTINGS.analyzeBackpressureProjectActiveMax
          ),
          analyzeBackpressureOrgActiveMax: numberOrDefault(
            settings.analyzeBackpressureOrgActiveMax,
            DEFAULT_ORG_RUNTIME_SETTINGS.analyzeBackpressureOrgActiveMax
          ),
          analyzeBackpressureRetryAfterSec: numberOrDefault(
            settings.analyzeBackpressureRetryAfterSec,
            DEFAULT_ORG_RUNTIME_SETTINGS.analyzeBackpressureRetryAfterSec
          ),
          analyzeReportTimeoutMs: numberOrDefault(settings.analyzeReportTimeoutMs, DEFAULT_ORG_RUNTIME_SETTINGS.analyzeReportTimeoutMs),
          codebaseFileMaxBytes: numberOrDefault(settings.codebaseFileMaxBytes, DEFAULT_ORG_RUNTIME_SETTINGS.codebaseFileMaxBytes),
          pipelineEnvironments: normalizePipelineEnvironmentDefinitions(settings.pipelineEnvironments),
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : i18n.loadFailed);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [i18n.loadFailed]);

  const environmentIssues = useMemo(() => {
    const keyRegex = /^[a-z][a-z0-9-]{0,31}$/;
    const keyCounts = new Map<string, number>();
    for (const item of state.pipelineEnvironments) {
      const key = item.key.trim();
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
    return state.pipelineEnvironments.map((item) => {
      const key = item.key.trim();
      const label = item.label.trim();
      return {
        invalidKey: !keyRegex.test(key),
        duplicateKey: (keyCounts.get(key) ?? 0) > 1,
        emptyLabel: label.length === 0,
      };
    });
  }, [state.pipelineEnvironments]);

  const environmentRows = useMemo(
    () =>
      state.pipelineEnvironments.map((item) => ({
        ...item,
        immutable: IMMUTABLE_PIPELINE_ENVIRONMENT_KEYS.has(item.key),
      })),
    [state.pipelineEnvironments]
  );

  const hasEnvironmentIssues = useMemo(
    () => environmentIssues.some((item) => item.invalidKey || item.duplicateKey || item.emptyLabel),
    [environmentIssues]
  );

  const canSave = useMemo(() => {
    if (!isAdmin || saving || loading) return false;
    const numericChecks = [
      state.analyzeRateWindowMs,
      state.analyzeRateUserProjectMax,
      state.analyzeRateOrgMax,
      state.analyzeRateIpMax,
      state.analyzeDedupeTtlSec,
      state.analyzeDedupeLockTtlSec,
      state.analyzeBackpressureProjectActiveMax,
      state.analyzeBackpressureOrgActiveMax,
      state.analyzeBackpressureRetryAfterSec,
      state.analyzeReportTimeoutMs,
      state.codebaseFileMaxBytes,
    ];
    return numericChecks.every((value) => Number.isFinite(value) && value > 0) && !hasEnvironmentIssues;
  }, [hasEnvironmentIssues, isAdmin, loading, saving, state]);

  function updateNumber<K extends keyof OrgRuntimeSettings>(key: K, value: string) {
    const parsed = Number.parseInt(value, 10);
    setState((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  }

  function updatePipelineEnvironment(
    index: number,
    patch: Partial<Pick<PipelineEnvironmentDefinition, 'key' | 'label'>>
  ) {
    setState((current) => {
      const currentItem = current.pipelineEnvironments[index];
      if (!currentItem) return current;
      if (IMMUTABLE_PIPELINE_ENVIRONMENT_KEYS.has(currentItem.key)) {
        return current;
      }
      const next = current.pipelineEnvironments.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const nextKey = patch.key === undefined ? item.key : patch.key.slice(0, 32);
        const nextLabel =
          patch.label === undefined
            ? item.label
            : patch.label.slice(0, 32);
        return { ...item, key: nextKey, label: nextLabel };
      });
      return {
        ...current,
        pipelineEnvironments: next.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })),
      };
    });
  }

  function movePipelineEnvironment(index: number, direction: 'up' | 'down') {
    setState((current) => {
      const list = [...current.pipelineEnvironments];
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= list.length) return current;
      const sourceItem = list[index];
      const targetItem = list[target];
      if (!sourceItem || !targetItem) return current;
      list[index] = targetItem;
      list[target] = sourceItem;
      return {
        ...current,
        pipelineEnvironments: list.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })),
      };
    });
  }

  function removePipelineEnvironment(index: number) {
    setState((current) => {
      if (current.pipelineEnvironments.length <= 1) return current;
      const item = current.pipelineEnvironments[index];
      if (!item || IMMUTABLE_PIPELINE_ENVIRONMENT_KEYS.has(item.key)) return current;
      const list = current.pipelineEnvironments.filter((_, itemIndex) => itemIndex !== index);
      return {
        ...current,
        pipelineEnvironments: list.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })),
      };
    });
  }

  function addPipelineEnvironment() {
    setState((current) => {
      const candidate = createPipelineEnvironmentCandidate(current.pipelineEnvironments);
      return {
        ...current,
        pipelineEnvironments: [...current.pipelineEnvironments, candidate],
      };
    });
  }

  function resetPipelineEnvironments() {
    setState((current) => ({
      ...current,
      pipelineEnvironments: DEFAULT_PIPELINE_ENVIRONMENT_DEFINITIONS.map((item) => ({ ...item })),
    }));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const normalizedEnvironments = normalizePipelineEnvironmentDefinitions(state.pipelineEnvironments);
      const payload: OrgRuntimeSettings = {
        ...state,
        pipelineEnvironments: normalizedEnvironments,
      };
      const response = await fetch('/api/runtime-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? i18n.saveFailed);
      }
      setState(payload);
      toast.success(i18n.saveSuccess);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <SettingsPageShell
      title={i18n.title}
      description={i18n.description}
      actions={
        <Button onClick={save} disabled={!canSave}>
          {saving ? i18n.saving : dict.common.save}
        </Button>
      }
    >
      <SettingsSection title={i18n.admissionTitle} description={i18n.admissionDescription}>
        <div className="divide-y divide-[hsl(var(--ds-border-1))]">
          {[
            ['analyzeRateWindowMs', i18n.rateWindowMsLabel, i18n.hintWindow],
            ['analyzeRateUserProjectMax', i18n.rateUserProjectMaxLabel, i18n.hintUserProject],
            ['analyzeRateOrgMax', i18n.rateOrgMaxLabel, i18n.hintOrg],
            ['analyzeRateIpMax', i18n.rateIpMaxLabel, i18n.hintIp],
            ['analyzeBackpressureProjectActiveMax', i18n.backpressureProjectActiveMaxLabel, i18n.hintProjectActive],
            ['analyzeBackpressureOrgActiveMax', i18n.backpressureOrgActiveMaxLabel, i18n.hintOrgActive],
            ['analyzeBackpressureRetryAfterSec', i18n.backpressureRetryAfterSecLabel, i18n.hintRetryAfter],
          ].map(([key, label, hint]) => (
            <SettingsRow
              key={String(key)}
              left={
                <>
                  <div className="text-[13px] font-medium">{label}</div>
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{hint}</div>
                </>
              }
              right={
                <Input
                  type="number"
                  min={1}
                  value={String(state[key as keyof OrgRuntimeSettings])}
                  onChange={(event) => updateNumber(key as keyof OrgRuntimeSettings, event.target.value)}
                  disabled={!isAdmin}
                  className="w-40"
                />
              }
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={i18n.dedupeTitle} description={i18n.dedupeDescription}>
        <div className="divide-y divide-[hsl(var(--ds-border-1))]">
          {[
            ['analyzeDedupeTtlSec', i18n.dedupeTtlSecLabel, i18n.hintDedupeTtl],
            ['analyzeDedupeLockTtlSec', i18n.dedupeLockTtlSecLabel, i18n.hintDedupeLock],
            ['analyzeReportTimeoutMs', i18n.reportTimeoutMsLabel, i18n.hintReportTimeout],
          ].map(([key, label, hint]) => (
            <SettingsRow
              key={String(key)}
              left={
                <>
                  <div className="text-[13px] font-medium">{label}</div>
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{hint}</div>
                </>
              }
              right={
                <Input
                  type="number"
                  min={1}
                  value={String(state[key as keyof OrgRuntimeSettings])}
                  onChange={(event) => updateNumber(key as keyof OrgRuntimeSettings, event.target.value)}
                  disabled={!isAdmin}
                  className="w-40"
                />
              }
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={i18n.codebaseTitle} description={i18n.codebaseDescription}>
        <SettingsRow
          left={
            <>
              <div className="text-[13px] font-medium">{i18n.codebaseFileMaxBytesLabel}</div>
              <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{i18n.hintCodebaseFileMaxBytes}</div>
            </>
          }
          right={
            <Input
              type="number"
              min={1}
              value={String(state.codebaseFileMaxBytes)}
              onChange={(event) => updateNumber('codebaseFileMaxBytes', event.target.value)}
              disabled={!isAdmin}
              className="w-40"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={i18n.pipelineEnvironmentsTitle} description={i18n.pipelineEnvironmentsDescription}>
        <SettingsRow
          left={
            <>
              <div className="text-[13px] font-medium">{i18n.pipelineEnvironmentsLabel}</div>
              <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{i18n.pipelineEnvironmentsHint}</div>
            </>
          }
          right={
              <div className="w-full max-w-[420px] space-y-2">
              {environmentRows.map((item, index) => {
                const issue = environmentIssues[index];
                return (
                  <div
                    key={index}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-2"
                  >
                    <Input
                      value={item.key}
                      onChange={(event) => updatePipelineEnvironment(index, { key: event.target.value })}
                      placeholder={i18n.pipelineEnvironmentsKeyPlaceholder}
                      disabled={!isAdmin || item.immutable}
                      className="font-mono text-[12px]"
                    />
                    <Input
                      value={item.label}
                      onChange={(event) => updatePipelineEnvironment(index, { label: event.target.value })}
                      placeholder={i18n.pipelineEnvironmentsLabelPlaceholder}
                      disabled={!isAdmin || item.immutable}
                      className="text-[12px]"
                    />
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => movePipelineEnvironment(index, 'up')}
                        disabled={!isAdmin || index === 0}
                        className="size-8"
                        aria-label={i18n.pipelineEnvironmentsMoveUp}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => movePipelineEnvironment(index, 'down')}
                        disabled={!isAdmin || index === state.pipelineEnvironments.length - 1}
                        className="size-8"
                        aria-label={i18n.pipelineEnvironmentsMoveDown}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removePipelineEnvironment(index)}
                        disabled={!isAdmin || state.pipelineEnvironments.length <= 1 || item.immutable}
                        className="size-8 text-danger"
                        aria-label={i18n.pipelineEnvironmentsRemove}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {item.immutable && (
                      <div className="col-span-3 text-[11px] text-[hsl(var(--ds-text-2))]">
                        {i18n.pipelineEnvironmentsImmutable}
                      </div>
                    )}
                    {issue && (issue.invalidKey || issue.duplicateKey || issue.emptyLabel) && (
                      <div className="col-span-3 text-[11px] text-danger">
                        {issue.invalidKey
                          ? i18n.pipelineEnvironmentsKeyInvalid
                          : issue.duplicateKey
                            ? i18n.pipelineEnvironmentsDuplicateKey
                            : i18n.pipelineEnvironmentsLabelRequired}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-1">
                <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{i18n.pipelineEnvironmentsColumns}</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetPipelineEnvironments}
                    disabled={!isAdmin}
                    className="h-8 gap-1.5"
                  >
                    <RotateCcw className="size-3.5" />
                    {i18n.pipelineEnvironmentsReset}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addPipelineEnvironment}
                    disabled={!isAdmin || state.pipelineEnvironments.length >= 20}
                    className="h-8 gap-1.5"
                  >
                    <Plus className="size-3.5" />
                    {i18n.pipelineEnvironmentsAdd}
                  </Button>
                </div>
              </div>
            </div>
          }
        />
      </SettingsSection>
    </SettingsPageShell>
  );
}
