'use client';

import { useState } from 'react';
import { Modal, Button, Input, Switch } from '@heroui/react';
import { useOverlayState } from '@heroui/react';
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

export default function EditAIIntegrationModal({ integration, onClose, onSuccess }: Props) {
  const [name, setName] = useState(integration.name);
  const [config, setConfig] = useState<Record<string, any>>(integration.config);
  const [secret, setSecret] = useState('');
  const [isDefault, setIsDefault] = useState(integration.is_default);
  const [loading, setLoading] = useState(false);

  const modalState = useOverlayState({
    isOpen: true,
    onOpenChange: (isOpen) => {
      if (!isOpen) onClose();
    },
  });

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
      if (secret) {
        body.secret = secret;
      }

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

  return (
    <Modal state={modalState}>
      <Modal.Backdrop isDismissable={!loading}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Edit AI Integration</Modal.Heading>
            </Modal.Header>

            <Modal.Body>
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
                    placeholder="My Claude API"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Base URL</label>
                  <Input
                    value={config.baseUrl || ''}
                    onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                    placeholder="https://api.anthropic.com"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Model</label>
                  <Input
                    value={config.model || ''}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    placeholder="claude-3-5-sonnet-20241022"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Max Tokens (optional)</label>
                  <Input
                    type="number"
                    value={config.maxTokens || ''}
                    onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) || undefined })}
                    placeholder="4096"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Temperature (optional)</label>
                  <Input
                    type="number"
                    step="0.1"
                    value={config.temperature || ''}
                    onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) || undefined })}
                    placeholder="0.7"
                  />
                </div>

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
                  <Switch isSelected={isDefault} onChange={setIsDefault} />
                  <label className="text-sm">Set as default</label>
                </div>
              </div>
            </Modal.Body>

            <Modal.Footer>
              <div className="flex gap-2 w-full">
                <Button variant="outline" onClick={onClose} isDisabled={loading} className="flex-1">
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleSubmit} isDisabled={loading} className="flex-1">
                  {loading ? 'Updating...' : 'Update'}
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
