'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import TypedConfirmDialog from '@/components/ui/typed-confirm-dialog';
import { useProject } from '@/lib/projectContext';
import SettingsDangerZone from '@/components/settings/SettingsDangerZone';
import SettingsField from '@/components/settings/SettingsField';
import SettingsRow from '@/components/settings/SettingsRow';
import SettingsSection from '@/components/settings/SettingsSection';

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
  const router = useRouter();
  const { project } = useProject();
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
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
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

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : dict.projects.deleteFailed);
      }
      toast.success(dict.projects.projectDeleted);
      router.push(`/o/${project.org_id}/projects`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : dict.projects.deleteFailed);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  const currentIntegrationMissing =
    !!config.ai_integration_id && !aiIntegrations.some((item) => item.id === config.ai_integration_id);
  const currentAIValue = config.ai_integration_id ?? 'default';
  const aiIntegrationOptions = useMemo(
    () => [
      {
        value: 'default',
        label: dict.projects.aiIntegrationDefaultOption,
        keywords: [dict.projects.aiIntegrationDefaultOption],
      },
      ...aiIntegrations.map((item) => ({
        value: item.id,
        label: item.model ? `${item.name} (${item.model})` : item.name,
        keywords: item.model ? [item.name, item.model, item.id] : [item.name, item.id],
      })),
      ...(currentIntegrationMissing && config.ai_integration_id
        ? [
            {
              value: config.ai_integration_id,
              label: dict.projects.aiIntegrationMissing,
              keywords: [dict.projects.aiIntegrationMissing, config.ai_integration_id],
            },
          ]
        : []),
    ],
    [
      aiIntegrations,
      config.ai_integration_id,
      currentIntegrationMissing,
      dict.projects.aiIntegrationDefaultOption,
      dict.projects.aiIntegrationMissing,
    ]
  );

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
      <SettingsSection
        title={dict.projects.projectConfig}
        description={project.name}
        contentClassName="space-y-0"
      >
        <div className="divide-y divide-[hsl(var(--ds-border-1))]">
          <SettingsRow
            align="start"
            left={
              <>
                <div className="text-[13px] font-medium text-foreground">{dict.projects.aiIntegrationLabel}</div>
                <div className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">
                  {dict.projects.aiIntegrationHelp}
                </div>
              </>
            }
            right={
              <SettingsField
                label={dict.projects.aiIntegrationLabel}
                className="max-w-[420px]"
                labelClassName="sr-only"
              >
                <Combobox
                  value={currentAIValue}
                  onChange={(value) =>
                    setConfig((prev) => ({
                      ...prev,
                      ai_integration_id: value === 'default' ? null : value,
                    }))
                  }
                  options={aiIntegrationOptions}
                  placeholder={dict.projects.aiIntegrationPlaceholder}
                  searchPlaceholder={dict.projects.aiIntegrationSearchPlaceholder}
                  heading={dict.projects.aiIntegrationListHeading}
                  emptyLabel={dict.projects.aiIntegrationListEmpty}
                  className="w-full"
                  contentClassName="w-[360px]"
                />
              </SettingsField>
            }
          />

          <SettingsRow
            align="start"
            left={
              <>
                <div className="text-[13px] font-medium text-foreground">{dict.projects.ignorePatterns}</div>
                <div className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">
                  {dict.projects.ignorePatternsHelp}
                </div>
              </>
            }
            right={
              <SettingsField
                label={dict.projects.ignorePatterns}
                htmlFor="ignore-patterns"
                className="max-w-[420px]"
                labelClassName="sr-only"
              >
                <Textarea
                  id="ignore-patterns"
                  value={ignoreText}
                  onChange={(e) => setIgnoreText(e.target.value)}
                  placeholder={dict.projects.ignorePatternsPlaceholder}
                  rows={8}
                  className="font-mono text-sm"
                />
              </SettingsField>
            }
          />

          <SettingsRow
            align="start"
            left={
              <>
                <div className="text-[13px] font-medium text-foreground">{dict.projects.qualityThreshold}</div>
                <div className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">
                  {dict.projects.qualityThresholdHelp}
                </div>
              </>
            }
            right={
              <SettingsField
                label={dict.projects.qualityThreshold}
                htmlFor="quality-threshold"
                className="max-w-[220px]"
                labelClassName="sr-only"
              >
                <Input
                  id="quality-threshold"
                  type="number"
                  min="0"
                  max="100"
                  value={String(config.quality_threshold ?? '')}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      quality_threshold: e.target.value ? parseInt(e.target.value, 10) : null,
                    }))
                  }
                  placeholder={dict.projects.qualityThresholdPlaceholder}
                />
              </SettingsField>
            }
          />

          <SettingsRow
            align="start"
            left={
              <>
                <div className="text-[13px] font-medium text-foreground">{dict.projects.artifactRetentionDays}</div>
                <div className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">
                  {dict.projects.artifactRetentionDaysHelp}
                </div>
              </>
            }
            right={
              <SettingsField
                label={dict.projects.artifactRetentionDays}
                htmlFor="artifact-retention-days"
                className="max-w-[220px]"
                labelClassName="sr-only"
              >
                <Input
                  id="artifact-retention-days"
                  type="number"
                  min="1"
                  max="3650"
                  value={String(config.artifact_retention_days ?? '')}
                  onChange={(e) =>
                    setConfig((prev) => ({
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
              </SettingsField>
            }
          />

          <SettingsRow
            left={
              <>
                <div className="text-[13px] font-medium text-foreground">{dict.projects.autoAnalyze}</div>
                <div className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">
                  {dict.projects.autoAnalyzeHelp}
                </div>
              </>
            }
            right={
              <div className="flex justify-start md:justify-end">
                <Switch
                  checked={config.auto_analyze}
                  onCheckedChange={(value) => setConfig((prev) => ({ ...prev, auto_analyze: value }))}
                />
              </div>
            }
          />

          <SettingsRow
            align="start"
            left={
              <>
                <div className="text-[13px] font-medium text-foreground">Webhook URL</div>
                <div className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">
                  {dict.projects.webhookHelp}
                </div>
              </>
            }
            right={
              <SettingsField
                label="Webhook URL"
                htmlFor="webhook-url"
                className="max-w-[420px]"
                labelClassName="sr-only"
              >
                <Input
                  id="webhook-url"
                  type="url"
                  value={config.webhook_url ?? ''}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, webhook_url: e.target.value || null }))
                  }
                  placeholder="https://your-webhook-url.com/notify"
                />
              </SettingsField>
            }
          />
        </div>

        <div className="flex justify-end pt-5">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="size-4" />
            {saving ? dict.common.loading : dict.projects.saveConfig}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title={dict.projects.dangerZoneTitle}
        description={dict.projects.dangerZoneDescription}
      >
        <SettingsDangerZone
          title={dict.projects.deleteProject}
          warning={dict.projects.deleteProjectWarning}
          action={
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleting}
            >
              {dict.projects.deleteProject}
            </Button>
          }
        />
      </SettingsSection>

      <TypedConfirmDialog
        open={deleteDialogOpen}
        title={dict.projects.deleteProjectDialogTitle}
        description={dict.projects.deleteProjectDialogDescription.replace('{{name}}', project.name)}
        confirmLabel={dict.common.delete}
        cancelLabel={dict.common.cancel}
        keyword={project.name}
        keywordHint={dict.projects.deleteProjectConfirmInstruction.replace('{{name}}', project.name)}
        inputLabel={dict.projects.deleteProjectConfirmLabel}
        inputPlaceholder={dict.projects.deleteProjectConfirmPlaceholder}
        mismatchText={dict.projects.deleteProjectConfirmMismatch}
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
