'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
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
}

export default function LoginClient({ dict, locale }: LoginClientProps) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const currentYear = new Date().getFullYear();

  const GoogleMark = (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <path fill="#EA4335" d="M24 9.5c3.2 0 6.1 1.1 8.4 3.2l6.1-6.1C34.6 2.5 29.6 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.1 5.5C11.5 13.1 17.2 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-2.8-.4-4.2H24v8h12.6c-.5 3.1-2.4 5.8-5.2 7.5l6.3 4.9c3.7-3.4 5.9-8.4 5.9-14.2z" />
      <path fill="#FBBC05" d="M9.6 28.7c-.6-1.7-.9-3.5-.9-5.4 0-1.9.3-3.7.9-5.4l-7.1-5.5C.9 15.2 0 19.5 0 23.3c0 3.8.9 8.1 2.5 11.4l7.1-6z" />
      <path fill="#34A853" d="M24 46.5c5.6 0 10.3-1.8 13.8-4.8l-6.3-4.9c-1.7 1.2-4.1 2.1-7.5 2.1-6.8 0-12.5-3.6-15.1-9.2l-7.1 5.5C6.5 42.6 14.6 46.5 24 46.5z" />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );

  const GithubMark = (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M12 0.5a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.02c-3.23.7-3.91-1.55-3.91-1.55-.53-1.33-1.3-1.68-1.3-1.68-1.06-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.41-1.27.75-1.56-2.58-.3-5.3-1.29-5.3-5.74 0-1.27.46-2.3 1.2-3.12-.12-.3-.52-1.52.11-3.16 0 0 .98-.31 3.2 1.2a11 11 0 0 1 5.82 0c2.22-1.51 3.2-1.2 3.2-1.2.63 1.64.23 2.86.12 3.16.75.82 1.2 1.85 1.2 3.12 0 4.46-2.72 5.44-5.3 5.73.42.36.8 1.08.8 2.18v3.22c0 .31.2.67.8.56A11.5 11.5 0 0 0 12 0.5z"
      />
    </svg>
  );

  async function handleOAuth(provider: 'google' | 'github') {
    setOauthLoading(provider);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;
    } catch {
      toast.error(dict.auth.oauthFailed);
      setOauthLoading(null);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      router.push('/projects');
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
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) throw error;

      router.push('/projects');
      router.refresh();
    } catch {
      toast.error(dict.auth.signUpFailed);
    } finally {
      setSigningUp(false);
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
                  <div className="text-xl font-semibold">Nexaly</div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {mode === 'login' ? dict.auth.login : dict.auth.signUpTitle}
                </div>
              </div>

              <div className="grid gap-2 max-w-[320px] w-full mx-auto">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full justify-center gap-2 text-sm px-4"
                  disabled={oauthLoading !== null}
                  onClick={() => handleOAuth('github')}
                >
                  <GithubMark className="h-4 w-4 text-foreground" />
                  {dict.auth.continueWithGithub}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full justify-center gap-2 text-sm px-4"
                  disabled={oauthLoading !== null}
                  onClick={() => handleOAuth('google')}
                >
                  <GoogleMark className="h-4 w-4" />
                  {dict.auth.continueWithGoogle}
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{dict.auth.orContinueWithEmail}</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              {mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-4 max-w-[320px] w-full mx-auto text-left">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
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
                      className="h-10 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {dict.auth.password}
                    </label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={dict.auth.passwordPlaceholder}
                      required
                      disabled={loading}
                      className="h-10 text-sm"
                    />
                  </div>

                  <Button
                    type="submit"
                    variant="default"
                    className="h-11 w-full text-sm font-semibold shadow-sm border border-border"
                    disabled={loading}
                  >
                    {loading ? dict.common.loading : dict.auth.signIn}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleSignUp} className="space-y-4 max-w-[320px] w-full mx-auto text-left">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
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
                      className="h-10 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {dict.auth.password}
                    </label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={dict.auth.passwordPlaceholder}
                      required
                      disabled={signingUp}
                      className="h-10 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
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
                    className="h-11 w-full text-sm font-semibold shadow-sm border border-border"
                    disabled={signingUp || getPasswordStrengthScore(password) < 3}
                  >
                    {signingUp ? dict.common.loading : dict.auth.signUpAction}
                  </Button>
                </form>
              )}

              <div className="text-center text-xs text-muted-foreground">
                {mode === 'login' ? dict.auth.signUpPrompt : dict.auth.signInPrompt}{' '}
                <button
                  type="button"
                  onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                  className="text-foreground hover:underline"
                >
                  {mode === 'login' ? dict.auth.signUpAction : dict.auth.signInAction}
                </button>
              </div>

              <div className="text-center text-[11px] leading-relaxed text-muted-foreground">
                {dict.auth.termsNotice}
              </div>
            </div>
          </Card>
        </div>
      </div>
      <div className="auth-footer">
        © {currentYear} Nexaly. All rights reserved.
      </div>
    </div>
  );
}
