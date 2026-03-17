'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Status = 'loading' | 'success' | 'error' | 'unauthorized';

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState<string>('Accepting invite...');

  async function resolveOrgRedirect(): Promise<string> {
    try {
      const res = await fetch('/api/orgs/active');
      if (!res.ok) return '/projects';
      const data = await res.json();
      if (data?.orgId) return `/o/${data.orgId}`;
    } catch {}
    return '/projects';
  }

  useEffect(() => {
    const tokenParam = params?.token;
    const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;
    if (!token) return;

    async function acceptInvite() {
      try {
        const res = await fetch(`/api/orgs/invites/${token}/accept`, { method: 'POST' });
        if (res.status === 401) {
          setStatus('unauthorized');
          setMessage('Please sign in to accept this invite.');
          return;
        }
        if (!res.ok) {
          const data = await res.json();
          setStatus('error');
          setMessage(data.error || 'Failed to accept invite.');
          return;
        }
        setStatus('success');
        setMessage('Invite accepted. You can now access the organization.');
      } catch {
        setStatus('error');
        setMessage('Failed to accept invite.');
      }
    }

    acceptInvite();
  }, [params]);

  return (
    <div className="auth-page">
      <div className="auth-main">
        <Card className="auth-card">
          <div className="px-8 py-8 space-y-4 text-center">
            <div className="text-lg font-semibold">Organization invite</div>
            <div className="text-sm text-muted-foreground">{message}</div>
            <div className="flex items-center justify-center gap-2">
              {status === 'success' && (
                <Button
                  onClick={async () => {
                    const nextPath = await resolveOrgRedirect();
                    router.push(nextPath);
                  }}
                >
                  Go to dashboard
                </Button>
              )}
              {status === 'unauthorized' && (
                <Button onClick={() => router.push('/login')}>Sign in</Button>
              )}
              {status === 'error' && (
                <Button variant="outline" onClick={() => router.push('/login')}>
                  Back to login
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
