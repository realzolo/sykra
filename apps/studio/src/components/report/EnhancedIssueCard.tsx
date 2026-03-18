'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronDown, ChevronUp, AlertTriangle, AlertCircle, Info, Zap,
  Copy, Check, MessageCircle, FileCode, Send, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Dictionary } from '@/i18n';

type Issue = {
  file: string;
  line?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  rule: string;
  message: string;
  suggestion?: string;
  codeSnippet?: string;
  fixPatch?: string;
  priority?: number;
  impactScope?: string;
  estimatedEffort?: string;
};

type Comment = {
  id: string;
  author: string;
  content: string;
  created_at: string;
};

function timeAgo(value: string) {
  const ms = Date.now() - new Date(value).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function EnhancedIssueCard({
  issue,
  issueId,
  reportId,
  onChat,
  codebaseHref,
  dict,
}: {
  issue: Issue;
  issueId?: string;
  reportId?: string;
  onChat?: () => void;
  codebaseHref?: string;
  dict: Dictionary;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Comment thread state
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const SEV_CONFIG = {
    critical: { icon: AlertCircle, iconClass: 'text-danger', badgeClass: 'bg-danger/10 text-danger', label: dict.reportDetail.severity.critical },
    high: { icon: AlertTriangle, iconClass: 'text-warning', badgeClass: 'bg-warning/20 text-warning', label: dict.reportDetail.severity.high },
    medium: { icon: AlertTriangle, iconClass: 'text-warning', badgeClass: 'bg-warning/10 text-warning', label: dict.reportDetail.severity.medium },
    low: { icon: Info, iconClass: 'text-accent', badgeClass: 'bg-accent/10 text-accent', label: dict.reportDetail.severity.low },
    info: { icon: Info, iconClass: 'text-success', badgeClass: 'bg-success/10 text-success', label: dict.reportDetail.severity.info },
  } as const;

  const config = SEV_CONFIG[issue.severity] || SEV_CONFIG.info;
  const Icon = config.icon;

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(dict.common.copied);
    setTimeout(() => setCopied(false), 2000);
  }

  const loadComments = useCallback(async () => {
    if (!issueId || !reportId || commentsLoaded) return;
    setCommentsLoading(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/issues/${issueId}`);
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setComments(Array.isArray(data.issue_comments) ? data.issue_comments : []);
      setCommentsLoaded(true);
    } catch {
      // silently ignore
    } finally {
      setCommentsLoading(false);
    }
  }, [issueId, reportId, commentsLoaded]);

  function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && !commentsLoaded && issueId && reportId) {
      void loadComments();
    }
  }

  async function handleSubmitComment() {
    if (!commentText.trim() || !issueId || !reportId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/issues/${issueId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'You', content: commentText.trim() }),
      });
      if (!res.ok) throw new Error('failed');
      const newComment = await res.json();
      setComments(prev => [...prev, newComment]);
      setCommentText('');
    } catch {
      toast.error('Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-[hsl(var(--ds-background-2))] border border-[hsl(var(--ds-border-1))] rounded-[8px] overflow-hidden mb-3 shadow-sm hover:shadow-md transition-all duration-200">
      <div
        onClick={handleExpand}
        className="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-[hsl(var(--ds-surface-1))] transition-colors"
      >
        <div className="shrink-0 mt-0.5">
          <Icon className={['size-5', config.iconClass].join(' ')} />
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-mono bg-muted rounded-[8px] px-2.5 py-1">
              {issue.file}{issue.line ? `:${issue.line}` : ''}
            </code>
            <span className={['px-2.5 py-1 rounded-[4px] text-[10px] font-bold uppercase tracking-wide', config.badgeClass].join(' ')}>
              {config.label}
            </span>
            <span className="px-2.5 py-1 rounded-[4px] text-xs font-semibold bg-primary/10 text-primary">
              {dict.reports.categories[issue.category as keyof typeof dict.reports.categories] ?? issue.category}
            </span>
            {issue.priority && (
              <span className="px-2.5 py-1 rounded-[4px] text-xs font-semibold bg-secondary text-secondary-foreground">
                P{issue.priority}
              </span>
            )}
            {issue.estimatedEffort && (
              <span className="text-[12px] font-medium text-[hsl(var(--ds-text-2))]">
                <Zap className="size-3 inline mr-1" />
                {issue.estimatedEffort}
              </span>
            )}
          </div>
          <div className="text-sm font-medium text-foreground leading-relaxed">{issue.message}</div>
          {issue.impactScope && (
            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{dict.reportDetail.impactScopeLabel}: {issue.impactScope}</div>
          )}
        </div>

        <div className="shrink-0 text-[hsl(var(--ds-text-2))]">
          {expanded ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-5 space-y-4">
          <div>
            <div className="text-xs font-semibold text-[hsl(var(--ds-text-2))] mb-2">{dict.reportDetail.ruleLabel}</div>
            <div className="text-sm font-medium">{issue.rule}</div>
          </div>

          {issue.codeSnippet && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-[hsl(var(--ds-text-2))]">{dict.reportDetail.codeSnippetLabel}</div>
                <Button variant="ghost" size="sm" className="h-7 text-xs rounded-[8px]" onClick={() => handleCopy(issue.codeSnippet!)}>
                  {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                  {dict.common.copy}
                </Button>
              </div>
              <pre className="text-xs font-mono bg-[hsl(var(--ds-background-2))] border border-[hsl(var(--ds-border-1))] rounded-[8px] p-3 overflow-x-auto">
                {issue.codeSnippet}
              </pre>
            </div>
          )}

          {issue.suggestion && (
            <div>
              <div className="text-xs font-semibold text-[hsl(var(--ds-text-2))] mb-2">💡 {dict.reportDetail.fixSuggestionLabel}</div>
              <div className="text-sm bg-[hsl(var(--ds-background-2))] border border-[hsl(var(--ds-border-1))] rounded-[8px] p-3 whitespace-pre-wrap">
                {issue.suggestion}
              </div>
            </div>
          )}

          {issue.fixPatch && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-[hsl(var(--ds-text-2))]">🔧 {dict.reportDetail.fixPatchLabel}</div>
                <Button variant="ghost" size="sm" className="h-7 text-xs rounded-[8px]" onClick={() => handleCopy(issue.fixPatch!)}>
                  {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                  {dict.common.copy}
                </Button>
              </div>
              <pre className="text-xs font-mono bg-[hsl(var(--ds-background-2))] border border-[hsl(var(--ds-border-1))] rounded-[8px] p-3 overflow-x-auto">
                {issue.fixPatch}
              </pre>
            </div>
          )}

          {(onChat || codebaseHref) && (
            <div className="pt-2 flex flex-wrap gap-2">
              {codebaseHref && (
                <Button asChild variant="outline" size="sm" className="gap-2 rounded-[8px]">
                  <Link href={codebaseHref}>
                    <FileCode className="size-4" />
                    {dict.reportDetail.viewInCodebase}
                  </Link>
                </Button>
              )}
              {onChat && (
                <Button variant="outline" size="sm" onClick={onChat} className="gap-2 rounded-[8px]">
                  <MessageCircle className="size-4" />
                  {dict.reportDetail.discussIssue}
                </Button>
              )}
            </div>
          )}

          {/* ── Comment Thread ─────────────────────────────── */}
          {issueId && reportId && (
            <div className="pt-2 border-t border-[hsl(var(--ds-border-1))]">
              <div className="text-xs font-semibold text-[hsl(var(--ds-text-2))] mb-3 flex items-center gap-1.5">
                <MessageCircle className="size-3.5" />
                Discussion
                {comments.length > 0 && (
                  <span className="ml-1 rounded-full bg-[hsl(var(--ds-surface-2))] px-1.5 py-0.5 text-[10px]">{comments.length}</span>
                )}
              </div>

              {commentsLoading && (
                <div className="text-[12px] text-[hsl(var(--ds-text-2))] py-2">Loading comments…</div>
              )}

              {!commentsLoading && comments.length > 0 && (
                <div className="space-y-3 mb-3">
                  {comments.map(c => (
                    <div key={c.id} className="flex gap-2.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--ds-surface-2))] shrink-0 mt-0.5">
                        <User className="size-3 text-[hsl(var(--ds-text-2))]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[12px] font-medium text-foreground">{c.author}</span>
                          <span className="text-[11px] text-[hsl(var(--ds-text-2))]">{timeAgo(c.created_at)}</span>
                        </div>
                        <div className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{c.content}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!commentsLoading && comments.length === 0 && (
                <p className="text-[12px] text-[hsl(var(--ds-text-2))] mb-3">No comments yet. Be the first to discuss this issue.</p>
              )}

              {/* Comment input */}
              <div className="flex gap-2">
                <textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void handleSubmitComment();
                    }
                  }}
                  placeholder="Leave a comment… (⌘+Enter to submit)"
                  rows={2}
                  className="flex-1 text-[13px] rounded-[6px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ds-border-2))] placeholder:text-[hsl(var(--ds-text-2))]"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-auto px-3 self-end rounded-[6px]"
                  disabled={!commentText.trim() || submitting}
                  onClick={handleSubmitComment}
                  aria-label="Post comment"
                >
                  <Send className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
