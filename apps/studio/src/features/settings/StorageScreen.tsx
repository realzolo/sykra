'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientDictionary } from '@/i18n/client';
import { useOrgRole } from '@/lib/useOrgRole';
import SettingsPageShell from '@/components/settings/SettingsPageShell';
import SettingsNotice from '@/components/settings/SettingsNotice';
import SettingsRow from '@/components/settings/SettingsRow';
import SettingsSection from '@/components/settings/SettingsSection';

type Provider = 'local' | 's3';

type StorageState = {
  provider: Provider;
  localBasePath: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3Prefix: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ForcePathStyle: boolean;
  hasSecret: boolean;
};

function defaultState(): StorageState {
  return {
    provider: 'local',
    localBasePath: 'artifacts',
    s3Endpoint: '',
    s3Region: 'us-east-1',
    s3Bucket: '',
    s3Prefix: '',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
    s3ForcePathStyle: true,
    hasSecret: false,
  };
}

export default function StorageScreen() {
  const dict = useClientDictionary();
  const i18n = dict.settings.storagePage;
  const { isAdmin } = useOrgRole();

  const [state, setState] = useState<StorageState>(() => defaultState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/storage-settings', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error ?? i18n.loadFailed);
        }
        if (!active) return;
        const next = defaultState();
        const provider = data?.provider === 's3' ? 's3' : 'local';
        next.provider = provider;
        const cfg = data?.config ?? {};
        next.localBasePath = typeof cfg.localBasePath === 'string' ? cfg.localBasePath : next.localBasePath;
        next.s3Endpoint = typeof cfg.s3Endpoint === 'string' ? cfg.s3Endpoint : '';
        next.s3Region = typeof cfg.s3Region === 'string' && cfg.s3Region ? cfg.s3Region : 'us-east-1';
        next.s3Bucket = typeof cfg.s3Bucket === 'string' ? cfg.s3Bucket : '';
        next.s3Prefix = typeof cfg.s3Prefix === 'string' ? cfg.s3Prefix : '';
        next.s3AccessKeyId = typeof cfg.s3AccessKeyId === 'string' ? cfg.s3AccessKeyId : '';
        next.s3ForcePathStyle = typeof cfg.s3ForcePathStyle === 'boolean' ? cfg.s3ForcePathStyle : true;
        next.hasSecret = Boolean(cfg.hasSecret);
        setState(next);
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
    if (!isAdmin || saving) return false;
    if (state.provider === 'local') {
      return state.localBasePath.trim().length > 0;
    }
    return (
      state.s3Region.trim().length > 0 &&
      state.s3Bucket.trim().length > 0 &&
      state.s3AccessKeyId.trim().length > 0 &&
      (state.s3SecretAccessKey.trim().length > 0 || state.hasSecret)
    );
  }, [isAdmin, saving, state]);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload =
        state.provider === 'local'
          ? {
              provider: 'local',
              config: {
                localBasePath: state.localBasePath.trim(),
              },
            }
          : {
              provider: 's3',
              config: {
                s3Endpoint: state.s3Endpoint.trim(),
                s3Region: state.s3Region.trim(),
                s3Bucket: state.s3Bucket.trim(),
                s3Prefix: state.s3Prefix.trim(),
                s3AccessKeyId: state.s3AccessKeyId.trim(),
                s3SecretAccessKey: state.s3SecretAccessKey.trim(),
                s3ForcePathStyle: state.s3ForcePathStyle,
              },
            };

      const response = await fetch('/api/storage-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? i18n.saveFailed);
      }
      setState((prev) => ({ ...prev, s3SecretAccessKey: '', hasSecret: prev.provider === 's3' ? true : prev.hasSecret }));
      toast.success(i18n.saveSuccess);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SettingsPageShell
        title={<Skeleton className="h-8 w-40 max-w-full" />}
        description={<Skeleton className="h-4 w-80 max-w-full" />}
      >
        <div className="space-y-6">
          <SettingsSection title={i18n.providerLabel} description={i18n.providerHelp}>
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div
                    key={`storage-provider-skeleton-${index}`}
                    className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3"
                  >
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-2 h-3 w-32" />
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </SettingsSection>
        </div>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell
      title={i18n.title}
      description={i18n.description}
      actions={
        <Button onClick={save} disabled={!canSave}>
          {saving ? i18n.saving : i18n.save}
        </Button>
      }
    >
      <SettingsSection title={i18n.providerLabel} description={i18n.providerHelp}>
        <div className="space-y-4">
          <div className="inline-flex rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-1">
            {[
              { key: 'local', label: i18n.providerLocal },
              { key: 's3', label: i18n.providerS3 },
            ].map((option) => {
              const active = state.provider === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => isAdmin && setState((prev) => ({ ...prev, provider: option.key as 'local' | 's3' }))}
                  disabled={!isAdmin}
                  className={[
                    'h-8 rounded-[8px] px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150',
                    active
                      ? 'bg-[hsl(var(--ds-background-1))] text-foreground shadow-[0_1px_2px_hsl(0_0%_0%/0.14)]'
                      : 'text-[hsl(var(--ds-text-2))] hover:text-foreground',
                    !isAdmin ? 'cursor-not-allowed opacity-60' : '',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {state.provider === 'local' ? (
            <div className="space-y-2">
              <label htmlFor="localBasePath" className="text-[12px] font-medium text-foreground">{i18n.localBasePathLabel}</label>
              <Input
                id="localBasePath"
                value={state.localBasePath}
                onChange={(event) => setState((prev) => ({ ...prev, localBasePath: event.target.value }))}
                disabled={!isAdmin}
              />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <label htmlFor="s3Endpoint" className="text-[12px] font-medium text-foreground">{i18n.s3EndpointLabel}</label>
                  <Input
                    id="s3Endpoint"
                    value={state.s3Endpoint}
                    placeholder={i18n.s3EndpointPlaceholder}
                    onChange={(event) => setState((prev) => ({ ...prev, s3Endpoint: event.target.value }))}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="s3Region" className="text-[12px] font-medium text-foreground">{i18n.s3RegionLabel}</label>
                  <Input
                    id="s3Region"
                    value={state.s3Region}
                    onChange={(event) => setState((prev) => ({ ...prev, s3Region: event.target.value }))}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="s3Bucket" className="text-[12px] font-medium text-foreground">{i18n.s3BucketLabel}</label>
                  <Input
                    id="s3Bucket"
                    value={state.s3Bucket}
                    onChange={(event) => setState((prev) => ({ ...prev, s3Bucket: event.target.value }))}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="s3Prefix" className="text-[12px] font-medium text-foreground">{i18n.s3PrefixLabel}</label>
                  <Input
                    id="s3Prefix"
                    value={state.s3Prefix}
                    onChange={(event) => setState((prev) => ({ ...prev, s3Prefix: event.target.value }))}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="s3AccessKey" className="text-[12px] font-medium text-foreground">{i18n.s3AccessKeyLabel}</label>
                  <Input
                    id="s3AccessKey"
                    value={state.s3AccessKeyId}
                    onChange={(event) => setState((prev) => ({ ...prev, s3AccessKeyId: event.target.value }))}
                    disabled={!isAdmin}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="s3SecretKey" className="text-[12px] font-medium text-foreground">{i18n.s3SecretKeyLabel}</label>
                <Input
                  id="s3SecretKey"
                  type="password"
                  value={state.s3SecretAccessKey}
                  placeholder={state.hasSecret ? i18n.secretPlaceholder : ''}
                  onChange={(event) => setState((prev) => ({ ...prev, s3SecretAccessKey: event.target.value }))}
                  disabled={!isAdmin}
                />
                {state.hasSecret && !state.s3SecretAccessKey.trim() ? (
                  <SettingsNotice
                    variant="info"
                    description={i18n.secretKeepHint}
                    className="mt-2"
                  />
                ) : null}
              </div>

              <SettingsRow
                left={
                  <>
                    <div className="text-[13px] font-medium text-foreground">{i18n.s3ForcePathStyleLabel}</div>
                    <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{i18n.providerHelp}</div>
                  </>
                }
                right={
                  <input
                    type="checkbox"
                    checked={state.s3ForcePathStyle}
                    onChange={(event) => setState((prev) => ({ ...prev, s3ForcePathStyle: event.target.checked }))}
                    disabled={!isAdmin}
                    className="size-4 rounded border-[hsl(var(--ds-border-2))] accent-foreground"
                  />
                }
              />
            </div>
          )}
        </div>
      </SettingsSection>
    </SettingsPageShell>
  );
}
