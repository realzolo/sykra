'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Pencil, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { withOrgPrefix } from '@/lib/orgPath';
import { useOrgRole } from '@/lib/useOrgRole';
import { Skeleton } from '@/components/ui/skeleton';

type Rule = {
  id: string; ruleset_id: string; category: string; name: string;
  prompt: string; weight: number; severity: 'error' | 'warning' | 'info';
  is_enabled: boolean; sort_order: number;
};
type RuleSet = { id: string; name: string; description?: string; is_global: boolean; rules: Rule[] };

const CATEGORIES = ['style', 'security', 'architecture', 'performance', 'maintainability'];
const SEV_COLOR: Record<string, 'danger' | 'warning' | 'success'> = { error: 'danger', warning: 'warning', info: 'success' };
const CAT_COLOR: Record<string, 'accent' | 'danger' | 'success' | 'warning' | 'default'> = {
  style: 'accent', security: 'danger', architecture: 'success', performance: 'warning', maintainability: 'default',
};

const EMPTY_RULE = { category: 'style', name: '', prompt: '', weight: 20, severity: 'warning' as const, is_enabled: true };

export default function RuleSetDetailClient({
  ruleSetId,
  initialRuleSet,
  dict,
}: {
  ruleSetId: string;
  initialRuleSet?: RuleSet;
  dict: Dictionary;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ruleSet, setRuleSet] = useState<RuleSet | null>(initialRuleSet ?? null);
  const [rules, setRules] = useState<Rule[]>(initialRuleSet?.rules ?? []);
  const [loading, setLoading] = useState(!initialRuleSet);
  const [loadError, setLoadError] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [fCategory, setFCategory] = useState('style');
  const [fSeverity, setFSeverity] = useState<'error' | 'warning' | 'info'>('warning');
  const [fName, setFName] = useState('');
  const [fPrompt, setFPrompt] = useState('');
  const [fWeight, setFWeight] = useState(20);
  const { isAdmin } = useOrgRole();

  const CAT_ITEMS = CATEGORIES.map(c => ({ id: c, label: dict.rules.category[c as keyof typeof dict.rules.category] ?? c }));
  const SEV_ITEMS = [
    { id: 'error', label: dict.rules.severity.error },
    { id: 'warning', label: dict.rules.severity.warning },
    { id: 'info', label: dict.rules.severity.info },
  ];

  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (initialRuleSet) return;
    let active = true;
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await fetch(`/api/rules/${ruleSetId}`);
        if (!res.ok) throw new Error('ruleset_fetch_failed');
        const data = (await res.json()) as RuleSet;
        if (!active) return;
        setRuleSet(data);
        setRules(data.rules ?? []);
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
  }, [initialRuleSet, ruleSetId]);

  function openAdd() {
    if (!isAdmin) return;
    setEditRule(null);
    const r = EMPTY_RULE;
    setFCategory(r.category); setFSeverity(r.severity); setFName(r.name); setFPrompt(r.prompt); setFWeight(r.weight);
    setDialogOpen(true);
  }

  function openEdit(rule: Rule) {
    if (!isAdmin) return;
    setEditRule(rule);
    setFCategory(rule.category); setFSeverity(rule.severity); setFName(rule.name); setFPrompt(rule.prompt); setFWeight(rule.weight);
    setDialogOpen(true);
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = editRule
      ? { id: editRule.id, category: fCategory, severity: fSeverity, name: fName, prompt: fPrompt, weight: fWeight }
      : { category: fCategory, severity: fSeverity, name: fName, prompt: fPrompt, weight: fWeight };
    const res = await fetch(`/api/rules/${ruleSetId}/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { toast.error(data.error ?? dict.rules.saving); return; }
    toast.success(editRule ? dict.rules.ruleUpdated : dict.rules.ruleCreated);
    setDialogOpen(false); setEditRule(null);
    const fresh = await fetch(`/api/rules/${ruleSetId}`).then(r => r.json());
    setRuleSet(fresh);
    setRules(fresh.rules ?? []);
  }

  async function handleToggle(rule: Rule) {
    if (!isAdmin) return;
    setTogglingId(rule.id);
    const res = await fetch(`/api/rules/${ruleSetId}/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, is_enabled: !rule.is_enabled }),
    });
    setTogglingId(null);
    if (!res.ok) { toast.error(dict.projects.updateFailed); return; }
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, is_enabled: !r.is_enabled } : r));
  }

  async function handleDelete(ruleId: string) {
    if (!isAdmin) return;
    const res = await fetch(`/api/rules/${ruleSetId}/rules`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ruleId }),
    });
    if (!res.ok) { toast.error(dict.reports.deleteFailed); return; }
    toast.success(dict.rules.ruleDeleted);
    setRules(prev => prev.filter(r => r.id !== ruleId));
  }

  const grouped = CATEGORIES.reduce<Record<string, Rule[]>>((acc, cat) => {
    acc[cat] = rules.filter(r => r.category === cat);
    return acc;
  }, {});

  const enabledCount = rules.filter(r => r.is_enabled).length;

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] shrink-0">
          <div className="flex items-center gap-3 px-6 py-4 max-w-[1200px] mx-auto w-full">
            <Skeleton className="h-8 w-8 rounded-[6px]" />
            <Skeleton className="h-4 w-4 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-28 rounded-[6px]" />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`rulecat-skeleton-${index}`} className="border border-[hsl(var(--ds-border-1))] rounded-[8px] overflow-hidden">
                <div className="flex items-center gap-2 px-6 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]">
                  <Skeleton className="h-4 w-20 rounded-[4px]" />
                  <Skeleton className="h-3 w-14" />
                </div>
                {Array.from({ length: 2 }).map((_, ruleIndex) => (
                  <div key={`rule-skeleton-${index}-${ruleIndex}`} className="flex items-start gap-3 px-6 py-4 border-b border-[hsl(var(--ds-border-1))] last:border-0">
                    <Skeleton className="h-5 w-10 rounded-[4px]" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-4 w-16 rounded-[4px]" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="flex gap-1">
                      <Skeleton className="h-8 w-8 rounded-[6px]" />
                      <Skeleton className="h-8 w-8 rounded-[6px]" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!ruleSet || loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="text-[13px] text-[hsl(var(--ds-text-2))]">{dict.common.error}</div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(withOrgPrefix(pathname, '/rules'))}
        >
          {dict.common.back}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] shrink-0">
        <div className="flex items-center gap-3 px-6 py-4 max-w-[1200px] mx-auto w-full">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => router.push(withOrgPrefix(pathname, '/rules'))}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Shield className="size-4 text-[hsl(var(--ds-text-2))] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold">{ruleSet.name}</span>
              {ruleSet.is_global && <Badge size="sm" variant="accent">{dict.rules.global}</Badge>}
            </div>
            {ruleSet.description && <div className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">{ruleSet.description}</div>}
          </div>
          <span className="text-[13px] text-[hsl(var(--ds-text-2))]">
            <span className="text-success font-semibold">{enabledCount}</span>/{rules.length} {dict.rules.enabled}
          </span>
          {isAdmin && (
            <Button size="sm" onClick={openAdd} className="gap-1.5">
              <Plus className="size-4" />
              {dict.rules.addRule}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {rules.length === 0 ? (
          <div className="max-w-[1200px] mx-auto w-full flex flex-col items-start gap-3 px-6 py-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[hsl(var(--ds-surface-2))]">
              <Shield className="size-5 text-[hsl(var(--ds-text-2))]" />
            </div>
            <div>
              <h3 className="text-[13px] font-medium">{dict.rules.noRulesInSet}</h3>
              <p className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">{dict.rules.noRulesInSetDescription}</p>
            </div>
            {isAdmin && (
              <Button size="sm" onClick={openAdd} className="gap-1.5 mt-1">
                <Plus className="size-4" />{dict.rules.addRule}
              </Button>
            )}
          </div>
        ) : (
          <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-4">
            {CATEGORIES.map(cat => {
              const catRules = grouped[cat];
              if (catRules.length === 0) return null;
              const catLabel = dict.rules.category[cat as keyof typeof dict.rules.category] ?? cat;
              return (
                <div key={cat} className="border border-[hsl(var(--ds-border-1))] rounded-[8px] overflow-hidden">
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-6 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]">
                    <Badge size="sm" variant={CAT_COLOR[cat]}>{catLabel}</Badge>
                    <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.rules.rulesCount.replace('{{count}}', String(catRules.length))}</span>
                  </div>
                  {catRules.map(rule => (
                    <div key={rule.id} className={['flex items-start gap-3 px-6 py-3.5 border-b border-[hsl(var(--ds-border-1))] last:border-0 hover:bg-[hsl(var(--ds-surface-1))] transition-colors duration-100', !rule.is_enabled ? 'opacity-50' : ''].join(' ')}>
                      <Switch
                        checked={rule.is_enabled}
                        disabled={!isAdmin || togglingId === rule.id}
                        onCheckedChange={() => handleToggle(rule)}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-[13px] font-medium">{rule.name}</span>
                          <Badge size="sm" variant={SEV_COLOR[rule.severity]}>{dict.rules.severity[rule.severity]}</Badge>
                          <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.rules.weight} {rule.weight}</span>
                        </div>
                        <div className="text-[12px] text-[hsl(var(--ds-text-2))] leading-relaxed bg-[hsl(var(--ds-surface-1))] rounded-[6px] px-3 py-2 font-mono whitespace-pre-wrap">
                          {rule.prompt}
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-0.5 shrink-0">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" onClick={() => openEdit(rule)}>
                                  <Pencil className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{dict.common.edit}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" onClick={() => handleDelete(rule.id)}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{dict.common.delete}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {isAdmin && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{editRule ? dict.rules.editRule : dict.rules.addRule}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveRule} className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[12px] font-medium">{dict.rules.categoryLabel}</label>
                  <Select value={fCategory} onValueChange={(value) => setFCategory(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAT_ITEMS.map(item => (
                        <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5 w-[130px]">
                  <label className="text-[12px] font-medium">{dict.rules.severityLabel}</label>
                  <Select value={fSeverity} onValueChange={(value) => setFSeverity(value as 'error' | 'warning' | 'info')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEV_ITEMS.map(item => (
                        <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium">{dict.rules.ruleNameLabel}</label>
                <Input value={fName} onChange={e => setFName(e.target.value)} placeholder={dict.rules.ruleNamePlaceholder} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium">{dict.rules.promptLabel}</label>
                <Textarea value={fPrompt} onChange={e => setFPrompt(e.target.value)}
                  placeholder={dict.rules.promptPlaceholder} required rows={4} className="font-mono text-[13px]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium">{dict.rules.weightLabel}</label>
                <Input type="number" min={0} max={100} step={5} value={String(fWeight)}
                  onChange={e => setFWeight(Number(e.target.value))} className="w-[120px]" />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); setEditRule(null); }}>{dict.common.cancel}</Button>
                <Button type="submit" disabled={saving}>{saving ? dict.rules.saving : editRule ? dict.rules.saveChanges : dict.rules.addRule}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
