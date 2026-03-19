'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileText, History, Loader2, MessageCircle, Pencil, Plus, Send, Sparkles, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';
import { formatLocalDateTime } from '@/lib/dateFormat';

type Message = { id: string; role: 'user' | 'assistant'; content: string; timestamp: string };
type ConversationRow = { id: string; issue_id?: string | null; updated_at?: string | null; messages: unknown };
type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'task'; items: Array<{ checked: boolean; text: string }> }
  | { type: 'quote'; text: string }
  | { type: 'code'; language: string; value: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' };

const NEW_CONV = '__new__';
const INIT_TTL = 10000;
const LIST_TTL = 8000;

const initCache = new Map<string, { expiresAt: number; data: ConversationRow | null }>();
const initInflight = new Map<string, Promise<ConversationRow | null>>();
const listCache = new Map<string, { expiresAt: number; data: ConversationRow[] }>();
const listInflight = new Map<string, Promise<ConversationRow[]>>();

export default function AIChat({
  reportId,
  issueId,
  issueContext,
  dict,
}: {
  reportId: string;
  issueId?: string;
  issueContext?: string;
  dict: Dictionary;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<ConversationRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [localPrompt, setLocalPrompt] = useState('');
  const [focusOpen, setFocusOpen] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(true);
  const [promptOpen, setPromptOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [conversationTitles, setConversationTitles] = useState<Record<string, string>>({});
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(312);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isResizingRef = useRef(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: loading ? 'auto' : 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    let active = true;
    async function init() {
      setInitialLoading(true);
      setMessages([]);
      setConversationId(null);
      try {
        const row = await fetchInitial(reportId, issueId);
        if (!active) return;
        if (row) {
          applyConversation(row);
        }
      } finally {
        if (active) setInitialLoading(false);
      }
    }
    void init();
    void fetchHistory(reportId, false).then((rows) => {
      if (active) setHistoryRows(rows);
    });
    return () => {
      active = false;
    };
  }, [reportId, issueId]);

  useEffect(() => {
    if (!initialLoading) {
      setShowSlowHint(false);
      return;
    }
    const t = window.setTimeout(() => setShowSlowHint(true), 1500);
    return () => window.clearTimeout(t);
  }, [initialLoading]);

  useEffect(() => {
    if (!loading || startedAt == null) {
      setElapsedMs(0);
      return;
    }
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [loading, startedAt]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(`ai-chat-titles:${reportId}`);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') setConversationTitles(parsed as Record<string, string>);
      else setConversationTitles({});
    } catch {
      setConversationTitles({});
    }
    setRenamingConversationId(null);
    setRenameDraft('');
    setConversationSearch('');
  }, [reportId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(`ai-chat-titles:${reportId}`, JSON.stringify(conversationTitles));
    } catch {
      // ignore storage write failures
    }
  }, [reportId, conversationTitles]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const next = Math.min(420, Math.max(260, e.clientX));
      setSidebarWidth(next);
    };
    const onUp = () => {
      isResizingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function resizeInput(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  function applyConversation(row: ConversationRow) {
    setConversationId(row.id);
    setMessages(normalizeMessages(row.messages).map((m) => ({
      id: uuid(),
      role: m.role,
      content: m.content,
      timestamp: m.timestamp ?? new Date().toISOString(),
    })));
  }

  async function refreshHistory(force: boolean) {
    setHistoryLoading(true);
    try {
      setHistoryRows(await fetchHistory(reportId, force));
    } finally {
      setHistoryLoading(false);
    }
  }

  function startNewConversation() {
    setConversationId(null);
    setMessages([]);
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.focus();
    }
  }

  async function selectConversation(value: string) {
    if (value === NEW_CONV) {
      startNewConversation();
      return;
    }
    const local = historyRows.find((r) => r.id === value);
    if (local) {
      applyConversation(local);
      return;
    }
    const res = await fetch(`/api/reports/${reportId}/chat?conversationId=${encodeURIComponent(value)}`);
    if (!res.ok) return;
    const row = normalizeConversationRow(await res.json());
    if (!row) return;
    applyConversation(row);
  }

  async function sendCurrent() {
    await sendText(input);
  }

  async function sendText(raw: string) {
    if (!raw.trim() || loading) return;
    const content = raw.trim();
    const now = new Date().toISOString();
    const prev = messages;
    const assistantId = uuid();
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setMessages((list) => [
      ...list,
      { id: uuid(), role: 'user', content, timestamp: now },
      { id: assistantId, role: 'assistant', content: '', timestamp: now },
    ]);
    setLoading(true);
    setStartedAt(Date.now());

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/reports/${reportId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, conversationId, issueId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error((data as { error?: string }).error ?? dict.reportDetail.aiChatSendFailed);
        setMessages((list) => list.filter((m) => m.id !== assistantId));
        return;
      }

      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!type.includes('text/event-stream') || !res.body) {
        const data = await res.json();
        if (typeof data.conversationId === 'string') setConversationId(data.conversationId);
        if (typeof data.message === 'string') {
          setMessages((list) => list.map((m) => (m.id === assistantId ? { ...m, content: data.message } : m)));
          const row: ConversationRow = {
            id: typeof data.conversationId === 'string' ? data.conversationId : conversationId ?? uuid(),
            issue_id: issueId ?? null,
            updated_at: now,
            messages: buildMessagesForCache(prev, content, data.message, now),
          };
          cacheInit(reportId, issueId, row);
          upsertHistory(row);
        }
        invalidateHistory(reportId);
        void refreshHistory(true);
        return;
      }

      await consumeStream(res.body, {
        assistantId,
        now,
        content,
        prev,
      });
      invalidateHistory(reportId);
      void refreshHistory(true);
    } catch (error) {
      if (isAbort(error)) toast.info(dict.reportDetail.aiChatStopped);
      else toast.error(dict.reportDetail.aiChatNetworkError);
      setMessages((list) => {
        const t = list.find((m) => m.id === assistantId);
        if (!t || !t.content.trim()) return list.filter((m) => m.id !== assistantId);
        return list;
      });
    } finally {
      setLoading(false);
      setStartedAt(null);
      abortRef.current = null;
    }
  }

  async function consumeStream(
    stream: ReadableStream<Uint8Array>,
    ctx: { assistantId: string; now: string; content: string; prev: Message[] }
  ) {
    let streamText = '';
    let streamConversationId = conversationId;
    let doneReceived = false;
    let streamFailed = false;
    await readSSE(stream, {
      onMeta: (p) => {
        if (typeof p.conversationId === 'string') {
          streamConversationId = p.conversationId;
          setConversationId(p.conversationId);
        }
      },
      onDelta: (p) => {
        const chunk = typeof p.text === 'string' ? p.text : '';
        if (!chunk) return;
        streamText += chunk;
        setMessages((list) => list.map((m) => (m.id === ctx.assistantId ? { ...m, content: `${m.content}${chunk}` } : m)));
      },
      onDone: (p) => {
        doneReceived = true;
        let final = streamText;
        if (typeof p.conversationId === 'string') {
          streamConversationId = p.conversationId;
          setConversationId(p.conversationId);
        }
        if (typeof p.message === 'string') {
          final = p.message;
          setMessages((list) => list.map((m) => (m.id === ctx.assistantId ? { ...m, content: final } : m)));
        }
        if (streamConversationId && final.trim()) {
          const row: ConversationRow = {
            id: streamConversationId,
            issue_id: issueId ?? null,
            updated_at: new Date().toISOString(),
            messages: buildMessagesForCache(ctx.prev, ctx.content, final, ctx.now),
          };
          cacheInit(reportId, issueId, row);
          upsertHistory(row);
        }
      },
      onError: (p) => {
        streamFailed = true;
        toast.error(typeof p.error === 'string' ? p.error : dict.reportDetail.aiChatSendFailed);
      },
    });

    if (streamFailed && !doneReceived) {
      setMessages((list) => {
        const t = list.find((m) => m.id === ctx.assistantId);
        if (!t || !t.content.trim()) return list.filter((m) => m.id !== ctx.assistantId);
        return list;
      });
    }
  }

  function upsertHistory(row: ConversationRow) {
    setHistoryRows((rows) =>
      [row, ...rows.filter((r) => r.id !== row.id)].sort(
        (a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
      )
    );
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(dict.common.copied);
    } catch {
      toast.error(dict.common.error);
    }
  }

  async function generateLocalPrompt() {
    const prompt = buildLocalAIPrompt(issueContext, messages);
    setLocalPrompt(prompt);
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(dict.reportDetail.aiChatPromptCopied);
    } catch {
      toast.error(dict.common.error);
    }
  }

  function defaultConversationLabel(row: ConversationRow, idx: number): string {
    return `${row.updated_at ? formatLocalDateTime(row.updated_at) : `#${idx + 1}`} · ${preview(row.messages)}`;
  }

  function conversationLabel(row: ConversationRow, idx: number): string {
    const custom = conversationTitles[row.id]?.trim();
    if (custom) return custom;
    return defaultConversationLabel(row, idx);
  }

  function beginRename(row: ConversationRow, idx: number) {
    setRenamingConversationId(row.id);
    setRenameDraft(conversationLabel(row, idx));
  }

  function cancelRename() {
    setRenamingConversationId(null);
    setRenameDraft('');
  }

  function saveRename(rowId: string) {
    const next = renameDraft.trim();
    setConversationTitles((prev) => {
      const map = { ...prev };
      if (!next) delete map[rowId];
      else map[rowId] = next;
      return map;
    });
    setRenamingConversationId(null);
    setRenameDraft('');
  }

  const selectedRowIndex = conversationId ? historyRows.findIndex((row) => row.id === conversationId) : -1;
  const selectedConversationLabel = selectedRowIndex >= 0
    ? clip(
        conversationLabel(historyRows[selectedRowIndex], selectedRowIndex),
        18,
      )
    : dict.reportDetail.aiChatNewConversation;
  const filteredHistoryRows = historyRows.filter((row, idx) => {
    if (!conversationSearch.trim()) return true;
    const query = conversationSearch.trim().toLowerCase();
    return conversationLabel(row, idx).toLowerCase().includes(query);
  });

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[hsl(var(--ds-background-2))]">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside
          className={`shrink-0 min-h-0 overflow-y-auto border-b border-[hsl(var(--ds-border-1))] bg-[linear-gradient(180deg,hsl(var(--ds-background-2))_0%,hsl(var(--ds-surface-1))_100%)] lg:h-full lg:border-b-0 lg:border-r ${sidebarCollapsed ? 'lg:w-0 lg:border-r-0' : ''}`}
          style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
        >
          <div className="space-y-3 p-4">
            <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]">
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setFocusOpen((v) => !v)}>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[hsl(var(--ds-text-2))]">
                  <Sparkles className="size-3.5 shrink-0" />
                  {dict.reportDetail.aiReviewer}
                </span>
                <ChevronDown className={`size-3.5 text-[hsl(var(--ds-text-2))] transition-transform ${focusOpen ? 'rotate-0' : '-rotate-90'}`} />
              </button>
              {focusOpen ? (
                <div className="border-t border-[hsl(var(--ds-border-1))] px-3 py-2 text-[11px] text-[hsl(var(--ds-text-2))]">
                  <div>{dict.reportDetail.aiChatFocusIssue}</div>
                  <div className="mt-1 truncate font-medium text-foreground" title={issueContext ?? dict.reportDetail.aiChatAllIssues}>
                    {issueContext ?? dict.reportDetail.aiChatAllIssues}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))/0.7]">
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setConversationOpen((v) => !v)}>
                <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.aiChatConversation}</span>
                <ChevronDown className={`size-3.5 text-[hsl(var(--ds-text-2))] transition-transform ${conversationOpen ? 'rotate-0' : '-rotate-90'}`} />
              </button>
              {conversationOpen ? (
                <div className="space-y-2 border-t border-[hsl(var(--ds-border-1))] p-3">
                  <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-2.5 py-2 text-[11px] text-[hsl(var(--ds-text-2))]">
                    <span className="mr-1">{dict.reportDetail.aiChatConversation}:</span>
                    <span className="font-medium text-foreground" title={selectedConversationLabel}>{selectedConversationLabel}</span>
                  </div>
                  <Input
                    value={conversationSearch}
                    onChange={(e) => setConversationSearch(e.target.value)}
                    placeholder={dict.reportDetail.aiChatSearchConversation}
                    className="h-8 text-[12px]"
                  />
                  <div className="max-h-[180px] space-y-1 overflow-y-auto rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-1">
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-[hsl(var(--ds-surface-2))] ${conversationId == null ? 'bg-[hsl(var(--ds-surface-2))]' : ''}`}
                      onClick={startNewConversation}
                    >
                      <span className="truncate">{dict.reportDetail.aiChatNewConversation}</span>
                      <Plus className="size-3.5 text-[hsl(var(--ds-text-2))]" />
                    </button>
                    {filteredHistoryRows.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.aiChatNoConversations}</div>
                    ) : (
                      filteredHistoryRows.map((row) => {
                        const idx = historyRows.findIndex((item) => item.id === row.id);
                        const fullLabel = conversationLabel(row, idx);
                        const active = conversationId === row.id;
                        const editing = renamingConversationId === row.id;
                        return (
                          <div key={row.id} className={`rounded-[6px] ${active ? 'bg-[hsl(var(--ds-surface-2))]' : ''}`}>
                            {editing ? (
                              <div className="flex items-center gap-1 px-2 py-1.5">
                                <Input
                                  value={renameDraft}
                                  onChange={(e) => setRenameDraft(e.target.value)}
                                  placeholder={dict.reportDetail.aiChatRenamePlaceholder}
                                  className="h-7 text-[12px]"
                                />
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveRename(row.id)}>
                                  <Check className="size-3.5" />
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={cancelRename}>
                                  <X className="size-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="flex min-w-0 flex-1 items-center px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-[hsl(var(--ds-surface-2))]"
                                  title={fullLabel}
                                  onClick={() => { void selectConversation(row.id); }}
                                >
                                  <span className="truncate">{clip(fullLabel, 48)}</span>
                                </button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="mr-1 h-7 w-7"
                                  title={dict.reportDetail.aiChatRenameConversation}
                                  onClick={() => beginRename(row, idx)}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    <Button variant="outline" size="sm" className="justify-start gap-1.5" disabled={historyLoading} onClick={() => { void refreshHistory(true); }}>
                      {historyLoading ? <Loader2 className="size-3.5 animate-spin" /> : <History className="size-3.5" />}
                      {dict.reportDetail.aiChatRefreshHistory}
                    </Button>
                    <Button variant="outline" size="sm" className="justify-start gap-1.5" onClick={startNewConversation}>
                      <Plus className="size-3.5" />
                      {dict.reportDetail.aiChatNewConversation}
                    </Button>
                    {loading ? (
                      <Button variant="outline" size="sm" className="justify-start gap-1.5 sm:col-span-2 lg:col-span-1" onClick={stopGeneration}>
                        <Square className="size-3.5" />
                        {dict.reportDetail.aiChatStop}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))/0.72]">
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setPromptOpen((v) => !v)}>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[hsl(var(--ds-text-2))]">
                  <FileText className="size-3.5" />
                  {dict.reportDetail.aiChatPromptToolkit}
                </span>
                <ChevronDown className={`size-3.5 text-[hsl(var(--ds-text-2))] transition-transform ${promptOpen ? 'rotate-0' : '-rotate-90'}`} />
              </button>
              {promptOpen ? (
                <div className="space-y-2 border-t border-[hsl(var(--ds-border-1))] p-3">
                  <div className="text-[11px] leading-relaxed text-[hsl(var(--ds-text-2))]">{dict.reportDetail.aiChatPromptDescription}</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    <Button type="button" variant="outline" size="sm" className="justify-start" onClick={() => { void generateLocalPrompt(); }}>
                      {localPrompt ? dict.reportDetail.aiChatPromptRegenerate : dict.reportDetail.aiChatPromptGenerate}
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="justify-start" disabled={!localPrompt.trim()} onClick={() => { void copyText(localPrompt); }}>
                      {dict.reportDetail.aiChatPromptCopy}
                    </Button>
                  </div>
                  <Textarea
                    value={localPrompt}
                    readOnly
                    placeholder={dict.reportDetail.aiChatPromptPlaceholder}
                    className="min-h-[116px] resize-y bg-[hsl(var(--ds-background-2))] text-[12px] leading-relaxed"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <div
          className={`hidden lg:block w-1.5 cursor-col-resize bg-transparent hover:bg-[hsl(var(--ds-border-1))] ${sidebarCollapsed ? 'pointer-events-none opacity-0' : ''}`}
          onMouseDown={() => {
            isResizingRef.current = true;
          }}
        />

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-5 space-y-4 bg-[radial-gradient(circle_at_top,hsl(var(--ds-surface-1))_0%,transparent_42%)]">
            {initialLoading ? (
              <div className="mx-auto w-full max-w-4xl space-y-4 pt-2">
                <div className="flex justify-start">
                  <div className="w-[78%] rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3">
                    <Skeleton className="h-3 w-3/5" />
                    <Skeleton className="mt-2 h-3 w-full" />
                    <Skeleton className="mt-2 h-3 w-4/5" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="w-[52%] rounded-[12px] border border-primary/30 bg-primary/80 px-4 py-3">
                    <Skeleton className="h-3 w-5/6 bg-white/25" />
                    <Skeleton className="mt-2 h-3 w-3/5 bg-white/20" />
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="w-[82%] rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3">
                    <Skeleton className="h-3 w-2/5" />
                    <Skeleton className="mt-2 h-3 w-full" />
                    <Skeleton className="mt-2 h-3 w-11/12" />
                    <Skeleton className="mt-2 h-3 w-2/3" />
                  </div>
                </div>
                {showSlowHint ? (
                  <div className="text-center text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.aiChatLoadingHistory}</div>
                ) : null}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="w-full max-w-lg rounded-[14px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))/0.75] p-6 text-center shadow-elevation-1">
                  <MessageCircle className="mx-auto mb-3 size-10 text-[hsl(var(--ds-text-2))]" />
                  <div className="text-sm font-semibold">{dict.reportDetail.aiChatEmptyTitle}</div>
                  <div className="mt-2 text-[12px] text-[hsl(var(--ds-text-2))] leading-relaxed">{dict.reportDetail.aiChatEmptyDescription}</div>
                  <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={() => { void sendText(quickPrompt('patch', issueContext)); }}>{dict.reportDetail.aiChatQuickPatch}</Button>
                    <Button variant="outline" size="sm" onClick={() => { void sendText(quickPrompt('tests', issueContext)); }}>{dict.reportDetail.aiChatQuickTests}</Button>
                    <Button variant="outline" size="sm" onClick={() => { void sendText(quickPrompt('regression', issueContext)); }}>{dict.reportDetail.aiChatQuickRegression}</Button>
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isLatestAssistantLoading = loading && msg.role === 'assistant' && idx === messages.length - 1;
                return (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[96%] lg:max-w-[92%] rounded-[14px] px-4 py-3 ${msg.role === 'user' ? 'border border-[hsl(var(--ds-accent-8))] bg-[hsl(var(--ds-accent-9))] text-white shadow-elevation-1' : 'border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))/0.92] text-foreground shadow-elevation-1'}`}>
                    {msg.role === 'assistant' && msg.content.trim() ? (
                      <div className="mb-2 flex justify-end">
                        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px] gap-1" onClick={() => { void copyText(msg.content); }}>
                          <Copy className="size-3" />
                          {dict.reportDetail.aiChatCopyResponse}
                        </Button>
                      </div>
                    ) : null}
                    {msg.role === 'assistant' ? (
                      <MessageMarkdown content={msg.content} copyCodeLabel={dict.reportDetail.aiChatCopyCode} copiedLabel={dict.common.copied} onCopy={copyText} />
                    ) : (
                      <div className="text-sm whitespace-pre-wrap leading-relaxed break-words">{msg.content}</div>
                    )}
                    {isLatestAssistantLoading ? (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-2 py-1 text-[10px] text-[hsl(var(--ds-text-2))]">
                        <TypingDots compact />
                        <span>{dict.reportDetail.aiChatGenerating}</span>
                      </div>
                    ) : null}
                    <div className={`text-[10px] mt-2 ${msg.role === 'user' ? 'text-white/75' : 'text-[hsl(var(--ds-text-2))]'}`}>{formatLocalDateTime(msg.timestamp)}</div>
                  </div>
                </div>
              );})
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))/0.95] backdrop-blur-sm p-4">
            <div className="rounded-[14px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))/0.82] p-3 space-y-2 shadow-elevation-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.aiChatQuickActions}</span>
                <Button variant="outline" size="sm" className="h-7 rounded-full px-3 text-[11px]" disabled={loading} onClick={() => { void sendText(quickPrompt('patch', issueContext)); }}>
                  {dict.reportDetail.aiChatQuickPatch}
                </Button>
                <Button variant="outline" size="sm" className="h-7 rounded-full px-3 text-[11px]" disabled={loading} onClick={() => { void sendText(quickPrompt('tests', issueContext)); }}>
                  {dict.reportDetail.aiChatQuickTests}
                </Button>
                <Button variant="outline" size="sm" className="h-7 rounded-full px-3 text-[11px]" disabled={loading} onClick={() => { void sendText(quickPrompt('regression', issueContext)); }}>
                  {dict.reportDetail.aiChatQuickRegression}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="hidden lg:inline-flex h-7 px-2 text-[11px]"
                    onClick={() => setSidebarCollapsed((v) => !v)}
                    title={sidebarCollapsed ? dict.reportDetail.aiChatExpandSidebar : dict.reportDetail.aiChatCollapseSidebar}
                  >
                    {sidebarCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
                    {sidebarCollapsed ? dict.reportDetail.aiChatExpandSidebar : dict.reportDetail.aiChatCollapseSidebar}
                  </Button>
                  <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.aiChatMultiLineHint}</div>
                </div>
                {loading ? (
                  <div className="inline-flex max-w-[70%] items-center gap-2 rounded-full border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-2 py-1 text-[11px]">
                    <TypingDots compact />
                    <span className="truncate text-[hsl(var(--ds-text-2))]">
                      {dict.reportDetail.aiChatGeneratingPhase}: {generationPhase(elapsedMs, dict)} · {dict.reportDetail.aiChatElapsed}: {formatElapsed(elapsedMs)}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2 items-end">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    resizeInput(e.target);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendCurrent();
                    }
                  }}
                  placeholder={dict.reportDetail.aiChatInputPlaceholder}
                  disabled={loading}
                  className="flex-1 min-h-[44px] max-h-[180px] resize-none bg-[hsl(var(--ds-background-2))] border-[hsl(var(--ds-border-2))]"
                />
                <Button onClick={() => { void sendCurrent(); }} disabled={!input.trim() || loading} size="icon" className="h-10 w-10 shrink-0 rounded-[10px]">
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MessageMarkdown({
  content,
  copyCodeLabel,
  copiedLabel,
  onCopy,
}: {
  content: string;
  copyCodeLabel: string;
  copiedLabel: string;
  onCopy: (text: string) => void | Promise<void>;
}) {
  const [copiedCodeKey, setCopiedCodeKey] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedCodeKey) return;
    const t = window.setTimeout(() => setCopiedCodeKey(null), 1200);
    return () => window.clearTimeout(t);
  }, [copiedCodeKey]);

  if (!content.trim()) {
    return (
      <div className="text-sm leading-relaxed text-[hsl(var(--ds-text-2))]">
        <TypingDots />
      </div>
    );
  }

  const blocks = parse(content);
  if (blocks.length === 0) {
    return <div className="text-sm whitespace-pre-wrap leading-relaxed break-words">{content}</div>;
  }

  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        if (b.type === 'code') {
          const copyKey = `code-${i}`;
          const copied = copiedCodeKey === copyKey;
          return (
            <div key={copyKey} className="overflow-hidden rounded-[8px] border border-[hsl(var(--ds-border-2))] bg-[hsl(var(--ds-background-2))]">
              <div className="px-2.5 py-1.5 text-[10px] text-[hsl(var(--ds-text-2))] border-b border-[hsl(var(--ds-border-1))] flex items-center justify-between gap-2">
                <span>{b.language || 'code'}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] gap-1"
                  onClick={() => {
                    void onCopy(b.value);
                    setCopiedCodeKey(copyKey);
                  }}
                >
                  <Copy className="size-3" />
                  {copied ? copiedLabel : copyCodeLabel}
                </Button>
              </div>
              <pre className="px-3 py-2.5 text-[12px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words">
                <code>{b.value}</code>
              </pre>
            </div>
          );
        }
        if (b.type === 'heading') {
          const cls = b.level <= 2 ? 'text-[15px] font-semibold' : b.level <= 4 ? 'text-[14px] font-semibold' : 'text-[13px] font-semibold';
          return <div key={`h-${i}`} className={`${cls} leading-relaxed break-words`}>{inline(b.text, `h-${i}`)}</div>;
        }
        if (b.type === 'ul') {
          return <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1 text-sm leading-relaxed">{b.items.map((it, j) => <li key={`ul-${i}-${j}`}>{inline(it, `ul-${i}-${j}`)}</li>)}</ul>;
        }
        if (b.type === 'ol') {
          return <ol key={`ol-${i}`} className="list-decimal pl-5 space-y-1 text-sm leading-relaxed">{b.items.map((it, j) => <li key={`ol-${i}-${j}`}>{inline(it, `ol-${i}-${j}`)}</li>)}</ol>;
        }
        if (b.type === 'task') {
          return (
            <ul key={`task-${i}`} className="space-y-1 text-sm leading-relaxed">
              {b.items.map((it, j) => (
                <li key={`task-${i}-${j}`} className="flex items-start gap-2">
                  <input type="checkbox" checked={it.checked} readOnly disabled className="mt-0.5 size-3.5 rounded border-[hsl(var(--ds-border-2))]" />
                  <span className={it.checked ? 'line-through text-[hsl(var(--ds-text-2))]' : ''}>{inline(it.text, `task-${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === 'quote') {
          return <blockquote key={`q-${i}`} className="border-l-2 border-[hsl(var(--ds-border-2))] pl-3 text-sm text-[hsl(var(--ds-text-2))] whitespace-pre-wrap break-words">{inline(b.text, `q-${i}`)}</blockquote>;
        }
        if (b.type === 'table') {
          return (
            <div key={`tbl-${i}`} className="overflow-x-auto rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))]">
              <table className="w-full min-w-[460px] border-collapse text-[12px]">
                <thead className="bg-[hsl(var(--ds-background-2))]">
                  <tr>
                    {b.headers.map((h, j) => (
                      <th key={`tbl-h-${i}-${j}`} className="sticky top-0 z-10 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] px-2.5 py-2 text-left font-semibold text-foreground">
                        {inline(h, `tbl-h-${i}-${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={`tbl-r-${i}-${r}`} className="odd:bg-transparent even:bg-[hsl(var(--ds-background-1))/0.28]">
                      {row.map((cell, c) => (
                        <td key={`tbl-c-${i}-${r}-${c}`} className="border-t border-[hsl(var(--ds-border-1))] px-2.5 py-2 align-top text-sm leading-relaxed break-words whitespace-pre-wrap">
                          {withBreaks(cell, `tbl-cell-${i}-${r}-${c}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.type === 'hr') {
          return <hr key={`hr-${i}`} className="border-[hsl(var(--ds-border-1))]" />;
        }
        return <div key={`p-${i}`} className="text-sm whitespace-pre-wrap leading-relaxed break-words">{withBreaks(b.text, `p-${i}`)}</div>;
      })}
    </div>
  );
}

function TypingDots({ compact = false }: { compact?: boolean }) {
  const dot = compact ? 'size-1' : 'size-1.5';
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`${dot} rounded-full bg-[hsl(var(--ds-text-2))] animate-pulse`} />
      <span className={`${dot} rounded-full bg-[hsl(var(--ds-text-2))] animate-pulse [animation-delay:120ms]`} />
      <span className={`${dot} rounded-full bg-[hsl(var(--ds-text-2))] animate-pulse [animation-delay:240ms]`} />
    </span>
  );
}

function parse(raw: string): Block[] {
  const text = raw.replace(/\r\n/g, '\n');
  const blocks: Block[] = [];
  const regex = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  let last = 0;
  for (const m of text.matchAll(regex)) {
    const idx = m.index ?? 0;
    if (idx > last) blocks.push(...textBlocks(text.slice(last, idx)));
    blocks.push({ type: 'code', language: (m[1] ?? '').trim(), value: (m[2] ?? '').replace(/\n$/, '') });
    last = idx + m[0].length;
  }
  if (last < text.length) blocks.push(...textBlocks(text.slice(last)));
  return blocks;
}

function textBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }
    if (isTableStart(lines, i)) {
      const headers = parseTableRow(lines[i]);
      i += 2; // header + delimiter
      const rows: string[][] = [];
      while (i < lines.length) {
        const current = lines[i];
        if (!current.trim() || !current.includes('|') || isTableDelimiter(current)) break;
        rows.push(parseTableRow(current));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows: normalizeTableRows(headers.length, rows) });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const arr: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        arr.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: arr.join('\n').trim() });
      continue;
    }
    if (/^- \[( |x|X)\]\s+/.test(line)) {
      const arr: Array<{ checked: boolean; text: string }> = [];
      while (i < lines.length && /^- \[( |x|X)\]\s+/.test(lines[i])) {
        const m = lines[i].match(/^- \[( |x|X)\]\s+(.+)$/);
        if (m) arr.push({ checked: m[1].toLowerCase() === 'x', text: m[2].trim() });
        i += 1;
      }
      blocks.push({ type: 'task', items: arr });
      continue;
    }
    if (/^(\*|-|\+)\s+/.test(line)) {
      const arr: string[] = [];
      while (i < lines.length && /^(\*|-|\+)\s+/.test(lines[i])) {
        arr.push(lines[i].replace(/^(\*|-|\+)\s+/, '').trim());
        i += 1;
      }
      blocks.push({ type: 'ul', items: arr });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const arr: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        arr.push(lines[i].replace(/^\d+\.\s+/, '').trim());
        i += 1;
      }
      blocks.push({ type: 'ol', items: arr });
      continue;
    }
    const arr = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s+|>\s?|(\*|-|\+)\s+|\d+\.\s+|([-*_])\1{2,}$)/.test(lines[i])) {
      arr.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: arr.join('\n').trim() });
  }
  return blocks;
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (!header.includes('|')) return false;
  return isTableDelimiter(delimiter);
}

function isTableDelimiter(line: string): boolean {
  const cells = parseTableCells(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTableRow(line: string): string[] {
  return parseTableCells(line).map((cell) => cell.trim());
}

function parseTableCells(line: string): string[] {
  const cleaned = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  if (!cleaned) return [];
  return cleaned.split('|').map((cell) => cell.trim());
}

function normalizeTableRows(width: number, rows: string[][]): string[][] {
  const normalized = rows.map((row) => row.slice(0, width));
  return normalized.map((row) => {
    if (row.length >= width) return row;
    return [...row, ...new Array(width - row.length).fill('')];
  });
}

function inline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0;
  let idx = 0;
  for (const m of text.matchAll(pattern)) {
    const pos = m.index ?? 0;
    if (pos > last) nodes.push(text.slice(last, pos));
    const token = m[0];
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) nodes.push(<a key={`${key}-${idx}`} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-[hsl(var(--ds-accent-9))]">{link[1]}</a>);
    else if (token.startsWith('`') && token.endsWith('`')) nodes.push(<code key={`${key}-${idx}`} className="rounded bg-[hsl(var(--ds-background-2))] px-1 py-0.5 text-[12px]">{token.slice(1, -1)}</code>);
    else if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) nodes.push(<strong key={`${key}-${idx}`}>{token.slice(2, -2)}</strong>);
    else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) nodes.push(<em key={`${key}-${idx}`}>{token.slice(1, -1)}</em>);
    else nodes.push(token);
    last = pos + token.length;
    idx += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function withBreaks(text: string, key: string): ReactNode[] {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    out.push(...inline(line, `${key}-${i}`));
    if (i < lines.length - 1) out.push(<br key={`${key}-br-${i}`} />);
  });
  return out;
}

function normalizeMessages(value: unknown): Array<{ role: 'user' | 'assistant'; content: string; timestamp?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
      const timestamp = (item as { timestamp?: unknown }).timestamp;
      return { role, content, ...(typeof timestamp === 'string' ? { timestamp } : {}) };
    })
    .filter((x): x is { role: 'user' | 'assistant'; content: string; timestamp?: string } => x !== null);
}

function normalizeConversationRow(value: unknown): ConversationRow | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== 'string') return null;
  return {
    id: c.id,
    issue_id: typeof c.issue_id === 'string' ? c.issue_id : null,
    updated_at: typeof c.updated_at === 'string' ? c.updated_at : null,
    messages: c.messages,
  };
}

function clip(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  if (!value) return '...';
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

function preview(messages: unknown): string {
  const items = normalizeMessages(messages);
  if (items.length === 0) return '...';
  return clip(items[items.length - 1].content, 30);
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function parseEvent(raw: string): { event: string; data: Record<string, unknown> } | null {
  const lines = raw.split('\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    const n = line.trimEnd();
    if (n.startsWith('event:')) event = n.slice(6).trim();
    if (n.startsWith('data:')) dataLines.push(n.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> };
  } catch {
    return null;
  }
}

async function readSSE(
  stream: ReadableStream<Uint8Array>,
  handlers: {
    onMeta: (payload: Record<string, unknown>) => void;
    onDelta: (payload: Record<string, unknown>) => void;
    onDone: (payload: Record<string, unknown>) => void;
    onError: (payload: Record<string, unknown>) => void;
  }
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const event = parseEvent(chunk);
      if (!event) continue;
      if (event.event === 'meta') handlers.onMeta(event.data);
      if (event.event === 'delta') handlers.onDelta(event.data);
      if (event.event === 'done') handlers.onDone(event.data);
      if (event.event === 'error') handlers.onError(event.data);
    }
  }
}

function cacheKey(reportId: string, issueId?: string) {
  if (issueId && issueId.trim()) return `${reportId}::issue:${issueId.trim()}`;
  return `${reportId}::latest`;
}

async function fetchInitial(reportId: string, issueId?: string): Promise<ConversationRow | null> {
  const key = cacheKey(reportId, issueId);
  const now = Date.now();
  const cached = initCache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;
  const inflight = initInflight.get(key);
  if (inflight) return inflight;
  const issueIdTrim = issueId?.trim();
  const issueIsUuid = !!issueIdTrim && /^[0-9a-f-]{36}$/i.test(issueIdTrim);
  if (issueIdTrim && !issueIsUuid) {
    return null;
  }
  const req = (async () => {
    const params = new URLSearchParams();
    if (issueIdTrim && issueIsUuid) params.set('issueId', issueIdTrim);
    else params.set('latest', '1');
    const res = await fetch(`/api/reports/${reportId}/chat?${params.toString()}`);
    if (!res.ok) return null;
    const row = normalizeConversationRow(await res.json());
    initCache.set(key, { data: row, expiresAt: Date.now() + INIT_TTL });
    return row;
  })();
  initInflight.set(key, req);
  try {
    return await req;
  } finally {
    initInflight.delete(key);
  }
}

function cacheInit(reportId: string, issueId: string | undefined, row: ConversationRow) {
  initCache.set(cacheKey(reportId, issueId), { data: row, expiresAt: Date.now() + INIT_TTL });
  initCache.set(`${reportId}::latest`, { data: row, expiresAt: Date.now() + INIT_TTL });
}

async function fetchHistory(reportId: string, force: boolean): Promise<ConversationRow[]> {
  const now = Date.now();
  const cached = listCache.get(reportId);
  if (!force && cached && cached.expiresAt > now) return cached.data;
  const inflight = listInflight.get(reportId);
  if (!force && inflight) return inflight;
  const req = (async () => {
    const res = await fetch(`/api/reports/${reportId}/chat`);
    if (!res.ok) return [];
    const rows = (await res.json()) as unknown;
    const normalized = (Array.isArray(rows) ? rows : [])
      .map((r) => normalizeConversationRow(r))
      .filter((r): r is ConversationRow => r !== null)
      .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime());
    listCache.set(reportId, { data: normalized, expiresAt: Date.now() + LIST_TTL });
    return normalized;
  })();
  listInflight.set(reportId, req);
  try {
    return await req;
  } finally {
    listInflight.delete(reportId);
  }
}

function invalidateHistory(reportId: string) {
  listCache.delete(reportId);
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function generationPhase(ms: number, dict: Dictionary): string {
  if (ms < 4000) return dict.reportDetail.aiChatGeneratingPhaseAnalyzing;
  if (ms < 12000) return dict.reportDetail.aiChatGeneratingPhaseDrafting;
  return dict.reportDetail.aiChatGeneratingPhasePolishing;
}

function quickPrompt(type: 'patch' | 'tests' | 'regression', issueContext?: string): string {
  const prefix = issueContext ? `Focus issue: ${issueContext}. ` : '';
  if (type === 'patch') return `${prefix}Please generate a minimal fix patch with exact code changes and explain trade-offs.`;
  if (type === 'tests') return `${prefix}Please propose focused test cases (unit/integration/e2e), including edge cases and expected assertions.`;
  return `${prefix}Please provide a regression risk checklist and a concise verification plan for release readiness.`;
}

function buildLocalAIPrompt(issueContext: string | undefined, messages: Message[]): string {
  const focus = issueContext?.trim() || 'N/A';
  const history = messages.slice(-6).map((m, idx) => `[${idx + 1}] ${m.role.toUpperCase()}: ${clip(m.content, 220)}`).join('\n');
  const historyBlock = history || '[No prior conversation context]';
  return [
    '# Task',
    'Act as a senior software engineer and provide an executable fix plan for the issue below.',
    '',
    '## Focus Issue',
    focus,
    '',
    '## Existing Conversation Context',
    historyBlock,
    '',
    '## Required Output',
    '1. Root cause analysis (with assumptions clearly marked).',
    '2. Minimal safe patch (exact files and code changes).',
    '3. Risk & regression checklist.',
    '4. Verification steps (commands + expected results).',
    '',
    '## Constraints',
    '- Keep changes minimal and production-safe.',
    '- Preserve existing behavior unless explicitly fixing a bug.',
    '- If uncertain, list the uncertainty before proposing changes.',
  ].join('\n');
}

function buildMessagesForCache(prev: Message[], user: string, assistant: string, now: string) {
  return [
    ...prev.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
    { role: 'user', content: user, timestamp: now },
    { role: 'assistant', content: assistant, timestamp: now },
  ];
}
