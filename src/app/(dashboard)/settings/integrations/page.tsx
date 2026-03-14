'use client';

import { useState, useEffect } from 'react';
import { Button, Card, Chip } from '@heroui/react';
import { Plus, Settings, Trash2, Check, X, Edit } from 'lucide-react';
import { toast } from 'sonner';
import AddVCSIntegrationModal from '@/components/settings/AddVCSIntegrationModal';
import AddAIIntegrationModal from '@/components/settings/AddAIIntegrationModal';
import EditVCSIntegrationModal from '@/components/settings/EditVCSIntegrationModal';
import EditAIIntegrationModal from '@/components/settings/EditAIIntegrationModal';

interface Integration {
  id: string;
  type: 'vcs' | 'ai';
  provider: string;
  name: string;
  is_default: boolean;
  config: Record<string, any>;
  created_at: string;
}

export default function IntegrationsPage() {
  const [vcsIntegrations, setVcsIntegrations] = useState<Integration[]>([]);
  const [aiIntegrations, setAiIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [showVCSModal, setShowVCSModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [editingVCS, setEditingVCS] = useState<Integration | null>(null);
  const [editingAI, setEditingAI] = useState<Integration | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    loadIntegrations();
  }, []);

  async function loadIntegrations() {
    try {
      const [vcsRes, aiRes] = await Promise.all([
        fetch('/api/integrations?type=vcs'),
        fetch('/api/integrations?type=ai'),
      ]);

      if (vcsRes.ok) {
        setVcsIntegrations(await vcsRes.json());
      }
      if (aiRes.ok) {
        setAiIntegrations(await aiRes.json());
      }
    } catch (error) {
      toast.error('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, type: 'vcs' | 'ai') {
    if (!confirm('Are you sure you want to delete this integration?')) return;

    try {
      const res = await fetch(`/api/integrations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }

      toast.success('Integration deleted');
      if (type === 'vcs') {
        setVcsIntegrations((prev) => prev.filter((i) => i.id !== id));
      } else {
        setAiIntegrations((prev) => prev.filter((i) => i.id !== id));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete integration');
    }
  }

  async function handleSetDefault(id: string, type: 'vcs' | 'ai') {
    try {
      const res = await fetch(`/api/integrations/${id}/set-default`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to set default');

      toast.success('Default integration updated');
      await loadIntegrations();
    } catch (error) {
      toast.error('Failed to set default integration');
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const res = await fetch(`/api/integrations/${id}/test`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        toast.success('Connection test successful');
      } else {
        toast.error(data.error || 'Connection test failed');
      }
    } catch (error) {
      toast.error('Connection test failed');
    } finally {
      setTestingId(null);
    }
  }

  function renderIntegrationCard(integration: Integration, type: 'vcs' | 'ai') {
    return (
      <Card key={integration.id} className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-medium">{integration.name}</h3>
              {integration.is_default && (
                <Chip size="sm" color="accent" variant="soft">
                  Default
                </Chip>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Provider: {integration.provider}
            </p>
            {integration.config.baseUrl && (
              <p className="text-xs text-muted-foreground">
                URL: {integration.config.baseUrl}
              </p>
            )}
            {integration.config.model && (
              <p className="text-xs text-muted-foreground">
                Model: {integration.config.model}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleTest(integration.id)}
              isDisabled={testingId === integration.id}
            >
              {testingId === integration.id ? 'Testing...' : 'Test'}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (type === 'vcs') {
                  setEditingVCS(integration);
                } else {
                  setEditingAI(integration);
                }
              }}
            >
              <Edit className="size-4" />
            </Button>

            {!integration.is_default && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleSetDefault(integration.id, type)}
              >
                Set Default
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleDelete(integration.id, type)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your code repository and AI model integrations
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl space-y-8">
          {/* VCS Integrations */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold">Code Repositories</h2>
                <p className="text-sm text-muted-foreground">
                  Connect to GitHub, GitLab, or other Git services
                </p>
              </div>
              <Button size="sm" onClick={() => setShowVCSModal(true)} className="gap-1.5">
                <Plus className="size-4" />
                Add Repository
              </Button>
            </div>

            {vcsIntegrations.length === 0 ? (
              <Card className="p-6">
                <p className="text-sm text-muted-foreground text-center">
                  No repository integrations configured. Add one to get started.
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {vcsIntegrations.map((integration) =>
                  renderIntegrationCard(integration, 'vcs')
                )}
              </div>
            )}
          </div>

          {/* AI Integrations */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold">AI Models</h2>
                <p className="text-sm text-muted-foreground">
                  Connect to Claude, GPT-4, or other AI services
                </p>
              </div>
              <Button size="sm" onClick={() => setShowAIModal(true)} className="gap-1.5">
                <Plus className="size-4" />
                Add AI Model
              </Button>
            </div>

            {aiIntegrations.length === 0 ? (
              <Card className="p-6">
                <p className="text-sm text-muted-foreground text-center">
                  No AI integrations configured. Add one to enable code analysis.
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {aiIntegrations.map((integration) => renderIntegrationCard(integration, 'ai'))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showVCSModal && (
        <AddVCSIntegrationModal
          onClose={() => setShowVCSModal(false)}
          onSuccess={() => {
            setShowVCSModal(false);
            loadIntegrations();
          }}
        />
      )}

      {showAIModal && (
        <AddAIIntegrationModal
          onClose={() => setShowAIModal(false)}
          onSuccess={() => {
            setShowAIModal(false);
            loadIntegrations();
          }}
        />
      )}

      {editingVCS && (
        <EditVCSIntegrationModal
          integration={editingVCS}
          onClose={() => setEditingVCS(null)}
          onSuccess={() => {
            setEditingVCS(null);
            loadIntegrations();
          }}
        />
      )}

      {editingAI && (
        <EditAIIntegrationModal
          integration={editingAI}
          onClose={() => setEditingAI(null)}
          onSuccess={() => {
            setEditingAI(null);
            loadIntegrations();
          }}
        />
      )}
    </div>
  );
}
