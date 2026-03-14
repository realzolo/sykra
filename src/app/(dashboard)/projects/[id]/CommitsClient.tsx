'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, User, Clock, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { Button, Select, ListBox, Modal, useOverlayState, Spinner } from '@heroui/react';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';

type Commit = { sha: string; message: string; author: string; date: string };
type Project = { id: string; name: string; repo: string; default_branch: string; ruleset_id?: string };

const PER_PAGE = 30;

export default function CommitsClient({ project, branches, dict }: { project: Project; branches: string[]; dict: Dictionary }) {
  const router = useRouter();
  const [branch, setBranch] = useState(project.default_branch);
  const [authorFilter, setAuthorFilter] = useState('all');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [ruleSetName, setRuleSetName] = useState('');
  const confirmState = useOverlayState();

  useEffect(() => {
    if (project.ruleset_id) {
      fetch(`/api/rules/${project.ruleset_id}`).then(r => r.json()).then(d => setRuleSetName(d.name ?? '')).catch(() => {});
    }
  }, [project.ruleset_id]);

  async function fetchCommits(targetBranch: string, targetPage: number, append = false) {
    if (!append) setLoading(true); else setLoadingMore(true);
    try {
      const data = await fetch(`/api/commits?repo=${project.repo}&branch=${targetBranch}&per_page=${PER_PAGE}&page=${targetPage}`).then(r => r.json());
      setHasMore(data.length === PER_PAGE);
      if (append) setCommits(prev => [...prev, ...data]);
      else { setCommits(data); setSelected([]); }
    } catch { /* silent */ }
    finally { setLoading(false); setLoadingMore(false); }
  }

  useEffect(() => {
    setPage(1); setAuthorFilter('all');
    fetchCommits(branch, 1, false);
  }, [branch, project.repo]);

  const authors = [...new Set(commits.map(c => c.author))];
  const filtered = authorFilter === 'all' ? commits : commits.filter(c => c.author === authorFilter);
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selected.includes(c.sha));

  function toggleCommit(sha: string) {
    setSelected(prev => prev.includes(sha) ? prev.filter(s => s !== sha) : [...prev, sha]);
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      const shas = new Set(filtered.map(c => c.sha));
      setSelected(prev => prev.filter(s => !shas.has(s)));
    } else {
      setSelected(prev => [...new Set([...prev, ...filtered.map(c => c.sha)])]);
    }
  }

  async function startReview() {
    confirmState.close();
    if (!project.ruleset_id) { toast.warning(dict.commits.configureRuleSetFirst); return; }
    setAnalyzing(true);
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, commits: selected }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); setAnalyzing(false); return; }
    router.push(`/reports/${data.reportId}`);
  }

  function formatDate(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const h = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (h < 1) return dict.commits.justNow;
    if (h < 24) return dict.commits.hoursAgo.replace('{{hours}}', h.toString());
    if (days < 30) return dict.commits.daysAgo.replace('{{days}}', days.toString());
    return new Date(d).toLocaleDateString('zh-CN');
  }

  const branchItems = branches.map(b => ({ id: b, label: b }));
  const authorItems = [{ id: 'all', label: dict.commits.allAuthors }, ...authors.map(a => ({ id: a, label: a }))];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-border bg-card shrink-0">
        <Link href="/projects">
          <Button isIconOnly variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold">{project.name}</div>
          <div className="text-xs text-muted-foreground">{project.repo}</div>
        </div>
        {selected.length > 0 && <span className="text-xs text-muted-foreground font-medium">{dict.commits.selected.replace('{{count}}', selected.length.toString())}</span>}
        <Button
          isDisabled={!selected.length || analyzing}
          onPress={() => {
            if (!project.ruleset_id) { toast.warning(dict.commits.configureRuleSetFirst); return; }
            confirmState.open();
          }}
          className="gap-1.5"
          size="sm"
        >
          {analyzing ? <Spinner size="sm" /> : <Send className="size-3.5" />}
          {analyzing ? dict.commits.analyzing : dict.commits.reviewCommits.replace('{{count}}', (selected.length || '').toString())}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-border bg-card/50 shrink-0">
        <Select selectedKey={branch} onSelectionChange={(key) => setBranch(key as string)} className="w-[150px]">
          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover>
            <ListBox items={branchItems}>
              {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
            </ListBox>
          </Select.Popover>
        </Select>
        <Select selectedKey={authorFilter} onSelectionChange={(key) => setAuthorFilter(key as string)} className="w-[160px]">
          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover>
            <ListBox items={authorItems}>
              {(item) => <ListBox.Item id={item.id}>{item.label}</ListBox.Item>}
            </ListBox>
          </Select.Popover>
        </Select>
        {filtered.length > 0 && (
          <Button variant="ghost" size="sm" onPress={toggleSelectAll} className="gap-1">
            {allFilteredSelected && <CheckCircle2 className="size-3.5" />}
            {allFilteredSelected ? dict.commits.deselectAll : dict.commits.selectAll.replace('{{count}}', filtered.length.toString())}
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{dict.commits.commitsCount.replace('{{count}}', filtered.length.toString())}</span>
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-auto bg-muted/30 p-4">
        {loading ? (
          <div className="flex justify-center items-center h-[200px]">
            <Spinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground text-sm">{dict.commits.noCommits}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map(commit => {
              const isSelected = selected.includes(commit.sha);
              return (
                <div
                  key={commit.sha}
                  onClick={() => toggleCommit(commit.sha)}
                  className={[
                    'flex items-center gap-3.5 px-4 py-3.5 cursor-pointer rounded-xl border transition-all',
                    isSelected
                      ? 'border-primary/40 bg-primary/5 ring-2 ring-primary/10'
                      : 'border-border bg-card hover:border-primary/20 hover:bg-accent/30',
                  ].join(' ')}
                >
                  <div className={[
                    'w-4.5 h-4.5 rounded-md shrink-0 flex items-center justify-center border-2 transition-all',
                    isSelected ? 'border-primary bg-primary' : 'border-border bg-background',
                  ].join(' ')}>
                    {isSelected && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                        {commit.sha.slice(0, 7)}
                      </code>
                      <span className="text-sm font-medium truncate">{commit.message}</span>
                    </div>
                    <div className="flex items-center gap-3.5">
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><User className="size-3" />{commit.author}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="size-3" />{formatDate(commit.date)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {hasMore && authorFilter === 'all' && (
              <div className="flex justify-center pt-2">
                <Button variant="ghost" isDisabled={loadingMore} onPress={() => { const next = page + 1; setPage(next); fetchCommits(branch, next, true); }}>
                  {loadingMore ? <Spinner size="sm" /> : null}
                  {loadingMore ? '加载中…' : '加载更多提交'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      <Modal state={confirmState}>
        <Modal.Backdrop isDismissable>
          <Modal.Container className="max-w-[420px]">
            <Modal.Dialog>
              <Modal.Header><Modal.Heading>开始代码审查</Modal.Heading></Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/50 border border-border">
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-1">待分析提交数</div>
                    <div className="text-2xl font-bold">{selected.length}</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-1">规则集</div>
                    <div className="text-sm font-semibold">{ruleSetName || '—'}</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Claude 将根据您配置的规则分析所选提交，生成质量报告。这可能需要一两分钟。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="outline" onPress={confirmState.close}>取消</Button>
                <Button variant="primary" onPress={startReview}>开始分析</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
