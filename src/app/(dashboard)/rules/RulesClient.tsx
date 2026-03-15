'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Shield, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';

type RuleSet = { id: string; name: string; description?: string; is_global: boolean; rules?: unknown[] };

export default function RulesClient({ initialRuleSets, dict }: { initialRuleSets?: RuleSet[]; dict: Dictionary }) {
  const router = useRouter();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>(initialRuleSets ?? []);
  const [loading, setLoading] = useState(!initialRuleSets);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);

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

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="text-sm text-muted-foreground">{dict.common.loading}</div>
      </div>
    );
  }

  if (loadError && ruleSets.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="text-sm text-muted-foreground">{dict.common.error}</div>
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
            <h1 className="text-lg font-semibold">{dict.rules.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{dict.rules.description}</p>
          </div>
          <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-1.5">
            <Plus className="size-4" />
            {dict.rules.newRuleSet}
          </Button>
        </div>

        {ruleSets.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Shield className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-medium">{dict.rules.noRules}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{dict.rules.noRulesDescription}</p>
            </div>
            <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-1.5 mt-1">
              <Plus className="size-4" />{dict.rules.newRuleSet}
            </Button>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <div className="flex items-center px-4 py-2 border-b border-border bg-muted/60 text-[11px] font-medium text-muted-foreground gap-4">
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
                  className="flex items-center gap-4 px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/30 transition-soft cursor-pointer"
                  onClick={() => router.push(`/rules/${rs.id}`)}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
                    <Shield className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{rs.name}</span>
                      {rs.is_global && <Badge size="sm" variant="accent">{dict.rules.global}</Badge>}
                    </div>
                    {rs.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{rs.description}</div>
                    )}
                  </div>
                  <div className="w-24 text-right shrink-0">
                    <span className="text-sm font-medium text-success">{enabled}</span>
                    <span className="text-sm text-muted-foreground">/{total}</span>
                    <div className="text-[10px] text-muted-foreground">{dict.rules.enabled}</div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dict.rules.newRuleSet}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">{dict.common.name}</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={dict.rules.ruleSetNamePlaceholder} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">{dict.rules.descriptionOptional}</label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={dict.rules.descriptionPlaceholder} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{dict.common.cancel}</Button>
              <Button type="submit" disabled={creating}>{creating ? dict.rules.creating : dict.rules.create}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
