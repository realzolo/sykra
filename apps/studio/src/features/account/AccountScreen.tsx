'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Clock3, Copy, Key, Link2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import AccountNav from '@/components/account/AccountNav';
import AccountPageShell from '@/components/account/AccountPageShell';
import SettingsEmptyState from '@/components/settings/SettingsEmptyState';
import SettingsNotice from '@/components/settings/SettingsNotice';
import SettingsRow from '@/components/settings/SettingsRow';
import SettingsSection from '@/components/settings/SettingsSection';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import UserAvatar from '@/components/common/UserAvatar';
import { useClientDictionary } from '@/i18n/client';
import { formatLocalDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';

import type { AccountPageData, AccountSession, AccountToken } from './accountPageData';

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

function providerLabel(provider: string) {
  return provider
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

export function AccountPageSkeleton() {
  return (
    <AccountPageShell
      title={<Skeleton className="h-8 w-40 max-w-full" />}
      description={<Skeleton className="h-4 w-80 max-w-full" />}
      navigation={
        <div className="space-y-2">
          <Skeleton className="h-8 w-full rounded-[8px]" />
          <Skeleton className="h-8 w-full rounded-[8px]" />
          <Skeleton className="h-8 w-full rounded-[8px]" />
          <Skeleton className="h-8 w-full rounded-[8px]" />
        </div>
      }
    >
      <div className="space-y-6">
        <div className="rounded-[20px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-72" />
              </div>
            </div>
            <Skeleton className="h-9 w-36 rounded-[8px]" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-36" />
          <div className="rounded-[12px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-10 w-full" />
          </div>
        </div>
      </div>
    </AccountPageShell>
  );
}

type Props = {
  initialData: AccountPageData;
};

export default function AccountScreen({ initialData }: Props) {
  const dict = useClientDictionary();
  const accountI18n = dict.settings.accountPage;
  const router = useRouter();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [sessions, setSessions] = useState<AccountSession[]>(initialData.sessions);
  const [tokens, setTokens] = useState<AccountToken[]>(initialData.tokens);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenScopes, setNewTokenScopes] = useState<string[]>(['read']);
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [sessionToRevoke, setSessionToRevoke] = useState<AccountSession | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<AccountToken | null>(null);
  const [activeSectionId, setActiveSectionId] = useState('profile');

  const userLabel = initialData.user.displayName?.trim() || initialData.user.email || dict.nav.account;
  const githubLinked = initialData.providers.includes('github');
  const linkedProviders = initialData.providers.filter(Boolean);
  const currentWorkspaceLabel = initialData.activeOrg?.name ?? dict.nav.workspaceDefault;

  const scopeOptions = [
    { value: SCOPE_VALUES[0], label: accountI18n.scopeReadLabel, description: accountI18n.scopeReadDescription },
    { value: SCOPE_VALUES[1], label: accountI18n.scopeWriteLabel, description: accountI18n.scopeWriteDescription },
    { value: SCOPE_VALUES[2], label: accountI18n.scopeTriggerLabel, description: accountI18n.scopeTriggerDescription },
  ] as const;

  const navItems = [
    { targetId: 'profile', label: accountI18n.profileNavLabel },
    { targetId: 'connections', label: accountI18n.connectionsTitle },
    { targetId: 'sessions', label: accountI18n.sessionsTitle },
    { targetId: 'tokens', label: accountI18n.workspaceTokensTitle },
  ];

  useEffect(() => {
    const sectionIds = ['profile', 'connections', 'sessions', 'tokens'] as const;
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollToHash = (behavior: ScrollBehavior = 'auto') => {
      const targetId = window.location.hash.replace(/^#/, '');
      if (!targetId) return;
      const element = document.getElementById(targetId);
      element?.scrollIntoView({ behavior, block: 'start' });
      setActiveSectionId(targetId);
    };

    const observedSections = new Map<string, IntersectionObserverEntry>();
    const syncActiveSection = () => {
      const visible = sectionIds
        .map((targetId) => observedSections.get(targetId))
        .filter((entry): entry is IntersectionObserverEntry => Boolean(entry && entry.isIntersecting));

      if (visible.length > 0) {
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const nextActive = visible[0]?.target instanceof HTMLElement
          ? (visible[0].target.id as (typeof sectionIds)[number])
          : sectionIds[0];
        setActiveSectionId((current) => (current === nextActive ? current : nextActive));
        return;
      }

      const containerTop = container.getBoundingClientRect().top;
      let nextActive: (typeof sectionIds)[number] = sectionIds[0] ?? 'profile';
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const targetId of sectionIds) {
        const element = document.getElementById(targetId);
        if (!element) continue;

        const distance = Math.abs(element.getBoundingClientRect().top - containerTop);
        if (distance < closestDistance) {
          closestDistance = distance;
          nextActive = targetId;
        }
      }

      setActiveSectionId((current) => (current === nextActive ? current : nextActive));
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        observedSections.set(entry.target.id, entry);
      }
      syncActiveSection();
    }, {
      root: container,
      threshold: [0, 0.15, 0.4, 0.75],
      rootMargin: '-12% 0px -68% 0px',
    });

    for (const targetId of sectionIds) {
      const element = document.getElementById(targetId);
      if (element) observer.observe(element);
    }

    const handleHashChange = () => {
      scrollToHash('auto');
      syncActiveSection();
    };

    scrollToHash('auto');
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  function handleSectionNavigate(targetId: string) {
    const element = document.getElementById(targetId);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${targetId}`);
    setActiveSectionId(targetId);
  }

  function toggleScope(scope: string) {
    setNewTokenScopes((prev) => (prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope]));
  }

  async function loadSessions() {
    try {
      const res = await fetch('/api/auth/sessions');
      if (!res.ok) throw new Error(accountI18n.loadSessionsFailed);
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : accountI18n.loadSessionsFailed);
    }
  }

  async function loadTokens() {
    try {
      const res = await fetch('/api/tokens');
      if (!res.ok) {
        if (res.status === 404) {
          setTokens([]);
          return;
        }
        throw new Error(accountI18n.loadTokensFailed);
      }
      const data = await res.json();
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : accountI18n.loadTokensFailed);
    }
  }

  async function handleRevokeSession(session: AccountSession) {
    setRevokingId(session.id);
    try {
      const res = await fetch('/api/auth/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!res.ok) throw new Error(accountI18n.revokeSessionFailed);
      toast.success(accountI18n.revokeSessionSuccess);
      if (session.isCurrent) {
        router.push('/login');
        router.refresh();
        return;
      }
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : accountI18n.revokeSessionFailed);
    } finally {
      setRevokingId(null);
      setSessionToRevoke(null);
    }
  }

  async function handleCreateToken() {
    if (!newTokenName.trim()) {
      toast.error(accountI18n.tokenNameRequired);
      return;
    }
    if (newTokenScopes.length === 0) {
      toast.error(accountI18n.scopeRequired);
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
      if (!res.ok) throw new Error(data.error ?? accountI18n.createTokenFailed);
      setCreatedToken(data.token);
      setNewTokenName('');
      setNewTokenScopes(['read']);
      await loadTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : accountI18n.createTokenFailed);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyToken() {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    toast.success(accountI18n.tokenCopied);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDeleteToken(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(accountI18n.revokeTokenFailed);
      toast.success(accountI18n.revokeTokenSuccess);
      setTokens((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : accountI18n.revokeTokenFailed);
    } finally {
      setDeletingId(null);
      setTokenToRevoke(null);
    }
  }

  return (
    <>
      <AccountPageShell
        title={accountI18n.title}
        description={accountI18n.description}
        navigation={<AccountNav items={navItems} activeTargetId={activeSectionId} onNavigate={handleSectionNavigate} />}
        scrollContainerRef={scrollContainerRef}
      >
        <div className="space-y-6">
          <section id="profile" className="relative overflow-hidden rounded-[20px] border border-[hsl(var(--ds-border-1))] bg-[linear-gradient(135deg,hsl(var(--ds-surface-1)),hsl(var(--ds-background-2)))] p-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--ds-accent-5)/0.12),transparent_45%)]" />
            <div className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 gap-4">
                <UserAvatar
                  src={initialData.user.avatarUrl}
                  name={initialData.user.displayName}
                  email={initialData.user.email}
                  size={64}
                  className="ring-1 ring-[hsl(var(--ds-border-1))]"
                />
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[18px] font-semibold tracking-[-0.02em] text-foreground">
                      {userLabel}
                    </h2>
                    <Badge variant="outline" size="sm">{initialData.user.email ?? dict.nav.account}</Badge>
                  </div>
                  <p className="text-[13px] leading-5 text-[hsl(var(--ds-text-2))]">
                    {accountI18n.profileDescription}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Badge variant="secondary" size="sm">
                      {linkedProviders.length} {accountI18n.linkedProvidersLabel}
                    </Badge>
                    <Badge variant="secondary" size="sm">
                      {sessions.length} {accountI18n.sessionsTitle}
                    </Badge>
                    <Badge variant="secondary" size="sm">
                      {tokens.length} {accountI18n.workspaceTokensTitle}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
                {githubLinked ? (
                  <Badge variant="success" size="sm">{accountI18n.githubConnected}</Badge>
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/auth/github?mode=link">{accountI18n.githubConnectAction}</Link>
                  </Button>
                )}
                <div className="max-w-[320px] rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))] px-3 py-2 text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">
                  {accountI18n.avatarHelp}
                </div>
              </div>
            </div>
          </section>

          <SettingsSection
            title={accountI18n.connectionsTitle}
            description={accountI18n.connectionsDescription}
            className="scroll-mt-24"
            contentClassName="space-y-4"
          >
            <SettingsRow
              align="start"
              left={
                <>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-medium">{accountI18n.githubConnectionTitle}</h3>
                  </div>
                  <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                    {accountI18n.githubConnectionDescription}
                  </p>
                </>
              }
              right={
                githubLinked ? (
                  <Badge variant="success" size="sm">{accountI18n.githubConnected}</Badge>
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/auth/github?mode=link">{accountI18n.githubConnectAction}</Link>
                  </Button>
                )
              }
            />

            {linkedProviders.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {linkedProviders.map((provider) => (
                  <Badge key={provider} variant="outline" size="sm">
                    <Link2 className="mr-1.5 size-3" />
                    {providerLabel(provider)}
                  </Badge>
                ))}
              </div>
            ) : (
                <SettingsEmptyState
                  title={accountI18n.noLinkedProviders}
                  description={accountI18n.noLinkedProvidersDescription}
                  icon={<Link2 className="size-4" />}
                />
              )}
          </SettingsSection>

          <SettingsSection
            title={accountI18n.sessionsTitle}
            description={accountI18n.sessionsDescription}
            className="scroll-mt-24"
          >
            {sessions.length === 0 ? (
              <SettingsEmptyState
                title={accountI18n.noSessions}
                description={accountI18n.sessionsEmptyDescription}
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
                          <h3 className="text-[13px] font-medium">{accountI18n.sessionLabel}</h3>
                          {session.isCurrent && <Badge size="sm" variant="accent">{accountI18n.currentBadge}</Badge>}
                        </div>
                        <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                          {accountI18n.ipLabel}: {session.ipAddress || accountI18n.unknown}
                          {' | '}
                          {accountI18n.lastUsedLabel}: {formatDate(session.lastUsedAt)}
                        </p>
                        <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                          {accountI18n.createdLabel}: {formatDate(session.createdAt)}
                          {' | '}
                          {accountI18n.expiresLabel}: {formatDate(session.expiresAt)}
                        </p>
                        {session.userAgent && (
                          <p className="break-words text-[12px] text-[hsl(var(--ds-text-2))]">{session.userAgent}</p>
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
                        {revokingId === session.id ? accountI18n.revoking : accountI18n.revokeAction}
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsSection
            title={accountI18n.workspaceTokensTitle}
            description={accountI18n.workspaceTokensDescription}
            className="scroll-mt-24"
          >
            <div className="space-y-3">
              <SettingsNotice
                variant="info"
                title={accountI18n.currentWorkspaceLabel}
                description={`${accountI18n.workspaceTokensNotice} ${currentWorkspaceLabel}.`}
                icon={<ShieldCheck className="size-4" />}
              />

              {createdToken && (
                <div className="space-y-3">
                  <SettingsNotice
                    variant="success"
                    title={accountI18n.tokenCreatedHint}
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
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 text-[12px]"
                      onClick={() => setCreatedToken(null)}
                    >
                      {accountI18n.dismiss}
                    </Button>
                  </div>
                </div>
              )}

              <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium">{accountI18n.createTokenTitle}</p>
                    <p className="mt-0.5 text-[12px] text-[hsl(var(--ds-text-2))]">{accountI18n.scopesTitle}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder={accountI18n.tokenNamePlaceholder}
                    value={newTokenName}
                    onChange={(e) => setNewTokenName(e.target.value)}
                    className="h-8 max-w-xs text-[13px]"
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
                    {creating ? accountI18n.creating : accountI18n.createTokenAction}
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
                        className={cn(
                          'flex max-w-[220px] items-start gap-2 rounded-[8px] border px-3 py-2 text-left text-[12px] transition-colors duration-100',
                          active
                            ? 'border-foreground bg-[hsl(var(--ds-surface-2))] text-foreground'
                            : 'border-[hsl(var(--ds-border-1))] text-[hsl(var(--ds-text-2))] hover:border-[hsl(var(--ds-border-2))] hover:text-foreground',
                        )}
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

              {tokens.length === 0 ? (
                <SettingsEmptyState
                  title={accountI18n.noTokens}
                  description={accountI18n.tokensEmptyDescription}
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
                            {accountI18n.createdPrefix} {formatDate(token.created_at)}
                            {token.last_used_at
                              ? ` · ${accountI18n.lastUsedPrefix} ${formatDate(token.last_used_at)}`
                              : ` · ${accountI18n.neverUsed}`}
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
                          aria-label={accountI18n.revokeTokenAria}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </SettingsSection>
        </div>
      </AccountPageShell>

      <ConfirmDialog
        open={sessionToRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !revokingId) setSessionToRevoke(null);
        }}
        icon={<AlertTriangle className="size-4 text-warning" />}
        title={accountI18n.revokeSessionDialogTitle}
        description={accountI18n.revokeSessionDialogDescription}
        confirmLabel={revokingId ? accountI18n.revoking : accountI18n.revokeAction}
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
        title={accountI18n.revokeTokenDialogTitle}
        description={accountI18n.revokeTokenDialogDescription}
        confirmLabel={deletingId ? accountI18n.revoking : accountI18n.revokeAction}
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
