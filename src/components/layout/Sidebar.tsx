'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Code2, FolderOpen, FileText, Shield, Settings, LogOut } from 'lucide-react';
import { Button, Chip } from '@heroui/react';
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
    <div className="w-64 h-screen flex flex-col shrink-0 border-r border-sidebar bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-sidebar shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0 shadow-sm ring-1 ring-primary/20">
          <Code2 className="text-primary-foreground size-4" />
        </div>
        <span className="font-semibold text-base tracking-tight">spec-axis</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const active = activeHref === item.href;
          const count = item.countKey ? counts[item.countKey] : null;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'flex items-center gap-3 h-9 px-3 rounded-medium text-sm w-full transition-colors',
                active
                  ? 'bg-secondary text-secondary-foreground font-medium'
                  : 'text-foreground hover:bg-muted/60',
              ].join(' ')}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {count != null && count > 0 && (
                <Chip size="sm" variant={active ? 'primary' : 'secondary'}>{count}</Chip>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar shrink-0 space-y-2">
        <div className="flex items-center justify-between px-2">
          <span className="text-xs text-muted-foreground">{dict.settings.language}</span>
          <LanguageSwitcher currentLocale={locale} />
        </div>
        <div className="flex items-center justify-between px-2">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <Button variant="ghost" onPress={handleSignOut} className="w-full justify-start gap-3 h-10">
          <LogOut className="size-4" />
          {dict.nav.logout}
        </Button>
      </div>
    </div>
  );
}
