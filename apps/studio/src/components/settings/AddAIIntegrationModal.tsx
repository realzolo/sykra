'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useClientDictionary } from '@/i18n/client';
import {
  DEFAULT_OUTPUT_LANGUAGE,
  OUTPUT_LANGUAGE_OPTIONS,
  isSupportedOutputLanguage,
} from '@/lib/outputLanguage';
import { getAIParameterCapabilities } from '@/lib/aiModelCapabilities';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type APIStyle = 'openai' | 'anthropic';

type AIConfigDraft = {
  baseUrl: string;
  model: string;
  outputLanguage: string;
  apiStyle: APIStyle;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
};

interface Preset {
  name: string;
  category?: string;
  config: Record<string, string | number>;
}

interface ProviderPayload {
  docs?: string | null;
  presets?: Preset[];
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

export default function AddAIIntegrationModal({ onClose, onSuccess }: Props) {
  const dict = useClientDictionary();
  const i18n = dict.settings.addAiModal;

  const [presets, setPresets] = useState<Preset[]>([]);
  const [docsUrl, setDocsUrl] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);

  const [config, setConfig] = useState<AIConfigDraft>({
    baseUrl: '',
    model: '',
    outputLanguage: DEFAULT_OUTPUT_LANGUAGE,
    apiStyle: 'openai',
  });

  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/providers');
      if (!res.ok) {
        throw new Error();
      }
      const data = await res.json() as { ai?: Record<string, ProviderPayload> };
      const aiProvider = data.ai?.['openai-api'];
      if (!aiProvider) return;
      setPresets(Array.isArray(aiProvider.presets) ? aiProvider.presets : []);
      setDocsUrl(typeof aiProvider.docs === 'string' ? aiProvider.docs : null);
    } catch {
      toast.error(i18n.loadProvidersFailed);
    }
  }, [i18n.loadProvidersFailed]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const presetLabel = useCallback((preset: Preset): string => {
    if (!preset.category) return preset.name;
    return `${preset.category} · ${preset.name}`;
  }, []);

  const selectedPresetEntity = useMemo(
    () => presets.find((preset) => preset.name === selectedPreset),
    [presets, selectedPreset]
  );
  const parameterCapabilities = useMemo(
    () =>
      getAIParameterCapabilities({
        model: config.model,
        apiStyle: config.apiStyle,
        baseUrl: config.baseUrl,
      }),
    [config.apiStyle, config.baseUrl, config.model]
  );

  useEffect(() => {
    if (!selectedPresetEntity) return;
    const presetConfig = selectedPresetEntity.config;
    const presetOutputLanguage = asString(presetConfig.outputLanguage);
    const outputLanguage = presetOutputLanguage && isSupportedOutputLanguage(presetOutputLanguage)
      ? presetOutputLanguage
      : DEFAULT_OUTPUT_LANGUAGE;
    const apiStyle = asString(presetConfig.apiStyle) === 'anthropic' ? 'anthropic' : 'openai';
    setConfig((prev) => {
      const next: AIConfigDraft = {
        ...prev,
        baseUrl: asString(presetConfig.baseUrl) ?? prev.baseUrl,
        model: asString(presetConfig.model) ?? prev.model,
        outputLanguage,
        apiStyle,
      };
      const maxTokens = asNumber(presetConfig.maxTokens);
      if (maxTokens !== undefined) {
        next.maxTokens = maxTokens;
      }
      const temperature = asNumber(presetConfig.temperature);
      if (temperature !== undefined) {
        next.temperature = temperature;
      }
      const reasoningEffort = asString(presetConfig.reasoningEffort) as ReasoningEffort | undefined;
      if (reasoningEffort !== undefined) {
        next.reasoningEffort = reasoningEffort;
      }
      return next;
    });
    if (!name.trim()) {
      setName(selectedPresetEntity.name);
    }
  }, [name, selectedPresetEntity]);

  function updateConfig<K extends keyof AIConfigDraft>(key: K, value: AIConfigDraft[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function clearOptionalField(key: 'maxTokens' | 'temperature' | 'reasoningEffort') {
    setConfig((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  useEffect(() => {
    setConfig((prev) => {
      let changed = false;
      const next: AIConfigDraft = { ...prev };
      if (!parameterCapabilities.temperature.supported && next.temperature !== undefined) {
        delete next.temperature;
        changed = true;
      }
      if (!parameterCapabilities.reasoningEffort.supported && next.reasoningEffort !== undefined) {
        delete next.reasoningEffort;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [parameterCapabilities.reasoningEffort.supported, parameterCapabilities.temperature.supported]);

  function getReasoningEffortUnsupportedMessage(): string {
    switch (parameterCapabilities.reasoningEffort.reason) {
      case 'api_style_not_supported':
        return i18n.reasoningUnsupportedApiStyle;
      case 'requires_openai_official_base':
        return i18n.reasoningUnsupportedBaseUrl;
      default:
        return i18n.reasoningUnsupportedModel;
    }
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
    if (!config.model.trim()) {
      toast.error(i18n.modelRequired);
      return;
    }
    if (!config.baseUrl.trim()) {
      toast.error(i18n.baseUrlRequired);
      return;
    }

    const payloadConfig: Record<string, unknown> = {
      baseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
      outputLanguage: config.outputLanguage,
      apiStyle: config.apiStyle,
    };
    if (typeof config.maxTokens === 'number' && Number.isFinite(config.maxTokens)) {
      payloadConfig.maxTokens = config.maxTokens;
    }
    if (
      parameterCapabilities.temperature.supported &&
      typeof config.temperature === 'number' &&
      Number.isFinite(config.temperature)
    ) {
      payloadConfig.temperature = config.temperature;
    }
    if (parameterCapabilities.reasoningEffort.supported && config.reasoningEffort) {
      payloadConfig.reasoningEffort = config.reasoningEffort;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ai',
          provider: 'openai-api',
          name: name.trim(),
          config: payloadConfig,
          secret: secret.trim(),
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
      <DialogContent className="max-w-[620px] overflow-hidden p-0">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold">{i18n.title}</DialogTitle>
        </DialogHeader>

        <DialogBody className="max-h-[calc(90vh-132px)] space-y-4">
          {presets.length > 0 && (
            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-3">
              <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
                {i18n.quickSetupModel}
              </label>
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={i18n.quickSetupModelPlaceholder} />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {presets.map((preset) => (
                    <SelectItem key={preset.name} value={preset.name}>
                      {presetLabel(preset)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">{i18n.name}</label>
            <Input
              className="h-9"
              placeholder={i18n.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
              {i18n.baseUrl}
            </label>
            <Input
              className="h-9"
              placeholder="https://api.openai.com/v1"
              value={config.baseUrl}
              onChange={(e) => updateConfig('baseUrl', e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
              {i18n.model}
            </label>
            <Input
              className="h-9"
              placeholder="gpt-5.4"
              value={config.model}
              onChange={(e) => updateConfig('model', e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
              {i18n.outputLanguage}
            </label>
            <Select value={config.outputLanguage} onValueChange={(value) => updateConfig('outputLanguage', value)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={i18n.outputLanguagePlaceholder} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                  <SelectItem key={option.code} value={option.code}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
              {i18n.apiKeyLabel}
            </label>
            <Input
              className="h-9"
              type="password"
              placeholder={i18n.apiKeyPlaceholder}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            {docsUrl && (
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-primary hover:underline"
              >
                {i18n.apiKeyDocs}
              </a>
            )}
          </div>

          <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-3">
            <button
              type="button"
              className="w-full text-left text-[12px] font-medium text-foreground"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? i18n.advancedHide : i18n.advancedShow}
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
                    {i18n.apiStyle}
                  </label>
                  <Select value={config.apiStyle} onValueChange={(value) => updateConfig('apiStyle', value as APIStyle)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">openai</SelectItem>
                      <SelectItem value="anthropic">anthropic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
                    {i18n.maxTokensOptional}
                  </label>
                  <Input
                    className="h-9"
                    type="number"
                    placeholder="4096"
                    value={config.maxTokens ?? ''}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      if (Number.isNaN(parsed)) {
                        clearOptionalField('maxTokens');
                        return;
                      }
                      updateConfig('maxTokens', parsed);
                    }}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
                    {i18n.temperatureOptional}
                  </label>
                  {parameterCapabilities.temperature.supported ? (
                    <Input
                      className="h-9"
                      type="number"
                      step="0.1"
                      placeholder="0.7"
                      value={config.temperature ?? ''}
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        if (Number.isNaN(parsed)) {
                          clearOptionalField('temperature');
                          return;
                        }
                        updateConfig('temperature', parsed);
                      }}
                    />
                  ) : (
                    <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                      {i18n.temperatureUnsupported}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
                    {i18n.reasoningEffortOptional}
                  </label>
                  {parameterCapabilities.reasoningEffort.supported ? (
                    <Select
                      {...(config.reasoningEffort ? { value: config.reasoningEffort } : {})}
                      onValueChange={(value) => updateConfig('reasoningEffort', value as ReasoningEffort)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={i18n.reasoningEffortPlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">none</SelectItem>
                        <SelectItem value="minimal">minimal</SelectItem>
                        <SelectItem value="low">low</SelectItem>
                        <SelectItem value="medium">medium</SelectItem>
                        <SelectItem value="high">high</SelectItem>
                        <SelectItem value="xhigh">xhigh</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                      {getReasoningEffortUnsupportedMessage()}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Switch id="isDefault" checked={isDefault} onCheckedChange={setIsDefault} />
            <label htmlFor="isDefault" className="text-[13px]">
              {i18n.setDefault}
            </label>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
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
