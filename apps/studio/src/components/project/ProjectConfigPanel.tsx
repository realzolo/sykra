'use client';

import { useState, useEffect } from 'react';
import { Settings, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { Skeleton } from '@/components/ui/skeleton';

type ProjectConfig = {
  ignore_patterns: string[];
  quality_threshold: number | null;
  artifact_retention_days: number | null;
  auto_analyze: boolean;
  webhook_url: string | null;
  ai_integration_id: string | null;
};

type AIIntegrationOption = {
  id: string;
  name: string;
  model: string | null;
};

function parseAIIntegrationOptions(payload: unknown): AIIntegrationOption[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id : null;
      const name = typeof row.name === 'string' ? row.name : null;
      if (!id || !name) return null;

      const config = row.config;
      const configRecord = config && typeof config === 'object' ? (config as Record<string, unknown>) : null;
      const model = configRecord && typeof configRecord.model === 'string' ? configRecord.model : null;

      return {
        id,
        name,
        model,
      } satisfies AIIntegrationOption;
    })
    .filter((option): option is AIIntegrationOption => !!option);
}

export default function ProjectConfigPanel({ projectId, dict }: { projectId: string; dict: Dictionary }) {
  const [config, setConfig] = useState<ProjectConfig>({
    ignore_patterns: [],
    quality_threshold: null,
    artifact_retention_days: null,
    auto_analyze: false,
    webhook_url: null,
    ai_integration_id: null,
  });
  const [aiIntegrations, setAiIntegrations] = useState<AIIntegrationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ignoreText, setIgnoreText] = useState('');
  const loadConfigFailed = dict.projects.loadConfigFailed;
  const loadAIIntegrationsFailed = dict.projects.aiIntegrationLoadFailed;

  useEffect(() => {
    async function loadConfig() {
      try {
        const [configRes, aiRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/config`),
          fetch('/api/integrations?type=ai'),
        ]);

        if (!configRes.ok) {
          throw new Error('project_config_fetch_failed');
        }

        const configData = (await configRes.json()) as ProjectConfig;
        setConfig({
          ignore_patterns: Array.isArray(configData.ignore_patterns) ? configData.ignore_patterns : [],
          quality_threshold:
            typeof configData.quality_threshold === 'number' ? configData.quality_threshold : null,
          artifact_retention_days:
            typeof configData.artifact_retention_days === 'number'
              ? configData.artifact_retention_days
              : null,
          auto_analyze: configData.auto_analyze === true,
          webhook_url: typeof configData.webhook_url === 'string' ? configData.webhook_url : null,
          ai_integration_id:
            typeof configData.ai_integration_id === 'string' ? configData.ai_integration_id : null,
        });
        setIgnoreText(
          Array.isArray(configData.ignore_patterns) ? configData.ignore_patterns.join('\n') : ''
        );

        if (!aiRes.ok) {
          toast.error(loadAIIntegrationsFailed);
          setAiIntegrations([]);
        } else {
          const aiData = await aiRes.json();
          setAiIntegrations(parseAIIntegrationOptions(aiData));
        }
      } catch {
        toast.error(loadConfigFailed);
      } finally {
        setLoading(false);
      }
    }

    void loadConfig();
  }, [projectId, loadAIIntegrationsFailed, loadConfigFailed]);

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
        artifactRetentionDays: config.artifact_retention_days,
        autoAnalyze: config.auto_analyze,
        webhookUrl: config.webhook_url,
        aiIntegrationId: config.ai_integration_id,
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

  const currentIntegrationMissing =
    !!config.ai_integration_id && !aiIntegrations.some((item) => item.id === config.ai_integration_id);
  const currentAIValue = config.ai_integration_id ?? 'default';

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
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
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

      {/* AI Integration Binding */}
      <div className="space-y-2">
        <label className="text-sm font-medium">{dict.projects.aiIntegrationLabel}</label>
        <Select
          value={currentAIValue}
          onValueChange={(value) =>
            setConfig((prev) => ({
              ...prev,
              ai_integration_id: value === 'default' ? null : value,
            }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{dict.projects.aiIntegrationDefaultOption}</SelectItem>
            {aiIntegrations.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.model ? `${item.name} (${item.model})` : item.name}
              </SelectItem>
            ))}
            {currentIntegrationMissing && config.ai_integration_id && (
              <SelectItem value={config.ai_integration_id}>
                {dict.projects.aiIntegrationMissing}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
          {dict.projects.aiIntegrationHelp}
        </p>
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

      <div className="space-y-2">
        <label htmlFor="artifact-retention-days" className="text-sm font-medium">
          {dict.projects.artifactRetentionDays}
        </label>
        <Input
          id="artifact-retention-days"
          type="number"
          min="1"
          max="3650"
          value={String(config.artifact_retention_days ?? '')}
          onChange={e =>
            setConfig(prev => ({
              ...prev,
              artifact_retention_days: e.target.value
                ? (() => {
                    const parsed = parseInt(e.target.value, 10);
                    return Number.isNaN(parsed) ? null : parsed;
                  })()
                : null,
            }))
          }
          placeholder={dict.projects.artifactRetentionDaysPlaceholder}
        />
        <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
          {dict.projects.artifactRetentionDaysHelp}
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
