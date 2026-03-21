'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
  }>;
  docs?: string;
}

export default function AddVCSIntegrationModal({ onClose, onSuccess }: Props) {
  const dict = useClientDictionary();
  const i18n = dict.settings.addVcsModal;
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [selectedProvider, setSelectedProvider] = useState('github');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/providers');
      const data = await res.json();
      setProviders(data.vcs);
    } catch {
      toast.error(i18n.loadProvidersFailed);
    }
  }, [i18n.loadProvidersFailed]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const providerConfig = providers[selectedProvider];

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error(i18n.nameRequired);
      return;
    }

    if (!secret.trim()) {
      toast.error(i18n.accessTokenRequired);
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

        <DialogBody className="max-h-[calc(90vh-132px)] space-y-5">
          <div>
            <label className="mb-2 block text-[12px] font-medium leading-5 text-[hsl(var(--ds-text-2))]">{i18n.provider}</label>
            <Select value={selectedProvider} onValueChange={(value) => setSelectedProvider(value)}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
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
            <label className="mb-2 block text-[12px] font-medium leading-5 text-[hsl(var(--ds-text-2))]">{i18n.name}</label>
            <Input
              className="h-10"
              placeholder={i18n.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-medium leading-5 text-[hsl(var(--ds-text-2))]">{i18n.accessTokenLabel}</label>
            <Input
              className="h-10"
              type="password"
              placeholder={i18n.accessTokenPlaceholder}
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
                {i18n.tokenDocs}
              </a>
            )}
          </div>

          {providerConfig?.fields
            .filter((f) => f.key !== 'token')
            .map((field) => (
              <div key={field.key}>
                <label className="mb-2 block text-[12px] font-medium leading-5 text-[hsl(var(--ds-text-2))]">
                  {field.label}
                  {field.required && ' *'}
                </label>
                <Input
                  className="h-10"
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

          <div className="flex items-center gap-2 pt-2">
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
