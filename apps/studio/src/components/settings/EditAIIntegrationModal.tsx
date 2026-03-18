'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useClientDictionary } from '@/i18n/client';

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
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
};

interface Props {
  integration: Integration;
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
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [name, setName] = useState(integration.name);
  const [config, setConfig] = useState<AIConfigForm>(integration.config);
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(integration.is_default);
  const [loading, setLoading] = useState(false);
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

  const loadProviderConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/providers');
      const data = await res.json();
      const cfg = data.ai?.[integration.provider];
      if (cfg) setProviderConfig(cfg);
    } catch {
      // non-fatal: fall back to basic fields
    }
  }, [integration.provider]);

  useEffect(() => {
    void loadProviderConfig();
  }, [loadProviderConfig]);

  function setConfigValue(key: string, value: string | number | undefined) {
    setConfig((prev) => {
      if (value === undefined) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }

  function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
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

    const model = typeof config.model === 'string' ? config.model.trim() : '';
    if (!model) {
      toast.error(i18n.modelRequired);
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, unknown> = { name, config, isDefault };
      if (secret) body.secret = secret;

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

  // Determine which fields to render: prefer dynamic provider config, fall back to hardcoded basics
  const fields = providerConfig?.fields ?? [
    { key: 'baseUrl', label: i18n.baseUrl, type: 'text', required: true, placeholder: 'https://api.anthropic.com' },
    { key: 'model', label: i18n.model, type: 'text', required: true, placeholder: 'claude-sonnet-4-6' },
    { key: 'maxTokens', label: i18n.maxTokensOptional, type: 'number', required: false, placeholder: '4096' },
    { key: 'temperature', label: i18n.temperatureOptional, type: 'number', required: false, placeholder: '0.7', help: i18n.temperatureHelp },
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[640px] overflow-hidden p-0">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold">{i18n.title}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(90vh-132px)] overflow-y-auto px-6 py-5 flex flex-col gap-4">
          <div>
            <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 block">{i18n.provider}</label>
            <Input className="h-9" value={integration.provider} disabled />
          </div>

          <div>
            <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 block">{i18n.name}</label>
            <Input
              className="h-9"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={i18n.namePlaceholder}
            />
          </div>

          {fields
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
                        onValueChange={(value) => setConfigValue(field.key, value)}
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
                  (() => {
                    const fieldValue = config[field.key];
                    return (
                      <Input
                        className="h-9"
                        type="number"
                        step={field.key === 'temperature' ? '0.1' : '1'}
                        placeholder={field.placeholder}
                        value={
                          typeof fieldValue === 'number' || typeof fieldValue === 'string'
                            ? fieldValue
                            : ''
                        }
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setConfigValue(field.key, Number.isNaN(v) ? undefined : v);
                        }}
                      />
                    );
                  })()
                ) : (
                  (() => {
                    const textValue = config[field.key];
                    return (
                      <Input
                        className="h-9"
                        type={field.type}
                        placeholder={field.placeholder}
                        value={
                          typeof textValue === 'string' || typeof textValue === 'number'
                            ? textValue
                            : ''
                        }
                        onChange={(e) => setConfigValue(field.key, e.target.value)}
                      />
                    );
                  })()
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
              </div>
            ))}

          <div>
            <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 block">
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

          <div className="flex items-center gap-2 pt-1">
            <Switch id="isDefault-edit-ai" checked={isDefault} onCheckedChange={setIsDefault} />
            <label htmlFor="isDefault-edit-ai" className="text-[13px]">{i18n.setDefault}</label>
          </div>
        </div>

        <DialogFooter className="px-6 py-4">
          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
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
