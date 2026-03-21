'use client';

import { useEffect, useMemo, useState } from 'react';
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
  DEFAULT_ORG_RUNTIME_SETTINGS,
  type OrgRuntimeSettings,
} from '@/services/runtimeSettings.shared';

function numberOrDefault(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(value);
}

function defaultState(): OrgRuntimeSettings {
  return { ...DEFAULT_ORG_RUNTIME_SETTINGS };
}

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

  const canSave = useMemo(() => {
    if (!isAdmin || saving || loading) return false;
    return Object.values(state).every((value) => Number.isFinite(value) && value > 0);
  }, [isAdmin, loading, saving, state]);

  function updateNumber<K extends keyof OrgRuntimeSettings>(key: K, value: string) {
    const parsed = Number.parseInt(value, 10);
    setState((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const response = await fetch('/api/runtime-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? i18n.saveFailed);
      }
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
    </SettingsPageShell>
  );
}
