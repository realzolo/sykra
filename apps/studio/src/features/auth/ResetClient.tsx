'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Dictionary } from '@/i18n';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function ResetClient({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const params = useSearchParams();
  const [token, setToken] = useState(() => params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState(dict.auth.resetPasswordPrompt);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedToken = token.trim();

    if (!trimmedToken) {
      setStatus('error');
      setMessage(dict.auth.resetPasswordInvalid);
      return;
    }

    if (password !== confirm) {
      setStatus('error');
      setMessage(dict.auth.resetPasswordMismatch);
      return;
    }

    setStatus('loading');
    setMessage(dict.common.loading);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: trimmedToken, password }),
      });
      if (!res.ok) {
        setStatus('error');
        setMessage(dict.auth.resetPasswordInvalid);
        return;
      }
      setStatus('success');
      setMessage(dict.auth.resetPasswordSuccess);
    } catch {
      setStatus('error');
      setMessage(dict.auth.resetPasswordInvalid);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-main">
        <Card className="auth-card">
          <div className="px-8 py-8 space-y-5 text-center">
            <div className="text-lg font-semibold">{dict.auth.resetPasswordTitle}</div>
            <div className="text-sm text-muted-foreground">{message}</div>

            {status !== 'success' && (
              <form onSubmit={handleSubmit} className="space-y-4 text-left">
                <div className="space-y-2">
                  <label className="text-label-14">{dict.auth.codeLabel}</label>
                  <Input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={dict.auth.codePlaceholder}
                    disabled={status === 'loading'}
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-label-14">{dict.auth.password}</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={dict.auth.passwordPlaceholder}
                    disabled={status === 'loading'}
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-label-14">{dict.auth.resetPasswordConfirm}</label>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={dict.auth.passwordPlaceholder}
                    disabled={status === 'loading'}
                    className="h-10"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={status === 'loading'}>
                  {status === 'loading' ? dict.common.loading : dict.auth.resetPasswordAction}
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
