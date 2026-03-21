'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useClientDictionary } from '@/i18n/client';
import {
  DEFAULT_OUTPUT_LANGUAGE,
  OUTPUT_LANGUAGE_OPTIONS,
  isSupportedOutputLanguage,
} from '@/lib/outputLanguage';
import { getAIParameterCapabilities } from '@/lib/aiModelCapabilities';

type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type APIStyle = 'openai' | 'anthropic';

interface Integration {
  id: string;
  name: string;
  provider: string;
  config: AIConfigForm;
  is_default: boolean;
}

type AIConfigForm = Record<string, unknown> & {
  model?: string;
  baseUrl?: string;
  outputLanguage?: string;
  apiStyle?: APIStyle;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
};

interface Props {
  integration: Integration;
  onClose: () => void;
  onSuccess: () => void;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export default function EditAIIntegrationModal({ integration, onClose, onSuccess }: Props) {
  const dict = useClientDictionary();
  const i18n = dict.settings.editAiModal;

  const [name, setName] = useState(integration.name);
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(integration.is_default);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);

  const initialConfig: {
    baseUrl: string;
    model: string;
    outputLanguage: string;
    apiStyle: APIStyle;
    maxTokens?: number;
    temperature?: number;
    reasoningEffort?: ReasoningEffort;
  } = {
    baseUrl: typeof integration.config.baseUrl === 'string' ? integration.config.baseUrl : '',
    model: typeof integration.config.model === 'string' ? integration.config.model : '',
    outputLanguage:
      typeof integration.config.outputLanguage === 'string' && isSupportedOutputLanguage(integration.config.outputLanguage)
        ? integration.config.outputLanguage
        : DEFAULT_OUTPUT_LANGUAGE,
    apiStyle: integration.config.apiStyle === 'anthropic' ? 'anthropic' : 'openai',
  };
  const maxTokens = asNumber(integration.config.maxTokens);
  if (maxTokens !== undefined) {
    initialConfig.maxTokens = maxTokens;
  }
  const temperature = asNumber(integration.config.temperature);
  if (temperature !== undefined) {
    initialConfig.temperature = temperature;
  }
  if (typeof integration.config.reasoningEffort === 'string') {
    initialConfig.reasoningEffort = integration.config.reasoningEffort as ReasoningEffort;
  }

  const [config, setConfig] = useState(initialConfig);
  const parameterCapabilities = useMemo(
    () =>
      getAIParameterCapabilities({
        model: config.model,
        apiStyle: config.apiStyle,
        baseUrl: config.baseUrl,
      }),
    [config.apiStyle, config.baseUrl, config.model]
  );

  function updateConfig<K extends keyof typeof config>(key: K, value: (typeof config)[K]) {
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
      const next = { ...prev };
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
    if (!config.model.trim()) {
      toast.error(i18n.modelRequired);
      return;
    }
    if (!config.baseUrl.trim()) {
      toast.error(i18n.baseUrlRequired);
      return;
    }

    setLoading(true);
    try {
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

      const body: Record<string, unknown> = {
        name: name.trim(),
        config: payloadConfig,
        isDefault,
      };
      if (secret.trim()) {
        body.secret = secret.trim();
      }

      const res = await fetch(`/api/integrations/${integration.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || i18n.updateFailed);
      }

      toast.success(i18n.updateSuccess);
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.updateFailed);
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
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">{i18n.name}</label>
            <Input
              className="h-9"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={i18n.namePlaceholder}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
              {i18n.baseUrl}
            </label>
            <Input
              className="h-9"
              value={config.baseUrl}
              onChange={(e) => updateConfig('baseUrl', e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
              {i18n.model}
            </label>
            <Input
              className="h-9"
              value={config.model}
              onChange={(e) => updateConfig('model', e.target.value)}
              placeholder="gpt-5.4"
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
              {secret ? i18n.apiKeyLabel : i18n.apiKeyLabelWithHint}
            </label>
            <Input
              className="h-9"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={i18n.apiKeyPlaceholder}
            />
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
            <Switch id="isDefault-edit-ai" checked={isDefault} onCheckedChange={setIsDefault} />
            <label htmlFor="isDefault-edit-ai" className="text-[13px]">{i18n.setDefault}</label>
          </div>
        </DialogBody>

        <DialogFooter>
          <div className="flex w-full gap-3">
            <Button variant="secondary" onClick={onClose} disabled={loading} className="flex-1">
              {dict.common.cancel}
            </Button>
            <Button onClick={handleSubmit} disabled={loading} className="flex-1">
              {loading ? i18n.updating : i18n.updateAction}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
