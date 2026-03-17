'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import NexalyMark from '@/components/common/NexalyMark';
import { cn } from '@/lib/utils';
import type { Dictionary } from '@/i18n';
import type { Locale } from '@/i18n/config';

interface LoginClientProps {
  dict: Dictionary;
  locale: Locale;
  legalLinks: {
    terms: string;
    privacy: string;
  };
}

export default function LoginClient({ dict, locale, legalLinks }: LoginClientProps) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const currentYear = new Date().getFullYear();

  async function resolveOrgRedirect(): Promise<string> {
    try {
      const res = await fetch('/api/orgs/active');
      if (!res.ok) return '/projects';
      const data = await res.json();
      if (data?.orgId) return `/o/${data.orgId}`;
    } catch {}
    return '/projects';
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.code === 'EMAIL_NOT_VERIFIED') {
          await fetch('/api/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim() }),
          }).catch(() => {});
          toast.error(dict.auth.verifyEmailRequired);
          toast.success(dict.auth.verifyEmailSent);
          return;
        }
        if (data?.code === 'ACCOUNT_LOCKED') {
          toast.error(dict.auth.accountLocked);
          return;
        }
        if (data?.code === 'RATE_LIMITED') {
          toast.error(dict.auth.tooManyAttempts);
          return;
        }
        throw new Error('login failed');
      }

      const nextPath = await resolveOrgRedirect();
      router.push(nextPath);
      router.refresh();
    } catch {
      toast.error(dict.auth.loginFailed);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();

    if (!email.trim()) {
      toast.error(dict.auth.emailRequired);
      return;
    }

    if (!password.trim()) {
      toast.error(dict.auth.passwordRequired);
      return;
    }

    const strengthScore = getPasswordStrengthScore(password);
    if (strengthScore < 3) {
      toast.error(dict.auth.passwordTooWeak);
      return;
    }

    setSigningUp(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) throw new Error('signup failed');

      toast.success(dict.auth.verifyEmailSent);
      setMode('login');
    } catch {
      toast.error(dict.auth.signUpFailed);
    } finally {
      setSigningUp(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetEmail.trim()) {
      toast.error(dict.auth.emailRequired);
      return;
    }
    setResetLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim() }),
      });
      if (!res.ok) throw new Error('reset failed');
      toast.success(dict.auth.passwordResetSent);
      setResetOpen(false);
    } catch {
      toast.error(dict.auth.passwordResetFailed);
    } finally {
      setResetLoading(false);
    }
  }

  function getPasswordStrengthScore(value: string) {
    const lengthOk = value.length >= 8;
    const hasUpper = /[A-Z]/.test(value);
    const hasNumber = /[0-9]/.test(value);
    const hasSymbol = /[^A-Za-z0-9]/.test(value);
    return [lengthOk, hasUpper, hasNumber, hasSymbol].filter(Boolean).length;
  }

  function getPasswordStrengthLabel(value: string) {
    if (!value.trim()) {
      return { label: dict.auth.passwordStrengthEmpty, color: 'text-muted-foreground' };
    }
    const score = getPasswordStrengthScore(value);
    if (score >= 4) return { label: dict.auth.passwordStrengthStrong, color: 'text-success' };
    if (score >= 2) return { label: dict.auth.passwordStrengthMedium, color: 'text-warning' };
    return { label: dict.auth.passwordStrengthWeak, color: 'text-danger' };
  }

  return (
    <div className="auth-page">
      <div className="auth-tools">
        <div className="auth-tool">
          <span className="auth-tool-label">{dict.settings.language}</span>
          <LanguageSwitcher currentLocale={locale} />
        </div>
        <div className="auth-tool">
          <span className="auth-tool-label">{dict.settings.theme}</span>
          <ThemeToggle />
        </div>
      </div>
      <div className="auth-main">
        <div className="auth-stack">
          <Card className="auth-card">
            <div className="px-8 pt-8 pb-8 space-y-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-transparent">
                    <NexalyMark className="h-9 w-9" />
                  </div>
                  <div className="text-heading-20">Nexaly</div>
                </div>
                <div className="text-copy-14">
                  {mode === 'login' ? dict.auth.login : dict.auth.signUpTitle}
                </div>
              </div>

              <div className="flex w-full max-w-[320px] mx-auto items-center gap-3 text-label-11 uppercase tracking-wide text-muted-foreground">
                <span className="auth-divider auth-divider--left" aria-hidden="true" />
                <span>{dict.auth.orContinueWithEmail}</span>
                <span className="auth-divider auth-divider--right" aria-hidden="true" />
              </div>

              {mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-4 max-w-[320px] w-full mx-auto text-left">
                  <div className="space-y-2">
                    <label className="text-label-14">
                      {dict.auth.email}
                    </label>
                    <Input
                      ref={emailRef}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={dict.auth.emailPlaceholder}
                      required
                      disabled={loading}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-label-14">
                      {dict.auth.password}
                    </label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={dict.auth.passwordPlaceholder}
                      required
                      disabled={loading}
                      className="h-10"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setResetEmail(email);
                        setResetOpen(true);
                      }}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      {dict.auth.passwordReset}
                    </button>
                  </div>

                  <Button
                    type="submit"
                    variant="default"
                    className="h-11 w-full shadow-sm border border-border"
                    disabled={loading}
                  >
                    {loading ? dict.common.loading : dict.auth.signIn}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleSignUp} className="space-y-4 max-w-[320px] w-full mx-auto text-left">
                  <div className="space-y-2">
                    <label className="text-label-14">
                      {dict.auth.email}
                    </label>
                    <Input
                      ref={emailRef}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={dict.auth.emailPlaceholder}
                      required
                      disabled={signingUp}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-label-14">
                      {dict.auth.password}
                    </label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={dict.auth.passwordPlaceholder}
                      required
                      disabled={signingUp}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-copy-12">
                      <span>{dict.auth.passwordStrength}</span>
                      <span className={cn('font-medium', getPasswordStrengthLabel(password).color)}>
                        {getPasswordStrengthLabel(password).label}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <span
                          key={index}
                          className={cn(
                            'h-1 rounded-full bg-muted',
                            password.trim() && index < getPasswordStrengthScore(password) && 'bg-accent',
                          )}
                        />
                      ))}
                    </div>
                  </div>

                  <Button
                    type="submit"
                    variant="default"
                    className="h-11 w-full shadow-sm border border-border"
                    disabled={signingUp || getPasswordStrengthScore(password) < 3}
                  >
                    {signingUp ? dict.common.loading : dict.auth.signUpAction}
                  </Button>
                </form>
              )}

              <div className="text-center text-copy-12">
                {mode === 'login' ? dict.auth.signUpPrompt : dict.auth.signInPrompt}{' '}
                <button
                  type="button"
                  onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                  className="text-foreground hover:underline"
                >
                  {mode === 'login' ? dict.auth.signUpAction : dict.auth.signInAction}
                </button>
              </div>

              <div className="text-center text-copy-12 leading-relaxed text-muted-foreground">
                {dict.auth.termsNotice.split(/(\{terms\}|\{privacy\})/g).map((segment, index) => {
                  if (segment === '{terms}') {
                    return (
                      <Link key={`terms-${index}`} href={legalLinks.terms} className="text-foreground hover:underline">
                        {dict.auth.termsOfService}
                      </Link>
                    );
                  }
                  if (segment === '{privacy}') {
                    return (
                      <Link key={`privacy-${index}`} href={legalLinks.privacy} className="text-foreground hover:underline">
                        {dict.auth.privacyPolicy}
                      </Link>
                    );
                  }
                  return <span key={`text-${index}`}>{segment}</span>;
                })}
              </div>
            </div>
          </Card>
        </div>
      </div>
      <div className="auth-footer">
        © {currentYear} Nexaly. All rights reserved.
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dict.auth.passwordReset}</DialogTitle>
            <DialogDescription>{dict.auth.passwordResetPrompt}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleResetPassword} className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className="text-label-14">{dict.auth.email}</label>
              <Input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder={dict.auth.emailPlaceholder}
                required
                disabled={resetLoading}
                className="h-10"
              />
            </div>
            <Button type="submit" className="w-full" disabled={resetLoading}>
              {resetLoading ? dict.common.loading : dict.auth.passwordResetSend}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
