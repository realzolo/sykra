'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Dictionary } from '@/i18n';

type Status = 'idle' | 'verifying' | 'success' | 'error';

export default function VerifyClient({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const params = useSearchParams();
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState(dict.auth.verifyEmailRequired);
  const [loading, setLoading] = useState(false);

  const handleVerify = useCallback(async (value?: string) => {
    const tokenValue = (value ?? token).trim();
    if (!tokenValue) {
      setStatus('error');
      setMessage(dict.auth.verifyEmailInvalid);
      return;
    }

    setLoading(true);
    setStatus('verifying');
    setMessage(dict.auth.verifyEmailInProgress);

    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenValue }),
      });
      if (!res.ok) {
        setStatus('error');
        setMessage(dict.auth.verifyEmailInvalid);
        return;
      }
      setStatus('success');
      setMessage(dict.auth.verifyEmailSuccess);
    } catch {
      setStatus('error');
      setMessage(dict.auth.verifyEmailInvalid);
    } finally {
      setLoading(false);
    }
  }, [dict.auth.verifyEmailInProgress, dict.auth.verifyEmailInvalid, dict.auth.verifyEmailSuccess, token]);

  useEffect(() => {
    const tokenParam = params.get('token');
    if (tokenParam && tokenParam !== token) {
      setToken(tokenParam);
      void handleVerify(tokenParam);
    }
  }, [handleVerify, params, token]);

  return (
    <div className="auth-page">
      <div className="auth-main">
        <Card className="auth-card">
          <div className="px-8 py-8 space-y-5 text-center">
            <div className="text-lg font-semibold">{dict.auth.verifyEmailTitle}</div>
            <div className="text-sm text-muted-foreground">{message}</div>

            {status !== 'success' && (
              <form
                className="space-y-4 text-left"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleVerify();
                }}
              >
                <div className="space-y-2">
                  <label className="text-label-14">{dict.auth.codeLabel}</label>
                  <Input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={dict.auth.codePlaceholder}
                    disabled={loading}
                    className="h-10"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? dict.common.loading : dict.auth.verifyEmailTitle}
                </Button>
              </form>
            )}

            <div className="flex items-center justify-center">
              <Button variant="outline" onClick={() => router.push('/login')}>
                {dict.auth.backToLogin}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
