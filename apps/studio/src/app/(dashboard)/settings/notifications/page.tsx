'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import SettingsNav from '@/components/settings/SettingsNav';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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

export default function NotificationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/notification-settings');
        if (!res.ok) throw new Error('load_failed');
        const data = await res.json();
        if (!alive) return;
        setSettings(data?.settings ?? null);
      } catch {
        if (alive) toast.error('Failed to load notification settings');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/notification-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('save_failed');
      toast.success('Saved');
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || !settings;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[240px_1fr] items-start">
          <SettingsNav />

          <div className="space-y-6">
            <div>
              <div className="text-heading-24">Notifications</div>
              <div className="text-copy-14 text-muted-foreground mt-1">
                Configure how you want to be notified about pipeline runs and reports.
              </div>
            </div>

            <Card className="shadow-elevation-1">
              <CardContent className="p-5 space-y-4">
                {loading && (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-56" />
                    <Skeleton className="h-4 w-72" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                )}

                {!loading && settings && (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">Email notifications</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Receive email updates when runs complete.
                        </div>
                      </div>
                      <Switch
                        checked={settings.email_enabled}
                        onCheckedChange={(v) => setSettings({ ...settings, email_enabled: v })}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">Notify on completion</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Pipeline run completed (success or failure).
                        </div>
                      </div>
                      <Switch
                        checked={settings.notify_on_complete}
                        onCheckedChange={(v) => setSettings({ ...settings, notify_on_complete: v })}
                        disabled={!settings.email_enabled}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">Notify on critical issues</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Reports with critical/high issues.
                        </div>
                      </div>
                      <Switch
                        checked={settings.notify_on_critical}
                        onCheckedChange={(v) => setSettings({ ...settings, notify_on_critical: v })}
                        disabled={!settings.email_enabled}
                      />
                    </div>

                    <div className="grid gap-2">
                      <div className="text-sm font-medium">Score threshold</div>
                      <div className="text-xs text-muted-foreground">
                        Only notify when the score is below this threshold (0-100). Leave empty to disable.
                      </div>
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
                    </div>

                    <div className="grid gap-2">
                      <div className="text-sm font-medium">Slack webhook (optional)</div>
                      <div className="text-xs text-muted-foreground">
                        Not implemented yet. Stored for future integrations.
                      </div>
                      <Input
                        value={settings.slack_webhook ?? ''}
                        onChange={(e) => setSettings({ ...settings, slack_webhook: e.target.value || null })}
                        placeholder="https://hooks.slack.com/services/..."
                        disabled={!settings.email_enabled}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">Daily digest</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Not implemented yet.
                        </div>
                      </div>
                      <Switch
                        checked={settings.daily_digest}
                        onCheckedChange={(v) => setSettings({ ...settings, daily_digest: v })}
                        disabled={!settings.email_enabled}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">Weekly digest</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Not implemented yet.
                        </div>
                      </div>
                      <Switch
                        checked={settings.weekly_digest}
                        onCheckedChange={(v) => setSettings({ ...settings, weekly_digest: v })}
                        disabled={!settings.email_enabled}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={save} disabled={disabled || saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
