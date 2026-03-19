'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, History, Loader2, MessageCircle, Plus, Send, Sparkles, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  | { type: 'quote'; text: string }
  | { type: 'code'; language: string; value: string }
  | { type: 'hr' };

const NEW_CONV = '__new__';
const NO_CONV = '__none__';
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
    if (value === NEW_CONV || value === NO_CONV) {
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

  const currentValue = conversationId ?? NEW_CONV;

  return (
    <div className="flex h-full flex-col bg-[hsl(var(--ds-background-2))]">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-[radial-gradient(circle_at_top,hsl(var(--ds-surface-1))_0%,transparent_42%)]">
        {/* header and controls */}
        <div className="sticky top-0 z-10 -mt-1 mb-3 space-y-2 rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))/0.9] px-3 py-2 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1.5 text-[11px] text-[hsl(var(--ds-text-2))]">
              <Sparkles className="size-3.5" />
              <span>{dict.reportDetail.aiReviewer}</span>
              <span className="mx-1 text-[hsl(var(--ds-border-2))]">|</span>
              <span>{dict.reportDetail.aiChatFocusIssue}</span>
              <span className="font-medium text-foreground">{issueContext ?? dict.reportDetail.aiChatAllIssues}</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-2 py-1 text-[11px]">
              {loading ? <TypingDots compact /> : <span className="size-1.5 rounded-full bg-success" />}
              {loading ? (
                <span className="text-[hsl(var(--ds-text-2))]">
                  {dict.reportDetail.aiChatGenerating} · {dict.reportDetail.aiChatElapsed}: {formatElapsed(elapsedMs)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="min-w-[240px] flex-1 max-w-[360px]">
              <Select value={currentValue} onValueChange={(v) => { void selectConversation(v); }}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={dict.reportDetail.aiChatConversation} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_CONV}>{dict.reportDetail.aiChatNewConversation}</SelectItem>
                  {historyRows.length > 0 ? null : <SelectItem value={NO_CONV} disabled>{dict.reportDetail.aiChatNoConversations}</SelectItem>}
                  {historyRows.map((row, idx) => (
                    <SelectItem key={row.id} value={row.id}>
                      {`${row.updated_at ? formatLocalDateTime(row.updated_at) : `#${idx + 1}`} · ${preview(row.messages)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={historyLoading} onClick={() => { void refreshHistory(true); }}>
              {historyLoading ? <Loader2 className="size-3.5 animate-spin" /> : <History className="size-3.5" />}
              {dict.reportDetail.aiChatRefreshHistory}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={startNewConversation}>
              <Plus className="size-3.5" />
              {dict.reportDetail.aiChatNewConversation}
            </Button>
            {loading ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={stopGeneration}>
                <Square className="size-3.5" />
                {dict.reportDetail.aiChatStop}
              </Button>
            ) : null}
          </div>
        </div>

        {initialLoading ? (
          <div className="mx-auto w-full max-w-3xl space-y-4 pt-2">
            <div className="flex justify-start">
              <div className="w-[78%] rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3">
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="mt-2 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-4/5" />
              </div>
            </div>
            <div className="flex justify-end">
              <div className="w-[52%] rounded-[10px] bg-primary/80 px-4 py-3">
                <Skeleton className="h-3 w-5/6 bg-white/25" />
                <Skeleton className="mt-2 h-3 w-3/5 bg-white/20" />
              </div>
            </div>
            <div className="flex justify-start">
              <div className="w-[82%] rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3">
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
            <div className="w-full max-w-md rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))/0.7] p-6 text-center shadow-elevation-1">
              <MessageCircle className="mx-auto mb-3 size-10 text-[hsl(var(--ds-text-2))]" />
              <div className="text-sm font-semibold">{dict.reportDetail.aiChatEmptyTitle}</div>
              <div className="mt-2 text-[12px] text-[hsl(var(--ds-text-2))] leading-relaxed">{dict.reportDetail.aiChatEmptyDescription}</div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-[10px] px-4 py-3 ${msg.role === 'user' ? 'bg-primary text-primary-foreground shadow-[0_8px_24px_hsl(0_0%_0%/0.24)]' : 'border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] text-foreground shadow-elevation-1'}`}>
                {msg.role === 'assistant' && msg.content.trim() ? (
                  <div className="mb-2 flex justify-end">
                    <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px] gap-1" onClick={() => { void copyText(msg.content); }}>
                      <Copy className="size-3" />
                      {dict.reportDetail.aiChatCopyResponse}
                    </Button>
                  </div>
                ) : null}
                {msg.role === 'assistant' ? (
                  <MessageMarkdown content={msg.content} copyCodeLabel={dict.reportDetail.aiChatCopyCode} onCopy={copyText} />
                ) : (
                  <div className="text-sm whitespace-pre-wrap leading-relaxed break-words">{msg.content}</div>
                )}
                <div className={`text-[10px] mt-2 ${msg.role === 'user' ? 'text-primary-foreground/70' : 'text-[hsl(var(--ds-text-2))]'}`}>{formatLocalDateTime(msg.timestamp)}</div>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))/0.92] backdrop-blur-sm p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.aiChatQuickActions}</span>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => { void sendText(quickPrompt('patch', issueContext)); }}>{dict.reportDetail.aiChatQuickPatch}</Button>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => { void sendText(quickPrompt('tests', issueContext)); }}>{dict.reportDetail.aiChatQuickTests}</Button>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => { void sendText(quickPrompt('regression', issueContext)); }}>{dict.reportDetail.aiChatQuickRegression}</Button>
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
            className="flex-1 min-h-[42px] max-h-[180px] resize-none bg-[hsl(var(--ds-background-1))] border-[hsl(var(--ds-border-2))]"
          />
          <Button onClick={() => { void sendCurrent(); }} disabled={!input.trim() || loading} size="icon" className="shrink-0">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.aiChatMultiLineHint}</div>
      </div>
    </div>
  );
}

function MessageMarkdown({
  content,
  copyCodeLabel,
  onCopy,
}: {
  content: string;
  copyCodeLabel: string;
  onCopy: (text: string) => void | Promise<void>;
}) {
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
          return (
            <div key={`code-${i}`} className="overflow-hidden rounded-[8px] border border-[hsl(var(--ds-border-2))] bg-[hsl(var(--ds-background-2))]">
              <div className="px-2.5 py-1.5 text-[10px] text-[hsl(var(--ds-text-2))] border-b border-[hsl(var(--ds-border-1))] flex items-center justify-between gap-2">
                <span>{b.language || 'code'}</span>
                <Button type="button" variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] gap-1" onClick={() => { void onCopy(b.value); }}>
                  <Copy className="size-3" />
                  {copyCodeLabel}
                </Button>
              </div>
              <pre className="px-3 py-2.5 text-[12px] leading-relaxed overflow-x-auto">
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
        if (b.type === 'quote') {
          return <blockquote key={`q-${i}`} className="border-l-2 border-[hsl(var(--ds-border-2))] pl-3 text-sm text-[hsl(var(--ds-text-2))] whitespace-pre-wrap break-words">{inline(b.text, `q-${i}`)}</blockquote>;
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

function preview(messages: unknown): string {
  const items = normalizeMessages(messages);
  if (items.length === 0) return '...';
  return items[items.length - 1].content.replace(/\s+/g, ' ').slice(0, 42) || '...';
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
  if (issueId && /^[0-9a-f-]{36}$/i.test(issueId)) return `${reportId}::issue:${issueId}`;
  return `${reportId}::latest`;
}

async function fetchInitial(reportId: string, issueId?: string): Promise<ConversationRow | null> {
  const key = cacheKey(reportId, issueId);
  const now = Date.now();
  const cached = initCache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;
  const inflight = initInflight.get(key);
  if (inflight) return inflight;
  const req = (async () => {
    const params = new URLSearchParams();
    if (issueId && /^[0-9a-f-]{36}$/i.test(issueId)) params.set('issueId', issueId);
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

function quickPrompt(type: 'patch' | 'tests' | 'regression', issueContext?: string): string {
  const prefix = issueContext ? `Focus issue: ${issueContext}. ` : '';
  if (type === 'patch') return `${prefix}Please generate a minimal fix patch with exact code changes and explain trade-offs.`;
  if (type === 'tests') return `${prefix}Please propose focused test cases (unit/integration/e2e), including edge cases and expected assertions.`;
  return `${prefix}Please provide a regression risk checklist and a concise verification plan for release readiness.`;
}

function buildMessagesForCache(prev: Message[], user: string, assistant: string, now: string) {
  return [
    ...prev.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
    { role: 'user', content: user, timestamp: now },
    { role: 'assistant', content: assistant, timestamp: now },
  ];
}
