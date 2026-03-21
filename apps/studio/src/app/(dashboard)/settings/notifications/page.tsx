'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import SettingsPageShell from '@/components/settings/SettingsPageShell';
import SettingsSection from '@/components/settings/SettingsSection';
import SettingsRow from '@/components/settings/SettingsRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useClientDictionary } from '@/i18n/client';

type NotificationSettings = {
  email_enabled: boolean;
  slack_webhook: string | null;
  notify_on_complete: boolean;
  notify_on_critical: boolean;
  notify_on_threshold: number | null;
  daily_digest: boolean;
  weekly_digest: boolean;
};

export const dynamic = 'force-dynamic';

function PageSkeleton({ title, description }: { title: string; description: string }) {
  return (
    <SettingsPageShell title={title} description={description}>
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

export default function NotificationsSettingsPage() {
  const dict = useClientDictionary();
  const i18n = dict.settings.notificationsPage;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);

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
    return <PageSkeleton title={i18n.title} description={i18n.description} />;
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
      <SettingsSection title={i18n.emailNotificationsTitle} description={i18n.emailNotificationsDescription}>
        {settings && (
          <div className="space-y-5">
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
                title: i18n.notifyCompletionTitle,
                description: i18n.notifyCompletionDescription,
                checked: settings.notify_on_complete,
                onChange: (v: boolean) => setSettings({ ...settings, notify_on_complete: v }),
              },
              {
                title: i18n.notifyCriticalTitle,
                description: i18n.notifyCriticalDescription,
                checked: settings.notify_on_critical,
                onChange: (v: boolean) => setSettings({ ...settings, notify_on_critical: v }),
              },
              {
                title: i18n.dailyDigestTitle,
                description: i18n.dailyDigestDescription,
                checked: settings.daily_digest,
                onChange: (v: boolean) => setSettings({ ...settings, daily_digest: v }),
              },
              {
                title: i18n.weeklyDigestTitle,
                description: i18n.weeklyDigestDescription,
                checked: settings.weekly_digest,
                onChange: (v: boolean) => setSettings({ ...settings, weekly_digest: v }),
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
                  <div className="text-[13px] font-medium">{i18n.scoreThresholdTitle}</div>
                  <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                    {i18n.scoreThresholdDescription}
                  </div>
                </>
              }
              right={
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.notify_on_threshold ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setSettings({ ...settings, notify_on_threshold: null });
                      return;
                    }
                    const n = Number(raw);
                    setSettings({
                      ...settings,
                      notify_on_threshold: Number.isFinite(n)
                        ? Math.min(100, Math.max(0, Math.round(n)))
                        : null,
                    });
                  }}
                  disabled={!settings.email_enabled}
                  className="w-40"
                />
              }
            />

            <div className="space-y-2">
              <div className="text-[13px] font-medium">{i18n.slackWebhookTitle}</div>
              <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                {i18n.slackWebhookDescription}
              </div>
              <Input
                value={settings.slack_webhook ?? ''}
                onChange={(e) => setSettings({ ...settings, slack_webhook: e.target.value || null })}
                placeholder={i18n.slackWebhookPlaceholder}
                disabled={!settings.email_enabled}
              />
            </div>
          </div>
        )}
      </SettingsSection>
    </SettingsPageShell>
  );
}
