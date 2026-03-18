'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Copy, Check, Plus, Trash2, Key } from 'lucide-react';
import SettingsNav from '@/components/settings/SettingsNav';

type Session = {
  id: string;
  createdAt: string;
  lastUsedAt?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt: string;
  isCurrent: boolean;
};

type ApiToken = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
};

const SCOPE_OPTIONS = [
  { value: 'read', label: 'Read', description: 'Read projects, reports, pipelines' },
  { value: 'write', label: 'Write', description: 'Create and update resources' },
  { value: 'pipeline:trigger', label: 'Pipeline Trigger', description: 'Trigger pipeline runs' },
] as const;

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function ScopeChip({ scope }: { scope: string }) {
  return (
    <span className="inline-flex items-center rounded-[4px] bg-[hsl(var(--ds-surface-2))] px-1.5 py-0.5 text-[10px] font-mono font-medium text-foreground">
      {scope}
    </span>
  );
}

function PageSkeleton() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl px-6 py-6">
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-28" />
            ))}
          </div>
          <div className="space-y-6">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4 space-y-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const router = useRouter();

  // Sessions
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // API Tokens
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenScopes, setNewTokenScopes] = useState<string[]>(['read']);
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void loadSessions();
    void loadTokens();
  }, []);

  async function loadSessions() {
    try {
      const res = await fetch('/api/auth/sessions');
      if (!res.ok) throw new Error('Failed to load sessions');
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setSessionsLoading(false);
    }
  }

  async function loadTokens() {
    try {
      const res = await fetch('/api/tokens');
      if (!res.ok) throw new Error('Failed to load tokens');
      const data = await res.json();
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch {
      // Silently ignore if table doesn't exist yet
    } finally {
      setTokensLoading(false);
    }
  }

  async function handleRevoke(session: Session) {
    if (!confirm('Revoke this session?')) return;
    setRevokingId(session.id);
    try {
      const res = await fetch('/api/auth/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!res.ok) throw new Error('Failed to revoke session');
      toast.success('Session revoked');
      if (session.isCurrent) {
        router.push('/login');
        router.refresh();
        return;
      }
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke session');
    } finally {
      setRevokingId(null);
    }
  }

  function toggleScope(scope: string) {
    setNewTokenScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  }

  async function handleCreateToken() {
    if (!newTokenName.trim()) {
      toast.error('Token name is required');
      return;
    }
    if (newTokenScopes.length === 0) {
      toast.error('Select at least one scope');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim(), scopes: newTokenScopes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create token');
      setCreatedToken(data.token);
      setNewTokenName('');
      setNewTokenScopes(['read']);
      await loadTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyToken() {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    toast.success('Token copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDeleteToken(id: string) {
    if (!confirm('Revoke this API token? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke token');
      toast.success('Token revoked');
      setTokens(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke token');
    } finally {
      setDeletingId(null);
    }
  }

  if (sessionsLoading && tokensLoading) return <PageSkeleton />;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl px-6 py-6">
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <SettingsNav />

          <div className="space-y-10">

            {/* ── Sessions ─────────────────────────────────────── */}
            <section className="space-y-4">
              <div>
                <h1 className="text-[15px] font-semibold">Security</h1>
                <p className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">
                  Manage active sessions for your account
                </p>
              </div>

              {sessions.length === 0 ? (
                <Card>
                  <CardContent className="p-6">
                    <p className="text-[13px] text-[hsl(var(--ds-text-2))] text-center">No active sessions found.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {sessions.map(session => (
                    <Card key={session.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="text-[13px] font-medium">Session</h3>
                              {session.isCurrent && <Badge size="sm" variant="accent">Current</Badge>}
                            </div>
                            <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                              IP: {session.ipAddress || 'Unknown'} | Last used: {formatDate(session.lastUsedAt)}
                            </p>
                            <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                              Created: {formatDate(session.createdAt)} | Expires: {formatDate(session.expiresAt)}
                            </p>
                            {session.userAgent && (
                              <p className="text-[12px] text-[hsl(var(--ds-text-2))] break-words">{session.userAgent}</p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={revokingId === session.id}
                            onClick={() => handleRevoke(session)}
                          >
                            {revokingId === session.id ? 'Revoking...' : 'Revoke'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* ── API Tokens ────────────────────────────────────── */}
            <section className="space-y-4">
              <div>
                <h2 className="text-[15px] font-semibold flex items-center gap-2">
                  <Key className="size-4" />
                  API Tokens
                </h2>
                <p className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">
                  Tokens allow programmatic access to Spec-Axis. They are shown once at creation.
                </p>
              </div>

              {/* Newly created token banner */}
              {createdToken && (
                <div className="rounded-[8px] border border-success/40 bg-success/5 p-4 space-y-2">
                  <p className="text-[13px] font-medium text-success">Token created — copy it now, it won't be shown again.</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[12px] font-mono bg-[hsl(var(--ds-background-2))] border border-[hsl(var(--ds-border-1))] rounded-[6px] px-3 py-2 break-all">
                      {createdToken}
                    </code>
                    <Button size="sm" variant="outline" onClick={handleCopyToken} className="shrink-0 gap-1.5">
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <Button size="sm" variant="ghost" className="text-[12px]" onClick={() => setCreatedToken(null)}>
                    Dismiss
                  </Button>
                </div>
              )}

              {/* Create form */}
              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4 space-y-4">
                <p className="text-[13px] font-medium">Create new token</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Token name (e.g. CI Deploy)"
                    value={newTokenName}
                    onChange={e => setNewTokenName(e.target.value)}
                    className="h-8 text-[13px] max-w-xs"
                    onKeyDown={e => { if (e.key === 'Enter') void handleCreateToken(); }}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-[12px] text-[hsl(var(--ds-text-2))] font-medium">Scopes</p>
                  <div className="flex flex-wrap gap-2">
                    {SCOPE_OPTIONS.map(opt => {
                      const active = newTokenScopes.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => toggleScope(opt.value)}
                          className={[
                            'flex items-start gap-2 rounded-[6px] border px-3 py-2 text-left text-[12px] transition-colors duration-100',
                            active
                              ? 'border-foreground bg-[hsl(var(--ds-surface-2))] text-foreground'
                              : 'border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:border-[hsl(var(--ds-border-2))] hover:text-foreground',
                          ].join(' ')}
                        >
                          <div>
                            <div className="font-medium">{opt.label}</div>
                            <div className="text-[11px] opacity-70">{opt.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCreateToken}
                  disabled={creating || !newTokenName.trim() || newTokenScopes.length === 0}
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  {creating ? 'Creating...' : 'Create token'}
                </Button>
              </div>

              {/* Token list */}
              {tokensLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] p-4">
                      <Skeleton className="h-4 w-40 mb-2" />
                      <Skeleton className="h-3 w-64" />
                    </div>
                  ))}
                </div>
              ) : tokens.length === 0 ? (
                <p className="text-[13px] text-[hsl(var(--ds-text-2))]">No API tokens yet.</p>
              ) : (
                <div className="space-y-2">
                  {tokens.map(token => (
                    <div
                      key={token.id}
                      className="flex items-center gap-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] px-4 py-3"
                    >
                      <Key className="size-4 text-[hsl(var(--ds-text-2))] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-medium text-foreground">{token.name}</span>
                          <code className="text-[11px] font-mono text-[hsl(var(--ds-text-2))]">{token.token_prefix}…</code>
                          {token.scopes.map(s => <ScopeChip key={s} scope={s} />)}
                        </div>
                        <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">
                          Created {formatDate(token.created_at)}
                          {token.last_used_at ? ` · Last used ${formatDate(token.last_used_at)}` : ' · Never used'}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-[hsl(var(--ds-text-2))] hover:text-danger shrink-0"
                        disabled={deletingId === token.id}
                        onClick={() => handleDeleteToken(token.id)}
                        aria-label="Revoke token"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}
