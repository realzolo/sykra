'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

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
    config: Record<string, string | number>;
  }>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default function AddAIIntegrationModal({ onClose, onSuccess }: Props) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [selectedProvider, setSelectedProvider] = useState('openai-compatible');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string | number>>({});
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    try {
      const res = await fetch('/api/integrations/providers');
      const data = await res.json();
      setProviders(data.ai);
    } catch (error) {
      toast.error('Failed to load providers');
    }
  }

  const providerConfig = providers[selectedProvider];

  function handlePresetChange(presetName: string) {
    setSelectedPreset(presetName);
    const preset = providerConfig?.presets?.find((p) => p.name === presetName);
    if (preset) {
      setConfig(preset.config);
      setName(preset.name);
    }
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Please enter a name');
      return;
    }

    if (!secret.trim()) {
      toast.error('Please enter an API key');
      return;
    }

    if (!config.model) {
      toast.error('Please enter a model name');
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
        throw new Error(data.error || 'Failed to create integration');
      }

      toast.success('AI integration created');
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create integration');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add AI Model Integration</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {providerConfig?.presets && providerConfig.presets.length > 0 && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Quick Setup</label>
              <Select value={selectedPreset || undefined} onValueChange={(value) => handlePresetChange(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a preset..." />
                </SelectTrigger>
                <SelectContent>
                  {providerConfig.presets.map((p) => (
                    <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">
                Or configure manually below
              </p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1.5 block">Name</label>
            <Input
              placeholder="e.g., Claude Sonnet 4.6"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">API Key *</label>
            <Input
              type="password"
              placeholder="sk-..."
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
                How to get an API key →
              </a>
            )}
          </div>

          {providerConfig?.fields
            .filter((f) => f.key !== 'apiKey')
            .map((field) => (
              <div key={field.key}>
                <label className="text-sm font-medium mb-1.5 block">
                  {field.label}
                  {field.required && ' *'}
                </label>
                {field.type === 'select' && field.options ? (
                  <Select
                    value={asString(config[field.key])}
                    onValueChange={(value) =>
                      setConfig((prev) => ({ ...prev, [field.key]: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={field.placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === 'number' ? (
                  <Input
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
              </div>
            ))}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="isDefault" className="text-sm">
              Set as default AI integration
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creating...' : 'Create Integration'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
