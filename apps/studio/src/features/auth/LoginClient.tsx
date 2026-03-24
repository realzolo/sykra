'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import SykraMark from '@/components/common/SykraMark';
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

type LoginErrorResponse = {
  code?: string;
};

export default function LoginClient({ dict, locale, legalLinks }: LoginClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const currentYear = new Date().getFullYear();
  const oauthError = searchParams.get('error');

  useEffect(() => {
    if (!oauthError) return;

    toast.error(dict.auth.oauthFailed);
    router.replace('/login');
  }, [dict.auth.oauthFailed, oauthError, router]);

  async function resolveOrgRedirect(): Promise<string> {
    try {
      const res = await fetch('/api/orgs/active');
      if (!res.ok) return '/projects';
      const data = await res.json();
      if (data?.orgId) return `/o/${data.orgId}`;
    } catch {}
    return '/projects';
  }

  function mapLoginErrorMessage(code: string | undefined, status: number) {
    if (code === 'INVALID_CREDENTIALS') return dict.auth.invalidCredentials;
    if (code === 'ACCOUNT_DISABLED') return dict.auth.accountDisabled;
    if (code === 'ACCOUNT_LOCKED') return dict.auth.accountLocked;
    if (code === 'RATE_LIMITED') return dict.auth.tooManyAttempts;
    if (code === 'EMAIL_NOT_VERIFIED') return dict.auth.verifyEmailRequired;
    if (status === 401) return dict.auth.invalidCredentials;
    return dict.auth.loginFailed;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setLoginError(dict.auth.emailRequired);
      emailRef.current?.focus();
      return;
    }

    if (!password) {
      setLoginError(dict.auth.passwordRequired);
      return;
    }

    setLoginError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as LoginErrorResponse));
        if (data?.code === 'EMAIL_NOT_VERIFIED') {
          await fetch('/api/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: normalizedEmail }),
          }).catch(() => {});
          setLoginError(dict.auth.verifyEmailRequired);
          toast.success(dict.auth.verifyEmailSent);
          return;
        }
        setLoginError(mapLoginErrorMessage(data?.code, res.status));
        return;
      }

      setLoginError(null);
      const nextPath = await resolveOrgRedirect();
      router.push(nextPath);
      router.refresh();
    } catch {
      setLoginError(dict.auth.loginFailed);
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as LoginErrorResponse));
        if (data?.code === 'EMAIL_DELIVERY_UNAVAILABLE' || res.status === 503) {
          toast.error(dict.auth.emailDeliveryUnavailable);
          return;
        }
        throw new Error('signup failed');
      }

      toast.success(dict.auth.verifyEmailSent);
      setMode('login');
      setLoginError(null);
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
                <div className="flex items-center gap-0.5">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-transparent">
                    <SykraMark className="h-9 w-9" />
                  </div>
                  <div className="text-heading-20">Sykra</div>
                </div>
                <div className="text-copy-14">
                  {mode === 'login' ? dict.auth.login : dict.auth.signUpTitle}
                </div>
              </div>

              <Button asChild variant="outline" className="h-11 w-full max-w-[320px] mx-auto shadow-sm border border-border">
                <Link href="/auth/github" className="flex items-center justify-center gap-2">
                  <Github className="size-4" />
                  {dict.auth.continueWithGithub}
                </Link>
              </Button>

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
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setLoginError(null);
                      }}
                      placeholder={dict.auth.emailPlaceholder}
                      autoComplete="email"
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
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setLoginError(null);
                      }}
                      placeholder={dict.auth.passwordPlaceholder}
                      autoComplete="current-password"
                      required
                      disabled={loading}
                      className="h-10"
                    />
                  </div>
                  {loginError ? (
                    <div role="alert" className="rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-copy-12 text-danger">
                      {loginError}
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setResetEmail(email.trim());
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
                    disabled={loading || !email.trim() || !password}
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
                      autoComplete="email"
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
                      autoComplete="new-password"
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
                  onClick={() => {
                    setMode(mode === 'login' ? 'signup' : 'login');
                    setLoginError(null);
                  }}
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
        © {currentYear} Sykra. All rights reserved.
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dict.auth.passwordReset}</DialogTitle>
            <DialogDescription>{dict.auth.passwordResetPrompt}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form onSubmit={handleResetPassword} className="space-y-4">
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
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
