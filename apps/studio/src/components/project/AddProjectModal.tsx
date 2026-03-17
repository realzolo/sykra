'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, Github, Lock } from 'lucide-react';
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
import { t } from '@/lib/i18n-utils';
import { Skeleton } from '@/components/ui/skeleton';

type RepoItem = {
  fullName: string;
  name: string;
  description?: string | null;
  defaultBranch: string;
  isPrivate?: boolean;
  language?: string | null;
  updatedAt?: string | null;
};
type RuleSet = { id: string; name: string };

function normalizeRepo(raw: Record<string, any>): RepoItem | null {
  const ownerValue =
    typeof raw.owner === 'string'
      ? raw.owner
      : typeof raw.owner?.login === 'string'
        ? raw.owner.login
        : typeof raw.owner?.name === 'string'
          ? raw.owner.name
          : undefined;
  const fullName =
    raw.full_name ??
    raw.fullName ??
    (ownerValue && raw.name ? `${ownerValue}/${raw.name}` : undefined);
  const name = raw.name ?? (fullName ? fullName.split('/').pop() : undefined);
  if (!fullName || !name) return null;

  const defaultBranch = raw.default_branch ?? raw.defaultBranch ?? 'main';
  const description = raw.description ?? null;
  const isPrivate =
    typeof raw.private === 'boolean'
      ? raw.private
      : typeof raw.isPrivate === 'boolean'
        ? raw.isPrivate
        : typeof raw.visibility === 'string'
          ? raw.visibility !== 'public'
          : undefined;
  const language = raw.language ?? null;
  const updatedAt = raw.updated_at ?? raw.updatedAt ?? raw.last_activity_at ?? null;

  return {
    fullName,
    name,
    description,
    defaultBranch,
    isPrivate,
    language,
    updatedAt,
  };
}

export default function AddProjectModal({ open, onClose, onCreated, dict }: {
  open: boolean; onClose: () => void; onCreated: () => void; dict: Dictionary;
}) {
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RepoItem | null>(null);
  const [projectName, setProjectName] = useState('');
  const [rulesetId, setRulesetId] = useState('none');
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) { setStep('pick'); setSearch(''); setSelected(null); setProjectName(''); setRulesetId('none'); return; }
    setReposLoading(true);
    setReposError('');
    Promise.all([
      fetch('/api/github/repos').then(r => r.json()),
      fetch('/api/rules/sets').then(r => r.json()),
    ]).then(([repoData, ruleData]: [Record<string, unknown>, unknown]) => {
      if (repoData.error) {
        setReposError(repoData.error as string);
      } else {
        const normalized = Array.isArray(repoData)
          ? repoData.map(normalizeRepo).filter((repo): repo is RepoItem => !!repo)
          : [];
        setRepos(normalized);
      }
      setRuleSets(Array.isArray(ruleData) ? ruleData : []);
    }).catch(() => setReposError(dict.projects.failedToLoadRepos)).finally(() => setReposLoading(false));
  }, [open]);

  const filtered = useMemo(() =>
    repos.filter(r =>
      r.fullName.toLowerCase().includes(search.toLowerCase()) ||
      (r.description ?? '').toLowerCase().includes(search.toLowerCase())
    ), [repos, search]);

  function pickRepo(repo: RepoItem) {
    setSelected(repo);
    setProjectName(repo.name);
    setStep('confirm');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !projectName.trim()) return;
    setSubmitting(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: projectName.trim(),
        repo: selected.fullName,
        default_branch: selected.defaultBranch,
        ruleset_id: rulesetId === 'none' ? undefined : rulesetId,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) { toast.error(data.error ?? dict.projects.addFailed); return; }
    toast.success(dict.projects.projectAdded);
    onCreated();
  }

  function formatDate(d: string | null) {
    if (!d) return '';
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (days === 0) return dict.projects.today;
    if (days < 30) return t(dict.projects.daysAgo, { days: days.toString() });
    if (days < 365) return t(dict.projects.monthsAgo, { months: Math.floor(days / 30).toString() });
    return t(dict.projects.yearsAgo, { years: Math.floor(days / 365).toString() });
  }

  const rulesetItems = [{ id: 'none', name: dict.common.none }, ...ruleSets.map(rs => ({ id: rs.id, name: rs.name }))];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{step === 'pick' ? dict.projects.selectRepository : dict.projects.confirmDetails}</DialogTitle>
        </DialogHeader>

        {step === 'pick' && (
          <div className="flex flex-col gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[hsl(var(--ds-text-2))]" />
              <Input placeholder={dict.projects.searchProjects} value={search} onChange={e => setSearch(e.target.value)} className="pl-10" autoFocus />
            </div>
            <div className="flex-1 overflow-y-auto border border-[hsl(var(--ds-border-1))] rounded-[6px] max-h-[320px] bg-background">
              {reposLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={`repo-skeleton-${index}`} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-[6px]" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-14" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : reposError ? (
                <div className="p-8 text-center text-danger text-sm">{reposError}</div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-[hsl(var(--ds-text-2))] text-sm">{dict.projects.noRepositories}</div>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map((repo) => (
                    <button
                      key={repo.fullName}
                      onClick={() => pickRepo(repo)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--ds-surface-1))] transition-colors text-left cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-[6px] bg-muted flex items-center justify-center shrink-0">
                        {repo.isPrivate ? <Lock className="size-4" /> : <Github className="size-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-sm truncate">{repo.fullName}</span>
                          {repo.isPrivate && (
                            <span className="text-xs px-2 py-0.5 rounded-[4px] bg-muted shrink-0">
                              {dict.projects.privateRepo}
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-[12px] text-[hsl(var(--ds-text-2))] truncate">{repo.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {repo.language && (
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-0.5">{repo.language}</div>
                        )}
                        {repo.updatedAt && (
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{formatDate(repo.updatedAt)}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {repos.length > 0 && <p className="text-[12px] text-[hsl(var(--ds-text-2))] text-center">{t(dict.projects.repositoriesLoaded, { count: repos.length.toString() })}</p>}
          </div>
        )}

        {step === 'confirm' && selected && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex items-center gap-3 p-4 rounded-[6px] bg-[hsl(var(--ds-surface-1))] border border-[hsl(var(--ds-border-1))]">
              <div className="w-10 h-10 rounded-[6px] bg-muted flex items-center justify-center shrink-0">
                <Github className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{selected.fullName}</p>
                <p className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.projects.branch}: {selected.defaultBranch}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep('pick')}>{dict.common.edit}</Button>
            </div>

            <div className="space-y-2">
              <label htmlFor="project-name" className="text-sm font-semibold">{dict.projects.projectName}</label>
              <Input id="project-name" value={projectName} onChange={e => setProjectName(e.target.value)} required />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold">{dict.projects.ruleSet} <span className="text-[hsl(var(--ds-text-2))] font-normal">({dict.common.none})</span></label>
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
        )}

        {step === 'confirm' && selected && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{dict.common.cancel}</Button>
            <Button type="submit" disabled={submitting || !projectName.trim()} onClick={handleSubmit as unknown as () => void}>
              {submitting ? dict.common.loading : dict.projects.addProject}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
