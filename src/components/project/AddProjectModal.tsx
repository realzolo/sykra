'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, Github, Lock, Loader2 } from 'lucide-react';
import { Modal, Input, Select, ListBox, useOverlayState } from '@heroui/react';
import { Button } from '@heroui/react';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { t } from '@/lib/i18n-utils';

type GHRepo = {
  full_name: string; name: string; description: string | null;
  default_branch: string; private: boolean; language: string | null; updated_at: string | null;
};
type RuleSet = { id: string; name: string };

export default function AddProjectModal({ open, onClose, onCreated, dict }: {
  open: boolean; onClose: () => void; onCreated: () => void; dict: Dictionary;
}) {
  const state = useOverlayState({ isOpen: open, onOpenChange: (v) => { if (!v) onClose(); } });
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [repos, setRepos] = useState<GHRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GHRepo | null>(null);
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
        setRepos(Array.isArray(repoData) ? (repoData as GHRepo[]) : []);
      }
      setRuleSets(Array.isArray(ruleData) ? ruleData : []);
    }).catch(() => setReposError(dict.projects.failedToLoadRepos)).finally(() => setReposLoading(false));
  }, [open]);

  const filtered = useMemo(() =>
    repos.filter(r =>
      r.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description ?? '').toLowerCase().includes(search.toLowerCase())
    ), [repos, search]);

  function pickRepo(repo: GHRepo) {
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
      body: JSON.stringify({ name: projectName.trim(), repo: selected.full_name, default_branch: selected.default_branch, ruleset_id: rulesetId === 'none' ? undefined : rulesetId }),
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
    <Modal state={state}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{step === 'pick' ? dict.projects.selectRepository : dict.projects.confirmDetails}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {step === 'pick' && (
                <div className="flex flex-col gap-4 flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-default-400" />
                    <Input placeholder={dict.projects.searchProjects} value={search} onChange={e => setSearch(e.target.value)} className="pl-10" autoFocus />
                  </div>
                  <div className="flex-1 overflow-y-auto border rounded-md max-h-[300px]">
                    {reposLoading ? (
                      <div className="flex justify-center items-center h-[300px]">
                        <Loader2 className="size-6 animate-spin text-default-400" />
                      </div>
                    ) : reposError ? (
                      <div className="p-8 text-center text-danger text-sm">{reposError}</div>
                    ) : filtered.length === 0 ? (
                      <div className="p-8 text-center text-default-400 text-sm">{dict.projects.noRepositories}</div>
                    ) : (
                      <div className="divide-y">
                        {filtered.map((repo) => (
                          <button
                            key={repo.full_name}
                            onClick={() => pickRepo(repo)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-default-100 transition-colors text-left cursor-pointer"
                          >
                            <div className="w-10 h-10 rounded-md bg-default-200 flex items-center justify-center shrink-0">
                              {repo.private ? <Lock className="size-4" /> : <Github className="size-4" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-medium text-sm truncate">{repo.full_name}</span>
                                {repo.private && <span className="text-xs px-2 py-0.5 rounded-full bg-default-200 shrink-0">{dict.projects.privateRepo}</span>}
                              </div>
                              {repo.description && <p className="text-xs text-default-400 truncate">{repo.description}</p>}
                            </div>
                            <div className="text-right shrink-0">
                              {repo.language && <div className="text-xs text-default-400 mb-0.5">{repo.language}</div>}
                              <div className="text-xs text-default-400">{formatDate(repo.updated_at)}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {repos.length > 0 && <p className="text-xs text-default-400 text-center">{t(dict.projects.repositoriesLoaded, { count: repos.length.toString() })}</p>}
                </div>
              )}

              {step === 'confirm' && selected && (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 p-4 rounded-md bg-default-100 border border-default-200">
                    <div className="w-10 h-10 rounded-md bg-default-200 flex items-center justify-center shrink-0">
                      <Github className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{selected.full_name}</p>
                      <p className="text-xs text-default-400">{dict.projects.branch}: {selected.default_branch}</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onPress={() => setStep('pick')}>{dict.common.edit}</Button>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="project-name" className="text-sm font-semibold">{dict.projects.projectName}</label>
                    <Input id="project-name" value={projectName} onChange={e => setProjectName(e.target.value)} required />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold">{dict.projects.ruleSet} <span className="text-default-400 font-normal">({dict.common.none})</span></label>
                    <Select selectedKey={rulesetId} onSelectionChange={(key) => setRulesetId(key as string)}>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox items={rulesetItems}>
                          {(item) => <ListBox.Item id={item.id}>{item.name}</ListBox.Item>}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                </form>
              )}
            </Modal.Body>
            <Modal.Footer>
              {step === 'confirm' && selected && (
                <>
                  <Button type="button" variant="outline" onPress={onClose}>{dict.common.cancel}</Button>
                  <Button type="submit" variant="primary" isDisabled={submitting || !projectName.trim()} onPress={handleSubmit as unknown as () => void}>{submitting ? dict.common.loading : dict.projects.addProject}</Button>
                </>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
