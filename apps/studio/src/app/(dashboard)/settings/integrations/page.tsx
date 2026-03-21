'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Bot, Check, Edit, Plug, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import AddVCSIntegrationModal from '@/components/settings/AddVCSIntegrationModal';
import AddAIIntegrationModal from '@/components/settings/AddAIIntegrationModal';
import EditVCSIntegrationModal from '@/components/settings/EditVCSIntegrationModal';
import EditAIIntegrationModal from '@/components/settings/EditAIIntegrationModal';
import SettingsPageShell from '@/components/settings/SettingsPageShell';
import SettingsEmptyState from '@/components/settings/SettingsEmptyState';
import SettingsNotice from '@/components/settings/SettingsNotice';
import SettingsSection from '@/components/settings/SettingsSection';
import { useOrgRole } from '@/lib/useOrgRole';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { useClientDictionary } from '@/i18n/client';
import { getOutputLanguageLabel } from '@/lib/outputLanguage';

interface Integration {
  id: string;
  type: 'vcs' | 'ai';
  provider: string;
  name: string;
  is_default: boolean;
  config: { baseUrl?: string; model?: string; outputLanguage?: string } & Record<string, unknown>;
  created_at: string;
}

type PageNotice = {
  variant: 'success' | 'warning' | 'info';
  title: string;
  description?: string;
  icon?: ReactNode;
};

function IntegrationsSkeleton({ title, description }: { title: string; description: string }) {
  return (
    <SettingsPageShell title={title} description={description}>
      <div className="space-y-6">
        <div className="space-y-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-8 w-28 rounded-[6px]" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`vcs-card-skeleton-${index}`}
                className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4 space-y-3"
              >
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

        <div className="space-y-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-52" />
            </div>
            <Skeleton className="h-8 w-28 rounded-[6px]" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={`ai-card-skeleton-${index}`}
                className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4 space-y-3"
              >
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
    </SettingsPageShell>
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
  const [deletingIntegration, setDeletingIntegration] = useState<Integration | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const { isAdmin } = useOrgRole();
  const dict = useClientDictionary();
  const i18n = dict.settings.integrationsPage;

  const loadIntegrations = useCallback(async () => {
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
    } catch {
      toast.error(i18n.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [i18n.loadFailed]);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  async function handleDelete(integration: Integration) {
    const type = integration.type;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/integrations/${integration.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || i18n.deleteFailed);
      }

      setNotice({
        variant: 'warning',
        title: i18n.deleteSuccess,
        description: i18n.deleteSuccessRebindHint,
        icon: <AlertTriangle className="size-4" />,
      });
      if (type === 'vcs') {
        setVcsIntegrations((prev) => prev.filter((item) => item.id !== integration.id));
      } else {
        setAiIntegrations((prev) => prev.filter((item) => item.id !== integration.id));
      }
      setDeletingIntegration(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.deleteFailed);
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/integrations/${id}/set-default`, { method: 'POST' });
      if (!res.ok) throw new Error(i18n.defaultFailed);

      setNotice({
        variant: 'success',
        title: i18n.defaultUpdated,
        icon: <Check className="size-4" />,
      });
      await loadIntegrations();
    } catch {
      toast.error(i18n.defaultFailed);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const res = await fetch(`/api/integrations/${id}/test`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        const observedModel = data.details?.observedModel as string | undefined;
        const expectedModel = data.details?.expectedModel as string | undefined;
        const warnings = Array.isArray(data.details?.warnings)
          ? (data.details.warnings as string[])
          : [];
        if (observedModel && expectedModel) {
          const nextNotice: PageNotice = {
            variant: warnings.length > 0 ? 'warning' : 'success',
            title: warnings.length > 0 ? i18n.testWarning : i18n.testSuccess,
            icon: warnings.length > 0 ? <AlertTriangle className="size-4" /> : <Check className="size-4" />,
            description: `${expectedModel} -> ${observedModel}`,
          };
          setNotice(nextNotice);
        } else {
          const nextNotice: PageNotice = {
            variant: warnings.length > 0 ? 'warning' : 'success',
            title: warnings.length > 0 ? i18n.testWarning : i18n.testSuccess,
            icon: warnings.length > 0 ? <AlertTriangle className="size-4" /> : <Check className="size-4" />,
          };
          if (warnings.length > 0) {
            nextNotice.description = warnings.join(' | ');
          }
          setNotice(nextNotice);
        }
        if (warnings.length > 0 && observedModel && expectedModel) {
          setNotice({
            variant: 'warning',
            title: i18n.testWarning,
            description: warnings.join(' | '),
            icon: <AlertTriangle className="size-4" />,
          });
        }
      } else {
        toast.error(data.error || i18n.testFailed);
      }
    } catch {
      toast.error(i18n.testFailed);
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
                    {i18n.defaultBadge}
                  </Badge>
                )}
              </div>
              <p className="text-[12px] text-[hsl(var(--ds-text-2))] mb-2">
                {i18n.providerLabel}: {integration.provider}
              </p>
              {integration.config.baseUrl && (
                <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                  {i18n.urlLabel}: {integration.config.baseUrl}
                </p>
              )}
              {integration.config.model && (
                <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                  {i18n.modelLabel}: {integration.config.model}
                </p>
              )}
              {integration.config.outputLanguage && (
                <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                  {i18n.outputLanguageLabel}: {getOutputLanguageLabel(integration.config.outputLanguage)}
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
                  {testingId === integration.id ? i18n.testing : i18n.test}
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
                  aria-label={dict.common.edit}
                >
                  <Edit className="size-4" />
                </Button>

                {!integration.is_default && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSetDefault(integration.id)}
                  >
                    {i18n.setDefault}
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeletingIntegration(integration)}
                  aria-label={dict.common.delete}
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
    return <IntegrationsSkeleton title={i18n.title} description={i18n.description} />;
  }

  return (
    <SettingsPageShell title={i18n.title} description={i18n.description}>
      <div className="space-y-6">
        {notice && (
          <SettingsNotice
            variant={notice.variant}
            title={notice.title}
            icon={notice.icon}
            {...(notice.description ? { description: notice.description } : {})}
          />
        )}

        <SettingsSection
          title={i18n.repositoriesTitle}
          description={i18n.repositoriesDescription}
          action={
            isAdmin ? (
              <Button size="sm" onClick={() => setShowVCSModal(true)} className="gap-1.5">
                <Plus className="size-4" />
                {i18n.addRepository}
              </Button>
            ) : undefined
          }
        >
          {vcsIntegrations.length === 0 ? (
            <SettingsEmptyState
              title={i18n.noRepositories}
              description={i18n.repositoriesEmptyDescription}
              icon={<Plug className="size-4" />}
              action={isAdmin ? (
                <Button size="sm" onClick={() => setShowVCSModal(true)} className="gap-1.5">
                  <Plus className="size-4" />
                  {i18n.addRepository}
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="space-y-2">
              {vcsIntegrations.map((integration) =>
                renderIntegrationCard(integration, 'vcs')
              )}
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          title={i18n.aiModelsTitle}
          description={i18n.aiModelsDescription}
          action={
            isAdmin ? (
              <Button size="sm" onClick={() => setShowAIModal(true)} className="gap-1.5">
                <Plus className="size-4" />
                {i18n.addAiModel}
              </Button>
            ) : undefined
          }
        >
          {aiIntegrations.length === 0 ? (
            <SettingsEmptyState
              title={i18n.noAiModels}
              description={i18n.aiModelsEmptyDescription}
              icon={<Bot className="size-4" />}
              action={isAdmin ? (
                <Button size="sm" onClick={() => setShowAIModal(true)} className="gap-1.5">
                  <Plus className="size-4" />
                  {i18n.addAiModel}
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="space-y-2">
              {aiIntegrations.map((integration) => renderIntegrationCard(integration, 'ai'))}
            </div>
          )}
        </SettingsSection>
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

      <ConfirmDialog
        open={deletingIntegration !== null}
        onOpenChange={(open) => {
          if (!open && !deleteLoading) setDeletingIntegration(null);
        }}
        icon={<AlertTriangle className="size-4 text-warning" />}
        title={i18n.deleteDialogTitle}
        description={i18n.deleteDialogDescription.replace('{{name}}', deletingIntegration?.name ?? '')}
        confirmLabel={deleteLoading ? i18n.deleting : i18n.deleteAction}
        cancelLabel={dict.common.cancel}
        onConfirm={() => {
          if (!deletingIntegration || deleteLoading) return;
          void handleDelete(deletingIntegration);
        }}
        loading={deleteLoading}
        danger
      />
    </SettingsPageShell>
  );
}
