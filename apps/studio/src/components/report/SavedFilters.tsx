'use client';

import { useCallback, useEffect, useState } from 'react';
import { Save, Trash2, Star } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';

type SavedFilter = {
  id: string; name: string;
  filter_config: Record<string, unknown>;
  is_default: boolean; created_at: string;
};

type FilterConfig = {
  severity?: string; category?: string; status?: string; priority?: number;
};

export default function SavedFilters({ userId, currentFilter, onApplyFilter, dict }: {
  userId?: string;
  currentFilter: FilterConfig;
  onApplyFilter: (filter: FilterConfig) => void;
  dict: Dictionary;
}) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [filterName, setFilterName] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(userId ?? null);

  useEffect(() => {
    if (userId) {
      queueMicrotask(() => setResolvedUserId(userId));
      return;
    }
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setResolvedUserId(data?.user?.id ?? null);
      })
      .catch(() => setResolvedUserId(null));
  }, [userId]);

  const loadFilters = useCallback(async (uid: string) => {
    const res = await fetch(`/api/filters?userId=${uid}`);
    if (res.ok) {
      setFilters(await res.json());
    }
  }, []);

  useEffect(() => {
    if (!resolvedUserId) return;
    fetch(`/api/filters?userId=${resolvedUserId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setFilters(Array.isArray(data) ? data : []);
      })
      .catch(() => setFilters([]));
  }, [resolvedUserId]);

  async function handleSave() {
    if (!filterName.trim()) { toast.error(dict.reports.filterNameRequired); return; }

    setSaving(true);
    const res = await fetch('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: filterName.trim(), filterConfig: currentFilter, isDefault: false }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? dict.reports.saveFilterFailed);
      return;
    }

    toast.success(dict.reports.saveFilterSuccess);
    setDialogOpen(false);
    setFilterName('');
    if (resolvedUserId) void loadFilters(resolvedUserId);
  }

  async function handleDelete(filterId: string) {
    const res = await fetch(`/api/filters?filterId=${filterId}`, { method: 'DELETE' });
    if (!res.ok) { toast.error(dict.reports.deleteFilterFailed); return; }
    toast.success(dict.reports.deleteFilterSuccess);
    if (resolvedUserId) void loadFilters(resolvedUserId);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{dict.reports.savedFiltersTitle}</h4>
        <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)} className="gap-2">
          <Save className="size-3.5" />
          {dict.reports.saveCurrentFilter}
        </Button>
      </div>

      {filters.length === 0 ? (
        <div className="text-[13px] text-[hsl(var(--ds-text-2))] text-center py-4">{dict.reports.noSavedFilters}</div>
      ) : (
        <div className="space-y-2">
          {filters.map(filter => (
            <div key={filter.id} className="flex items-center gap-2 p-2 rounded-[6px] border border-[hsl(var(--ds-border-1))] hover:bg-[hsl(var(--ds-surface-1))] transition-colors">
              {filter.is_default && <Star className="size-3.5 text-yellow-500 fill-yellow-500" />}
              <button onClick={() => onApplyFilter(filter.filter_config)} className="flex-1 text-left text-sm">
                {filter.name}
              </button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleDelete(filter.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dict.reports.saveFilterTitle}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{dict.reports.filterNameLabel}</label>
              <Input value={filterName} onChange={e => setFilterName(e.target.value)} placeholder={dict.reports.filterNamePlaceholder} autoFocus />
            </div>
            <div className="text-[13px] text-[hsl(var(--ds-text-2))]">
              {dict.reports.currentFilterLabel}
              <ul className="mt-2 space-y-1">
                {currentFilter.severity && (
                  <li>
                    • {dict.reports.severityLabel}: {dict.reportDetail.severity[currentFilter.severity as keyof typeof dict.reportDetail.severity] ?? currentFilter.severity}
                  </li>
                )}
                {currentFilter.category && (
                  <li>
                    • {dict.reports.categoryLabel}: {dict.reports.categories[currentFilter.category as keyof typeof dict.reports.categories] ?? currentFilter.category}
                  </li>
                )}
                {currentFilter.status && (
                  <li>
                    • {dict.reports.statusLabel}: {dict.reportDetail.issueStatus[currentFilter.status as keyof typeof dict.reportDetail.issueStatus] ?? currentFilter.status}
                  </li>
                )}
                {currentFilter.priority && <li>• {dict.reports.priorityLabel}: P{currentFilter.priority}</li>}
              </ul>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>{dict.common.cancel}</Button>
            <Button disabled={saving} onClick={handleSave}>{saving ? dict.reports.savingFilter : dict.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
