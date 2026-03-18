'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Send, User, Clock, CheckCircle2, FileText } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { withOrgPrefix } from '@/lib/orgPath';
import ReactDiffViewer from 'react-diff-viewer-continued';
import { Skeleton } from '@/components/ui/skeleton';
import { formatLocalDate } from '@/lib/dateFormat';

type Commit = { sha: string; message: string; author: string; date: string };
type Project = { id: string; name: string; repo: string; default_branch: string; ruleset_id?: string };
type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C';
type ParsedDiffFile = {
  key: string;
  oldPath: string;
  newPath: string;
  displayPath: string;
  status: FileStatus;
  oldValue: string;
  newValue: string;
};

const PER_PAGE = 30;
const STATUS_STYLES: Record<FileStatus, string> = {
  A: 'text-success border-success/30 bg-success/10',
  M: 'text-warning border-warning/30 bg-warning/10',
  D: 'text-danger border-danger/30 bg-danger/10',
  R: 'text-accent border-accent/30 bg-accent/10',
  C: 'text-primary border-primary/30 bg-primary/10',
};

function normalizeDiffPath(pathToken: string) {
  const value = pathToken.trim();
  if (value === '/dev/null') return '';
  if (value.startsWith('a/') || value.startsWith('b/')) return value.slice(2);
  return value;
}

function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  if (!diff.trim()) return [];

  const lines = diff.split('\n');
  const files: ParsedDiffFile[] = [];

  type Working = {
    oldPath: string;
    newPath: string;
    status: FileStatus;
    inHunk: boolean;
    oldLines: string[];
    newLines: string[];
  };

  let current: Working | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const oldPath = current.oldPath;
    const newPath = current.newPath;
    const status = current.status;
    const displayPath = status === 'D'
      ? oldPath
      : status === 'R' || status === 'C'
        ? `${oldPath} -> ${newPath}`
        : newPath;
    files.push({
      key: `${oldPath}:${newPath}:${files.length}`,
      oldPath,
      newPath,
      displayPath,
      status,
      oldValue: current.oldLines.join('\n'),
      newValue: current.newLines.join('\n'),
    });
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      pushCurrent();
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = {
        oldPath: match?.[1] ?? '',
        newPath: match?.[2] ?? '',
        status: 'M',
        inHunk: false,
        oldLines: [],
        newLines: [],
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('new file mode')) {
      current.status = 'A';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'D';
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.status = 'R';
      current.oldPath = normalizeDiffPath(line.slice('rename from '.length));
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.status = 'R';
      current.newPath = normalizeDiffPath(line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('copy from ')) {
      current.status = 'C';
      current.oldPath = normalizeDiffPath(line.slice('copy from '.length));
      continue;
    }
    if (line.startsWith('copy to ')) {
      current.status = 'C';
      current.newPath = normalizeDiffPath(line.slice('copy to '.length));
      continue;
    }
    if (line.startsWith('--- ')) {
      current.oldPath = normalizeDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith('+++ ')) {
      current.newPath = normalizeDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith('@@ ')) {
      current.inHunk = true;
      continue;
    }
    if (!current.inHunk) continue;
    if (line.startsWith('\\ No newline at end of file')) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      current.oldLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(' ')) {
      const content = line.slice(1);
      current.oldLines.push(content);
      current.newLines.push(content);
    }
  }

  pushCurrent();
  return files;
}

export default function CommitsClient({ project, branches, dict }: { project: Project; branches: string[]; dict: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCommit, setDetailCommit] = useState<Commit | null>(null);
  const [detailDiff, setDetailDiff] = useState('');
  const [detailFiles, setDetailFiles] = useState<ParsedDiffFile[]>([]);
  const [activeFileKey, setActiveFileKey] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    if (project.ruleset_id) {
      fetch(`/api/rules/${project.ruleset_id}`).then(r => r.json()).then(d => setRuleSetName(d.name ?? '')).catch(() => {});
    }
  }, [project.ruleset_id]);

  const fetchCommits = useCallback(async (targetBranch: string, targetPage: number, append = false) => {
    if (!append) setLoading(true); else setLoadingMore(true);
    try {
      const data = await fetch(`/api/commits?repo=${project.repo}&branch=${targetBranch}&per_page=${PER_PAGE}&page=${targetPage}&project_id=${project.id}`).then(r => r.json());
      setHasMore(data.length === PER_PAGE);
      if (append) setCommits(prev => [...prev, ...data]);
      else { setCommits(data); setSelected([]); }
    } catch { /* silent */ }
    finally { setLoading(false); setLoadingMore(false); }
  }, [project.id, project.repo]);

  useEffect(() => {
    setPage(1); setAuthorFilter('all');
    void fetchCommits(branch, 1, false);
  }, [branch, fetchCommits]);

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
    setConfirmOpen(false);
    if (!project.ruleset_id) { toast.warning(dict.commits.configureRuleSetFirst); return; }
    setAnalyzing(true);
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, commits: selected }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); setAnalyzing(false); return; }
    router.push(withOrgPrefix(pathname, `/projects/${project.id}/reports/${data.reportId}`));
  }

  async function openCommitDetail(commit: Commit) {
    setDetailCommit(commit);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(false);
    setDetailDiff('');
    setDetailFiles([]);
    setActiveFileKey('');
    try {
      const res = await fetch(`/api/commits/${commit.sha}?repo=${project.repo}&project_id=${project.id}`);
      if (!res.ok) throw new Error('diff_fetch_failed');
      const data = await res.json();
      const rawDiff = (data?.diff as string) || '';
      setDetailDiff(rawDiff);
      const parsedFiles = parseUnifiedDiff(rawDiff);
      setDetailFiles(parsedFiles);
      const firstFile = parsedFiles.at(0);
      if (firstFile) {
        setActiveFileKey(firstFile.key);
      }
    } catch {
      setDetailError(true);
    } finally {
      setDetailLoading(false);
    }
  }

  function formatDate(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const h = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (h < 1) return dict.commits.justNow;
    if (h < 24) return dict.commits.hoursAgo.replace('{{hours}}', h.toString());
    if (days < 30) return dict.commits.daysAgo.replace('{{days}}', days.toString());
    return formatLocalDate(d);
  }

  const branchItems = branches.map(b => ({ id: b, label: b }));
  const authorItems = [{ id: 'all', label: dict.commits.allAuthors }, ...authors.map(a => ({ id: a, label: a }))];
  const activeDiffFile = useMemo(
    () => detailFiles.find((file) => file.key === activeFileKey) ?? detailFiles[0] ?? null,
    [activeFileKey, detailFiles],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-11 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] shrink-0">
        <Link href={withOrgPrefix(pathname, '/projects')}>
          <Button size="icon" variant="ghost"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">{project.name}</div>
          <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{project.repo}</div>
        </div>
        {selected.length > 0 && <span className="text-[12px] text-[hsl(var(--ds-text-2))] font-medium">{dict.commits.selected.replace('{{count}}', selected.length.toString())}</span>}
        <Button
          disabled={!selected.length || analyzing}
          onClick={() => {
            if (!project.ruleset_id) { toast.warning(dict.commits.configureRuleSetFirst); return; }
            setConfirmOpen(true);
          }}
          className="gap-1.5"
          size="sm"
        >
          <Send className="size-3.5" />
          {analyzing ? dict.commits.analyzing : dict.commits.reviewCommits.replace('{{count}}', (selected.length || '').toString())}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] shrink-0">
        <Select value={branch} onValueChange={(value) => setBranch(value)}>
          <SelectTrigger className="w-[150px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {branchItems.map(item => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={authorFilter} onValueChange={(value) => setAuthorFilter(value)}>
          <SelectTrigger className="w-[160px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {authorItems.map(item => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered.length > 0 && (
          <Button variant="ghost" size="sm" onClick={toggleSelectAll} className="gap-1">
            {allFilteredSelected && <CheckCircle2 className="size-3.5" />}
            {allFilteredSelected ? dict.commits.deselectAll : dict.commits.selectAll.replace('{{count}}', filtered.length.toString())}
          </Button>
        )}
        <span className="text-[12px] text-[hsl(var(--ds-text-2))] ml-auto">{dict.commits.commitsCount.replace('{{count}}', filtered.length.toString())}</span>
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-auto bg-[hsl(var(--ds-background-1))] p-4">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={`commit-skeleton-${index}`} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] px-4 py-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4 rounded-[4px]" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
                <div className="flex items-center gap-4">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-[hsl(var(--ds-text-2))] text-[13px]">{dict.commits.noCommits}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map(commit => {
              const isSelected = selected.includes(commit.sha);
              return (
                <div
                  key={commit.sha}
                  onClick={() => openCommitDetail(commit)}
                  className={[
                    'flex items-center gap-3.5 px-4 py-3.5 cursor-pointer rounded-[8px] border transition-colors duration-100',
                    isSelected
                      ? 'border-[hsl(var(--ds-accent-7)/0.4)] bg-[hsl(var(--ds-accent-7)/0.08)]'
                      : 'border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] hover:border-[hsl(var(--ds-border-2))] hover:bg-[hsl(var(--ds-surface-1))]',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCommit(commit.sha);
                    }}
                    aria-pressed={isSelected}
                    className={[
                      'w-4.5 h-4.5 rounded-[4px] shrink-0 flex items-center justify-center border-2 transition-colors duration-100',
                      isSelected ? 'border-[hsl(var(--ds-accent-7))] bg-[hsl(var(--ds-accent-7))]' : 'border-[hsl(var(--ds-border-2))] bg-[hsl(var(--ds-background-1))]',
                    ].join(' ')}
                  >
                    {isSelected && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <code className="text-[11px] font-mono px-1.5 py-0.5 rounded-[4px] bg-[hsl(var(--ds-surface-2))] text-[hsl(var(--ds-text-2))] shrink-0">
                        {commit.sha.slice(0, 7)}
                      </code>
                      <span className="text-[13px] font-medium truncate">{commit.message}</span>
                    </div>
                    <div className="flex items-center gap-3.5">
                      <span className="text-[12px] text-[hsl(var(--ds-text-2))] flex items-center gap-1"><User className="size-3" />{commit.author}</span>
                      <span className="text-[12px] text-[hsl(var(--ds-text-2))] flex items-center gap-1"><Clock className="size-3" />{formatDate(commit.date)}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-[12px]"
                    onClick={(event) => {
                      event.stopPropagation();
                      openCommitDetail(commit);
                    }}
                  >
                    <FileText className="size-3.5" />
                    {dict.commits.viewChanges}
                  </Button>
                </div>
              );
            })}
            {hasMore && authorFilter === 'all' && (
              <div className="flex justify-center pt-2">
              <Button variant="ghost" disabled={loadingMore} onClick={() => { const next = page + 1; setPage(next); fetchCommits(branch, next, true); }}>
                {loadingMore ? dict.common.loading : dict.commits.loadMore}
              </Button>
            </div>
          )}
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{dict.commits.confirmReview}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4 p-4 rounded-[8px] bg-[hsl(var(--ds-surface-1))] border border-[hsl(var(--ds-border-1))]">
              <div className="flex-1">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.commits.pendingCommitCount}</div>
                <div className="text-2xl font-bold">{selected.length}</div>
              </div>
              <div className="flex-1">
                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.projects.ruleSet}</div>
                <div className="text-[13px] font-semibold">{ruleSetName || '—'}</div>
              </div>
            </div>
            <p className="text-[13px] text-[hsl(var(--ds-text-2))] leading-relaxed">
              {dict.commits.analysisNote}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{dict.common.cancel}</Button>
            <Button onClick={startReview}>{dict.commits.startReview}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="w-[96vw] max-w-[1400px] max-h-[92vh]">
          <DialogHeader>
            <DialogTitle>{dict.commits.commitChanges}</DialogTitle>
          </DialogHeader>
          {detailCommit && (
            <div className="text-[12px] text-[hsl(var(--ds-text-2))] flex flex-wrap items-center gap-2">
              <code className="rounded-[4px] bg-[hsl(var(--ds-surface-2))] px-2 py-0.5">{detailCommit.sha.slice(0, 7)}</code>
              <span className="text-foreground">{detailCommit.message}</span>
              <span className="text-[hsl(var(--ds-text-2))]">·</span>
              <span>{detailCommit.author}</span>
              <span className="text-[hsl(var(--ds-text-2))]">·</span>
              <span>{formatDate(detailCommit.date)}</span>
            </div>
          )}
          <div className="mt-4 border border-[hsl(var(--ds-border-1))] rounded-[8px] overflow-hidden bg-[hsl(var(--ds-background-1))]">
            {detailLoading && (
              <div className="p-4 space-y-2">
                {Array.from({ length: 12 }).map((_, index) => (
                  <Skeleton key={`diff-skeleton-${index}`} className="h-3 w-full" />
                ))}
              </div>
            )}
            {!detailLoading && detailError && (
              <div className="p-6 text-[13px] text-[hsl(var(--ds-text-2))]">{dict.commits.diffFailed}</div>
            )}
            {!detailLoading && !detailError && detailFiles.length > 0 && (
              <div className="h-[72vh] grid grid-cols-[280px_minmax(0,1fr)]">
                <aside className="border-r border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] overflow-y-auto">
                  <div className="px-3 py-2 border-b border-[hsl(var(--ds-border-1))] text-[11px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                    {dict.commits.filesChanged.replace('{{count}}', String(detailFiles.length))}
                  </div>
                  <div className="p-2 space-y-1">
                    {detailFiles.map((file) => {
                      const isActive = (activeDiffFile?.key ?? '') === file.key;
                      return (
                        <button
                          key={file.key}
                          type="button"
                          onClick={() => setActiveFileKey(file.key)}
                          className={[
                            'w-full text-left rounded-[6px] px-2.5 py-2 border transition-colors',
                            isActive
                              ? 'bg-[hsl(var(--ds-accent-7)/0.12)] border-[hsl(var(--ds-accent-7)/0.3)]'
                              : 'bg-transparent border-transparent hover:bg-[hsl(var(--ds-surface-1))] hover:border-[hsl(var(--ds-border-1))]',
                          ].join(' ')}
                        >
                          <div className="flex items-start gap-2">
                            <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-[4px] border text-[11px] font-semibold ${STATUS_STYLES[file.status]}`}>
                              {file.status}
                            </span>
                            <span className="text-[12px] leading-5 break-all">{file.displayPath}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </aside>
                <div className="overflow-auto bg-[hsl(var(--ds-background-1))]">
                  {activeDiffFile ? (
                    <ReactDiffViewer
                      oldValue={activeDiffFile.oldValue}
                      newValue={activeDiffFile.newValue}
                      splitView
                      showDiffOnly={false}
                      leftTitle={`${dict.commits.original} · ${activeDiffFile.oldPath || '/dev/null'}`}
                      rightTitle={`${dict.commits.modified} · ${activeDiffFile.newPath || '/dev/null'}`}
                    />
                  ) : (
                    <div className="p-6 text-[13px] text-[hsl(var(--ds-text-2))]">{dict.commits.selectFileToView}</div>
                  )}
                </div>
              </div>
            )}
            {!detailLoading && !detailError && !detailDiff && (
              <div className="p-6 text-[13px] text-[hsl(var(--ds-text-2))]">{dict.commits.diffEmpty}</div>
            )}
            {!detailLoading && !detailError && detailDiff && detailFiles.length === 0 && (
              <div className="p-6 text-[13px] text-[hsl(var(--ds-text-2))]">{dict.commits.noParsedFiles}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>{dict.common.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
