'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { EditorView } from '@codemirror/view';
import {
  Copy,
  FileText,
  Folder,
  FolderUp,
  Image as ImageIcon,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Type as TypeIcon,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import type { Dictionary } from '@/i18n';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import CodeEditor, { type CodeLineClickPayload, type CodeSelectionPayload } from '@/components/codebase/CodeEditor';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

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
  line: number;
  line_end?: number | null;
  selection_text?: string | null;
  body: string;
  author_email: string;
  created_at: string;
  assignees?: CommentAssignee[] | null;
};

type DraftSelection = {
  lineStart: number;
  lineEnd: number;
  text: string;
  anchor: { x: number; y: number };
};

const COMPOSER_WIDTH = 360;
const COMPOSER_PADDING = 12;
const COMPOSER_EST_HEIGHT = 280;
const MAX_SELECTION_TEXT = 1200;

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
  const [fileData, setFileData] = useState<FileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [comments, setComments] = useState<CodebaseComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [draftSelection, setDraftSelection] = useState<DraftSelection | null>(null);
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
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const codeContainerRef = useRef<HTMLDivElement | null>(null);
  const codeScrollerRef = useRef<HTMLElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const pendingScrollLineRef = useRef<number | null>(null);

  useEffect(() => {
    if (!branches.length) return;
    if (!branches.includes(branch) && !isCommitSha(branch)) {
      setBranch(branches[0]);
    }
  }, [branches, branch]);

  const deepLinkPath = searchParams.get('path');
  const deepLinkRef = searchParams.get('ref');
  const deepLinkLine = searchParams.get('line');

  // Deep link support: open a file (optionally at a specific ref + line).
  useEffect(() => {
    if (!deepLinkPath) return;
    const targetPath = deepLinkPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!targetPath) return;

    const refOverride = deepLinkRef?.trim() || undefined;

    const parsedLine = deepLinkLine ? Number(deepLinkLine) : Number.NaN;
    pendingScrollLineRef.current = Number.isFinite(parsedLine)
      ? Math.max(1, Math.trunc(parsedLine))
      : null;

    setCurrentPath(parentDir(targetPath));
    void loadFile(targetPath, false, refOverride);
  }, [deepLinkPath, deepLinkRef, deepLinkLine]);

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
    const requestId = ++treeRequestId.current;
    let active = true;

    async function loadTree() {
      setTreeLoading(true);
      setTreeError(null);
      try {
        const params = new URLSearchParams();
        params.set('ref', branch);
        const shouldForceSync = forceSyncUntil > Date.now();
        params.set('sync', shouldForceSync ? '1' : '0');
        if (currentPath) params.set('path', currentPath);
        const res = await fetch(`/api/projects/${project.id}/codebase/tree?${params.toString()}`);
        if (!res.ok) throw new Error('tree_fetch_failed');
        const data = (await res.json()) as TreeResponse;
        if (!active || treeRequestId.current !== requestId) return;
        setEntries(data.entries || []);
      } catch (err) {
        if (!active || treeRequestId.current !== requestId) return;
        setTreeError(err instanceof Error ? err.message : 'tree_fetch_failed');
      } finally {
        if (!active || treeRequestId.current !== requestId) return;
        setTreeLoading(false);
      }
    }

    loadTree();
    return () => {
      active = false;
    };
  }, [branch, currentPath, project.id, refreshKey]);

  useEffect(() => {
    if (!draftSelection) return;
    const handle = requestAnimationFrame(() => {
      draftRef.current?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [draftSelection]);

  useEffect(() => {
    if (!draftSelection) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (composerRef.current?.contains(target)) return;
      if (codeContainerRef.current?.contains(target)) return;
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
      closeComposer();
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [draftSelection]);

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
    setBranch(value);
    setCurrentPath('');
    setEntries([]);
    setFilePath(null);
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
      setFileData(null);
      setFileError(null);
      setDraftSelection(null);
      setDraftBody('');
      setAssigneeIds([]);
      setCommentError(null);
      return;
    }
    void loadFile(entry.path);
  };

  const loadFile = async (path: string, forceSync?: boolean, refOverride?: string) => {
    const requestId = ++fileRequestId.current;
    setFileLoading(true);
    setFileError(null);
    setFilePath(path);
    setFileData(null);
    try {
      const effectiveRef = refOverride?.trim() || branch;
      if (refOverride && refOverride !== branch) {
        setBranch(refOverride);
      }
      const params = new URLSearchParams();
      params.set('ref', effectiveRef);
      const shouldForceSync = forceSync ? true : forceSyncUntil > Date.now();
      params.set('sync', shouldForceSync ? '1' : '0');
      params.set('path', path);
      const res = await fetch(`/api/projects/${project.id}/codebase/file?${params.toString()}`);
      if (!res.ok) throw new Error('file_fetch_failed');
      const data = (await res.json()) as FileResponse;
      if (fileRequestId.current !== requestId) return;
      setFileData(data);
      setComments([]);
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
  };

  const loadComments = async (path: string, commit?: string | null) => {
    const requestId = ++commentRequestId.current;
    setCommentsLoading(true);
    setCommentError(null);
    try {
      const params = new URLSearchParams();
      params.set('ref', branch);
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
  }, [filePath, branch, project.id, fileData?.commit]);

  const lines = useMemo(() => {
    if (!fileData || fileData.isBinary || fileData.truncated) return [];
    return fileData.content.split('\n');
  }, [fileData]);

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
        body: JSON.stringify({
          ref: branch,
          commit: fileData.commit,
          path: filePath,
          line: draftSelection.lineStart,
          line_end: lineEnd,
          selection_text: selectionText || undefined,
          assignees: assigneeIds.length ? assigneeIds : undefined,
          body: draftBody.trim(),
        }),
      });
      if (!res.ok) throw new Error('comment_create_failed');
      closeComposer();
      await loadComments(filePath);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'comment_create_failed');
    } finally {
      setCommentSaving(false);
    }
  };

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

  const openComposer = (lineStart: number, lineEnd: number, text: string, clientX: number, clientY: number) => {
    if (typeof window === 'undefined') return;
    const maxX = Math.max(COMPOSER_PADDING, window.innerWidth - COMPOSER_WIDTH - COMPOSER_PADDING);
    const maxY = Math.max(COMPOSER_PADDING, window.innerHeight - COMPOSER_EST_HEIGHT - COMPOSER_PADDING);
    const anchorX = clamp(clientX, COMPOSER_PADDING, maxX);
    const anchorY = clamp(clientY + 8, COMPOSER_PADDING, maxY);
    const selectionText = normalizeSelectionText(text);
    setDraftSelection({
      lineStart,
      lineEnd,
      text: selectionText,
      anchor: { x: anchorX, y: anchorY },
    });
    setDraftBody('');
    setCommentError(null);
    setAssigneeIds([]);
  };

  const handleLineClick = (payload: CodeLineClickPayload) => {
    let lineStart = payload.line;
    let lineEnd = payload.line;
    if (payload.shiftKey && lastLineClicked) {
      lineStart = Math.min(lastLineClicked, payload.line);
      lineEnd = Math.max(lastLineClicked, payload.line);
    }
    setLastLineClicked(payload.line);
    openComposer(lineStart, lineEnd, '', payload.clientX, payload.clientY);
  };

  const handleSelection = (payload: CodeSelectionPayload) => {
    const text = payload.text.trim();
    if (!text) return;
    openComposer(payload.lineStart, payload.lineEnd, text, payload.clientX, payload.clientY);
  };

  const handleEditorReady = (view: EditorView) => {
    editorViewRef.current = view;
    codeScrollerRef.current = view.scrollDOM;
    setEditorReadyKey((value) => value + 1);
  };

  const closeComposer = () => {
    setDraftSelection(null);
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

      // The CodeEditor updates its document in an effect. Wait a few frames
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
            <Select value={branch} onValueChange={handleSelectBranch}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!branches.includes(branch) && isCommitSha(branch) && (
                  <SelectItem key={branch} value={branch}>
                    {dict.reports.commit}: {branch.slice(0, 7)}
                  </SelectItem>
                )}
                {branches.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                {fileData && !fileData.isBinary && !fileData.truncated && (
                  <span>{dict.projects.codebaseLines.replace('{{count}}', String(lines.length))}</span>
                )}
                {fileData && (
                  <span>{formatBytes(fileData.size)}</span>
                )}
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
                  <CodeEditor
                    value={fileData.content}
                    language={filePath ?? ''}
                    onSelection={handleSelection}
                    onLineClick={handleLineClick}
                    onReady={handleEditorReady}
                    className="h-full"
                  />
                </div>
              )}

              {!fileLoading && !fileError && !fileData && (
                <div className="px-6 py-6 text-[12px] text-[hsl(var(--ds-text-2))]">{dict.projects.codebaseSelectFile}</div>
              )}

              {draftSelection && typeof document !== 'undefined' && createPortal(
                <div
                  ref={composerRef}
                  className="fixed z-50"
                  style={{ left: draftSelection.anchor.x, top: draftSelection.anchor.y, width: COMPOSER_WIDTH }}
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
                    <div className="px-4 pt-5 pb-2 flex items-center gap-2">
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
                    <div className="px-4 py-3">
                      <Textarea
                        ref={draftRef}
                        value={draftBody}
                        onChange={(event) => setDraftBody(event.target.value)}
                        placeholder={dict.projects.codebaseThreadPlaceholder}
                        className="min-h-[110px] border-0 bg-transparent px-0 py-0 text-xs focus-visible:border-0"
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
                      <div className="flex items-center gap-3 text-[11px]">
                        <button type="button" className="hover:text-foreground" aria-label="Add">
                          <Plus className="size-4" />
                        </button>
                        <button type="button" className="hover:text-foreground" aria-label="Image">
                          <ImageIcon className="size-4" />
                        </button>
                        <span className="h-4 w-px bg-border" />
                        <button type="button" className="hover:text-foreground" aria-label="Type">
                          <TypeIcon className="size-4" />
                        </button>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSubmitComment}
                        disabled={!draftBody.trim() || commentSaving}
                      >
                        <Send className="size-3.5" />
                        {dict.projects.codebaseCommentSubmit}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-[hsl(var(--ds-text-2))]">
                    <span>{dict.projects.codebaseMarkdownHint}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={closeComposer}
                    >
                      {dict.common.cancel}
                    </Button>
                  </div>
                  {commentSaving && (
                    <div className="mt-2">
                      <Skeleton className="h-3 w-20" />
                    </div>
                  )}
                  {commentError && (
                    <div className="mt-2 text-xs text-danger">{dict.common.error}</div>
                  )}
                </div>,
                document.body
              )}
            </div>
          </div>

          {filePath && (
            <div className="border-t border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))/60]">
              <div className="px-6 py-3 text-[12px] text-[hsl(var(--ds-text-2))] flex items-center justify-between">
                <span>
                  {dict.projects.codebaseCommentsCount.replace('{{count}}', String(comments.length))}
                </span>
                {commentsLoading && <Skeleton className="h-3 w-20" />}
                {!commentsLoading && commentError && <span className="text-danger">{dict.common.error}</span>}
              </div>

              {commentsLoading && (
                <div className="px-6 pb-6 space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={`comment-skeleton-${index}`} className="flex gap-3">
                      <Skeleton className="size-7 rounded-[4px]" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3 w-40" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-5/6" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!commentsLoading && !commentError && comments.length === 0 && (
                <div className="px-6 pb-6 text-[12px] text-[hsl(var(--ds-text-2))]">
                  {dict.projects.codebaseNoComments}
                </div>
              )}

              {!commentsLoading && comments.length > 0 && (
                <div className="divide-y divide-border">
                  {comments.map((comment) => {
                    const lineEnd = comment.line_end && comment.line_end !== comment.line
                      ? `${comment.line}-${comment.line_end}`
                      : `${comment.line}`;
                    return (
                      <div
                        key={comment.id}
                        className="flex gap-3 px-6 py-4"
                      >
                        <div className="size-7 rounded-[4px] bg-muted flex items-center justify-center text-[10px] font-medium text-[hsl(var(--ds-text-2))]">
                          {initialsFromEmail(comment.author_email)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-medium text-foreground">{comment.author_email}</span>
                            <span className="text-[hsl(var(--ds-text-2))]">{formatDate(comment.created_at)}</span>
                            <span className="text-[hsl(var(--ds-text-2))]">
                              {dict.projects.codebaseLine} {lineEnd}
                            </span>
                          </div>
                          {comment.selection_text && (
                            <pre className="mt-2 rounded-md bg-[hsl(var(--ds-surface-1))] px-3 py-2 text-[11px] text-[hsl(var(--ds-text-2))] whitespace-pre-wrap">
                              {comment.selection_text}
                            </pre>
                          )}
                          {comment.assignees && comment.assignees.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {comment.assignees.map((assignee) => (
                                <span
                                  key={`${comment.id}-${assignee.user_id}`}
                                  className="rounded-[4px] bg-[hsl(var(--ds-surface-2))] px-2 py-0.5 text-[10px] text-[hsl(var(--ds-text-2))]"
                                >
                                  {assignee.email ?? assignee.user_id.slice(0, 8)}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 text-xs whitespace-pre-wrap text-foreground">
                            {comment.body}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function initialsFromEmail(email: string) {
  if (!email) return 'U';
  const name = email.split('@')[0] ?? '';
  const parts = name.split(/[._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? name[0] ?? 'U';
  const second = parts[1]?.[0] ?? name[1] ?? '';
  return `${first}${second}`.toUpperCase();
}

function clamp(value: number, min: number, max: number) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeSelectionText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.length <= MAX_SELECTION_TEXT) return trimmed;
  return `${trimmed.slice(0, MAX_SELECTION_TEXT)}...`;
}
