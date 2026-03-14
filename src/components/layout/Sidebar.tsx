'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Code2, FolderOpen, FileText, Shield, Settings, LogOut, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n';

interface SidebarProps {
  locale: Locale;
  dict: Dictionary;
}

export default function Sidebar({ locale, dict }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>({});

  const navItems = [
    { href: '/projects', label: dict.nav.projects, icon: FolderOpen, countKey: 'projects' as const },
    { href: '/reports',  label: dict.nav.reports,  icon: FileText,   countKey: 'reports' as const },
    { href: '/rules',    label: dict.nav.rules,    icon: Shield,     countKey: null },
    { href: '/settings', label: dict.nav.settings,  icon: Settings,   countKey: null },
  ];

  const activeHref = navItems.find(item => pathname.startsWith(item.href))?.href ?? '/projects';

  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then(r => r.json()).then((d: unknown[]) => ({ projects: Array.isArray(d) ? d.length : 0 })).catch(() => ({ projects: 0 })),
      fetch('/api/reports').then(r => r.json()).then((d: unknown[]) => ({ reports: Array.isArray(d) ? d.length : 0 })).catch(() => ({ reports: 0 })),
    ]).then(([p, r]) => setCounts({ ...p, ...r }));
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="w-[240px] h-screen flex flex-col shrink-0 border-r border-sidebar bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-4 h-14 border-b border-sidebar shrink-0">
        <div className="w-8 h-8 rounded-md bg-foreground/10 flex items-center justify-center shrink-0">
          <Code2 className="text-foreground size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-none">AIDOL_Test</div>
          <div className="text-[11px] text-muted-foreground mt-1">Pro</div>
        </div>
      </div>

      <div className="px-3 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Find…"
            className="h-8 pl-8 bg-muted/40 border-border text-xs"
          />
        </div>
      </div>

      <nav className="flex-1 px-2 pb-3 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const active = activeHref === item.href;
          const count = item.countKey ? counts[item.countKey] : null;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'flex items-center gap-2.5 h-8 px-3 rounded-md text-[13px] w-full transition-colors',
                active
                  ? 'bg-secondary/70 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
              ].join(' ')}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {count != null && count > 0 && (
                <Badge variant={active ? 'secondary' : 'muted'} size="sm">{count}</Badge>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar shrink-0 space-y-2">
        <div className="flex items-center justify-between px-2">
          <span className="text-xs text-muted-foreground">{dict.settings.language}</span>
          <LanguageSwitcher currentLocale={locale} />
        </div>
        <div className="flex items-center justify-between px-2">
          <span className="text-xs text-muted-foreground">{dict.settings.theme}</span>
          <ThemeToggle />
        </div>
        <Button variant="ghost" onClick={handleSignOut} className="w-full justify-start gap-2 h-9 text-sm">
          <LogOut className="size-4" />
          {dict.nav.logout}
        </Button>
      </div>
    </div>
  );
}
