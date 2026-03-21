'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EditorView } from '@codemirror/view';
import {
  CheckCircle2,
  CircleDot,
  Copy,
  FileText,
  Folder,
  FolderUp,
  RefreshCcw,
  Search,
  Send,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import type { Dictionary } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import CodeViewer, { type CodeLineClickPayload, type CodeSelectionPayload } from '@/components/codebase/CodeViewer';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatLocalDateTime } from '@/lib/dateFormat';
import { Combobox } from '@/components/ui/combobox';

type Project = {
  id: string;
  name: string;
  repo: string;
  default_branch: string;
  org_id: string;
};

type TreeEntry = {
  path: string;
  name: string;
  type: 'tree' | 'blob';
  size?: number;
};

type TreeResponse = {
  ref: string;
  commit: string;
  path: string;
  entries: TreeEntry[];
};

type FileResponse = {
  path: string;
  ref: string;
  commit: string;
  size: number;
  content: string;
  truncated: boolean;
  isBinary: boolean;
};

type OrgMember = {
  user_id: string;
  email: string | null;
  role: string;
  status?: string;
};

type CommentAssignee = {
  user_id: string;
  email: string | null;
};

type CodebaseComment = {
  id: string;
  thread_id: string;
  thread_status: 'open' | 'resolved';
  thread_line?: number | null;
  thread_line_end?: number | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  projection_status?: 'exact' | 'shifted' | 'ambiguous' | 'outdated' | 'missing' | null;
  projection_confidence?: number | null;
  projection_reason_code?: string | null;
  projection_target_commit?: string | null;
  anchor_commit_sha?: string | null;
  anchor_path?: string | null;
  line: number;
  line_end?: number | null;
  selection_text?: string | null;
  body: string;
  author_email: string;
  created_at: string;
  assignees?: CommentAssignee[] | null;
};

type CodebaseCommentThread = {
  id: string;
  status: 'open' | 'resolved';
  line: number;
  lineEnd: number;
  resolvedAt: string | null;
  resolvedBy: string | null;
  comments: CodebaseComment[];
};

type DraftSelection = {
  lineStart: number;
  lineEnd: number;
  threadId?: string;
  text: string;
  from?: number;
  to?: number;
};

type CachedValue<T> = {
  value: T;
  expiresAt: number;
};

const COMPOSER_WIDTH = 420;
const MAX_SELECTION_TEXT = 1200;
const TREE_CACHE_TTL_MS = 20_000;
const FILE_CACHE_TTL_MS = 60_000;
const TREE_CACHE_MAX_ENTRIES = 240;
const FILE_CACHE_MAX_ENTRIES = 180;

function isCommitSha(value: string) {
  return /^[0-9a-f]{7,40}$/i.test(value.trim());
}

function parentDir(filePath: string) {
  const cleaned = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export default function CodebaseClient({
  project,
  branches,
  dict,
}: {
  project: Project;
  branches: string[];
  dict: Dictionary;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [branch, setBranch] = useState<string>(branches[0] ?? project.default_branch);
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  const [filePath, setFilePath] = useState<string | null>(null);
  const [anchorLine, setAnchorLine] = useState<number | null>(null);
  const [commentSelectionRange, setCommentSelectionRange] = useState<{ from: number; to: number } | null>(null);
  const [fileData, setFileData] = useState<FileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [comments, setComments] = useState<CodebaseComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadFilter, setThreadFilter] = useState<'all' | 'open' | 'resolved' | 'mine'>('all');
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [draftSelection, setDraftSelection] = useState<DraftSelection | null>(null);
  const [inlineThreadTop, setInlineThreadTop] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastLineClicked, setLastLineClicked] = useState<number | null>(null);
  const [forceSyncUntil, setForceSyncUntil] = useState(0);
  const [editorReadyKey, setEditorReadyKey] = useState(0);

  const treeRequestId = useRef(0);
  const fileRequestId = useRef(0);
  const commentRequestId = useRef(0);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const codeContainerRef = useRef<HTMLDivElement | null>(null);
  const codeScrollerRef = useRef<HTMLElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const pendingScrollLineRef = useRef<number | null>(null);
  const handledDeepLinkKeyRef = useRef<string | null>(null);
  const handledCommentDeepLinkRef = useRef<string | null>(null);
  const urlSyncReadyRef = useRef(false);
  const treeCacheRef = useRef<Map<string, CachedValue<TreeResponse>>>(new Map());
  const fileCacheRef = useRef<Map<string, CachedValue<FileResponse>>>(new Map());
  const suppressOutsideComposerCloseRef = useRef(false);

  const updateInlineThreadPosition = useCallback((lineNumber: number) => {
    const view = editorViewRef.current;
    const container = codeContainerRef.current;
    if (!view || !container) return;
    const safeLine = Math.max(1, Math.min(view.state.doc.lines, Math.trunc(lineNumber)));
    const lineInfo = view.state.doc.line(safeLine);
    const coords = view.coordsAtPos(lineInfo.from);
    if (!coords) return;
    const containerRect = container.getBoundingClientRect();
    const top = coords.bottom - containerRect.top + 8;
    setInlineThreadTop(Math.max(12, top));
  }, []);

  const markCommentInteractionStart = useCallback(() => {
    suppressOutsideComposerCloseRef.current = true;
    queueMicrotask(() => {
      suppressOutsideComposerCloseRef.current = false;
    });
  }, []);

  const availableBranches = useMemo(() => {
    return Array.from(new Set(branches.map((item) => item.trim()).filter(Boolean)));
  }, [branches]);

  const activeRef = useMemo(() => {
    const current = branch.trim();
    if (current && (isCommitSha(current) || availableBranches.includes(current))) {
      return current;
    }
    return availableBranches[0] ?? '';
  }, [availableBranches, branch]);

  const branchOptions = useMemo(() => {
    const items = [...availableBranches];
    if (activeRef && isCommitSha(activeRef) && !items.includes(activeRef)) {
      items.unshift(activeRef);
    }
    return items.map((item) => ({
      value: item,
      label: isCommitSha(item) && !availableBranches.includes(item)
        ? `${dict.reports.commit}: ${item.slice(0, 7)}`
        : item,
      keywords: [item],
    }));
  }, [activeRef, availableBranches, dict.reports.commit]);

  const deepLinkPath = searchParams.get('path');
  const deepLinkRef = searchParams.get('ref');
  const deepLinkLine = searchParams.get('line');
  const deepLinkCommentId = searchParams.get('commentId');

  useEffect(() => {
    if (!project.org_id) return;
    let active = true;
    setMembersLoading(true);
    setMembersError(false);
    fetch(`/api/orgs/${project.org_id}/members`)
      .then((res) => {
        if (!res.ok) throw new Error('members_fetch_failed');
        return res.json();
      })
      .then((data: OrgMember[]) => {
        if (!active) return;
        setMembers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setMembersError(true);
      })
      .finally(() => {
        if (!active) return;
        setMembersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project.org_id]);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        const email = typeof data?.user?.email === 'string' ? data.user.email : null;
        setCurrentUserEmail(email);
      })
      .catch(() => {
        if (!active) return;
        setCurrentUserEmail(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadFile = useCallback(async (path: string, forceSync?: boolean, refOverride?: string) => {
    const requestId = ++fileRequestId.current;
    setFileLoading(true);
    setFileError(null);
    setFilePath(path);
    try {
      const normalizedOverride = refOverride?.trim() || '';
      const effectiveRef = normalizedOverride || activeRef;
      if (normalizedOverride && normalizedOverride !== branch) {
        setBranch(normalizedOverride);
      }
      const shouldForceSync = forceSync ? true : forceSyncUntil > Date.now();
      const cacheKey = makeFileCacheKey(project.id, effectiveRef, path);
      if (!shouldForceSync) {
        const cached = getCachedValue(fileCacheRef.current, cacheKey);
        if (cached) {
          if (fileRequestId.current !== requestId) return;
          setFileData(cached);
          setComments([]);
          setActiveThreadId(null);
          setDraftSelection(null);
          setDraftBody('');
          setAssigneeIds([]);
          setCommentError(null);
          setFileLoading(false);
          return;
        }
      }

      setFileData(null);
      const params = new URLSearchParams();
      if (effectiveRef) params.set('ref', effectiveRef);
      params.set('sync', shouldForceSync ? '1' : '0');
      params.set('path', path);
      const res = await fetch(`/api/projects/${project.id}/codebase/file?${params.toString()}`);
      if (!res.ok) throw new Error('file_fetch_failed');
      const data = (await res.json()) as FileResponse;
      if (fileRequestId.current !== requestId) return;
      setCachedValue(fileCacheRef.current, cacheKey, data, FILE_CACHE_TTL_MS, FILE_CACHE_MAX_ENTRIES);
      setFileData(data);
      setComments([]);
      setActiveThreadId(null);
      setDraftSelection(null);
      setDraftBody('');
      setAssigneeIds([]);
      setCommentError(null);
    } catch (err) {
      if (fileRequestId.current !== requestId) return;
      setFileError(err instanceof Error ? err.message : 'file_fetch_failed');
    } finally {
      if (fileRequestId.current !== requestId) return;
      setFileLoading(false);
    }
  }, [activeRef, branch, forceSyncUntil, project.id]);

  const loadFileRef = useRef(loadFile);
  useEffect(() => {
    loadFileRef.current = loadFile;
  }, [loadFile]);

  const loadComments = useCallback(async (path: string, commit?: string | null) => {
    const requestId = ++commentRequestId.current;
    setCommentsLoading(true);
    setCommentError(null);
    try {
      const params = new URLSearchParams();
      if (activeRef) params.set('ref', activeRef);
      if (commit) params.set('commit', commit);
      params.set('path', path);
      const res = await fetch(`/api/projects/${project.id}/codebase/comments?${params.toString()}`);
      if (!res.ok) throw new Error('comments_fetch_failed');
      const data = (await res.json()) as CodebaseComment[];
      if (commentRequestId.current !== requestId) return;
      setComments(Array.isArray(data) ? data : []);
    } catch (err) {
      if (commentRequestId.current !== requestId) return;
      setCommentError(err instanceof Error ? err.message : 'comments_fetch_failed');
    } finally {
      if (commentRequestId.current !== requestId) return;
      setCommentsLoading(false);
    }
  }, [activeRef, project.id]);

  // Deep link support: open a file (optionally at a specific ref).
  useEffect(() => {
    if (!deepLinkPath) {
      handledDeepLinkKeyRef.current = null;
      const nextRef = deepLinkRef?.trim() ?? '';
      if (nextRef && nextRef !== branch) {
        setBranch(nextRef);
      }
      urlSyncReadyRef.current = true;
      return;
    }
    const deepLinkKey = `${deepLinkPath}|${deepLinkRef ?? ''}`;
    if (handledDeepLinkKeyRef.current === deepLinkKey) return;
    handledDeepLinkKeyRef.current = deepLinkKey;

    const targetPath = deepLinkPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!targetPath) {
      urlSyncReadyRef.current = true;
      return;
    }

    const refOverride = deepLinkRef?.trim() || undefined;
    const sameFile = filePath === targetPath;
    const sameRef = !refOverride || refOverride === activeRef;
    setCurrentPath(parentDir(targetPath));

    if (sameFile && sameRef) {
      urlSyncReadyRef.current = true;
      return;
    }

    void loadFileRef.current(targetPath, false, refOverride);
    urlSyncReadyRef.current = true;
  }, [activeRef, branch, deepLinkPath, deepLinkRef, filePath]);

  // Deep link support: line anchor sync is independent from file loading.
  useEffect(() => {
    if (!deepLinkPath) return;
    const parsedLine = deepLinkLine ? Number(deepLinkLine) : Number.NaN;
    const normalizedLine = Number.isFinite(parsedLine)
      ? Math.max(1, Math.trunc(parsedLine))
      : null;
    pendingScrollLineRef.current = normalizedLine;
    setAnchorLine(normalizedLine);
  }, [deepLinkLine, deepLinkPath]);

  // Keep URL in sync with current codebase anchor state so refresh/back keeps context.
  useEffect(() => {
    if (!urlSyncReadyRef.current) return;
    const params = new URLSearchParams(searchParams.toString());
    const nextRef = activeRef.trim();

    if (nextRef) {
      params.set('ref', nextRef);
    } else {
      params.delete('ref');
    }

    if (filePath) {
      params.set('path', filePath);
      if (anchorLine && anchorLine > 0) {
        params.set('line', String(anchorLine));
      } else {
        params.delete('line');
      }
      if (activeThreadId) {
        params.set('commentId', activeThreadId);
      } else {
        params.delete('commentId');
      }
    } else {
      params.delete('path');
      params.delete('line');
      params.delete('commentId');
    }

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery === currentQuery) return;
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [activeRef, activeThreadId, anchorLine, filePath, pathname, router, searchParams]);

  useEffect(() => {
    const requestId = ++treeRequestId.current;
    let active = true;

    async function loadTree() {
      const shouldForceSync = forceSyncUntil > Date.now();
      const cacheKey = makeTreeCacheKey(project.id, activeRef, currentPath);
      if (!shouldForceSync) {
        const cached = getCachedValue(treeCacheRef.current, cacheKey);
        if (cached) {
          setEntries(cached.entries || []);
          setTreeError(null);
          setTreeLoading(false);
          return;
        }
      }

      setTreeLoading(true);
      setTreeError(null);
      try {
        const params = new URLSearchParams();
        if (activeRef) params.set('ref', activeRef);
        params.set('sync', shouldForceSync ? '1' : '0');
        if (currentPath) params.set('path', currentPath);
        const res = await fetch(`/api/projects/${project.id}/codebase/tree?${params.toString()}`);
        if (!res.ok) throw new Error('tree_fetch_failed');
        const data = (await res.json()) as TreeResponse;
        if (!active || treeRequestId.current !== requestId) return;
        setCachedValue(treeCacheRef.current, cacheKey, data, TREE_CACHE_TTL_MS, TREE_CACHE_MAX_ENTRIES);
        setEntries(data.entries || []);
      } catch (err) {
        if (!active || treeRequestId.current !== requestId) return;
        setTreeError(err instanceof Error ? err.message : 'tree_fetch_failed');
      } finally {
        if (!active || treeRequestId.current !== requestId) return;
        setTreeLoading(false);
      }
    }

    void loadTree();
    return () => {
      active = false;
    };
  }, [activeRef, currentPath, forceSyncUntil, project.id, refreshKey]);

  useEffect(() => {
    if (!draftSelection) return;
    const handle = requestAnimationFrame(() => {
      replyRef.current?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [draftSelection]);

  useEffect(() => {
    if (!draftSelection) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (suppressOutsideComposerCloseRef.current) return;
      const target = event.target as Node;
      if (composerRef.current?.contains(target)) return;
      if (codeContainerRef.current?.contains(target)) {
        const targetElement = target instanceof Element ? target : target.parentElement;
        if (targetElement && isCommentInteractionTarget(targetElement)) {
          return;
        }
      }
      closeComposer();
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [draftSelection]);

  useEffect(() => {
    if (!draftSelection) return;
    const container = codeScrollerRef.current;
    if (!container) return;
    const handleScroll = () => {
      updateInlineThreadPosition(draftSelection.lineStart);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [draftSelection, updateInlineThreadPosition]);

  useEffect(() => {
    closeComposer();
  }, [filePath, branch]);

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/').filter(Boolean);
  }, [currentPath]);

  const activeMembers = useMemo(() => {
    return members.filter((member) => member.email && member.status !== 'invited');
  }, [members]);

  const memberById = useMemo(() => {
    return new Map(activeMembers.map((member) => [member.user_id, member]));
  }, [activeMembers]);

  const filteredEntries = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(query));
  }, [entries, deferredSearch]);

  const handleSelectBranch = (value: string) => {
    const nextBranch = value.trim();
    if (!nextBranch || nextBranch === branch) {
      return;
    }
    setBranch(nextBranch);
    setCurrentPath('');
    setEntries([]);
    setFilePath(null);
    setActiveThreadId(null);
    setAnchorLine(null);
    setCommentSelectionRange(null);
    setFileData(null);
    setFileError(null);
    setComments([]);
    setDraftSelection(null);
    setDraftBody('');
    setAssigneeIds([]);
    setCommentError(null);
    setSearch('');
    setLastLineClicked(null);
  };

  const handleSelectEntry = (entry: TreeEntry) => {
    if (entry.type === 'tree') {
      setCurrentPath(entry.path);
      setFilePath(null);
      setActiveThreadId(null);
      setAnchorLine(null);
      setCommentSelectionRange(null);
      setFileData(null);
      setFileError(null);
      setDraftSelection(null);
      setDraftBody('');
      setAssigneeIds([]);
      setCommentError(null);
      return;
    }
    setAnchorLine(null);
    setCommentSelectionRange(null);
    void loadFile(entry.path);
  };

  const parentPath = useMemo(() => {
    if (!currentPath) return '';
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
  }, [currentPath]);

  useEffect(() => {
    if (!filePath) return;
    void loadComments(filePath, fileData?.commit ?? null);
  }, [filePath, fileData?.commit, loadComments]);

  const lines = useMemo(() => {
    if (!fileData || fileData.isBinary || fileData.truncated) return [];
    return fileData.content.split('\n');
  }, [fileData]);

  const allThreads = useMemo<CodebaseCommentThread[]>(() => {
    const byThread = new Map<string, CodebaseCommentThread>();
    for (const comment of comments) {
      const resolvedLine = comment.thread_line ?? comment.line;
      if (!resolvedLine) continue;
      const lineStart = Math.max(1, Math.trunc(resolvedLine));
      const lineEnd = Math.max(lineStart, Math.trunc(comment.thread_line_end ?? comment.line_end ?? comment.line));
      const existing = byThread.get(comment.thread_id);
      if (!existing) {
        byThread.set(comment.thread_id, {
          id: comment.thread_id,
          status: comment.thread_status,
          line: lineStart,
          lineEnd,
          resolvedAt: comment.resolved_at ?? null,
          resolvedBy: comment.resolved_by ?? null,
          comments: [comment],
        });
        continue;
      }
      existing.comments.push(comment);
      existing.status = comment.thread_status;
      existing.line = Math.min(existing.line, lineStart);
      existing.lineEnd = Math.max(existing.lineEnd, lineEnd);
      existing.resolvedAt = comment.resolved_at ?? existing.resolvedAt;
      existing.resolvedBy = comment.resolved_by ?? existing.resolvedBy;
    }
    const threads = Array.from(byThread.values());
    for (const thread of threads) {
      thread.comments.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    }
    threads.sort((a, b) => a.line - b.line || Date.parse(a.comments[0]?.created_at ?? '') - Date.parse(b.comments[0]?.created_at ?? ''));
    return threads;
  }, [comments]);

  const threadById = useMemo(() => {
    return new Map(allThreads.map((thread) => [thread.id, thread]));
  }, [allThreads]);

  const filteredThreads = useMemo(() => {
    return allThreads.filter((thread) => {
      if (threadFilter === 'open' && thread.status !== 'open') return false;
      if (threadFilter === 'resolved' && thread.status !== 'resolved') return false;
      if (threadFilter === 'mine') {
        const me = currentUserEmail?.toLowerCase();
        if (!me) return false;
        return thread.comments.some((comment) => comment.author_email.toLowerCase() === me);
      }
      return true;
    });
  }, [allThreads, currentUserEmail, threadFilter]);

  const composerThread = useMemo(() => {
    if (!draftSelection?.threadId) return null;
    return threadById.get(draftSelection.threadId) ?? null;
  }, [draftSelection?.threadId, threadById]);

  const composerThreadComments = useMemo(() => {
    if (composerThread) return composerThread.comments;
    if (!draftSelection) return [];
    return allThreads
      .filter((thread) => rangesOverlap(
        draftSelection.lineStart,
        draftSelection.lineEnd,
        thread.line,
        thread.lineEnd
      ))
      .flatMap((thread) => thread.comments);
  }, [allThreads, composerThread, draftSelection]);

  useEffect(() => {
    if (!draftSelection?.threadId) return;
    const thread = threadById.get(draftSelection.threadId);
    if (!thread) return;
    updateInlineThreadPosition(thread.line);
  }, [draftSelection?.threadId, threadById, updateInlineThreadPosition]);

  const commentLineNumbers = useMemo(() => {
    const lineSet = new Set<number>();
    for (const thread of filteredThreads) {
      const start = thread.line;
      const end = thread.lineEnd;
      // Avoid rendering massive ranges as individual highlights.
      if (end - start > 120) {
        lineSet.add(start);
        lineSet.add(end);
        continue;
      }
      for (let line = start; line <= end; line += 1) {
        lineSet.add(line);
      }
    }
    return Array.from(lineSet).sort((a, b) => a - b);
  }, [filteredThreads]);

  const commentLinePreviews = useMemo<Record<number, string>>(() => {
    const previews: Record<number, string> = {};
    for (const thread of filteredThreads) {
      const latest = thread.comments[thread.comments.length - 1];
      if (!latest) continue;
      const raw = latest.body.replace(/\s+/g, ' ').trim();
      const preview = raw.length > 68 ? `${raw.slice(0, 68)}...` : raw;
      previews[thread.line] = preview || latest.author_email;
    }
    return previews;
  }, [filteredThreads]);

  const visibleThreadNavigator = useMemo(() => {
    if (filteredThreads.length === 0) return [];
    return filteredThreads.map((thread) => thread.id);
  }, [filteredThreads]);

  useEffect(() => {
    if (!activeThreadId) return;
    if (threadById.has(activeThreadId)) return;
    setActiveThreadId(null);
    setDraftSelection(null);
    setInlineThreadTop(null);
  }, [activeThreadId, threadById]);

  const handleSubmitComment = async () => {
    if (!filePath || !draftSelection || !draftBody.trim()) return;
    if (!fileData?.commit) {
      setCommentError('missing_commit');
      return;
    }
    setCommentSaving(true);
    try {
      const selectionText = normalizeSelectionText(draftSelection.text);
      const lineEnd = draftSelection.lineEnd !== draftSelection.lineStart ? draftSelection.lineEnd : undefined;
      const res = await fetch(`/api/projects/${project.id}/codebase/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          draftSelection.threadId
            ? {
                thread_id: draftSelection.threadId,
                assignees: assigneeIds.length ? assigneeIds : undefined,
                body: draftBody.trim(),
              }
            : {
                ref: fileData.ref || activeRef,
                commit: fileData.commit,
                path: filePath,
                line: draftSelection.lineStart,
                line_end: lineEnd,
                selection_text: selectionText || undefined,
                assignees: assigneeIds.length ? assigneeIds : undefined,
                body: draftBody.trim(),
              }
        ),
      });
      if (!res.ok) throw new Error('comment_create_failed');
      const created = await res.json() as CodebaseComment;
      setComments((prev) => {
        const next = [...prev, created];
        next.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
        return next;
      });
      setActiveThreadId(created.thread_id);
      setAnchorLine(created.thread_line ?? created.line);
      setDraftBody('');
      setCommentError(null);
      void loadComments(filePath, fileData.commit);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'comment_create_failed');
    } finally {
      setCommentSaving(false);
    }
  };

  const focusThread = useCallback((threadId: string, options?: { openComposer?: boolean }) => {
    const thread = threadById.get(threadId);
    if (!thread) return;
    setActiveThreadId(thread.id);
    setAnchorLine(thread.line);
    pendingScrollLineRef.current = thread.line;
    updateInlineThreadPosition(thread.line);
    setDraftSelection({
      lineStart: thread.line,
      lineEnd: thread.lineEnd,
      threadId: thread.id,
      text: '',
    });
    setCommentSelectionRange(null);
    if (options?.openComposer) {
      setDraftBody('');
    }
  }, [threadById, updateInlineThreadPosition]);

  const handleThreadStatusChange = useCallback(async (threadId: string, nextStatus: 'open' | 'resolved') => {
    const res = await fetch(`/api/projects/${project.id}/codebase/comments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, status: nextStatus }),
    });
    if (!res.ok) {
      throw new Error('thread_update_failed');
    }
    setComments((prev) => prev.map((comment) => (
      comment.thread_id === threadId
        ? {
            ...comment,
            thread_status: nextStatus,
          }
        : comment
    )));
    if (filePath) {
      void loadComments(filePath, fileData?.commit ?? null);
    }
  }, [fileData?.commit, filePath, loadComments, project.id]);

  useEffect(() => {
    if (!deepLinkCommentId) {
      handledCommentDeepLinkRef.current = null;
      return;
    }
    if (allThreads.length === 0) return;
    if (handledCommentDeepLinkRef.current === deepLinkCommentId) return;
    if (!threadById.has(deepLinkCommentId)) return;
    handledCommentDeepLinkRef.current = deepLinkCommentId;
    focusThread(deepLinkCommentId);
  }, [allThreads.length, deepLinkCommentId, focusThread, threadById]);


  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/codebase/sync?project_id=${project.id}&force=1`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('sync_failed');
      }
      treeCacheRef.current.clear();
      fileCacheRef.current.clear();
      setSyncMessage(dict.projects.codebaseSyncSuccess);
      setForceSyncUntil(Date.now() + 10_000);
      setRefreshKey((value) => value + 1);
      if (filePath) {
        await loadFile(filePath, true);
      }
    } catch {
      setSyncMessage(dict.projects.codebaseSyncFailed);
    } finally {
      setSyncing(false);
    }
  };

  const handleCopyPath = async () => {
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
      toast.success(dict.common.copied);
    } catch {
      toast.error(dict.common.error);
    }
  };

  const toggleAssignee = (userId: string) => {
    setAssigneeIds((prev) => (
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    ));
  };

  const selectedAssignees = useMemo(() => {
    return assigneeIds
      .map((id) => memberById.get(id))
      .filter((member): member is OrgMember => Boolean(member));
  }, [assigneeIds, memberById]);

  const openComposer = useCallback((
    lineStart: number,
    lineEnd: number,
    text: string,
    selectionRange?: { from: number; to: number } | null,
    threadId?: string
  ) => {
    const selectionText = normalizeSelectionText(text);
    setDraftSelection({
      lineStart,
      lineEnd,
      ...(threadId ? { threadId } : {}),
      text: selectionText,
      ...(selectionRange ? { from: selectionRange.from, to: selectionRange.to } : {}),
    });
    if (threadId) {
      setActiveThreadId(threadId);
    }
    updateInlineThreadPosition(lineStart);
    setCommentSelectionRange(selectionRange ?? null);
    setDraftBody('');
    setCommentError(null);
    setAssigneeIds([]);
  }, [updateInlineThreadPosition]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      const isTypingTarget = Boolean(
        target?.isContentEditable ||
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select'
      );
      if (isTypingTarget) return;
      const key = event.key.toLowerCase();

      if (key === 'c') {
        event.preventDefault();
        if (activeThreadId) {
          focusThread(activeThreadId, { openComposer: true });
          return;
        }
        if (anchorLine) {
          openComposer(anchorLine, anchorLine, '', null);
        }
        return;
      }

      if (visibleThreadNavigator.length === 0) return;
      const currentIndex = activeThreadId
        ? visibleThreadNavigator.indexOf(activeThreadId)
        : -1;

      if (key === 'j') {
        event.preventDefault();
        const nextIndex = currentIndex >= 0
          ? (currentIndex + 1) % visibleThreadNavigator.length
          : 0;
        const nextThreadId = visibleThreadNavigator[nextIndex];
        if (!nextThreadId) return;
        focusThread(nextThreadId);
        return;
      }

      if (key === 'k') {
        event.preventDefault();
        const nextIndex = currentIndex >= 0
          ? (currentIndex - 1 + visibleThreadNavigator.length) % visibleThreadNavigator.length
          : visibleThreadNavigator.length - 1;
        const nextThreadId = visibleThreadNavigator[nextIndex];
        if (!nextThreadId) return;
        focusThread(nextThreadId);
        return;
      }

      if (key === 'r' && activeThreadId) {
        event.preventDefault();
        const active = threadById.get(activeThreadId);
        if (!active) return;
        const nextStatus = active.status === 'resolved' ? 'open' : 'resolved';
        void handleThreadStatusChange(activeThreadId, nextStatus);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    activeThreadId,
    anchorLine,
    focusThread,
    handleThreadStatusChange,
    openComposer,
    threadById,
    visibleThreadNavigator,
  ]);

  const handleLineClick = (payload: CodeLineClickPayload) => {
    let lineStart = payload.line;
    let lineEnd = payload.line;
    if (payload.shiftKey && lastLineClicked) {
      lineStart = Math.min(lastLineClicked, payload.line);
      lineEnd = Math.max(lastLineClicked, payload.line);
    }
    setLastLineClicked(payload.line);
    const thread = allThreads.find((item) => payload.line >= item.line && payload.line <= item.lineEnd);
    setAnchorLine(lineStart);
    if (thread) {
      focusThread(thread.id);
      return;
    }
    setActiveThreadId(null);
    openComposer(lineStart, lineEnd, '', null);
  };

  const handleSelection = (payload: CodeSelectionPayload) => {
    const text = payload.text.trim();
    if (!text) return;
    setActiveThreadId(null);
    setAnchorLine(payload.lineStart);
    openComposer(
      payload.lineStart,
      payload.lineEnd,
      text,
      { from: payload.from, to: payload.to },
      undefined
    );
  };

  const handleEditorReady = useCallback((view: EditorView) => {
    editorViewRef.current = view;
    codeScrollerRef.current = view.scrollDOM;
    setEditorReadyKey((value) => value + 1);
  }, []);

  const closeComposer = () => {
    setDraftSelection(null);
    setInlineThreadTop(null);
    setActiveThreadId(null);
    setCommentSelectionRange(null);
    setDraftBody('');
    setCommentError(null);
    setAssigneeIds([]);
  };

  const shouldRenderFile = Boolean(filePath && fileData && !fileData.isBinary && !fileData.truncated);

  useEffect(() => {
    const line = pendingScrollLineRef.current;
    if (!line) return;
    if (!shouldRenderFile || !fileData) return;

    let canceled = false;

    const attemptScroll = (attempt: number) => {
      if (canceled) return;
      const view = editorViewRef.current;
      if (!view) return;

      // The CodeViewer updates its document in an effect. Wait a few frames
      // so the view reflects the latest `fileData.content` before scrolling.
      if (attempt < 5) {
        const current = view.state.doc.toString();
        if (current !== fileData.content) {
          requestAnimationFrame(() => attemptScroll(attempt + 1));
          return;
        }
      }

      const maxLine = view.state.doc.lines;
      const safeLine = Math.max(1, Math.min(maxLine, line));
      const info = view.state.doc.line(safeLine);

      view.dispatch({
        selection: { anchor: info.from, head: info.to },
        effects: EditorView.scrollIntoView(info.from, { y: 'center' }),
      });

      pendingScrollLineRef.current = null;
    };

    const raf = requestAnimationFrame(() => attemptScroll(0));
    return () => {
      canceled = true;
      cancelAnimationFrame(raf);
    };
  }, [editorReadyKey, fileData, shouldRenderFile]);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[hsl(var(--ds-border-1))] bg-background px-6 py-3 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs font-medium text-[hsl(var(--ds-text-2))]">{dict.projects.branch}</div>
            <Combobox
              value={activeRef}
              options={branchOptions}
              placeholder={dict.projects.branchPlaceholder}
              searchPlaceholder={dict.projects.branchSearchPlaceholder}
              heading={dict.projects.branchListHeading}
              emptyLabel={dict.projects.branchListEmpty}
              disabled={!activeRef}
              onChange={handleSelectBranch}
              className="w-56 h-8 text-[13px]"
              contentClassName="w-[320px]"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? dict.projects.codebaseSyncing : dict.projects.codebaseSync}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={dict.common.refresh}
              onClick={() => {
                setRefreshKey((value) => value + 1);
                if (filePath) {
                  void loadFile(filePath);
                }
              }}
            >
              <RefreshCcw className="size-4" />
            </Button>
            {syncMessage && (
              <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{syncMessage}</span>
            )}
          </div>
          <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{project.repo}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[hsl(var(--ds-text-2))]">
          <button
            type="button"
            className="text-[12px] text-[hsl(var(--ds-text-2))] hover:text-foreground"
            onClick={() => {
              setCurrentPath('');
              setFilePath(null);
              setActiveThreadId(null);
              setAnchorLine(null);
              setCommentSelectionRange(null);
              setFileData(null);
              setFileError(null);
              setDraftSelection(null);
              setDraftBody('');
            }}
          >
            {dict.projects.codebaseRoot}
          </button>
          {breadcrumbs.map((segment, index) => {
            const nextPath = breadcrumbs.slice(0, index + 1).join('/');
            const isLast = index === breadcrumbs.length - 1;
            const isFile = Boolean(filePath);
            const isClickable = !(isFile && isLast);
            return (
              <button
                key={nextPath}
                className={cn(
                  'text-[12px] text-[hsl(var(--ds-text-2))] hover:text-foreground',
                  !isClickable && 'cursor-default text-foreground',
                )}
                onClick={() => {
                  if (!isClickable) return;
                  setCurrentPath(nextPath);
                  setFilePath(null);
                  setActiveThreadId(null);
                  setAnchorLine(null);
                  setCommentSelectionRange(null);
                  setFileData(null);
                  setFileError(null);
                  setDraftSelection(null);
                  setDraftBody('');
                }}
                type="button"
              >
                / {segment}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        <div className="lg:w-80 border-r border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))/60] overflow-auto">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="text-xs font-medium text-[hsl(var(--ds-text-2))]">{project.repo}</div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              aria-label={dict.common.refresh}
              onClick={() => {
                setRefreshKey((value) => value + 1);
              }}
            >
              <RefreshCcw className="size-3.5" />
            </Button>
          </div>

          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--ds-text-2))]" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={dict.projects.codebaseFindFile}
                className="pl-9"
              />
            </div>
          </div>

          {currentPath && (
            <button
              className="w-full px-4 py-2 text-left text-[12px] text-[hsl(var(--ds-text-2))] hover:text-foreground hover:bg-[hsl(var(--ds-surface-1))] flex items-center gap-2"
              onClick={() => {
                setCurrentPath(parentPath);
                setFilePath(null);
                setActiveThreadId(null);
                setAnchorLine(null);
                setCommentSelectionRange(null);
                setFileData(null);
                setFileError(null);
                setDraftSelection(null);
                setDraftBody('');
              }}
              type="button"
            >
              <FolderUp className="size-4" />
              {dict.projects.codebaseParent}
            </button>
          )}

          {treeLoading && (
            <div className="px-4 py-4 space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={`tree-skeleton-${index}`} className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          )}

          {!treeLoading && treeError && (
            <div className="px-4 py-6 text-xs text-danger">{dict.common.error}</div>
          )}

          {!treeLoading && !treeError && filteredEntries.length === 0 && (
            <div className="px-4 py-6 text-[12px] text-[hsl(var(--ds-text-2))]">
              {search.trim()
                ? dict.projects.codebaseNoMatches
                : dict.projects.codebaseEmpty}
            </div>
          )}

          {!treeLoading && !treeError && filteredEntries.length > 0 && (
            <div className="flex flex-col">
              {filteredEntries.map((entry) => {
                const isActive = filePath === entry.path;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => handleSelectEntry(entry)}
                    className={cn(
                      'w-full px-4 py-2 text-left text-xs flex items-center gap-2 hover:bg-[hsl(var(--ds-surface-1))]',
                      isActive && 'bg-[hsl(var(--ds-surface-1))] text-foreground'
                    )}
                  >
                    {entry.type === 'tree' ? (
                      <Folder className="size-4 text-accent" />
                    ) : (
                      <FileText className="size-4 text-[hsl(var(--ds-text-2))]" />
                    )}
                    <span className="truncate flex-1">{entry.name}</span>
                    {entry.type === 'blob' && entry.size != null && (
                      <span className="text-[10px] text-[hsl(var(--ds-text-2))]">
                        {formatBytes(entry.size)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden flex flex-col bg-background">
          <div className="px-6 py-4 border-b border-[hsl(var(--ds-border-1))] flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[12px] text-[hsl(var(--ds-text-2))] truncate">
              {filePath ? filePath : dict.projects.codebaseSelectFile}
            </div>
            {filePath && (
              <div className="flex items-center gap-3 text-[12px] text-[hsl(var(--ds-text-2))]">
                <span>{dict.projects.codebaseCommentsCount.replace('{{count}}', String(comments.length))}</span>
                {commentsLoading && <Skeleton className="h-3 w-12" />}
                {fileData && !fileData.isBinary && !fileData.truncated && (
                  <span>{dict.projects.codebaseLines.replace('{{count}}', String(lines.length))}</span>
                )}
                {fileData && (
                  <span>{formatBytes(fileData.size)}</span>
                )}
                <div className="hidden md:flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={threadFilter === 'all' ? 'secondary' : 'ghost'}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setThreadFilter('all')}
                  >
                    {dict.common.all}
                  </Button>
                  <Button
                    size="sm"
                    variant={threadFilter === 'open' ? 'secondary' : 'ghost'}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setThreadFilter('open')}
                  >
                    {dict.projects.codebaseThreadOpen}
                  </Button>
                  <Button
                    size="sm"
                    variant={threadFilter === 'resolved' ? 'secondary' : 'ghost'}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setThreadFilter('resolved')}
                  >
                    {dict.projects.codebaseThreadResolved}
                  </Button>
                  <Button
                    size="sm"
                    variant={threadFilter === 'mine' ? 'secondary' : 'ghost'}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setThreadFilter('mine')}
                  >
                    {dict.projects.codebaseThreadMine}
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={handleCopyPath}>
                  <Copy className="size-3.5" />
                  {dict.projects.codebaseCopyPath}
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-hidden">
            <div
              className="h-full overflow-hidden relative"
              ref={codeContainerRef}
            >
              {fileLoading && (
                <div className="px-6 py-6 space-y-2">
                  {Array.from({ length: 12 }).map((_, index) => (
                    <Skeleton key={`file-skeleton-${index}`} className="h-3 w-full" />
                  ))}
                </div>
              )}

              {!fileLoading && fileError && (
                <div className="px-6 py-6 text-xs text-danger">{dict.common.error}</div>
              )}

              {!fileLoading && !fileError && fileData && fileData.truncated && (
                <div className="px-6 py-6 text-[12px] text-[hsl(var(--ds-text-2))]">{dict.projects.codebaseFileTooLarge}</div>
              )}

              {!fileLoading && !fileError && fileData && fileData.isBinary && (
                <div className="px-6 py-6 text-[12px] text-[hsl(var(--ds-text-2))]">{dict.projects.codebaseBinaryFile}</div>
              )}

              {!fileLoading && !fileError && shouldRenderFile && fileData && (
                <div className="h-full">
                  <CodeViewer
                    value={fileData.content}
                    language={filePath ?? ''}
                    onSelection={handleSelection}
                    onLineClick={handleLineClick}
                    onCommentInteractionStart={markCommentInteractionStart}
                    commentLines={commentLineNumbers}
                    commentLinePreviews={commentLinePreviews}
                    activeCommentLine={draftSelection?.lineStart ?? anchorLine}
                    commentSelectionRange={commentSelectionRange}
                    onReady={handleEditorReady}
                    className="h-full"
                  />
                </div>
              )}

              {!fileLoading && !fileError && !fileData && (
                <div className="px-6 py-6 text-[12px] text-[hsl(var(--ds-text-2))]">{dict.projects.codebaseSelectFile}</div>
              )}

              {draftSelection && shouldRenderFile && (
                <div
                  ref={composerRef}
                  className="absolute z-30"
                  style={{
                    left: 52,
                    right: 12,
                    top: inlineThreadTop ?? 18,
                    maxWidth: COMPOSER_WIDTH,
                  }}
                >
                  <div className="relative rounded-[12px] border border-[hsl(var(--ds-border-2))] bg-[hsl(var(--ds-background-2))]">
                    <button
                      type="button"
                      className="absolute right-2 top-2 rounded-[4px] p-1 text-[hsl(var(--ds-text-2))] hover:text-foreground hover:bg-[hsl(var(--ds-surface-1))]"
                      onClick={closeComposer}
                      aria-label={dict.common.close}
                    >
                      <X className="size-3.5" />
                    </button>
                    <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[12px]">
                        {composerThread?.status === 'resolved' ? (
                          <CheckCircle2 className="size-4 text-success" />
                        ) : (
                          <CircleDot className="size-4 text-[hsl(var(--ds-accent-8))]" />
                        )}
                        <span className="font-medium text-foreground">
                          {dict.projects.codebaseLine} {draftSelection.lineStart}
                          {draftSelection.lineEnd > draftSelection.lineStart ? `-${draftSelection.lineEnd}` : ''}
                        </span>
                        {composerThread && (
                          <span className={cn(
                            'rounded-[999px] px-2 py-0.5 text-[10px]',
                            composerThread.status === 'resolved'
                              ? 'bg-success/15 text-success'
                              : 'bg-[hsl(var(--ds-accent-7))/0.15] text-[hsl(var(--ds-accent-8))]'
                          )}>
                            {composerThread.status === 'resolved'
                              ? dict.projects.codebaseThreadResolved
                              : dict.projects.codebaseThreadOpen}
                          </span>
                        )}
                        {composerThread?.comments.some((comment) => comment.projection_status === 'shifted') && (
                          <span className="rounded-[999px] px-2 py-0.5 text-[10px] bg-warning/15 text-warning">
                            {dict.projects.codebaseThreadShifted}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {composerThread && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => {
                              const next = composerThread.status === 'resolved' ? 'open' : 'resolved';
                              void handleThreadStatusChange(composerThread.id, next);
                            }}
                          >
                            {composerThread.status === 'resolved'
                              ? dict.projects.codebaseReopenThread
                              : dict.projects.codebaseResolveThread}
                          </Button>
                        )}
                      </div>
                    </div>
                    {selectedAssignees.length > 0 ? (
                      <div className="px-4 pb-2 flex flex-wrap gap-1">
                        {selectedAssignees.map((member) => (
                          <span
                            key={member.user_id}
                            className="rounded-[4px] bg-[hsl(var(--ds-surface-2))] px-2 py-0.5 text-[10px] text-[hsl(var(--ds-text-2))]"
                          >
                            {member.email}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="px-4 pb-2 text-[11px] text-[hsl(var(--ds-text-2))]">
                        {dict.projects.codebaseNoAssignees}
                      </div>
                    )}
                    <div className="px-4 pb-2 flex items-center gap-2">
                      <Users className="size-3.5 text-[hsl(var(--ds-text-2))]" />
                      <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.projects.codebaseAssignees}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                            {dict.projects.codebaseAssignPeople}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-60 max-h-60 overflow-auto">
                          <DropdownMenuLabel>{dict.projects.codebaseAssignees}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {membersLoading && (
                            <div className="px-2 py-2 space-y-2">
                              <Skeleton className="h-3 w-24" />
                              <Skeleton className="h-3 w-20" />
                            </div>
                          )}
                          {!membersLoading && activeMembers.length === 0 && (
                            <div className="px-2 py-1.5 text-[12px] text-[hsl(var(--ds-text-2))]">
                              {dict.projects.codebaseNoAssignees}
                            </div>
                          )}
                          {!membersLoading && activeMembers.map((member) => (
                            <DropdownMenuCheckboxItem
                              key={member.user_id}
                              checked={assigneeIds.includes(member.user_id)}
                              onCheckedChange={() => toggleAssignee(member.user_id)}
                            >
                              {member.email}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {membersError && (
                        <span className="text-[11px] text-danger">{dict.common.error}</span>
                      )}
                    </div>
                    {composerThread?.comments[0]?.anchor_commit_sha && (
                      <div className="px-4 pb-2 text-[11px] text-[hsl(var(--ds-text-2))]">
                        {dict.projects.codebaseThreadAnchoredAt.replace('{{commit}}', composerThread.comments[0].anchor_commit_sha.slice(0, 7))}
                      </div>
                    )}
                    <div className="px-3 pb-2">
                      <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))/60]">
                        <div className="px-3 py-2 text-[11px] text-[hsl(var(--ds-text-2))] flex items-center justify-between">
                          <span>
                            {dict.projects.codebaseLine} {draftSelection.lineStart}
                            {draftSelection.lineEnd > draftSelection.lineStart ? `-${draftSelection.lineEnd}` : ''}
                          </span>
                          <span>{dict.projects.codebaseCommentsCount.replace('{{count}}', String(composerThreadComments.length))}</span>
                        </div>
                        {commentsLoading ? (
                          <div className="px-3 pb-2 text-[11px] text-[hsl(var(--ds-text-2))]">{dict.common.loading}</div>
                        ) : composerThreadComments.length === 0 ? (
                          <div className="px-3 pb-2 text-[11px] text-[hsl(var(--ds-text-2))]">
                            {dict.projects.codebaseNoComments}
                          </div>
                        ) : (
                          <div className="max-h-36 overflow-y-auto border-t border-[hsl(var(--ds-border-1))] divide-y divide-[hsl(var(--ds-border-1))]">
                            {composerThreadComments.map((comment) => {
                              const lineEnd = comment.line_end && comment.line_end !== comment.line
                                ? `${comment.line}-${comment.line_end}`
                                : `${comment.line}`;
                              return (
                                <div key={comment.id} className="px-3 py-2">
                                  <div className="flex items-center justify-between text-[10px] text-[hsl(var(--ds-text-2))]">
                                    <span className="truncate">{comment.author_email}</span>
                                    <span>{formatDate(comment.created_at)}</span>
                                  </div>
                                  <div className="mt-1 text-[11px] text-[hsl(var(--ds-text-2))]">
                                    {dict.projects.codebaseLine} {lineEnd}
                                  </div>
                                  <div className="mt-1 text-[12px] text-foreground whitespace-pre-wrap break-words">
                                    {comment.body}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <Textarea
                        ref={replyRef}
                        value={draftBody}
                        onChange={(event) => setDraftBody(event.target.value)}
                        placeholder={composerThread ? dict.projects.codebaseReplyPlaceholder : dict.projects.codebaseThreadPlaceholder}
                        className="min-h-[92px] border-0 bg-transparent px-0 py-0 text-xs focus-visible:border-0"
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            event.preventDefault();
                            void handleSubmitComment();
                          }
                          if (event.key === 'Escape') {
                            closeComposer();
                          }
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between border-t border-[hsl(var(--ds-border-1))] px-3 py-2 text-[hsl(var(--ds-text-2))]">
                      <div className="text-[11px] text-[hsl(var(--ds-text-2))]">
                        {dict.projects.codebaseMarkdownHint} · {dict.projects.codebaseThreadShortcuts}
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSubmitComment}
                        disabled={!draftBody.trim() || commentSaving}
                      >
                        <Send className="size-3.5" />
                        {composerThread ? dict.projects.codebaseReplySubmit : dict.projects.codebaseCommentSubmit}
                      </Button>
                    </div>
                  </div>
                  {commentSaving && (
                    <div className="mt-2">
                      <Skeleton className="h-3 w-20" />
                    </div>
                  )}
                  {commentError && (
                    <div className="mt-2 text-xs text-danger">{dict.common.error}</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {filePath && commentError && !draftSelection && (
            <div className="border-t border-[hsl(var(--ds-border-1))] bg-danger/10 px-6 py-2 text-[12px] text-danger">
              {dict.common.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function makeTreeCacheKey(projectId: string, ref: string, treePath: string) {
  return `${projectId}::${ref || 'HEAD'}::${treePath || '.'}`;
}

function makeFileCacheKey(projectId: string, ref: string, filePath: string) {
  return `${projectId}::${ref || 'HEAD'}::${filePath}`;
}

function getCachedValue<T>(cache: Map<string, CachedValue<T>>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCachedValue<T>(
  cache: Map<string, CachedValue<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number,
) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (cache.size <= maxEntries) return;
  const first = cache.keys().next().value;
  if (first) {
    cache.delete(first);
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatDate(value: string) {
  return formatLocalDateTime(value);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  const left = Math.max(Math.trunc(aStart), Math.trunc(bStart));
  const right = Math.min(Math.trunc(aEnd), Math.trunc(bEnd));
  return left <= right;
}

function normalizeSelectionText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.length <= MAX_SELECTION_TEXT) return trimmed;
  return `${trimmed.slice(0, MAX_SELECTION_TEXT)}...`;
}

function isCommentInteractionTarget(target: Element) {
  return Boolean(
    target.closest('.cm-comment-marker') ||
    target.closest('.cm-comment-marker-active') ||
    target.closest('.cm-line-commented') ||
    target.closest('.cm-line-comment-active') ||
    target.closest('.cm-comment-gutter') ||
    target.closest('.cm-lineNumbers') ||
    target.closest('.cm-comment-selection')
  );
}
