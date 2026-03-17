'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
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

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function SessionsSkeleton() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl px-6 py-6">
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`settings-nav-skeleton-${index}`} className="h-4 w-28" />
            ))}
          </div>
          <div className="space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-64" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={`session-card-skeleton-${index}`} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4 space-y-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-3 w-72" />
                  <Skeleton className="h-8 w-20 rounded-[6px]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    void loadSessions();
  }, []);

  async function loadSessions() {
    try {
      const res = await fetch('/api/auth/sessions');
      if (!res.ok) {
        throw new Error('Failed to load sessions');
      }
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
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
      if (!res.ok) {
        throw new Error('Failed to revoke session');
      }
      toast.success('Session revoked');
      if (session.isCurrent) {
        router.push('/login');
        router.refresh();
        return;
      }
      await loadSessions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revoke session');
    } finally {
      setRevokingId(null);
    }
  }

  if (loading) {
    return <SessionsSkeleton />;
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl px-6 py-6">
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <SettingsNav />

          <div className="space-y-6">
            <div>
              <h1 className="text-[15px] font-semibold">Security</h1>
              <p className="text-[13px] text-[hsl(var(--ds-text-2))] mt-0.5">
                Manage active sessions for your account
              </p>
            </div>

            {sessions.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <p className="text-[13px] text-[hsl(var(--ds-text-2))] text-center">
                    No active sessions found.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <Card key={session.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-[13px] font-medium">Session</h3>
                            {session.isCurrent && (
                              <Badge size="sm" variant="accent">
                                Current
                              </Badge>
                            )}
                          </div>
                          <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                            IP: {session.ipAddress || 'Unknown'} | Last used: {formatDate(session.lastUsedAt)}
                          </p>
                          <p className="text-[12px] text-[hsl(var(--ds-text-2))]">
                            Created: {formatDate(session.createdAt)} | Expires: {formatDate(session.expiresAt)}
                          </p>
                          {session.userAgent && (
                            <p className="text-[12px] text-[hsl(var(--ds-text-2))] break-words">
                              {session.userAgent}
                            </p>
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
          </div>
        </div>
      </div>
    </div>
  );
}
