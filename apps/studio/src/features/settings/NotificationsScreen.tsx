'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Mail } from 'lucide-react';
import { toast } from 'sonner';

import SettingsPageShell from '@/components/settings/SettingsPageShell';
import SettingsNotice from '@/components/settings/SettingsNotice';
import SettingsSection from '@/components/settings/SettingsSection';
import SettingsRow from '@/components/settings/SettingsRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useClientDictionary } from '@/i18n/client';

type NotificationSettings = {
  email_enabled: boolean;
  notify_on_pipeline_run: boolean;
  notify_on_report_ready: boolean;
  notify_on_report_score_below: number | null;
};

type EmailDeliveryStatus = {
  provider: 'console' | 'resend';
  configured: boolean;
  mode: 'development' | 'live' | 'misconfigured';
};

function PageSkeleton() {
  return (
    <SettingsPageShell
      title={<Skeleton className="h-8 w-40 max-w-full" />}
      description={<Skeleton className="h-4 w-80 max-w-full" />}
    >
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={`notifications-skeleton-${index}`}
            className="space-y-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4"
          >
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </SettingsPageShell>
  );
}

export default function NotificationsScreen() {
  const dict = useClientDictionary();
  const i18n = dict.settings.notificationsPage;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [delivery, setDelivery] = useState<EmailDeliveryStatus | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/notification-settings');
        if (!res.ok) throw new Error(i18n.loadFailed);
        const data = await res.json();
        if (!alive) return;
        setSettings(data?.settings ?? null);
        setDelivery(data?.delivery ?? null);
      } catch {
        if (alive) toast.error(i18n.loadFailed);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [i18n.loadFailed]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/notification-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(i18n.saveFailed);
      toast.success(i18n.saveSuccess);
    } catch {
      toast.error(i18n.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || !settings;

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <SettingsPageShell
      title={i18n.title}
      description={i18n.description}
      actions={
        <Button onClick={save} disabled={disabled || saving}>
          {saving ? i18n.saving : dict.common.save}
        </Button>
      }
    >
      {delivery?.mode === 'live' && (
        <SettingsNotice
          variant="success"
          icon={<CheckCircle2 className="size-4" />}
          title={i18n.deliveryLiveTitle}
          description={i18n.deliveryLiveDescription.replace('{{provider}}', delivery.provider)}
        />
      )}
      {delivery?.mode === 'development' && (
        <SettingsNotice
          variant="warning"
          icon={<Mail className="size-4" />}
          title={i18n.deliveryDevTitle}
          description={i18n.deliveryDevDescription}
        />
      )}
      {delivery?.mode === 'misconfigured' && (
        <SettingsNotice
          variant="danger"
          icon={<AlertCircle className="size-4" />}
          title={i18n.deliveryBrokenTitle}
          description={i18n.deliveryBrokenDescription}
        />
      )}

      <SettingsSection title={i18n.emailNotificationsTitle} description={i18n.emailNotificationsDescription}>
        {settings && (
          <div className="divide-y divide-[hsl(var(--ds-border-1))]">
            <SettingsRow
              left={
                <>
                  <div className="text-[13px] font-medium">{i18n.emailNotificationsTitle}</div>
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                    {i18n.emailNotificationsDescription}
                  </div>
                </>
              }
              right={
                <Switch
                  checked={settings.email_enabled}
                  onCheckedChange={(v) => setSettings({ ...settings, email_enabled: v })}
                />
              }
            />

            {[
              {
                title: i18n.notifyPipelineRunTitle,
                description: i18n.notifyPipelineRunDescription,
                checked: settings.notify_on_pipeline_run,
                onChange: (v: boolean) => setSettings({ ...settings, notify_on_pipeline_run: v }),
              },
              {
                title: i18n.notifyReportReadyTitle,
                description: i18n.notifyReportReadyDescription,
                checked: settings.notify_on_report_ready,
                onChange: (v: boolean) => setSettings({ ...settings, notify_on_report_ready: v }),
              },
            ].map((item) => (
              <SettingsRow
                key={item.title}
                left={
                  <>
                    <div className="text-[13px] font-medium">{item.title}</div>
                    <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{item.description}</div>
                  </>
                }
                right={
                  <Switch
                    checked={item.checked}
                    onCheckedChange={item.onChange}
                    disabled={!settings.email_enabled}
                  />
                }
              />
            ))}

            <SettingsRow
              align="start"
              left={
                <>
                  <div className="text-[13px] font-medium">{i18n.reportScoreThresholdTitle}</div>
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                    {i18n.reportScoreThresholdDescription}
                  </div>
                </>
              }
              right={
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.notify_on_report_score_below ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setSettings({ ...settings, notify_on_report_score_below: null });
                      return;
                    }
                    const n = Number(raw);
                    setSettings({
                      ...settings,
                      notify_on_report_score_below: Number.isFinite(n)
                        ? Math.min(100, Math.max(0, Math.round(n)))
                        : null,
                    });
                  }}
                  disabled={!settings.email_enabled || !settings.notify_on_report_ready}
                  className="w-40"
                />
              }
            />
          </div>
        )}
      </SettingsSection>
    </SettingsPageShell>
  );
}
