'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Plus, Shield, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { withOrgPrefix } from '@/lib/orgPath';
import { useOrgRole } from '@/lib/useOrgRole';
import { Skeleton } from '@/components/ui/skeleton';

type RuleSet = { id: string; name: string; description?: string; is_global: boolean; rules?: unknown[] };

type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  ruleCount: number;
};

export default function RulesClient({ initialRuleSets, dict }: { initialRuleSets?: RuleSet[]; dict: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>(initialRuleSets ?? []);
  const [loading, setLoading] = useState(!initialRuleSets);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const { isAdmin } = useOrgRole();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    if (initialRuleSets) return;
    let active = true;
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await fetch('/api/rules/sets');
        if (!res.ok) throw new Error('rulesets_fetch_failed');
        const data = await res.json();
        if (!active) return;
        setRuleSets(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setLoadError(true);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [initialRuleSets]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch('/api/rules/sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(dict.rules.ruleSetCreated);
    setDialogOpen(false);
    setName(''); setDescription('');
    const updated = await fetch('/api/rules/sets').then(r => r.json());
    setRuleSets(updated);
  }

  async function openTemplateDialog() {
    setTemplateDialogOpen(true);
    if (templates.length > 0) return;
    setTemplatesLoading(true);
    try {
      const res = await fetch('/api/rules/templates');
      const data = res.ok ? await res.json() : [];
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function handleImportTemplate(templateId: string) {
    setImportingId(templateId);
    try {
      const res = await fetch(`/api/rules/templates/${templateId}/import`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'import_failed');
      toast.success(dict.rules.templates.importSuccess);
      setTemplateDialogOpen(false);
      const updated = await fetch('/api/rules/sets').then(r => r.json());
      setRuleSets(updated);
      // Navigate to the newly created ruleset
      if (data.id) {
        router.push(withOrgPrefix(pathname, `/rules/${data.id}`));
      }
    } catch {
      toast.error(dict.rules.templates.importFailed);
    } finally {
      setImportingId(null);
    }
  }

  const CATEGORY_LABELS: Record<string, string> = {
    react: dict.rules.templates.category.react,
    go: dict.rules.templates.category.go,
    security: dict.rules.templates.category.security,
    python: dict.rules.templates.category.python,
    performance: dict.rules.templates.category.performance,
  };

  if (loading) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-4">
          <div className="flex items-end justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-8 w-32 rounded-[6px]" />
          </div>
          <div className="border border-[hsl(var(--ds-border-1))] rounded-[8px] overflow-hidden">
            <div className="flex items-center px-4 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] gap-4">
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-16 ml-auto" />
            </div>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`ruleset-skeleton-${index}`} className="flex items-center gap-4 px-4 py-3 border-b border-[hsl(var(--ds-border-1))] last:border-0">
                <Skeleton className="h-7 w-7 rounded-[6px]" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-5 w-14" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadError && ruleSets.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{dict.common.error}</div>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          {dict.common.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[15px] font-semibold">{dict.rules.title}</h1>
            <p className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">{dict.rules.description}</p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button onClick={openTemplateDialog} size="sm" variant="outline" className="gap-1.5 text-sm">
                <Download className="size-4" />
                {dict.rules.templates.title}
              </Button>
              <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-1.5 text-sm">
                <Plus className="size-4" />
                {dict.rules.newRuleSet}
              </Button>
            </div>
          )}
        </div>

        {ruleSets.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[hsl(var(--ds-surface-2))]">
              <Shield className="h-5 w-5 text-[hsl(var(--ds-text-2))]" />
            </div>
            <div>
              <h3 className="text-[13px] font-medium">{dict.rules.noRules}</h3>
              <p className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">{dict.rules.noRulesDescription}</p>
            </div>
            {isAdmin && (
              <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-1.5 mt-1">
                <Plus className="size-4" />{dict.rules.newRuleSet}
              </Button>
            )}
          </div>
        ) : (
          <div className="border border-[hsl(var(--ds-border-1))] rounded-[8px] overflow-hidden">
            <div className="flex items-center px-4 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] text-[12px] font-medium text-[hsl(var(--ds-text-2))] gap-4">
              <div className="w-8 shrink-0" />
              <div className="flex-1">{dict.common.name}</div>
              <div className="w-24 text-right">{dict.rules.rulesCount.replace('{{count}}', '')}</div>
              <div className="w-6 shrink-0" />
            </div>
            {ruleSets.map(rs => {
              const total = (rs.rules as unknown[])?.length ?? 0;
              const enabled = (rs.rules as { is_enabled: boolean }[])?.filter(r => r.is_enabled).length ?? 0;
              return (
                <div
                  key={rs.id}
                  className="flex items-center gap-4 px-4 py-2.5 border-b border-[hsl(var(--ds-border-1))] last:border-0 hover:bg-[hsl(var(--ds-surface-1))] transition-colors duration-100 cursor-pointer"
                  onClick={() => router.push(withOrgPrefix(pathname, `/rules/${rs.id}`))}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[hsl(var(--ds-surface-2))] shrink-0">
                    <Shield className="size-4 text-[hsl(var(--ds-text-2))]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{rs.name}</span>
                      {rs.is_global && <Badge size="sm" variant="accent">{dict.rules.global}</Badge>}
                    </div>
                    {rs.description && (
                      <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5 truncate">{rs.description}</div>
                    )}
                  </div>
                  <div className="w-24 text-right shrink-0">
                    <span className="text-[13px] font-medium text-success">{enabled}</span>
                    <span className="text-[13px] text-[hsl(var(--ds-text-2))]">/{total}</span>
                    <div className="text-[10px] text-[hsl(var(--ds-text-2))]">{dict.rules.enabled}</div>
                  </div>
                  <ChevronRight className="size-4 text-[hsl(var(--ds-text-2))] shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isAdmin && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{dict.rules.newRuleSet}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium">{dict.common.name}</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder={dict.rules.ruleSetNamePlaceholder} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium">{dict.rules.descriptionOptional}</label>
                <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={dict.rules.descriptionPlaceholder} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{dict.common.cancel}</Button>
                <Button type="submit" disabled={creating}>{creating ? dict.rules.creating : dict.rules.create}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Template marketplace dialog */}
      {isAdmin && (
        <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{dict.rules.templates.title}</DialogTitle>
              <p className="text-[13px] text-[hsl(var(--ds-text-2))] mt-1">{dict.rules.templates.description}</p>
            </DialogHeader>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {templatesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] p-4">
                    <Skeleton className="h-4 w-48 mb-2" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                ))
              ) : templates.map(t => (
                <div
                  key={t.id}
                  className="flex items-start justify-between gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{t.name}</span>
                      <Badge size="sm" variant="secondary">
                        {CATEGORY_LABELS[t.category] ?? t.category}
                      </Badge>
                    </div>
                    <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">{t.description}</div>
                    <div className="text-[11px] text-[hsl(var(--ds-text-2))] mt-1">{t.ruleCount} rules</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleImportTemplate(t.id)}
                    disabled={importingId === t.id}
                    className="shrink-0"
                  >
                    {importingId === t.id ? dict.rules.templates.importing : dict.rules.templates.import}
                  </Button>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setTemplateDialogOpen(false)}>{dict.common.close}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
