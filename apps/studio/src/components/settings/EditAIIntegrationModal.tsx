'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface Integration {
  id: string;
  name: string;
  provider: string;
  config: Record<string, any>;
  is_default: boolean;
}

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

export default function EditAIIntegrationModal({ integration, onClose, onSuccess }: Props) {
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [name, setName] = useState(integration.name);
  const [config, setConfig] = useState<Record<string, any>>(integration.config);
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(integration.is_default);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadProviderConfig();
  }, []);

  async function loadProviderConfig() {
    try {
      const res = await fetch('/api/integrations/providers');
      const data = await res.json();
      const cfg = data.ai?.[integration.provider];
      if (cfg) setProviderConfig(cfg);
    } catch {
      // non-fatal: fall back to basic fields
    }
  }

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

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    if (!config.model?.trim()) {
      toast.error('Model is required');
      return;
    }

    setLoading(true);
    try {
      const body: any = { name, config, isDefault };
      if (secret) body.secret = secret;

      const res = await fetch(`/api/integrations/${integration.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update integration');
      }

      toast.success('Integration updated successfully');
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update integration');
    } finally {
      setLoading(false);
    }
  }

  // Determine which fields to render: prefer dynamic provider config, fall back to hardcoded basics
  const fields = providerConfig?.fields ?? [
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, placeholder: 'https://api.anthropic.com' },
    { key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'claude-sonnet-4-6' },
    { key: 'maxTokens', label: 'Max Tokens (optional)', type: 'number', required: false, placeholder: '4096' },
    { key: 'temperature', label: 'Temperature (optional)', type: 'number', required: false, placeholder: '0.7', help: 'Value between 0 and 1. Not supported by reasoning models.' },
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit AI Integration</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Provider</label>
            <Input value={integration.provider} disabled />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My AI Integration"
            />
          </div>

          {fields
            .filter((f) => f.key !== 'apiKey')
            .map((field) => (
              <div key={field.key}>
                <label className="text-sm font-medium mb-1.5 block">
                  {field.label}
                  {field.required && ' *'}
                </label>
                {field.type === 'select' && field.options ? (
                  <Select
                    value={config[field.key] || undefined}
                    onValueChange={(value) => setConfigValue(field.key, value)}
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
                      setConfigValue(field.key, Number.isNaN(v) ? undefined : v);
                    }}
                  />
                ) : (
                  <Input
                    type={field.type}
                    placeholder={field.placeholder}
                    value={config[field.key] || ''}
                    onChange={(e) => setConfigValue(field.key, e.target.value)}
                  />
                )}
                {field.help && (
                  <p className="text-xs text-muted-foreground mt-1">{field.help}</p>
                )}
              </div>
            ))}

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              API Key {secret ? '' : '(leave empty to keep current)'}
            </label>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter new API key to update"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            <label className="text-sm">Set as default</label>
          </div>
        </div>

        <DialogFooter>
          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading} className="flex-1">
              {loading ? 'Updating...' : 'Update'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
