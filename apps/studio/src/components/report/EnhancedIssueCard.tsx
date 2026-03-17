'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, AlertTriangle, AlertCircle, Info, Zap, Copy, Check, MessageCircle, FileCode } from 'lucide-react';
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

export default function EnhancedIssueCard({
  issue,
  onChat,
  codebaseHref,
  dict,
}: {
  issue: Issue;
  onChat?: () => void;
  codebaseHref?: string;
  dict: Dictionary;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

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

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden mb-3 shadow-sm hover:shadow-md transition-all duration-200">
      <div
        onClick={() => setExpanded(e => !e)}
        className="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-muted/50 transition-colors"
      >
        <div className="shrink-0 mt-0.5">
          <Icon className={['size-5', config.iconClass].join(' ')} />
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-mono bg-muted rounded-lg px-2.5 py-1">
              {issue.file}{issue.line ? `:${issue.line}` : ''}
            </code>
            <span className={['px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide', config.badgeClass].join(' ')}>
              {config.label}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
              {dict.reports.categories[issue.category as keyof typeof dict.reports.categories] ?? issue.category}
            </span>
            {issue.priority && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground">
                P{issue.priority}
              </span>
            )}
            {issue.estimatedEffort && (
              <span className="text-xs font-medium text-muted-foreground">
                <Zap className="size-3 inline mr-1" />
                {issue.estimatedEffort}
              </span>
            )}
          </div>
          <div className="text-sm font-medium text-foreground leading-relaxed">{issue.message}</div>
          {issue.impactScope && (
            <div className="text-xs text-muted-foreground">{dict.reportDetail.impactScopeLabel}: {issue.impactScope}</div>
          )}
        </div>

        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-muted/30 p-5 space-y-4">
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">{dict.reportDetail.ruleLabel}</div>
            <div className="text-sm font-medium">{issue.rule}</div>
          </div>

          {issue.codeSnippet && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-muted-foreground">{dict.reportDetail.codeSnippetLabel}</div>
              <Button variant="ghost" size="sm" className="h-7 text-xs rounded-lg" onClick={() => handleCopy(issue.codeSnippet!)}>
                {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                {dict.common.copy}
              </Button>
              </div>
              <pre className="text-xs font-mono bg-card border border-border rounded-lg p-3 overflow-x-auto">
                {issue.codeSnippet}
              </pre>
            </div>
          )}

          {issue.suggestion && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-2">💡 {dict.reportDetail.fixSuggestionLabel}</div>
              <div className="text-sm bg-card border border-border rounded-lg p-3 whitespace-pre-wrap">
                {issue.suggestion}
              </div>
            </div>
          )}

          {issue.fixPatch && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-muted-foreground">🔧 {dict.reportDetail.fixPatchLabel}</div>
              <Button variant="ghost" size="sm" className="h-7 text-xs rounded-lg" onClick={() => handleCopy(issue.fixPatch!)}>
                {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                {dict.common.copy}
              </Button>
              </div>
              <pre className="text-xs font-mono bg-card border border-border rounded-lg p-3 overflow-x-auto">
                {issue.fixPatch}
              </pre>
            </div>
          )}

          {(onChat || codebaseHref) && (
            <div className="pt-2 flex flex-wrap gap-2">
              {codebaseHref && (
                <Button asChild variant="outline" size="sm" className="gap-2 rounded-lg">
                  <Link href={codebaseHref}>
                    <FileCode className="size-4" />
                    {dict.reportDetail.viewInCodebase}
                  </Link>
                </Button>
              )}
              {onChat && (
                <Button variant="outline" size="sm" onClick={onChat} className="gap-2 rounded-lg">
                  <MessageCircle className="size-4" />
                  {dict.reportDetail.discussIssue}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
