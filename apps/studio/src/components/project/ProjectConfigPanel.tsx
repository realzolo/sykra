'use client';

import { useState, useEffect } from 'react';
import { Settings, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { Skeleton } from '@/components/ui/skeleton';

type ProjectConfig = {
  ignore_patterns: string[];
  quality_threshold: number | null;
  auto_analyze: boolean;
  webhook_url: string | null;
};

export default function ProjectConfigPanel({ projectId, dict }: { projectId: string; dict: Dictionary }) {
  const [config, setConfig] = useState<ProjectConfig>({
    ignore_patterns: [],
    quality_threshold: null,
    auto_analyze: false,
    webhook_url: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ignoreText, setIgnoreText] = useState('');

  useEffect(() => {
    fetch(`/api/projects/${projectId}/config`)
      .then(r => r.json())
      .then(data => {
        setConfig(data);
        setIgnoreText((data.ignore_patterns || []).join('\n'));
        setLoading(false);
      })
      .catch(() => {
        toast.error(dict.projects.loadConfigFailed);
        setLoading(false);
      });
  }, [projectId]);

  async function handleSave() {
    setSaving(true);

    const ignorePatterns = ignoreText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    const res = await fetch(`/api/projects/${projectId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ignorePatterns,
        qualityThreshold: config.quality_threshold,
        autoAnalyze: config.auto_analyze,
        webhookUrl: config.webhook_url,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? dict.projects.saveFailed);
      return;
    }

    toast.success(dict.projects.configSaved);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-52" />
          </div>
          <Skeleton className="h-6 w-10 rounded-[4px]" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-9 w-32 rounded-[6px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="size-5" />
        <h3 className="text-lg font-semibold">{dict.projects.projectConfig}</h3>
      </div>

      {/* Ignore Patterns */}
      <div className="space-y-2">
        <label htmlFor="ignore-patterns" className="text-sm font-medium">{dict.projects.ignorePatterns}</label>
        <Textarea
          id="ignore-patterns"
          value={ignoreText}
          onChange={e => setIgnoreText(e.target.value)}
          placeholder={dict.projects.ignorePatternsPlaceholder}
          rows={8}
          className="font-mono text-sm"
        />
        <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
          {dict.projects.ignorePatternsHelp}
        </p>
      </div>

      {/* Quality Threshold */}
      <div className="space-y-2">
        <label htmlFor="quality-threshold" className="text-sm font-medium">{dict.projects.qualityThreshold}</label>
        <Input
          id="quality-threshold"
          type="number"
          min="0"
          max="100"
          value={String(config.quality_threshold ?? '')}
          onChange={e =>
            setConfig(prev => ({
              ...prev,
              quality_threshold: e.target.value ? parseInt(e.target.value) : null,
            }))
          }
          placeholder={dict.projects.qualityThresholdPlaceholder}
        />
        <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
          {dict.projects.qualityThresholdHelp}
        </p>
      </div>

      {/* Auto Analyze */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <label className="text-sm font-medium">{dict.projects.autoAnalyze}</label>
          <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
            {dict.projects.autoAnalyzeHelp}
          </p>
        </div>
        <Switch
          checked={config.auto_analyze}
          onCheckedChange={(v) => setConfig(prev => ({ ...prev, auto_analyze: v }))}
        />
      </div>

      {/* Webhook URL */}
      <div className="space-y-2">
        <label htmlFor="webhook-url" className="text-sm font-medium">Webhook URL</label>
        <Input
          id="webhook-url"
          type="url"
          value={config.webhook_url ?? ''}
          onChange={e =>
            setConfig(prev => ({ ...prev, webhook_url: e.target.value || null }))
          }
          placeholder="https://your-webhook-url.com/notify"
        />
        <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
          {dict.projects.webhookHelp}
        </p>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="size-4" />
          {saving ? dict.common.loading : dict.projects.saveConfig}
        </Button>
      </div>
    </div>
  );
}
