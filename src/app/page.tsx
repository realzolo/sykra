import Link from 'next/link';
import { Sparkles, Sliders, Radar, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import NexalyMark from '@/components/common/NexalyMark';
import { getLocale } from '@/lib/locale';
import { getDictionary } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const year = new Date().getFullYear();

  const features = [
    { icon: Sparkles, title: dict.home.feature1Title, description: dict.home.feature1Desc },
    { icon: Sliders, title: dict.home.feature2Title, description: dict.home.feature2Desc },
    { icon: Radar, title: dict.home.feature3Title, description: dict.home.feature3Desc },
  ];

  return (
    <div className="marketing-shell">
      <div className="marketing-bg" aria-hidden="true" />
      <div className="marketing-grid" aria-hidden="true" />
      <div className="marketing-content">
        <header className="mx-auto w-full max-w-6xl px-6 pt-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-2)] bg-muted">
                <NexalyMark className="h-6 w-6" />
              </div>
              <div className="flex flex-col">
                <span className="text-label-14">Axon</span>
              </div>
            </Link>

            <div className="flex items-center gap-3">
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">{dict.auth.signIn}</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/login">{dict.home.primaryCta}</Link>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-6 pb-24 pt-20">
          <section className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 items-center">
            <div className="space-y-8 max-w-xl">
              <h1 className="text-heading-48">{dict.home.title}</h1>
              <p className="text-copy-18">{dict.home.subtitle}</p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/login">
                    {dict.home.primaryCta}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="#features">{dict.home.secondaryCta}</Link>
                </Button>
              </div>
            </div>

            <div className="rounded-[var(--radius-3)] border border-border bg-card p-7 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-danger opacity-80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning opacity-80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success opacity-80" />
                </div>
                <Badge variant="success" size="sm">92</Badge>
              </div>

              <div className="mt-7 rounded-[var(--radius-2)] border border-border bg-muted p-5">
                <div className="flex items-center justify-between text-copy-12">
                  <span>{dict.home.previewQuality}</span>
                  <span>92</span>
                </div>
                <div className="mt-3 h-2 w-full rounded-full bg-border">
                  <div className="h-2 w-[82%] rounded-full bg-accent" />
                </div>
                <div className="mt-5 text-copy-12">{dict.home.previewFindings}</div>
                <div className="mt-3 space-y-3 text-copy-14">
                  <div className="flex items-center justify-between">
                    <span>{dict.home.previewFinding1}</span>
                    <Badge variant="danger" size="sm">{dict.reportDetail.severity.high}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{dict.home.previewFinding2}</span>
                    <Badge variant="warning" size="sm">{dict.reportDetail.severity.medium}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{dict.home.previewFinding3}</span>
                    <Badge variant="muted" size="sm">{dict.reportDetail.severity.low}</Badge>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="features" className="mt-24">
            <div className="max-w-2xl space-y-3">
              <h2 className="text-heading-24">{dict.home.featuresTitle}</h2>
              <p className="text-copy-16">{dict.home.featuresSubtitle}</p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title} className="rounded-[var(--radius-2)] border border-border bg-card p-6 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-1)] bg-muted">
                        <Icon className="size-5 text-foreground" />
                      </div>
                      <div>
                        <div className="text-label-16">{feature.title}</div>
                        <div className="text-copy-14 mt-1">{feature.description}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-24">
            <div className="rounded-[var(--radius-3)] border border-border bg-card p-10 shadow-[0_16px_40px_rgba(0,0,0,0.16)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <h2 className="text-heading-24">{dict.home.ctaTitle}</h2>
                  <p className="text-copy-16">{dict.home.ctaSubtitle}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild size="lg">
                    <Link href="/login">{dict.home.ctaPrimary}</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="#features">{dict.home.ctaSecondary}</Link>
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </main>

        <footer className="mx-auto w-full max-w-6xl px-6 pb-12 text-copy-12">
          © {year} Axon. All rights reserved.
        </footer>
      </div>
    </div>
  );
}
