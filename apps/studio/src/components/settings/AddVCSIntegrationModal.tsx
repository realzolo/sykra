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
  }>;
  docs?: string;
}

export default function AddVCSIntegrationModal({ onClose, onSuccess }: Props) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [selectedProvider, setSelectedProvider] = useState('github');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    try {
      const res = await fetch('/api/integrations/providers');
      const data = await res.json();
      setProviders(data.vcs);
    } catch (error) {
      toast.error('Failed to load providers');
    }
  }

  const providerConfig = providers[selectedProvider];

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Please enter a name');
      return;
    }

    if (!secret.trim()) {
      toast.error('Please enter an access token');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'vcs',
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

      toast.success('VCS integration created');
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
          <DialogTitle>Add Code Repository Integration</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Provider</label>
            <Select value={selectedProvider} onValueChange={(value) => setSelectedProvider(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(providers).map(([key, value]) => (
                  <SelectItem key={key} value={key}>{value.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {providerConfig?.description && (
              <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">
                {providerConfig.description}
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Name</label>
            <Input
              placeholder="e.g., Company GitHub"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Access Token *</label>
            <Input
              type="password"
              placeholder="ghp_..."
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
                How to create a token →
              </a>
            )}
          </div>

          {providerConfig?.fields
            .filter((f) => f.key !== 'token')
            .map((field) => (
              <div key={field.key}>
                <label className="text-sm font-medium mb-1.5 block">
                  {field.label}
                  {field.required && ' *'}
                </label>
                <Input
                  type={field.type}
                  placeholder={field.placeholder}
                  value={config[field.key] || ''}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
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
              Set as default VCS integration
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
