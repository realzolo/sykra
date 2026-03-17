'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Settings, Trash2, Check, X, Edit } from 'lucide-react';
import { toast } from 'sonner';
import AddVCSIntegrationModal from '@/components/settings/AddVCSIntegrationModal';
import AddAIIntegrationModal from '@/components/settings/AddAIIntegrationModal';
import EditVCSIntegrationModal from '@/components/settings/EditVCSIntegrationModal';
import EditAIIntegrationModal from '@/components/settings/EditAIIntegrationModal';
import SettingsNav from '@/components/settings/SettingsNav';
import { useOrgRole } from '@/lib/useOrgRole';

interface Integration {
  id: string;
  type: 'vcs' | 'ai';
  provider: string;
  name: string;
  is_default: boolean;
  config: Record<string, any>;
  created_at: string;
}

function IntegrationsSkeleton() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl px-6 py-6">
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`settings-nav-skeleton-${index}`} className="h-4 w-28" />
            ))}
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-64" />
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-8 w-28 rounded-[6px]" />
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={`vcs-card-skeleton-${index}`} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-12 rounded-[4px]" />
                      </div>
                      <Skeleton className="h-3 w-40" />
                      <Skeleton className="h-3 w-56" />
                      <div className="flex gap-2">
                        <Skeleton className="h-7 w-16 rounded-[6px]" />
                        <Skeleton className="h-7 w-7 rounded-[6px]" />
                        <Skeleton className="h-7 w-20 rounded-[6px]" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-52" />
                  </div>
                  <Skeleton className="h-8 w-28 rounded-[6px]" />
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <div key={`ai-card-skeleton-${index}`} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-4 w-12 rounded-[4px]" />
                      </div>
                      <Skeleton className="h-3 w-36" />
                      <Skeleton className="h-3 w-44" />
                      <div className="flex gap-2">
                        <Skeleton className="h-7 w-16 rounded-[6px]" />
                        <Skeleton className="h-7 w-7 rounded-[6px]" />
                        <Skeleton className="h-7 w-20 rounded-[6px]" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
  const { isAdmin } = useOrgRole();

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
      <Card key={integration.id}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-[13px] font-medium">{integration.name}</h3>
                {integration.is_default && (
                  <Badge size="sm" variant="accent">
                    Default
                  </Badge>
                )}
              </div>
              <p className="text-[12px] text-[hsl(var(--ds-text-2))] mb-2">
                Provider: {integration.provider}
              </p>
              {integration.config.baseUrl && (
                <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                  URL: {integration.config.baseUrl}
                </p>
              )}
              {integration.config.model && (
                <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                  Model: {integration.config.model}
                </p>
              )}
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleTest(integration.id)}
                  disabled={testingId === integration.id}
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
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return <IntegrationsSkeleton />;
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl px-6 py-6">
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <SettingsNav />

          <div className="space-y-6">
            <div>
              <h1 className="text-[15px] font-semibold">Integrations</h1>
              <p className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">
                Manage your code repository and AI model integrations
              </p>
            </div>

            <div className="space-y-8">
              {/* VCS Integrations */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-[13px] font-semibold">Code Repositories</h2>
                    <p className="text-[13px] text-[hsl(var(--ds-text-2))]">
                      Connect to GitHub, GitLab, or other Git services
                    </p>
                  </div>
                  {isAdmin && (
                    <Button size="sm" onClick={() => setShowVCSModal(true)} className="gap-1.5">
                      <Plus className="size-4" />
                      Add Repository
                    </Button>
                  )}
                </div>

                {vcsIntegrations.length === 0 ? (
                  <Card>
                    <CardContent className="p-6">
                      <p className="text-[13px] text-[hsl(var(--ds-text-2))] text-center">
                        No repository integrations configured. Add one to get started.
                      </p>
                    </CardContent>
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
                    <h2 className="text-[13px] font-semibold">AI Models</h2>
                    <p className="text-[13px] text-[hsl(var(--ds-text-2))]">
                      Connect to Claude, GPT-4, or other AI services
                    </p>
                  </div>
                  {isAdmin && (
                    <Button size="sm" onClick={() => setShowAIModal(true)} className="gap-1.5">
                      <Plus className="size-4" />
                      Add AI Model
                    </Button>
                  )}
                </div>

                {aiIntegrations.length === 0 ? (
                  <Card>
                    <CardContent className="p-6">
                      <p className="text-[13px] text-[hsl(var(--ds-text-2))] text-center">
                        No AI integrations configured. Add one to enable code analysis.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {aiIntegrations.map((integration) => renderIntegrationCard(integration, 'ai'))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {isAdmin && showVCSModal && (
        <AddVCSIntegrationModal
          onClose={() => setShowVCSModal(false)}
          onSuccess={() => {
            setShowVCSModal(false);
            loadIntegrations();
          }}
        />
      )}

      {isAdmin && showAIModal && (
        <AddAIIntegrationModal
          onClose={() => setShowAIModal(false)}
          onSuccess={() => {
            setShowAIModal(false);
            loadIntegrations();
          }}
        />
      )}

      {isAdmin && editingVCS && (
        <EditVCSIntegrationModal
          integration={editingVCS}
          onClose={() => setEditingVCS(null)}
          onSuccess={() => {
            setEditingVCS(null);
            loadIntegrations();
          }}
        />
      )}

      {isAdmin && editingAI && (
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
