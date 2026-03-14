'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Pencil, Shield } from 'lucide-react';
import { Button, Input, TextArea, Select, ListBox, Switch, Modal, useOverlayState, Tooltip, Chip } from '@heroui/react';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';

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

export default function RuleSetDetailClient({ initialRuleSet, dict }: { initialRuleSet: RuleSet; dict: Dictionary }) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRuleSet.rules ?? []);
  const [showAdd, setShowAdd] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [fCategory, setFCategory] = useState('style');
  const [fSeverity, setFSeverity] = useState<'error' | 'warning' | 'info'>('warning');
  const [fName, setFName] = useState('');
  const [fPrompt, setFPrompt] = useState('');
  const [fWeight, setFWeight] = useState(20);

  const CAT_ITEMS = CATEGORIES.map(c => ({ id: c, label: dict.rules.category[c as keyof typeof dict.rules.category] ?? c }));
  const SEV_ITEMS = [
    { id: 'error', label: dict.rules.severity.error },
    { id: 'warning', label: dict.rules.severity.warning },
    { id: 'info', label: dict.rules.severity.info },
  ];

  const modalState = useOverlayState({
    isOpen: showAdd,
    onOpenChange: (v) => { if (!v) { setShowAdd(false); setEditRule(null); } },
  });

  function openAdd() {
    setEditRule(null);
    const r = EMPTY_RULE;
    setFCategory(r.category); setFSeverity(r.severity); setFName(r.name); setFPrompt(r.prompt); setFWeight(r.weight);
    setShowAdd(true);
  }

  function openEdit(rule: Rule) {
    setEditRule(rule);
    setFCategory(rule.category); setFSeverity(rule.severity); setFName(rule.name); setFPrompt(rule.prompt); setFWeight(rule.weight);
    setShowAdd(true);
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = editRule
      ? { id: editRule.id, category: fCategory, severity: fSeverity, name: fName, prompt: fPrompt, weight: fWeight }
      : { category: fCategory, severity: fSeverity, name: fName, prompt: fPrompt, weight: fWeight };
    const res = await fetch(`/api/rules/${initialRuleSet.id}/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { toast.error(data.error ?? dict.rules.saving); return; }
    toast.success(editRule ? dict.rules.ruleUpdated : dict.rules.ruleCreated);
    setShowAdd(false); setEditRule(null);
    const fresh = await fetch(`/api/rules/${initialRuleSet.id}`).then(r => r.json());
    setRules(fresh.rules ?? []);
  }

  async function handleToggle(rule: Rule) {
    setTogglingId(rule.id);
    const res = await fetch(`/api/rules/${initialRuleSet.id}/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, is_enabled: !rule.is_enabled }),
    });
    setTogglingId(null);
    if (!res.ok) { toast.error(dict.projects.updateFailed); return; }
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, is_enabled: !r.is_enabled } : r));
  }

  async function handleDelete(ruleId: string) {
    const res = await fetch(`/api/rules/${initialRuleSet.id}/rules`, {
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3 px-6 py-4 max-w-[1200px] mx-auto w-full">
          <Button isIconOnly variant="ghost" size="sm" onPress={() => router.push('/rules')}>
            <ArrowLeft className="size-4" />
          </Button>
          <Shield className="size-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">{initialRuleSet.name}</span>
              {initialRuleSet.is_global && <Chip size="sm" variant="soft" color="accent">{dict.rules.global}</Chip>}
            </div>
            {initialRuleSet.description && <div className="text-xs text-muted-foreground mt-0.5">{initialRuleSet.description}</div>}
          </div>
          <span className="text-sm text-muted-foreground">
            <span className="text-success font-semibold">{enabledCount}</span>/{rules.length} {dict.rules.enabled}
          </span>
          <Button size="sm" onPress={openAdd} className="gap-1.5">
            <Plus className="size-4" />
            {dict.rules.addRule}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {rules.length === 0 ? (
          <div className="max-w-[1200px] mx-auto w-full flex flex-col items-start gap-3 px-6 py-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Shield className="size-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-medium">{dict.rules.noRulesInSet}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{dict.rules.noRulesInSetDescription}</p>
            </div>
            <Button size="sm" onPress={openAdd} className="gap-1.5 mt-1">
              <Plus className="size-4" />{dict.rules.addRule}
            </Button>
          </div>
        ) : (
          <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-4">
            {CATEGORIES.map(cat => {
              const catRules = grouped[cat];
              if (catRules.length === 0) return null;
              const catLabel = dict.rules.category[cat as keyof typeof dict.rules.category] ?? cat;
              return (
                <div key={cat} className="border border-border rounded-lg overflow-hidden bg-card">
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-6 py-2 border-b border-border bg-muted/40">
                    <Chip size="sm" color={CAT_COLOR[cat]} variant="soft">{catLabel}</Chip>
                    <span className="text-xs text-muted-foreground">{dict.rules.rulesCount.replace('{{count}}', String(catRules.length))}</span>
                  </div>
                  {catRules.map(rule => (
                    <div key={rule.id} className={['flex items-start gap-3 px-6 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 transition-colors', !rule.is_enabled ? 'opacity-50' : ''].join(' ')}>
                      <Switch
                        isSelected={rule.is_enabled}
                        isDisabled={togglingId === rule.id}
                        onChange={() => handleToggle(rule)}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-sm font-medium">{rule.name}</span>
                          <Chip size="sm" color={SEV_COLOR[rule.severity]} variant="soft">{dict.rules.severity[rule.severity]}</Chip>
                          <span className="text-xs text-muted-foreground">{dict.rules.weight} {rule.weight}</span>
                        </div>
                        <div className="text-xs text-muted-foreground leading-relaxed bg-muted rounded px-3 py-2 font-mono whitespace-pre-wrap">
                          {rule.prompt}
                        </div>
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        <Tooltip>
                          <Tooltip.Trigger>
                            <Button isIconOnly variant="ghost" size="sm" onPress={() => openEdit(rule)}>
                              <Pencil className="size-3.5" />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>{dict.common.edit}</Tooltip.Content>
                        </Tooltip>
                        <Tooltip>
                          <Tooltip.Trigger>
                            <Button isIconOnly variant="ghost" size="sm" onPress={() => handleDelete(rule.id)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>{dict.common.delete}</Tooltip.Content>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal state={modalState}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{editRule ? dict.rules.editRule : dict.rules.addRule}</Modal.Heading>
              </Modal.Header>
              <form onSubmit={handleSaveRule}>
                <Modal.Body className="flex flex-col gap-4">
                  <div className="flex gap-3">
                    <div className="flex flex-col gap-1.5 flex-1">
                      <label className="text-sm font-medium">{dict.rules.categoryLabel}</label>
                      <Select selectedKey={fCategory} onSelectionChange={(key) => setFCategory(key as string)}>
                        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                        <Select.Popover>
                          <ListBox items={CAT_ITEMS}>
                            {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5 w-[130px]">
                      <label className="text-sm font-medium">{dict.rules.severityLabel}</label>
                      <Select selectedKey={fSeverity} onSelectionChange={(key) => setFSeverity(key as 'error' | 'warning' | 'info')}>
                        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                        <Select.Popover>
                          <ListBox items={SEV_ITEMS}>
                            {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">{dict.rules.ruleNameLabel}</label>
                    <Input value={fName} onChange={e => setFName(e.target.value)} placeholder={dict.rules.ruleNamePlaceholder} required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">{dict.rules.promptLabel}</label>
                    <TextArea value={fPrompt} onChange={e => setFPrompt(e.target.value)}
                      placeholder={dict.rules.promptPlaceholder} required rows={4} className="font-mono text-sm" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">{dict.rules.weightLabel}</label>
                    <Input type="number" min={0} max={100} step={5} value={String(fWeight)}
                      onChange={e => setFWeight(Number(e.target.value))} className="w-[120px]" />
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button type="button" variant="outline" onPress={() => { setShowAdd(false); setEditRule(null); }}>{dict.common.cancel}</Button>
                  <Button type="submit" isDisabled={saving}>{saving ? dict.rules.saving : editRule ? dict.rules.saveChanges : dict.rules.addRule}</Button>
                </Modal.Footer>
              </form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
