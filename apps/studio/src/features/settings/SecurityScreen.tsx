'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Clock3, Copy, Key, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import SettingsPageShell from '@/components/settings/SettingsPageShell';
import SettingsEmptyState from '@/components/settings/SettingsEmptyState';
import SettingsNotice from '@/components/settings/SettingsNotice';
import SettingsRow from '@/components/settings/SettingsRow';
import SettingsSection from '@/components/settings/SettingsSection';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientDictionary } from '@/i18n/client';
import { formatLocalDateTime } from '@/lib/dateFormat';

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

const SCOPE_VALUES = ['read', 'write', 'pipeline:trigger'] as const;

function formatDate(value?: string | null) {
  if (!value) return '-';
  return formatLocalDateTime(value);
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
    <SettingsPageShell
      title={<Skeleton className="h-8 w-40 max-w-full" />}
      description={<Skeleton className="h-4 w-80 max-w-full" />}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="space-y-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="space-y-3 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-72" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </div>
    </SettingsPageShell>
  );
}

export default function SecurityScreen() {
  const dict = useClientDictionary();
  const i18n = dict.settings.securityPage;
  const router = useRouter();

  const scopeOptions = [
    { value: SCOPE_VALUES[0], label: i18n.scopeReadLabel, description: i18n.scopeReadDescription },
    { value: SCOPE_VALUES[1], label: i18n.scopeWriteLabel, description: i18n.scopeWriteDescription },
    { value: SCOPE_VALUES[2], label: i18n.scopeTriggerLabel, description: i18n.scopeTriggerDescription },
  ] as const;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenScopes, setNewTokenScopes] = useState<string[]>(['read']);
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sessionToRevoke, setSessionToRevoke] = useState<Session | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<ApiToken | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/sessions');
      if (!res.ok) throw new Error(i18n.loadSessionsFailed);
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.loadSessionsFailed);
    } finally {
      setSessionsLoading(false);
    }
  }, [i18n.loadSessionsFailed]);

  const loadTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/tokens');
      if (!res.ok) {
        if (res.status === 404) {
          setTokens([]);
          return;
        }
        throw new Error(i18n.loadTokensFailed);
      }
      const data = await res.json();
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.loadTokensFailed);
    } finally {
      setTokensLoading(false);
    }
  }, [i18n.loadTokensFailed]);

  useEffect(() => {
    void loadSessions();
    void loadTokens();
  }, [loadSessions, loadTokens]);

  async function handleRevokeSession(session: Session) {
    setRevokingId(session.id);
    try {
      const res = await fetch('/api/auth/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!res.ok) throw new Error(i18n.revokeSessionFailed);
      toast.success(i18n.revokeSessionSuccess);
      if (session.isCurrent) {
        router.push('/login');
        router.refresh();
        return;
      }
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.revokeSessionFailed);
    } finally {
      setRevokingId(null);
      setSessionToRevoke(null);
    }
  }

  function toggleScope(scope: string) {
    setNewTokenScopes((prev) => (prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope]));
  }

  async function handleCreateToken() {
    if (!newTokenName.trim()) {
      toast.error(i18n.tokenNameRequired);
      return;
    }
    if (newTokenScopes.length === 0) {
      toast.error(i18n.scopeRequired);
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
      if (!res.ok) throw new Error(data.error ?? i18n.createTokenFailed);
      setCreatedToken(data.token);
      setNewTokenName('');
      setNewTokenScopes(['read']);
      await loadTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.createTokenFailed);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyToken() {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    toast.success(i18n.tokenCopied);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDeleteToken(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(i18n.revokeTokenFailed);
      toast.success(i18n.revokeTokenSuccess);
      setTokens((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.revokeTokenFailed);
    } finally {
      setDeletingId(null);
      setTokenToRevoke(null);
    }
  }

  if (sessionsLoading && tokensLoading) {
    return <PageSkeleton />;
  }

  return (
    <>
      <SettingsPageShell title={i18n.title} description={i18n.description}>
        <div className="space-y-6">
          <SettingsSection title={i18n.sessionsTitle} description={i18n.sessionsDescription}>
            {sessions.length === 0 ? (
              <SettingsEmptyState
                title={i18n.noSessions}
                description={i18n.sessionsEmptyDescription}
                icon={<Clock3 className="size-4" />}
              />
            ) : (
              <div className="divide-y divide-[hsl(var(--ds-border-1))]">
                {sessions.map((session) => (
                  <SettingsRow
                    key={session.id}
                    align="start"
                    left={
                      <>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[13px] font-medium">{i18n.sessionLabel}</h3>
                          {session.isCurrent && <Badge size="sm" variant="accent">{i18n.currentBadge}</Badge>}
                        </div>
                        <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                          {i18n.ipLabel}: {session.ipAddress || i18n.unknown}
                          {' | '}
                          {i18n.lastUsedLabel}: {formatDate(session.lastUsedAt)}
                        </p>
                        <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                          {i18n.createdLabel}: {formatDate(session.createdAt)}
                          {' | '}
                          {i18n.expiresLabel}: {formatDate(session.expiresAt)}
                        </p>
                        {session.userAgent && (
                          <p className="text-[12px] text-[hsl(var(--ds-text-2))] break-words">{session.userAgent}</p>
                        )}
                      </>
                    }
                    right={
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revokingId === session.id}
                        onClick={() => setSessionToRevoke(session)}
                      >
                        {revokingId === session.id ? i18n.revoking : i18n.revokeAction}
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsSection title={i18n.apiTokensTitle} description={i18n.apiTokensDescription}>
            {createdToken && (
              <div className="space-y-3">
                <SettingsNotice
                  variant="success"
                  title={i18n.tokenCreatedHint}
                  icon={<Check className="size-4" />}
                />
                <div className="flex items-center gap-2 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] px-4 py-3">
                  <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-foreground">
                    {createdToken}
                  </code>
                  <Button size="sm" variant="outline" onClick={handleCopyToken} className="shrink-0 gap-1.5">
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? dict.common.copied : dict.common.copy}
                  </Button>
                  <Button size="sm" variant="ghost" className="shrink-0 text-[12px]" onClick={() => setCreatedToken(null)}>
                    {i18n.dismiss}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium">{i18n.createTokenTitle}</p>
                  <p className="text-[12px] text-[hsl(var(--ds-text-2))] mt-0.5">{i18n.scopesTitle}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder={i18n.tokenNamePlaceholder}
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  className="h-8 text-[13px] max-w-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreateToken();
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCreateToken}
                  disabled={creating || !newTokenName.trim() || newTokenScopes.length === 0}
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  {creating ? i18n.creating : i18n.createTokenAction}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {scopeOptions.map((opt) => {
                  const active = newTokenScopes.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleScope(opt.value)}
                      className={[
                        'flex max-w-[220px] items-start gap-2 rounded-[8px] border px-3 py-2 text-left text-[12px] transition-colors duration-100',
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

            {tokensLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div key={`token-skeleton-${index}`} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] p-4">
                    <Skeleton className="h-4 w-40 mb-2" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                ))}
              </div>
            ) : tokens.length === 0 ? (
              <SettingsEmptyState
                title={i18n.noTokens}
                description={i18n.tokensEmptyDescription}
                icon={<Key className="size-4" />}
              />
            ) : (
              <div className="divide-y divide-[hsl(var(--ds-border-1))]">
                {tokens.map((token) => (
                  <SettingsRow
                    key={token.id}
                    align="start"
                    left={
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Key className="size-4 shrink-0 text-[hsl(var(--ds-text-2))]" />
                          <span className="text-[13px] font-medium text-foreground">{token.name}</span>
                          <code className="text-[11px] font-mono text-[hsl(var(--ds-text-2))]">{token.token_prefix}…</code>
                          {token.scopes.map((scope) => (
                            <ScopeChip key={scope} scope={scope} />
                          ))}
                        </div>
                        <p className="mt-0.5 text-[12px] text-[hsl(var(--ds-text-2))]">
                          {i18n.createdPrefix} {formatDate(token.created_at)}
                          {token.last_used_at
                            ? ` · ${i18n.lastUsedPrefix} ${formatDate(token.last_used_at)}`
                            : ` · ${i18n.neverUsed}`}
                        </p>
                      </>
                    }
                    right={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-[hsl(var(--ds-text-2))] hover:text-danger"
                        disabled={deletingId === token.id}
                        onClick={() => setTokenToRevoke(token)}
                        aria-label={i18n.revokeTokenAria}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </SettingsSection>
        </div>
      </SettingsPageShell>

      <ConfirmDialog
        open={sessionToRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !revokingId) setSessionToRevoke(null);
        }}
        icon={<AlertTriangle className="size-4 text-warning" />}
        title={i18n.revokeSessionDialogTitle}
        description={i18n.revokeSessionDialogDescription}
        confirmLabel={revokingId ? i18n.revoking : i18n.revokeAction}
        cancelLabel={dict.common.cancel}
        onConfirm={() => {
          if (!sessionToRevoke || revokingId) return;
          void handleRevokeSession(sessionToRevoke);
        }}
        loading={revokingId !== null}
        danger
      />

      <ConfirmDialog
        open={tokenToRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !deletingId) setTokenToRevoke(null);
        }}
        icon={<AlertTriangle className="size-4 text-warning" />}
        title={i18n.revokeTokenDialogTitle}
        description={i18n.revokeTokenDialogDescription}
        confirmLabel={deletingId ? i18n.revoking : i18n.revokeAction}
        cancelLabel={dict.common.cancel}
        onConfirm={() => {
          if (!tokenToRevoke || deletingId) return;
          void handleDeleteToken(tokenToRevoke.id);
        }}
        loading={deletingId !== null}
        danger
      />
    </>
  );
}
