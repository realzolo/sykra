'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Send,
  User,
  Clock,
  CheckCircle2,
  FileText,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Copy,
  ExternalLink,
  MoreHorizontal,
  MessageSquare,
  Check,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { withOrgPrefix } from '@/lib/orgPath';
import ReactDiffViewer, { DiffMethod, LineNumberPrefix } from 'react-diff-viewer-continued';
import { Skeleton } from '@/components/ui/skeleton';
import { formatLocalDate } from '@/lib/dateFormat';
import type { LanguageSupport } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { resolveLanguageSupportForPath } from '@/lib/codeLanguage';

type Commit = { sha: string; message: string; author: string; date: string };
type Project = { id: string; name: string; repo: string; default_branch: string; ruleset_id?: string };
type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C';
type ParsedDiffFile = {
  key: string;
  oldPath: string;
  newPath: string;
  displayPath: string;
  status: FileStatus;
  hunkLines: string[];
  isBinary: boolean;
  additions: number;
  deletions: number;
};
type DiffMode = 'commit' | 'compare';
type DiffOptions = {
  showDiffOnly: boolean;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  contextLines: number;
  syntaxHighlight: boolean;
};
type ReviewEntry = {
  id: string;
  path: string;
  line: number;
};
type CodebaseComment = {
  id: string;
  path: string;
  line: number;
  author_email: string | null;
  body: string;
  created_at: string;
};
type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  depth: number;
  isDir: boolean;
  file?: ParsedDiffFile;
  children: FileTreeNode[];
};

const PER_PAGE = 30;
const DIFF_PAGE_SIZE = 200;
const MAX_HIGHLIGHT_LINES = 800;
const TREE_INDENT_STEP = 12;
const TREE_MAX_INDENT = 84;
const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  showDiffOnly: true,
  ignoreWhitespace: false,
  ignoreCase: false,
  contextLines: 3,
  syntaxHighlight: true,
};
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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function highlightLine(source: string, language: LanguageSupport) {
  if (!source) return '';
  const tree = language.language.parser.parse(source);
  let result = '';
  let pos = 0;
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (from > pos) {
      result += escapeHtml(source.slice(pos, from));
    }
    const slice = escapeHtml(source.slice(from, to));
    result += `<span class="${classes}">${slice}</span>`;
    pos = to;
  });
  if (pos < source.length) {
    result += escapeHtml(source.slice(pos));
  }
  return result;
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
    hunkLines: string[];
    isBinary: boolean;
    additions: number;
    deletions: number;
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
      hunkLines: current.hunkLines,
      isBinary: current.isBinary,
      additions: current.additions,
      deletions: current.deletions,
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
        hunkLines: [],
        isBinary: false,
        additions: 0,
        deletions: 0,
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
    if (line.startsWith('GIT binary patch') || line.startsWith('Binary files ')) {
      current.isBinary = true;
      continue;
    }
    if (!current.inHunk) continue;
    if (line.startsWith('\\ No newline at end of file')) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.hunkLines.push(line);
      current.additions += 1;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      current.hunkLines.push(line);
      current.deletions += 1;
      continue;
    }
    if (line.startsWith(' ')) {
      current.hunkLines.push(line);
    }
  }

  pushCurrent();
  return files;
}

function buildFileTree(files: ParsedDiffFile[]): FileTreeNode[] {
  const root: FileTreeNode = { id: 'root', name: '', path: '', depth: -1, isDir: true, children: [] };
  for (const file of files) {
    const path = file.newPath || file.oldPath || file.displayPath;
    if (!path) continue;
    const segments = path.split('/').filter(Boolean);
    let cursor = root;
    let currentPath = '';
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      let node = cursor.children.find((child) => child.name === segment && child.isDir === !isLeaf);
      if (!node) {
        node = {
          id: `${currentPath}:${isLeaf ? 'file' : 'dir'}`,
          name: segment,
          path: currentPath,
          depth: cursor.depth + 1,
          isDir: !isLeaf,
          children: [],
        };
        cursor.children.push(node);
      }
      if (isLeaf) {
        node.file = file;
      }
      cursor = node;
    });
  }
  return root.children;
}

function flattenFileTree(nodes: FileTreeNode[], collapsed: Record<string, boolean>): FileTreeNode[] {
  const rows: FileTreeNode[] = [];
  const walk = (node: FileTreeNode) => {
    rows.push(node);
    if (node.isDir && !collapsed[node.path]) {
      node.children
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .forEach(walk);
    }
  };
  nodes
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .forEach(walk);
  return rows;
}

function buildDiffContent(file: ParsedDiffFile) {
  if (file.isBinary) {
    return { oldValue: '', newValue: '' };
  }
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of file.hunkLines) {
    if (line.startsWith('+')) {
      newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(' ')) {
      const content = line.slice(1);
      oldLines.push(content);
      newLines.push(content);
    }
  }
  return { oldValue: oldLines.join('\n'), newValue: newLines.join('\n') };
}

function normalizeDiffContent(content: { oldValue: string; newValue: string }, options: DiffOptions) {
  let { oldValue, newValue } = content;
  if (options.ignoreCase) {
    oldValue = oldValue.toLowerCase();
    newValue = newValue.toLowerCase();
  }
  if (options.ignoreWhitespace) {
    oldValue = oldValue.replace(/\s+$/gm, '').replace(/\t/g, ' ');
    newValue = newValue.replace(/\s+$/gm, '').replace(/\t/g, ' ');
  }
  return { oldValue, newValue };
}

function createDiffParserWorker() {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  const workerSource = `
    const normalizeDiffPath = (pathToken) => {
      const value = pathToken.trim();
      if (value === '/dev/null') return '';
      if (value.startsWith('a/') || value.startsWith('b/')) return value.slice(2);
      return value;
    };
    self.onmessage = (event) => {
      const diff = typeof event.data?.diff === 'string' ? event.data.diff : '';
      if (!diff.trim()) {
        self.postMessage([]);
        return;
      }
      const lines = diff.split('\\n');
      const files = [];
      let current = null;
      const pushCurrent = () => {
        if (!current) return;
        const oldPath = current.oldPath;
        const newPath = current.newPath;
        const status = current.status;
        const displayPath = status === 'D'
          ? oldPath
          : status === 'R' || status === 'C'
            ? oldPath + ' -> ' + newPath
            : newPath;
        files.push({
          key: oldPath + ':' + newPath + ':' + files.length,
          oldPath,
          newPath,
          displayPath,
          status,
          hunkLines: current.hunkLines,
          isBinary: current.isBinary,
          additions: current.additions,
          deletions: current.deletions,
        });
      };
      for (const line of lines) {
        if (line.startsWith('diff --git ')) {
          pushCurrent();
          const match = line.match(/^diff --git a\\/(.+?) b\\/(.+)$/);
          current = {
            oldPath: match?.[1] ?? '',
            newPath: match?.[2] ?? '',
            status: 'M',
            inHunk: false,
            hunkLines: [],
            isBinary: false,
            additions: 0,
            deletions: 0,
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
        if (line.startsWith('GIT binary patch') || line.startsWith('Binary files ')) {
          current.isBinary = true;
          continue;
        }
        if (!current.inHunk) continue;
        if (line.startsWith('\\\\ No newline at end of file')) continue;
        if (line.startsWith('+') && !line.startsWith('+++')) {
          current.hunkLines.push(line);
          current.additions += 1;
          continue;
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
          current.hunkLines.push(line);
          current.deletions += 1;
          continue;
        }
        if (line.startsWith(' ')) {
          current.hunkLines.push(line);
        }
      }
      pushCurrent();
      self.postMessage(files);
    };
  `;
  const blob = new Blob([workerSource], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  return { worker, url };
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCommit, setDetailCommit] = useState<Commit | null>(null);
  const [detailDiff, setDetailDiff] = useState('');
  const [detailFiles, setDetailFiles] = useState<ParsedDiffFile[]>([]);
  const [activeFileKey, setActiveFileKey] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'A' | 'M' | 'D'>('all');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [diffLanguage, setDiffLanguage] = useState<LanguageSupport | null>(null);
  const [detailMode, setDetailMode] = useState<DiffMode>('commit');
  const [compareBase, setCompareBase] = useState(project.default_branch);
  const [compareHead, setCompareHead] = useState(project.default_branch);
  const [diffOptions, setDiffOptions] = useState<DiffOptions>(DEFAULT_DIFF_OPTIONS);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [reviewedFiles, setReviewedFiles] = useState<Record<string, boolean>>({});
  const [reviewedLines, setReviewedLines] = useState<Record<string, boolean>>({});
  const [fileComments, setFileComments] = useState<CodebaseComment[]>([]);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [commentDraft, setCommentDraft] = useState('');
  const [commentAnchor, setCommentAnchor] = useState<{
    lineId: string;
    lineNumber: number;
    top: number;
  } | null>(null);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [changeAnchors, setChangeAnchors] = useState<string[]>([]);
  const [activeChangeIndex, setActiveChangeIndex] = useState(0);
  const diffViewerRef = useRef<ReactDiffViewer | null>(null);
  const fileSearchRef = useRef<HTMLInputElement>(null);
  const diffParserRef = useRef<ReturnType<typeof createDiffParserWorker> | null>(null);

  useEffect(() => {
    diffParserRef.current = createDiffParserWorker();
    return () => {
      if (diffParserRef.current?.worker) {
        diffParserRef.current.worker.terminate();
        URL.revokeObjectURL(diffParserRef.current.url);
      }
      diffParserRef.current = null;
    };
  }, []);

  useEffect(() => {
    setCompareHead(branch);
  }, [branch]);

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

  const parseDiff = useCallback(async (rawDiff: string) => {
    const workerBundle = diffParserRef.current;
    if (!workerBundle?.worker) {
      return parseUnifiedDiff(rawDiff);
    }
    return new Promise<ParsedDiffFile[]>((resolve) => {
      const handler = (event: MessageEvent) => {
        resolve(Array.isArray(event.data) ? event.data as ParsedDiffFile[] : []);
      };
      workerBundle.worker.addEventListener('message', handler, { once: true });
      workerBundle.worker.postMessage({ diff: rawDiff });
    });
  }, []);

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
    setAnalyzing(true);
    const res = await fetch('/api/code-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        scope: {
          mode: 'diff',
          commits: selected,
        },
      }),
    });
    const data = await res.json().catch(() => ({} as { error?: string; code?: string; runId?: string }));
    if (!res.ok) {
      if (data.code === 'AI_INTEGRATION_REBIND_REQUIRED' || data.code === 'AI_INTEGRATION_MISSING') {
        toast.error(dict.commits.aiIntegrationRebindRequired, {
          action: {
            label: dict.commits.openProjectSettings,
            onClick: () => router.push(withOrgPrefix(pathname, `/projects/${project.id}/settings`)),
          },
        });
      } else {
        toast.error(data.error ?? dict.commits.analysisFailed);
      }
      setAnalyzing(false);
      return;
    }
    router.push(withOrgPrefix(pathname, `/projects/${project.id}/code-reviews/${data.runId}`));
  }

  async function loadCommitDiff(commit: Commit) {
    setDetailMode('commit');
    setDetailLoading(true);
    setDetailError(false);
    setDetailDiff('');
    setDetailFiles([]);
    setActiveFileKey('');
    setFileSearch('');
    setStatusFilter('all');
    setReviewedFiles({});
    setReviewedLines({});
    setFileComments([]);
    setCommentCounts({});
    setCommentAnchor(null);
    setCommentDraft('');
    try {
      const res = await fetch(`/api/commits/${commit.sha}?repo=${project.repo}&project_id=${project.id}`);
      if (!res.ok) throw new Error('diff_fetch_failed');
      const data = await res.json();
      const rawDiff = (data?.diff as string) || '';
      setDetailDiff(rawDiff);
      const parsedFiles = await parseDiff(rawDiff);
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

  async function loadCompareDiff(base: string, head: string) {
    if (!base || !head || base === head) {
      toast.warning(dict.commits.compareInvalid);
      return;
    }
    setDetailMode('compare');
    setDetailLoading(true);
    setDetailError(false);
    setDetailDiff('');
    setDetailFiles([]);
    setActiveFileKey('');
    setFileSearch('');
    setStatusFilter('all');
    setReviewedFiles({});
    setReviewedLines({});
    setFileComments([]);
    setCommentCounts({});
    setCommentAnchor(null);
    setCommentDraft('');
    try {
      const res = await fetch(`/api/commits/compare?repo=${project.repo}&project_id=${project.id}&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);
      if (!res.ok) throw new Error('diff_fetch_failed');
      const data = await res.json();
      const rawDiff = (data?.diff as string) || '';
      setDetailDiff(rawDiff);
      const parsedFiles = await parseDiff(rawDiff);
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

  async function openCommitDetail(commit: Commit) {
    setDetailCommit(commit);
    setDetailOpen(true);
    setCompareBase(project.default_branch);
    setCompareHead(branch);
    await loadCommitDiff(commit);
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
  const filteredFiles = useMemo(() => {
    const query = fileSearch.trim().toLowerCase();
    return detailFiles.filter((file) => {
      const matchesSearch = !query || file.displayPath.toLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'A') return file.status === 'A';
      if (statusFilter === 'D') return file.status === 'D';
      return file.status === 'M' || file.status === 'R' || file.status === 'C';
    });
  }, [detailFiles, fileSearch, statusFilter]);
  const activeDiffFile = useMemo(
    () => filteredFiles.find((file) => file.key === activeFileKey) ?? filteredFiles[0] ?? null,
    [activeFileKey, filteredFiles],
  );
  const baseDiffContent = useMemo(
    () => (activeDiffFile ? buildDiffContent(activeDiffFile) : null),
    [activeDiffFile],
  );
  const activeDiffContent = useMemo(
    () => (baseDiffContent ? normalizeDiffContent(baseDiffContent, diffOptions) : null),
    [baseDiffContent, diffOptions],
  );
  useEffect(() => {
    if (!diffOptions.syntaxHighlight || !activeDiffFile) {
      setDiffLanguage(null);
      return;
    }
    const targetPath = activeDiffFile.newPath || activeDiffFile.oldPath;
    if (!targetPath) {
      setDiffLanguage(null);
      return;
    }
    let cancelled = false;
    resolveLanguageSupportForPath(targetPath)
      .then((language) => {
        if (cancelled) return;
        setDiffLanguage(language);
      })
      .catch(() => {
        if (cancelled) return;
        setDiffLanguage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDiffFile, diffOptions.syntaxHighlight]);
  const highlightEnabled = useMemo(() => {
    if (!diffOptions.syntaxHighlight || !diffLanguage || !baseDiffContent) return false;
    const lineCount = Math.max(
      baseDiffContent.oldValue.split('\n').length,
      baseDiffContent.newValue.split('\n').length,
    );
    return lineCount <= MAX_HIGHLIGHT_LINES;
  }, [diffOptions.syntaxHighlight, diffLanguage, baseDiffContent]);
  const diffViewerStyles = useMemo(() => {
    const palette = {
      diffViewerBackground: 'hsl(var(--ds-background-1))',
      diffViewerTitleBackground: 'hsl(var(--ds-background-2))',
      diffViewerColor: 'hsl(var(--ds-text-1))',
      diffViewerTitleColor: 'hsl(var(--ds-text-2))',
      diffViewerTitleBorderColor: 'hsl(var(--ds-border-1))',
      addedBackground: 'hsl(var(--ds-success-7)/0.12)',
      addedColor: 'hsl(var(--ds-text-1))',
      removedBackground: 'hsl(var(--ds-danger-7)/0.12)',
      removedColor: 'hsl(var(--ds-text-1))',
      changedBackground: 'hsl(var(--ds-accent-7)/0.1)',
      wordAddedBackground: 'hsl(var(--ds-success-7)/0.24)',
      wordRemovedBackground: 'hsl(var(--ds-danger-7)/0.24)',
      addedGutterBackground: 'hsl(var(--ds-success-7)/0.18)',
      removedGutterBackground: 'hsl(var(--ds-danger-7)/0.18)',
      gutterBackground: 'hsl(var(--ds-background-2))',
      gutterBackgroundDark: 'hsl(var(--ds-background-2))',
      highlightBackground: 'hsl(var(--ds-accent-7)/0.16)',
      highlightGutterBackground: 'hsl(var(--ds-accent-7)/0.2)',
      codeFoldGutterBackground: 'hsl(var(--ds-background-2))',
      codeFoldBackground: 'hsl(var(--ds-background-2))',
      emptyLineBackground: 'hsl(var(--ds-background-1))',
      gutterColor: 'hsl(var(--ds-text-2))',
      addedGutterColor: 'hsl(var(--ds-text-2))',
      removedGutterColor: 'hsl(var(--ds-text-2))',
      codeFoldContentColor: 'hsl(var(--ds-text-2))',
    };
    return {
      variables: {
        light: palette,
        dark: palette,
      },
      diffContainer: {
        borderColor: 'hsl(var(--ds-border-1))',
      },
      contentText: {
        fontSize: '12px',
        lineHeight: 1.5,
      },
      lineNumber: {
        fontSize: '11px',
      },
    };
  }, []);
  const fileTree = useMemo(() => buildFileTree(filteredFiles), [filteredFiles]);
  const treeRows = useMemo(() => flattenFileTree(fileTree, collapsedDirs), [fileTree, collapsedDirs]);
  const diffSummary = useMemo(() => {
    if (!detailFiles.length) return null;
    let additions = 0;
    let deletions = 0;
    let binaries = 0;
    let largest: ParsedDiffFile | null = null;
    for (const file of detailFiles) {
      additions += file.additions;
      deletions += file.deletions;
      if (file.isBinary) binaries += 1;
      if (!largest || file.additions + file.deletions > largest.additions + largest.deletions) {
        largest = file;
      }
    }
    return {
      totalFiles: detailFiles.length,
      additions,
      deletions,
      binaries,
      largestFile: largest,
    };
  }, [detailFiles]);

  useEffect(() => {
    if (!detailOpen) return;
    if (filteredFiles.length === 0) return;
    const stillVisible = filteredFiles.some((file) => file.key === activeFileKey);
    if (!stillVisible) {
      const firstFile = filteredFiles.at(0);
      if (firstFile) {
        setActiveFileKey(firstFile.key);
      }
    }
  }, [detailOpen, filteredFiles, activeFileKey]);

  const loadReviewStatus = useCallback(async (commitSha: string) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/commits/review?commit=${commitSha}`);
      if (!res.ok) return;
      const data = await res.json();
      const fileMap: Record<string, boolean> = {};
      const lineMap: Record<string, boolean> = {};
      (data as ReviewEntry[]).forEach((entry) => {
        const key = `${entry.path}:${entry.line}`;
        if (entry.line === 0) {
          fileMap[entry.path] = true;
        } else {
          lineMap[key] = true;
        }
      });
      setReviewedFiles(fileMap);
      setReviewedLines(lineMap);
    } catch {
      /* ignore */
    }
  }, [project.id]);

  const loadFileComments = useCallback(async (commitSha: string, path: string) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/codebase/comments?commit=${commitSha}&path=${encodeURIComponent(path)}`);
      if (!res.ok) return;
      const data = await res.json();
      const comments = Array.isArray(data) ? data as CodebaseComment[] : [];
      setFileComments(comments);
      setCommentCounts((prev) => ({ ...prev, [path]: comments.length }));
    } catch {
      /* ignore */
    }
  }, [project.id]);

  useEffect(() => {
    if (!detailOpen || detailMode !== 'commit' || !detailCommit) return;
    void loadReviewStatus(detailCommit.sha);
  }, [detailOpen, detailMode, detailCommit, loadReviewStatus]);

  useEffect(() => {
    if (!detailOpen || detailMode !== 'commit' || !detailCommit || !activeDiffFile) return;
    const path = activeDiffFile.newPath || activeDiffFile.oldPath;
    if (!path) return;
    void loadFileComments(detailCommit.sha, path);
  }, [detailOpen, detailMode, detailCommit, activeDiffFile, loadFileComments]);

  useEffect(() => {
    setCommentAnchor(null);
    setCommentDraft('');
  }, [activeDiffFile?.key]);

  useEffect(() => {
    if (!detailOpen) return;
    setChangeAnchors([]);
    setActiveChangeIndex(0);
  }, [detailOpen, activeDiffFile?.key, detailMode, diffOptions.showDiffOnly, diffOptions.contextLines, diffOptions.ignoreCase, diffOptions.ignoreWhitespace]);

  const commentLineIds = useMemo(() => {
    const set = new Set<string>();
    if (!activeDiffFile) return set;
    const prefix = activeDiffFile.status === 'D' ? 'L' : 'R';
    for (const comment of fileComments) {
      if (comment.line > 0) {
        set.add(`${prefix}-${comment.line}`);
      }
    }
    return set;
  }, [activeDiffFile, fileComments]);

  const reviewedLineIds = useMemo(() => {
    const set = new Set<string>();
    Object.keys(reviewedLines).forEach((key) => {
      const [path, lineText] = key.split(':');
      if (!activeDiffFile) return;
      const activePath = activeDiffFile.newPath || activeDiffFile.oldPath;
      if (path !== activePath) return;
      const line = Number(lineText);
      if (!Number.isFinite(line) || line <= 0) return;
      const prefix = activeDiffFile.status === 'D' ? 'L' : 'R';
      set.add(`${prefix}-${line}`);
    });
    return set;
  }, [activeDiffFile, reviewedLines]);

  const highlightLines = useMemo(() => {
    const highlights = new Set<string>();
    if (commentAnchor) {
      highlights.add(commentAnchor.lineId);
    }
    commentLineIds.forEach((id) => highlights.add(id));
    reviewedLineIds.forEach((id) => highlights.add(id));
    return Array.from(highlights);
  }, [commentAnchor, commentLineIds, reviewedLineIds]);

  const syntaxCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    syntaxCacheRef.current.clear();
  }, [activeDiffFile, diffOptions.syntaxHighlight, diffLanguage]);

  const renderContent = useCallback((source?: string) => {
    const normalizedSource = typeof source === 'string' ? source : '';
    if (!highlightEnabled || !diffLanguage) {
      return <span>{normalizedSource}</span>;
    }
    if (normalizedSource.length === 0) {
      return <span>&nbsp;</span>;
    }
    const cached = syntaxCacheRef.current.get(normalizedSource);
    if (cached) {
      return <span dangerouslySetInnerHTML={{ __html: cached }} />;
    }
    const html = highlightLine(normalizedSource, diffLanguage);
    const value = html || escapeHtml(normalizedSource);
    syntaxCacheRef.current.set(normalizedSource, value);
    return <span dangerouslySetInnerHTML={{ __html: value }} />;
  }, [diffLanguage, highlightEnabled]);

  const renderGutter = useCallback((data: {
    lineNumber: number;
    prefix: LineNumberPrefix;
  }) => {
    const lineNumber = data.lineNumber;
    if (!lineNumber) {
      return <td className="w-6" />;
    }
    const lineId = `${data.prefix}-${lineNumber}`;
    const hasComment = commentLineIds.has(lineId);
    const isReviewed = reviewedLineIds.has(lineId);
    return (
      <td
        data-line-id={lineId}
        className="w-6 px-1 text-center align-middle text-[10px] text-[hsl(var(--ds-text-2))]"
      >
        {hasComment ? (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[hsl(var(--ds-accent-7)/0.45)] bg-[hsl(var(--ds-accent-7)/0.12)] text-[hsl(var(--ds-accent-7))]">
            <MessageSquare className="h-2.5 w-2.5" />
          </span>
        ) : isReviewed ? (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[hsl(var(--ds-success-7)/0.45)] bg-[hsl(var(--ds-success-7)/0.12)] text-[hsl(var(--ds-success-7))]">
            <Check className="h-2.5 w-2.5" />
          </span>
        ) : (
          <span className="inline-flex h-2 w-2 rounded-full bg-[hsl(var(--ds-border-2))]" />
        )}
      </td>
    );
  }, [commentLineIds, reviewedLineIds]);

  const getDiffScrollContainer = useCallback(() => {
    const viewer = diffViewerRef.current as unknown as { state?: { scrollableContainerRef?: { current?: HTMLDivElement | null } } };
    return viewer?.state?.scrollableContainerRef?.current ?? null;
  }, []);

  const scrollToLineId = useCallback((lineId: string) => {
    const container = getDiffScrollContainer();
    if (!container) return;
    const target = container.querySelector(`[data-line-id="${lineId}"]`) as HTMLElement | null;
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
  }, [getDiffScrollContainer]);

  const refreshChangeAnchors = useCallback(() => {
    const viewer = diffViewerRef.current as unknown as { state?: { computedDiffResult?: Record<string, { lineInformation: Array<{ left?: { lineNumber?: number; type?: number }; right?: { lineNumber?: number; type?: number } }> }> } };
    const computed = viewer?.state?.computedDiffResult;
    const computedEntries = computed ? Object.values(computed) : [];
    const lineInformation = computedEntries[0]?.lineInformation ?? [];
    if (!lineInformation.length) {
      setChangeAnchors([]);
      setActiveChangeIndex(0);
      return;
    }
    const anchors: string[] = [];
    let inBlock = false;
    for (const info of lineInformation) {
      const leftType = info.left?.type ?? 0;
      const rightType = info.right?.type ?? 0;
      const isChange = leftType !== 0 || rightType !== 0;
      if (isChange && !inBlock) {
        const lineNumber = info.right?.lineNumber ?? info.left?.lineNumber;
        const prefix = info.right?.lineNumber ? 'R' : 'L';
        if (lineNumber) {
          anchors.push(`${prefix}-${lineNumber}`);
        }
        inBlock = true;
      }
      if (!isChange) {
        inBlock = false;
      }
    }
    setChangeAnchors(anchors);
    setActiveChangeIndex(anchors.length ? 0 : 0);
  }, []);

  useEffect(() => {
    if (!detailOpen || !activeDiffFile) return;
    const timer = window.setTimeout(() => {
      refreshChangeAnchors();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [detailOpen, activeDiffFile, activeDiffContent?.oldValue, activeDiffContent?.newValue, diffOptions.showDiffOnly, diffOptions.contextLines, refreshChangeAnchors]);

  const goToChange = useCallback((direction: 'next' | 'prev') => {
    if (changeAnchors.length === 0) return;
    setActiveChangeIndex((prev) => {
      const nextIndex = direction === 'next'
        ? (prev + 1) % changeAnchors.length
        : (prev - 1 + changeAnchors.length) % changeAnchors.length;
      const targetLineId = changeAnchors[nextIndex];
      if (targetLineId) {
        scrollToLineId(targetLineId);
      }
      return nextIndex;
    });
  }, [changeAnchors, scrollToLineId]);

  const selectFileByOffset = useCallback((offset: number) => {
    if (!activeDiffFile || filteredFiles.length === 0) return;
    const index = filteredFiles.findIndex((file) => file.key === activeDiffFile.key);
    if (index === -1) return;
    const nextIndex = Math.min(filteredFiles.length - 1, Math.max(0, index + offset));
    const nextFile = filteredFiles[nextIndex];
    if (nextFile) {
      setActiveFileKey(nextFile.key);
    }
  }, [activeDiffFile, filteredFiles]);

  useEffect(() => {
    if (!detailOpen) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (event.key === 'n') {
        event.preventDefault();
        goToChange('next');
      }
      if (event.key === 'p') {
        event.preventDefault();
        goToChange('prev');
      }
      if (event.key === ']') {
        event.preventDefault();
        selectFileByOffset(1);
      }
      if (event.key === '[') {
        event.preventDefault();
        selectFileByOffset(-1);
      }
      if (event.key === 'f') {
        event.preventDefault();
        fileSearchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [detailOpen, goToChange, selectFileByOffset]);

  const openCodebaseAt = useCallback((path: string, line?: number) => {
    const ref = detailMode === 'commit' && detailCommit ? detailCommit.sha : compareHead || project.default_branch;
    const params = new URLSearchParams({ ref, path });
    if (line) params.set('line', String(line));
    const href = withOrgPrefix(pathname, `/projects/${project.id}/codebase?${params.toString()}`);
    window.open(href, '_blank');
  }, [detailCommit, detailMode, compareHead, project.default_branch, project.id, pathname]);

  const toggleFileReviewed = useCallback(async (file: ParsedDiffFile) => {
    if (!detailCommit) return;
    const path = file.newPath || file.oldPath;
    if (!path) return;
    const isReviewed = !!reviewedFiles[path];
    try {
      if (isReviewed) {
        const res = await fetch(`/api/projects/${project.id}/commits/review`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commit: detailCommit.sha, path }),
        });
        if (!res.ok) throw new Error('review_delete_failed');
      } else {
        const res = await fetch(`/api/projects/${project.id}/commits/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commit: detailCommit.sha, path }),
        });
        if (!res.ok) throw new Error('review_create_failed');
      }
      setReviewedFiles((prev) => ({ ...prev, [path]: !isReviewed }));
    } catch {
      toast.error(dict.commits.reviewUpdateFailed);
    }
  }, [detailCommit, project.id, reviewedFiles, dict.commits.reviewUpdateFailed]);

  const toggleLineReviewed = useCallback(async (path: string, lineNumber: number) => {
    if (!detailCommit) return;
    const key = `${path}:${lineNumber}`;
    const isReviewed = !!reviewedLines[key];
    try {
      if (isReviewed) {
        const res = await fetch(`/api/projects/${project.id}/commits/review`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commit: detailCommit.sha, path, line: lineNumber }),
        });
        if (!res.ok) throw new Error('review_delete_failed');
      } else {
        const res = await fetch(`/api/projects/${project.id}/commits/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commit: detailCommit.sha, path, line: lineNumber }),
        });
        if (!res.ok) throw new Error('review_create_failed');
      }
      setReviewedLines((prev) => ({ ...prev, [key]: !isReviewed }));
    } catch {
      toast.error(dict.commits.reviewUpdateFailed);
    }
  }, [detailCommit, project.id, reviewedLines, dict.commits.reviewUpdateFailed]);

  const handleLineNumberClick = useCallback((lineId: string, event: React.MouseEvent<HTMLTableCellElement>) => {
    if (detailMode !== 'commit' || !detailCommit || !activeDiffFile) {
      toast.warning(dict.commits.commentsDisabledCompare);
      return;
    }
    const container = getDiffScrollContainer();
    if (!container) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const top = rect.top - containerRect.top + container.scrollTop;
    const [, lineText] = lineId.split('-');
    const lineNumber = Number(lineText);
    if (!Number.isFinite(lineNumber)) return;
    setCommentAnchor({
      lineId,
      lineNumber,
      top,
    });
    setCommentDraft('');
  }, [detailCommit, detailMode, activeDiffFile, dict.commits.commentsDisabledCompare, getDiffScrollContainer]);

  const submitInlineComment = useCallback(async () => {
    if (!commentAnchor || !detailCommit || !activeDiffFile) return;
    const path = activeDiffFile.newPath || activeDiffFile.oldPath;
    if (!path) return;
    const body = commentDraft.trim();
    if (!body) return;
    setCommentSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/codebase/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: detailCommit.sha,
          commit: detailCommit.sha,
          path,
          line: commentAnchor.lineNumber,
          body,
        }),
      });
      if (!res.ok) throw new Error('comment_create_failed');
      const data = await res.json();
      setFileComments((prev) => [...prev, data as CodebaseComment]);
      setCommentCounts((prev) => ({ ...prev, [path]: (prev[path] ?? 0) + 1 }));
      setCommentDraft('');
      setCommentAnchor(null);
    } catch {
      toast.error(dict.commits.commentFailed);
    } finally {
      setCommentSubmitting(false);
    }
  }, [commentAnchor, detailCommit, activeDiffFile, commentDraft, project.id, dict.commits.commentFailed]);

  const copyFilePath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success(dict.common.copied);
    } catch {
      toast.error(dict.common.error);
    }
  }, [dict.common.copied, dict.common.error]);

  useEffect(() => {
    if (!commentAnchor) return;
    const container = getDiffScrollContainer();
    if (!container) return;
    const handleScroll = () => setCommentAnchor(null);
    container.addEventListener('scroll', handleScroll, { once: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [commentAnchor, getDiffScrollContainer]);

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
                <div className="text-[12px] text-[hsl(var(--ds-text-2))] mb-1">{dict.codeReviews.modeLabel}</div>
                <div className="text-[13px] font-semibold">{dict.codeReviews.modeDiff}</div>
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
        <DialogContent className="w-[96vw] max-w-[1400px] max-h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{dict.commits.commitChanges}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-1 min-h-0 flex-col">
            {detailMode === 'commit' && detailCommit && (
              <div className="text-[12px] text-[hsl(var(--ds-text-2))] flex flex-wrap items-center gap-2">
                <code className="rounded-[4px] bg-[hsl(var(--ds-surface-2))] px-2 py-0.5">{detailCommit.sha.slice(0, 7)}</code>
                <span className="text-foreground">{detailCommit.message}</span>
                <span className="text-[hsl(var(--ds-text-2))]">·</span>
                <span>{detailCommit.author}</span>
                <span className="text-[hsl(var(--ds-text-2))]">·</span>
                <span>{formatDate(detailCommit.date)}</span>
              </div>
            )}
            {detailMode === 'compare' && (
              <div className="text-[12px] text-[hsl(var(--ds-text-2))] flex flex-wrap items-center gap-2">
                <Badge variant="outline">{compareBase}</Badge>
                <span>→</span>
                <Badge variant="outline">{compareHead}</Badge>
                {diffSummary?.largestFile && (
                  <>
                    <span className="text-[hsl(var(--ds-text-2))]">·</span>
                    <span>{dict.commits.largestFile.replace('{{path}}', diffSummary.largestFile.newPath || diffSummary.largestFile.oldPath || diffSummary.largestFile.displayPath)}</span>
                  </>
                )}
              </div>
            )}
            <div className="mt-4 flex flex-1 min-h-0 flex-col border border-[hsl(var(--ds-border-1))] rounded-[8px] !overflow-hidden bg-[hsl(var(--ds-background-1))]">
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
              <div className="flex-1 min-h-0 grid grid-cols-[300px_minmax(0,1fr)]">
                <aside className="h-full min-h-0 border-r border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] grid grid-rows-[auto_minmax(0,1fr)]">
                  <div className="px-3 py-2 border-b border-[hsl(var(--ds-border-1))] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--ds-text-2))]">
                        {dict.commits.filesChanged.replace('{{count}}', String(detailFiles.length))}
                      </div>
                      {diffSummary && (
                        <div className="flex items-center gap-1">
                          <Badge variant="success">{`+${diffSummary.additions}`}</Badge>
                          <Badge variant="danger">{`-${diffSummary.deletions}`}</Badge>
                        </div>
                      )}
                    </div>
                    <Input
                      ref={fileSearchRef}
                      value={fileSearch}
                      onChange={(event) => setFileSearch(event.target.value)}
                      placeholder={dict.commits.fileSearchPlaceholder}
                    />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['all', 'A', 'M', 'D'] as const).map((value) => {
                        const label =
                          value === 'all'
                            ? dict.commits.filterAll
                            : value === 'A'
                              ? dict.commits.filterAdded
                              : value === 'D'
                                ? dict.commits.filterDeleted
                                : dict.commits.filterModified;
                        const isActive = statusFilter === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setStatusFilter(value)}
                            className={[
                              'px-2 py-1 rounded-[5px] text-[11px] border transition-colors',
                              isActive
                                ? 'border-[hsl(var(--ds-accent-7)/0.5)] text-foreground bg-[hsl(var(--ds-accent-7)/0.14)]'
                                : 'border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-surface-1))]',
                            ].join(' ')}
                          >
                            {label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          if (Object.values(collapsedDirs).some(Boolean)) {
                            setCollapsedDirs({});
                          } else {
                            const collapsed: Record<string, boolean> = {};
                            treeRows.filter((node) => node.isDir).forEach((node) => {
                              collapsed[node.path] = true;
                            });
                            setCollapsedDirs(collapsed);
                          }
                        }}
                        className="ml-auto flex items-center gap-1 rounded-[5px] border border-[hsl(var(--ds-border-1))] px-2 py-1 text-[11px] text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-surface-1))]"
                      >
                        <ChevronsUpDown className="h-3 w-3" />
                        {dict.commits.toggleFolders}
                      </button>
                    </div>
                  </div>
                  <div
                    className="h-full min-h-0 overflow-y-auto overscroll-contain p-2 space-y-1"
                    onWheel={(event) => {
                      const container = event.currentTarget;
                      if (container.scrollHeight <= container.clientHeight) return;
                      event.preventDefault();
                      event.stopPropagation();
                      container.scrollTop += event.deltaY;
                    }}
                  >
                    {treeRows.map((node) => {
                      if (node.isDir) {
                        const isCollapsed = collapsedDirs[node.path];
                        const depthPadding = Math.min(node.depth * TREE_INDENT_STEP, TREE_MAX_INDENT);
                        return (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => setCollapsedDirs((prev) => ({ ...prev, [node.path]: !prev[node.path] }))}
                            className="w-full text-left rounded-[6px] px-2.5 py-2 border border-transparent hover:border-[hsl(var(--ds-border-1))] hover:bg-[hsl(var(--ds-surface-1))]"
                          >
                            <div className="flex items-center gap-2" style={{ paddingLeft: `${depthPadding}px` }}>
                              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              <span className="text-[12px] text-foreground">{node.name}</span>
                            </div>
                          </button>
                        );
                      }
                      const file = node.file;
                      if (!file) return null;
                      const isActive = (activeDiffFile?.key ?? '') === file.key;
                      const filePath = file.newPath || file.oldPath || file.displayPath;
                      const parentPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
                      const depthPadding = Math.min(node.depth * TREE_INDENT_STEP, TREE_MAX_INDENT);
                      const commentCount = commentCounts[filePath] ?? 0;
                      const isReviewed = !!reviewedFiles[filePath];
                      return (
                        <div
                          key={file.key}
                          onClick={() => setActiveFileKey(file.key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setActiveFileKey(file.key);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isActive}
                          className={[
                            'group w-full text-left rounded-[6px] px-2.5 py-2 border transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ds-accent-7)/0.45)]',
                            isActive
                              ? 'bg-[hsl(var(--ds-accent-7)/0.12)] border-[hsl(var(--ds-accent-7)/0.3)]'
                              : 'bg-transparent border-transparent hover:bg-[hsl(var(--ds-surface-1))] hover:border-[hsl(var(--ds-border-1))]',
                          ].join(' ')}
                        >
                          <div className="flex items-start gap-2" style={{ paddingLeft: `${depthPadding}px` }}>
                            <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-[4px] border text-[11px] font-semibold ${STATUS_STYLES[file.status]}`}>
                              {file.status}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="min-w-0 flex-1 truncate whitespace-nowrap text-[12px] leading-5" title={filePath}>
                                  {node.name}
                                </div>
                                <span className="shrink-0 text-[11px] text-[hsl(var(--ds-text-2))]">
                                  {dict.commits.fileStats
                                    .replace('{{additions}}', String(file.additions))
                                    .replace('{{deletions}}', String(file.deletions))}
                                </span>
                                {isReviewed && <Badge variant="success">{dict.commits.reviewed}</Badge>}
                              </div>
                              {(parentPath || commentCount > 0) && (
                                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[hsl(var(--ds-text-2))]">
                                  {parentPath && (
                                    <div
                                      className="min-w-0 flex-1 truncate whitespace-nowrap"
                                      title={parentPath}
                                    >
                                      {parentPath}
                                    </div>
                                  )}
                                  {commentCount > 0 && (
                                    <span className="inline-flex shrink-0 items-center gap-1">
                                      <MessageSquare className="h-3 w-3" />
                                      {commentCount}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div
                              className={[
                                'shrink-0 overflow-hidden transition-[width,opacity] duration-100',
                                isActive
                                  ? 'w-6 opacity-100'
                                  : 'w-0 opacity-0 group-hover:w-6 group-hover:opacity-100 group-focus-within:w-6 group-focus-within:opacity-100',
                              ].join(' ')}
                            >
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    aria-label={dict.common.actions}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                    }}
                                    onKeyDown={(event) => {
                                      event.stopPropagation();
                                    }}
                                  >
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      if (filePath) void copyFilePath(filePath);
                                    }}
                                    className="gap-2"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    {dict.common.copy}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      if (filePath) openCodebaseAt(filePath);
                                    }}
                                    className="gap-2"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    {dict.commits.openInCodebase}
                                  </DropdownMenuItem>
                                  {detailMode === 'commit' && (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        void toggleFileReviewed(file);
                                      }}
                                      className="gap-2"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      {dict.commits.markReviewed}
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {filteredFiles.length === 0 && (
                      <div className="px-2 py-3 text-[12px] text-[hsl(var(--ds-text-2))]">
                        {dict.commits.noMatchingFiles}
                      </div>
                    )}
                  </div>
                </aside>
                <div className="flex flex-col h-full min-w-0 bg-[hsl(var(--ds-background-1))]">
                  <div className="px-4 py-3 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))]">
                    <div className="flex flex-wrap items-center gap-3">
                      <Tabs
                        value={detailMode}
                        onValueChange={(value) => {
                          const mode = value as DiffMode;
                          setDetailMode(mode);
                          if (mode === 'commit' && detailCommit) {
                            void loadCommitDiff(detailCommit);
                          }
                          if (mode === 'compare') {
                            void loadCompareDiff(compareBase, compareHead);
                          }
                        }}
                      >
                        <TabsList>
                          <TabsTrigger value="commit">{dict.commits.commitDiff}</TabsTrigger>
                          <TabsTrigger value="compare">{dict.commits.compareDiff}</TabsTrigger>
                        </TabsList>
                      </Tabs>
                      {detailMode === 'compare' && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Select value={compareBase} onValueChange={(value) => setCompareBase(value)}>
                            <SelectTrigger className="h-8 w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {branchItems.map(item => (
                                <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-[11px] text-[hsl(var(--ds-text-2))]">→</span>
                          <Select value={compareHead} onValueChange={(value) => setCompareHead(value)}>
                            <SelectTrigger className="h-8 w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {branchItems.map(item => (
                                <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="sm" variant="outline" onClick={() => loadCompareDiff(compareBase, compareHead)}>
                            {dict.commits.compareAction}
                          </Button>
                        </div>
                      )}
                      <div className="ml-auto flex items-center gap-2 text-[11px] text-[hsl(var(--ds-text-2))]">
                        <Button size="icon" variant="ghost" onClick={() => goToChange('prev')} disabled={changeAnchors.length === 0}>
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <span>
                          {changeAnchors.length === 0
                            ? dict.commits.noChanges
                            : `${activeChangeIndex + 1}/${changeAnchors.length}`}
                        </span>
                        <Button size="icon" variant="ghost" onClick={() => goToChange('next')} disabled={changeAnchors.length === 0}>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Separator orientation="vertical" className="h-4" />
                        <Button size="sm" variant="ghost" onClick={() => selectFileByOffset(-1)}>
                          {dict.common.previous}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => selectFileByOffset(1)}>
                          {dict.common.next}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={diffOptions.showDiffOnly}
                          onCheckedChange={(value) => setDiffOptions((prev) => ({ ...prev, showDiffOnly: value }))}
                        />
                        <span className="text-[12px]">{dict.commits.showDiffOnly}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={diffOptions.ignoreWhitespace}
                          onCheckedChange={(value) => setDiffOptions((prev) => ({ ...prev, ignoreWhitespace: value }))}
                        />
                        <span className="text-[12px]">{dict.commits.ignoreWhitespace}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={diffOptions.ignoreCase}
                          onCheckedChange={(value) => setDiffOptions((prev) => ({ ...prev, ignoreCase: value }))}
                        />
                        <span className="text-[12px]">{dict.commits.ignoreCase}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={diffOptions.syntaxHighlight}
                          onCheckedChange={(value) => setDiffOptions((prev) => ({ ...prev, syntaxHighlight: value }))}
                        />
                        <span className="text-[12px]">{dict.commits.syntaxHighlight}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.commits.contextLines}</span>
                        <Select
                          value={String(diffOptions.contextLines)}
                          onValueChange={(value) => setDiffOptions((prev) => ({ ...prev, contextLines: Number(value) }))}
                        >
                          <SelectTrigger className="h-8 w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3">{dict.commits.context3}</SelectItem>
                            <SelectItem value="5">{dict.commits.context5}</SelectItem>
                            <SelectItem value="10">{dict.commits.context10}</SelectItem>
                            <SelectItem value="-1">{dict.commits.contextAll}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {!highlightEnabled && diffOptions.syntaxHighlight && (
                        <Badge variant="muted">{dict.commits.syntaxDisabled}</Badge>
                      )}
                    </div>
                    {(diffOptions.ignoreCase || diffOptions.ignoreWhitespace) && (
                      <div className="mt-2 text-[11px] text-[hsl(var(--ds-text-2))]">
                        {dict.commits.normalizedViewHint}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 relative">
                    {activeDiffFile ? (
                      activeDiffFile.isBinary ? (
                        <div className="p-6 text-[13px] text-[hsl(var(--ds-text-2))]">
                          {dict.commits.binaryFileNotice}
                        </div>
                      ) : (
                        <div className="commit-diff-viewer h-full">
                          <ReactDiffViewer
                            ref={diffViewerRef}
                            oldValue={activeDiffContent?.oldValue ?? ''}
                            newValue={activeDiffContent?.newValue ?? ''}
                            splitView
                            showDiffOnly={diffOptions.showDiffOnly}
                            extraLinesSurroundingDiff={diffOptions.contextLines}
                            compareMethod={
                              diffOptions.ignoreCase || diffOptions.ignoreWhitespace
                                ? DiffMethod.WORDS
                                : DiffMethod.WORDS_WITH_SPACE
                            }
                            styles={diffViewerStyles}
                            renderContent={renderContent}
                            renderGutter={renderGutter}
                            highlightLines={highlightLines}
                            onLineNumberClick={handleLineNumberClick}
                            infiniteLoading={{ pageSize: DIFF_PAGE_SIZE, containerHeight: '100%' }}
                            leftTitle={`${dict.commits.original} · ${activeDiffFile.oldPath || '/dev/null'}`}
                            rightTitle={`${dict.commits.modified} · ${activeDiffFile.newPath || '/dev/null'}`}
                          />
                          {commentAnchor && (
                            <div
                              className="absolute left-6 z-20 w-[320px] rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] shadow-[0_12px_32px_hsl(0_0%_0%/0.35)] p-3"
                              style={{ top: commentAnchor.top }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-[12px] font-medium">
                                  {dict.commits.commentOnLine.replace('{{line}}', String(commentAnchor.lineNumber))}
                                </div>
                                <Button size="icon" variant="ghost" onClick={() => setCommentAnchor(null)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              <Textarea
                                value={commentDraft}
                                onChange={(event) => setCommentDraft(event.target.value)}
                                placeholder={dict.commits.commentPlaceholder}
                                className="mt-2 min-h-[90px]"
                              />
                              <div className="mt-2 flex items-center justify-between">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const path = activeDiffFile.newPath || activeDiffFile.oldPath;
                                    if (path) void toggleLineReviewed(path, commentAnchor.lineNumber);
                                  }}
                                >
                                  {dict.commits.markReviewed}
                                </Button>
                                <Button size="sm" onClick={submitInlineComment} disabled={commentSubmitting}>
                                  {commentSubmitting ? dict.common.loading : dict.commits.postComment}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="p-6 text-[13px] text-[hsl(var(--ds-text-2))]">{dict.commits.selectFileToView}</div>
                    )}
                  </div>
                  <div className="border-t border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-3 max-h-[180px] overflow-auto">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[12px] font-medium">{dict.commits.inlineComments}</div>
                      {activeDiffFile && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const path = activeDiffFile.newPath || activeDiffFile.oldPath;
                            if (path) openCodebaseAt(path);
                          }}
                        >
                          {dict.commits.openInCodebase}
                        </Button>
                      )}
                    </div>
                    {detailMode !== 'commit' ? (
                      <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.commits.commentsDisabledCompare}</div>
                    ) : fileComments.length === 0 ? (
                      <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.commits.noComments}</div>
                    ) : (
                      <div className="space-y-3">
                        {fileComments.map((comment) => (
                          <div key={comment.id} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-3">
                            <div className="flex items-center justify-between text-[11px] text-[hsl(var(--ds-text-2))]">
                              <span>{comment.author_email ?? dict.commits.unknownAuthor}</span>
                              <span>{formatLocalDate(comment.created_at)}</span>
                            </div>
                            <div className="mt-1 text-[12px] text-foreground">
                              {comment.body}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>{dict.common.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
