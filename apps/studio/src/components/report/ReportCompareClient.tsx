'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Dictionary } from '@/i18n';

type Issue = {
  id: string;
  file: string;
  line: number | null;
  severity: string;
  category: string;
  rule: string;
  message: string;
  status: string;
};

type Report = {
  id: string;
  status: string;
  score?: number;
  created_at: string;
  commits?: { sha?: string; message?: string }[];
};

type DiffResult = {
  newIssues: Issue[];
  resolvedIssues: Issue[];
  persistingIssues: Issue[];
};

function issueKey(issue: Issue) {
  return `${issue.file}:${issue.rule}:${issue.category}`;
}

function diffIssues(issuesA: Issue[], issuesB: Issue[]): DiffResult {
  const keysA = new Map(issuesA.map(i => [issueKey(i), i]));
  const keysB = new Map(issuesB.map(i => [issueKey(i), i]));

  const newIssues: Issue[] = [];
  const resolvedIssues: Issue[] = [];
  const persistingIssues: Issue[] = [];

  for (const [key, issue] of keysB) {
    if (!keysA.has(key)) {
      newIssues.push(issue);
    } else {
      persistingIssues.push(issue);
    }
  }

  for (const [key, issue] of keysA) {
    if (!keysB.has(key)) {
      resolvedIssues.push(issue);
    }
  }

  return { newIssues, resolvedIssues, persistingIssues };
}

function ScoreDelta({ scoreA, scoreB }: { scoreA?: number; scoreB?: number }) {
  if (scoreA == null || scoreB == null) return null;
  const delta = scoreB - scoreA;
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success text-sm font-semibold">
        <ArrowUp className="size-3.5" />+{delta} pts
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger/10 text-danger text-sm font-semibold">
        <ArrowDown className="size-3.5" />{delta} pts
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-sm font-semibold">
      <Minus className="size-3.5" />0 pts
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, 'danger' | 'warning' | 'default'> = {
    error: 'danger',
    warning: 'warning',
    info: 'default',
  };
  return <Badge variant={map[severity] ?? 'default'} size="sm">{severity}</Badge>;
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 border-b border-[hsl(var(--ds-border-1))] last:border-0">
      <div className="flex items-center gap-2">
        <SeverityBadge severity={issue.severity} />
        <span className="text-[12px] font-mono text-[hsl(var(--ds-text-2))] truncate flex-1">
          {issue.file}{issue.line != null ? `:${issue.line}` : ''}
        </span>
      </div>
      <div className="text-[13px] text-foreground">{issue.message}</div>
      <div className="text-[11px] text-[hsl(var(--ds-text-2))]">{issue.rule} · {issue.category}</div>
    </div>
  );
}

function IssueSection({
  title,
  issues,
  emptyText,
  accent,
}: {
  title: string;
  issues: Issue[];
  emptyText: string;
  accent: 'danger' | 'success' | 'neutral';
}) {
  const borderColor =
    accent === 'danger' ? 'border-danger/30' :
    accent === 'success' ? 'border-success/30' :
    'border-[hsl(var(--ds-border-1))]';
  const headerBg =
    accent === 'danger' ? 'bg-danger/5' :
    accent === 'success' ? 'bg-success/5' :
    'bg-[hsl(var(--ds-surface-1))]';
  const countColor =
    accent === 'danger' ? 'text-danger' :
    accent === 'success' ? 'text-success' :
    'text-[hsl(var(--ds-text-2))]';

  return (
    <div className={`rounded-[8px] border ${borderColor} overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-2.5 ${headerBg} border-b ${borderColor}`}>
        <span className="text-[13px] font-medium text-foreground">{title}</span>
        <span className={`text-[13px] font-semibold tabular-nums ${countColor}`}>{issues.length}</span>
      </div>
      {issues.length === 0 ? (
        <div className="px-4 py-6 text-[13px] text-[hsl(var(--ds-text-2))] text-center">{emptyText}</div>
      ) : (
        <div className="max-h-80 overflow-auto">
          {issues.map(issue => <IssueRow key={issue.id} issue={issue} />)}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, label }: { report: Report; label: string }) {
  const firstCommit = Array.isArray(report.commits) && report.commits.length > 0 ? report.commits[0] : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-medium text-[hsl(var(--ds-text-2))] uppercase tracking-wider">{label}</div>
      <div className="flex items-center gap-3">
        {report.score != null && (
          <span className="text-2xl font-bold tabular-nums text-foreground">{report.score}</span>
        )}
        <div className="flex flex-col">
          {firstCommit?.message && (
            <span className="text-[13px] text-foreground truncate max-w-[220px]">{firstCommit.message}</span>
          )}
          {firstCommit?.sha && (
            <span className="text-[12px] font-mono text-[hsl(var(--ds-text-2))]">{firstCommit.sha.slice(0, 7)}</span>
          )}
          <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{new Date(report.created_at).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

export default function ReportCompareClient({
  reportIdA,
  reportIdB,
  projectId,
  dict,
}: {
  reportIdA: string;
  reportIdB: string;
  projectId: string;
  dict: Dictionary;
}) {
  const router = useRouter();
  const [reportA, setReportA] = useState<Report | null>(null);
  const [reportB, setReportB] = useState<Report | null>(null);
  const [issuesA, setIssuesA] = useState<Issue[]>([]);
  const [issuesB, setIssuesB] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/reports/${reportIdA}`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch(`/api/reports/${reportIdB}`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch(`/api/reports/${reportIdA}/issues`).then(r => r.ok ? r.json() : { issues: [] }),
      fetch(`/api/reports/${reportIdB}/issues`).then(r => r.ok ? r.json() : { issues: [] }),
    ])
      .then(([rA, rB, iA, iB]) => {
        if (!alive) return;
        setReportA(rA);
        setReportB(rB);
        setIssuesA(Array.isArray(iA?.issues) ? iA.issues : []);
        setIssuesB(Array.isArray(iB?.issues) ? iB.issues : []);
        setLoading(false);
      })
      .catch(() => {
        if (alive) { setError('Failed to load reports'); setLoading(false); }
      });

    return () => { alive = false; };
  }, [reportIdA, reportIdB]);

  const diff = !loading && reportA && reportB ? diffIssues(issuesA, issuesB) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[hsl(var(--ds-border-1))] bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex-1">
            <div className="text-[16px] font-semibold text-foreground">{dict.reports.compare.title}</div>
          </div>
          {!loading && reportA && reportB && (
            <ScoreDelta scoreA={reportA.score} scoreB={reportB.score} />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-6">
        {loading ? (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-6">
              <Skeleton className="h-16 rounded-[8px]" />
              <Skeleton className="h-16 rounded-[8px]" />
            </div>
            <Skeleton className="h-48 rounded-[8px]" />
            <Skeleton className="h-48 rounded-[8px]" />
            <Skeleton className="h-48 rounded-[8px]" />
          </div>
        ) : error ? (
          <div className="text-[13px] text-danger px-2 py-4">{error}</div>
        ) : reportA && reportB && diff ? (
          <div className="flex flex-col gap-6 max-w-4xl mx-auto">
            {/* Report headers */}
            <div className="grid grid-cols-2 gap-6 p-4 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]">
              <ReportCard report={reportA} label={dict.reports.compare.reportA} />
              <div className="border-l border-[hsl(var(--ds-border-1))] pl-6">
                <ReportCard report={reportB} label={dict.reports.compare.reportB} />
              </div>
            </div>

            {/* New issues */}
            <IssueSection
              title={dict.reports.compare.newIssues}
              issues={diff.newIssues}
              emptyText={dict.reports.compare.noNewIssues}
              accent="danger"
            />

            {/* Resolved issues */}
            <IssueSection
              title={dict.reports.compare.resolvedIssues}
              issues={diff.resolvedIssues}
              emptyText={dict.reports.compare.noResolvedIssues}
              accent="success"
            />

            {/* Persisting issues */}
            <IssueSection
              title={dict.reports.compare.persistingIssues}
              issues={diff.persistingIssues}
              emptyText={dict.reports.compare.noPersistingIssues}
              accent="neutral"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
