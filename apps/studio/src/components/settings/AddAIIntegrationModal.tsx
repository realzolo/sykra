'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useClientDictionary } from '@/i18n/client';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

interface ProviderConfig {
  name: string;
  description: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    help?: string;
    options?: string[];
  }>;
  docs?: string;
  presets?: Array<{
    name: string;
    category?: string;
    config: Record<string, string | number>;
  }>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const ALL_PRESET_CATEGORIES = 'all';

export default function AddAIIntegrationModal({ onClose, onSuccess }: Props) {
  const dict = useClientDictionary();
  const i18n = dict.settings.addAiModal;
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const selectedProvider = 'openai-api';
  const [selectedCategory, setSelectedCategory] = useState(ALL_PRESET_CATEGORIES);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string | number>>({});
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/providers');
      const data = await res.json();
      setProviders(data.ai);
    } catch {
      toast.error(i18n.loadProvidersFailed);
    }
  }, [i18n.loadProvidersFailed]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const providerConfig = providers[selectedProvider];
  const allPresets = providerConfig?.presets ?? [];
  const tokenProfiles = [
    {
      key: 'fast' as const,
      label: i18n.tokenProfileFast,
      maxTokens: 3072,
      reasoningEffort: 'low',
    },
    {
      key: 'deep' as const,
      label: i18n.tokenProfileDeep,
      maxTokens: 6144,
      reasoningEffort: 'high',
    },
    {
      key: 'logs' as const,
      label: i18n.tokenProfileLogs,
      maxTokens: 6144,
      reasoningEffort: 'medium',
    },
    {
      key: 'autofix' as const,
      label: i18n.tokenProfileAutofix,
      maxTokens: 8192,
      reasoningEffort: 'high',
    },
  ];
  const presetCategories = Array.from(
    new Set(allPresets.map((preset) => preset.category).filter((value): value is string => Boolean(value)))
  );
  const filteredPresets = allPresets.filter((preset) => (
    selectedCategory === ALL_PRESET_CATEGORIES || preset.category === selectedCategory
  ));

  function categoryLabel(category: string): string {
    switch (category) {
      case 'anthropic':
        return i18n.categoryAnthropic;
      case 'openai-gpt':
        return i18n.categoryOpenAIGpt;
      case 'openai-reasoning':
        return i18n.categoryOpenAIReasoning;
      case 'openai-codex':
        return i18n.categoryOpenAICodex;
      case 'google-gemini':
        return i18n.categoryGoogleGemini;
      case 'deepseek':
        return i18n.categoryDeepSeek;
      case 'mistral':
        return i18n.categoryMistral;
      case 'llama-groq':
        return i18n.categoryLlamaGroq;
      case 'xai-grok':
        return i18n.categoryXaiGrok;
      default:
        return category;
    }
  }

  useEffect(() => {
    if (selectedPreset && !filteredPresets.some((preset) => preset.name === selectedPreset)) {
      setSelectedPreset('');
    }
  }, [filteredPresets, selectedPreset]);

  function handlePresetChange(presetName: string) {
    setSelectedPreset(presetName);
    const preset = providerConfig?.presets?.find((p) => p.name === presetName);
    if (preset) {
      setConfig(preset.config);
      setName(preset.name);
    }
  }

  function applyTokenProfile(profile: (typeof tokenProfiles)[number]) {
    setConfig((prev) => ({
      ...prev,
      maxTokens: profile.maxTokens,
      reasoningEffort: profile.reasoningEffort,
    }));
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error(i18n.nameRequired);
      return;
    }

    if (!secret.trim()) {
      toast.error(i18n.apiKeyRequired);
      return;
    }

    if (!config.model) {
      toast.error(i18n.modelRequired);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ai',
          provider: selectedProvider,
          name,
          config,
          secret,
          isDefault,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || i18n.createFailed);
      }

      toast.success(i18n.createSuccess);
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.createFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[640px] overflow-hidden p-0">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold">{i18n.title}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(90vh-132px)] overflow-y-auto px-6 py-5 space-y-4">
          {allPresets.length > 0 && (
            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-3">
              <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 block">
                {i18n.quickSetup}
              </label>
              <div className="space-y-2">
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={i18n.quickSetupCategoryPlaceholder} />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value={ALL_PRESET_CATEGORIES}>{i18n.allCategories}</SelectItem>
                    {presetCategories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {categoryLabel(category)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">
                {i18n.quickSetupCategoryHelp}
              </p>

              <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 mt-3 block">
                {i18n.quickSetupModel}
              </label>
              <Select
                {...(selectedPreset ? { value: selectedPreset } : {})}
                onValueChange={(value) => handlePresetChange(value)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={i18n.quickSetupModelPlaceholder} />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {filteredPresets.map((p) => (
                    <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filteredPresets.length === 0 && (
                <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">
                  {i18n.noPresetsInCategory}
                </p>
              )}
              <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">
                {i18n.configureManually}
              </p>
            </div>
          )}

          <div>
            <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 block">{i18n.name}</label>
            <Input
              className="h-9"
              placeholder={i18n.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 block">{i18n.apiKeyLabel}</label>
            <Input
              className="h-9"
              type="password"
              placeholder={i18n.apiKeyPlaceholder}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            {providerConfig?.docs && (
              <a
                href={providerConfig.docs}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline mt-1 inline-block"
              >
                {i18n.apiKeyDocs}
              </a>
            )}
          </div>

          {providerConfig?.fields
            .filter((f) => f.key !== 'apiKey')
            .map((field) => (
              <div key={field.key}>
                <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 block">
                  {field.label}
                  {field.required && ' *'}
                </label>
                {field.type === 'select' && field.options ? (
                  (() => {
                    const selectedValue = asString(config[field.key]);
                    return (
                      <Select
                        {...(selectedValue ? { value: selectedValue } : {})}
                        onValueChange={(value) =>
                          setConfig((prev) => ({ ...prev, [field.key]: value }))
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder={field.placeholder} />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          {field.options.map((opt) => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()
                ) : field.type === 'number' ? (
                  <Input
                    className="h-9"
                    type="number"
                    step={field.key === 'temperature' ? '0.1' : '1'}
                    placeholder={field.placeholder}
                    value={config[field.key] ?? ''}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isNaN(v)) {
                        setConfig((prev) => { const next = { ...prev }; delete next[field.key]; return next; });
                      } else {
                        setConfig((prev) => ({ ...prev, [field.key]: v }));
                      }
                    }}
                  />
                ) : (
                  <Input
                    className="h-9"
                    type={field.type}
                    placeholder={field.placeholder}
                    value={String(config[field.key] ?? '')}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                )}
                {field.help && (
                  <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">{field.help}</p>
                )}
                {field.key === 'maxTokens' && (
                  <div className="mt-2 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-2.5">
                    <p className="text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
                      {i18n.tokenRecommendationTitle}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {tokenProfiles.map((profile) => {
                        const currentMaxTokens = asNumber(config.maxTokens);
                        const currentReasoningEffort = asString(config.reasoningEffort);
                        const active = currentMaxTokens === profile.maxTokens &&
                          currentReasoningEffort === profile.reasoningEffort;
                        return (
                          <button
                            key={profile.key}
                            type="button"
                            onClick={() => applyTokenProfile(profile)}
                            className={
                              active
                                ? 'h-7 rounded-[6px] border border-foreground bg-foreground px-2.5 text-[12px] text-background'
                                : 'h-7 rounded-[6px] border border-[hsl(var(--ds-border-2))] bg-[hsl(var(--ds-surface-1))] px-2.5 text-[12px] text-foreground hover:bg-[hsl(var(--ds-surface-2))]'
                            }
                          >
                            {profile.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                      {i18n.tokenRecommendationHint}
                    </p>
                  </div>
                )}
                {field.key === 'model' && (
                  <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">
                    {i18n.manualModelIdHelp}
                  </p>
                )}
              </div>
            ))}

          <div className="flex items-center gap-2 pt-1">
            <Switch id="isDefault" checked={isDefault} onCheckedChange={setIsDefault} />
            <label htmlFor="isDefault" className="text-[13px]">
              {i18n.setDefault}
            </label>
          </div>
        </div>

        <DialogFooter className="px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {dict.common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={loading} className="min-w-28">
            {loading ? i18n.creating : i18n.createAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
