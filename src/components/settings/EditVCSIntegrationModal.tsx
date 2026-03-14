'use client';

import { useState, useEffect } from 'react';
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

export default function EditVCSIntegrationModal({ integration, onClose, onSuccess }: Props) {
  const [name, setName] = useState(integration.name);
  const [config, setConfig] = useState<Record<string, string>>(integration.config);
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
              <Modal.Heading>Edit VCS Integration</Modal.Heading>
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
                    placeholder="My GitHub"
                  />
                </div>

                {integration.provider === 'github' && (
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Base URL (optional)</label>
                    <Input
                      value={config.baseUrl || ''}
                      onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                      placeholder="https://api.github.com"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Leave empty for GitHub.com, or use GitHub Enterprise URL
                    </p>
                  </div>
                )}

                {integration.provider === 'gitlab' && (
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Base URL</label>
                    <Input
                      value={config.baseUrl || ''}
                      onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                      placeholder="https://gitlab.com"
                    />
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Access Token {secret ? '' : '(leave empty to keep current)'}
                  </label>
                  <Input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="Enter new token to update"
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
