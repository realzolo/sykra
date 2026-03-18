'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useClientDictionary } from '@/i18n/client';

interface Integration {
  id: string;
  name: string;
  provider: string;
  config: Record<string, unknown>;
  is_default: boolean;
}

interface Props {
  integration: Integration;
  onClose: () => void;
  onSuccess: () => void;
}

interface FieldDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export default function EditVCSIntegrationModal({ integration, onClose, onSuccess }: Props) {
  const dict = useClientDictionary();
  const i18n = dict.settings.editVcsModal;
  const defaultProviderFields = useMemo<Record<string, FieldDef[]>>(
    () => ({
      github: [
        {
          key: 'baseUrl',
          label: i18n.baseUrlEnterprise,
          type: 'text',
          required: false,
          placeholder: 'https://github.company.com/api/v3',
          help: i18n.baseUrlEnterpriseHelp,
        },
        { key: 'org', label: i18n.defaultOrganization, type: 'text', required: false, placeholder: 'my-org' },
      ],
      gitlab: [
        { key: 'baseUrl', label: i18n.baseUrl, type: 'text', required: true, placeholder: 'https://gitlab.com' },
        { key: 'org', label: i18n.defaultGroup, type: 'text', required: false, placeholder: 'my-group' },
      ],
      git: [
        { key: 'baseUrl', label: i18n.baseUrl, type: 'text', required: true, placeholder: 'https://git.company.com' },
      ],
    }),
    [i18n],
  );
  const [fields, setFields] = useState<FieldDef[]>(defaultProviderFields[integration.provider] ?? []);
  const [name, setName] = useState(integration.name);
  const [config, setConfig] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(integration.config).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : value == null ? '' : String(value),
      ])
    )
  );
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(integration.is_default);
  const [loading, setLoading] = useState(false);

  const loadProviderFields = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/providers');
      const data = await res.json();
      const providerCfg = data.vcs?.[integration.provider];
      if (providerCfg?.fields) {
        // Exclude the token field — handled separately as the secret input
        setFields(providerCfg.fields.filter((f: FieldDef) => f.key !== 'token'));
      }
    } catch {
      // Keep current field definitions.
    }
  }, [integration.provider]);

  useEffect(() => {
    setFields(defaultProviderFields[integration.provider] ?? []);
    void loadProviderFields();
  }, [defaultProviderFields, integration.provider, loadProviderFields]);

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error(i18n.nameRequired);
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

          {fields.map((field) => (
            <div key={field.key}>
              <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 block">
                {field.label}
                {field.required && ' *'}
              </label>
              <Input
                className="h-9"
                type={field.type}
                placeholder={field.placeholder}
                value={config[field.key] || ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
              {field.help && (
                <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-1">{field.help}</p>
              )}
            </div>
          ))}

          <div>
            <label className="text-[12px] font-medium text-[hsl(var(--ds-text-2))] mb-1.5 block">
              {secret ? i18n.accessTokenLabel : i18n.accessTokenLabelWithHint}
            </label>
            <Input
              className="h-9"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={i18n.accessTokenPlaceholder}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Switch id="isDefault-edit-vcs" checked={isDefault} onCheckedChange={setIsDefault} />
            <label htmlFor="isDefault-edit-vcs" className="text-[13px]">{i18n.setDefault}</label>
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
