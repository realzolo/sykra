'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';

type Project = {
  id: string; name: string; repo: string;
  description?: string; default_branch: string; ruleset_id?: string;
};
type RuleSet = { id: string; name: string };

export default function EditProjectModal({ project, open, onClose, onUpdated, dict }: {
  project: Project;
  open: boolean;
  onClose: () => void;
  onUpdated: (updated: Project) => void;
  dict: Dictionary;
}) {
  const [loading, setLoading] = useState(false);
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [rulesetId, setRulesetId] = useState(project.ruleset_id ?? 'none');

  useEffect(() => {
    if (open) {
      setName(project.name);
      setDescription(project.description ?? '');
      setRulesetId(project.ruleset_id ?? 'none');
      fetch('/api/rules/sets').then(r => r.json()).then(setRuleSets).catch(() => {});
    }
  }, [open, project]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, ruleset_id: rulesetId === 'none' ? undefined : rulesetId }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error ?? dict.projects.updateFailed); return; }
    toast.success(dict.projects.projectUpdated);
    onUpdated(data);
  }

  const rulesetItems = [{ id: 'none', name: dict.common.none }, ...ruleSets.map(rs => ({ id: rs.id, name: rs.name }))];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{dict.projects.editProject}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-semibold">{dict.projects.projectName}</label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-semibold">{dict.common.description} <span className="text-[hsl(var(--ds-text-2))] font-normal">({dict.projects.optional})</span></label>
            <Input id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder={dict.projects.descriptionPlaceholder} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold">{dict.projects.ruleSet} <span className="text-[hsl(var(--ds-text-2))] font-normal">({dict.projects.optional})</span></label>
            <Select value={rulesetId} onValueChange={(value) => setRulesetId(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rulesetItems.map(item => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{dict.common.cancel}</Button>
          <Button type="submit" disabled={loading} onClick={handleSubmit as unknown as () => void}>{loading ? dict.common.loading : dict.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
