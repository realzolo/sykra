'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  Code2,
  FolderOpen,
  FileText,
  Shield,
  Settings,
  LogOut,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createClient } from '@/lib/supabase/client';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n';

interface SidebarProps {
  locale: Locale;
  dict: Dictionary;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 320;
const COLLAPSED_WIDTH = 64;

export default function Sidebar({ locale, dict }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [dragging, setDragging] = useState(false);

  const navItems = [
    { href: '/projects', label: dict.nav.projects, icon: FolderOpen, countKey: 'projects' as const },
    { href: '/reports',  label: dict.nav.reports,  icon: FileText,   countKey: 'reports' as const },
    { href: '/rules',    label: dict.nav.rules,    icon: Shield,     countKey: null },
    { href: '/settings', label: dict.nav.settings,  icon: Settings,   countKey: null },
  ];

  const activeHref = navItems.find(item => pathname.startsWith(item.href))?.href ?? '/projects';

  useEffect(() => {
    let alive = true;

    async function loadOrgs() {
      try {
        const [orgRes, activeRes] = await Promise.all([
          fetch('/api/orgs'),
          fetch('/api/orgs/active'),
        ]);
        const orgData = orgRes.ok ? await orgRes.json() : [];
        const activeData = activeRes.ok ? await activeRes.json() : null;

        if (!alive) return;
        setOrgs(Array.isArray(orgData) ? orgData : []);
        setActiveOrgId(activeData?.orgId ?? orgData?.[0]?.id ?? null);
      } catch {}
    }

    loadOrgs();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!activeOrgId) return;
    Promise.all([
      fetch('/api/projects').then(r => r.json()).then((d: unknown[]) => ({ projects: Array.isArray(d) ? d.length : 0 })).catch(() => ({ projects: 0 })),
      fetch('/api/reports').then(r => r.json()).then((d: unknown[]) => ({ reports: Array.isArray(d) ? d.length : 0 })).catch(() => ({ reports: 0 })),
    ]).then(([p, r]) => setCounts({ ...p, ...r }));
  }, [activeOrgId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedWidth = Number(localStorage.getItem('sidebar-width'));
    const storedCollapsed = localStorage.getItem('sidebar-collapsed');
    if (!Number.isNaN(storedWidth) && storedWidth >= MIN_WIDTH && storedWidth <= MAX_WIDTH) {
      setSidebarWidth(storedWidth);
    }
    if (storedCollapsed != null) {
      setCollapsed(storedCollapsed === 'true');
    } else if (window.innerWidth < 1024) {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX));
      setSidebarWidth(next);
    };
    const onUp = () => setDragging(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgLabel = activeOrg?.name ?? dict.nav.workspaceDefault;
  const orgInitial = orgLabel.slice(0, 1).toUpperCase();
  const orgSubLabel = activeOrg?.is_personal ? dict.nav.workspaceDefault : (activeOrg?.slug ?? dict.nav.planDefault);

  async function setActiveOrg(orgId: string) {
    if (orgId === activeOrgId) return;
    try {
      const res = await fetch('/api/orgs/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) throw new Error('Failed to switch org');
      setActiveOrgId(orgId);
      router.refresh();
    } catch {}
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const width = collapsed ? COLLAPSED_WIDTH : sidebarWidth;
  const compact = collapsed;

  const orgMenu = (trigger: ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {orgs.length === 0 && (
          <DropdownMenuItem disabled>No organizations</DropdownMenuItem>
        )}
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => setActiveOrg(org.id)}
            className="gap-2"
          >
            <span className="flex-1 truncate">{org.name}</span>
            {org.id === activeOrg?.id && <Check className="size-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/settings/organizations')}>
          Manage organizations
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div
      className="relative h-screen flex flex-col shrink-0 border-r border-sidebar bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out"
      style={{ width }}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="flex items-center gap-2 px-3 h-12 border-b border-sidebar shrink-0">
        {compact ? (
          orgMenu(
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[12px] font-semibold text-foreground">
                {orgInitial}
              </span>
            </Button>
          )
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-[12px] font-semibold select-none">
              {orgInitial}
            </div>
            {orgMenu(
              <button className="flex items-center gap-2 text-left w-full transition-soft hover:text-foreground outline-none select-none">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium leading-none truncate">
                      {orgLabel}
                    </div>
                    <Badge variant="muted" size="sm" className="text-[12px] px-1.5">
                      {dict.nav.planDefault}
                    </Badge>
                  </div>
                </div>
                <ChevronDown className="size-4 text-muted-foreground shrink-0" />
              </button>
            )}
          </div>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </div>

      <div className="px-3 py-3">
        {compact ? (
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={dict.nav.searchPlaceholder}>
            <Search className="size-4 text-muted-foreground" />
          </Button>
        ) : (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder={dict.nav.searchPlaceholder}
              className="h-8 pl-8 pr-12 bg-muted/40 border-border text-sm"
            />
            <span className="keycap absolute right-2 top-1/2 -translate-y-1/2">F</span>
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 pb-3 space-y-0.5 overflow-y-auto">
        {navItems.map(item => {
          const active = activeHref === item.href;
          const count = item.countKey ? counts[item.countKey] : null;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'group relative flex items-center gap-2.5 h-8 px-2.5 rounded-md text-sm w-full transition-soft',
                compact ? 'justify-center' : '',
                active
                  ? 'bg-sidebar-muted text-foreground shadow-elevation-1'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
              ].join(' ')}
              aria-current={active ? 'page' : undefined}
              title={compact ? item.label : undefined}
            >
              <span
                className={[
                  'absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full',
                  active ? 'bg-foreground/80' : 'bg-transparent',
                ].join(' ')}
              />
              <Icon className="size-3.5 shrink-0" />
              {!compact && <span className="flex-1 text-left truncate">{item.label}</span>}
              {!compact && count != null && count > 0 && (
                <Badge variant={active ? 'secondary' : 'muted'} size="sm">{count}</Badge>
              )}
              {compact && count != null && count > 0 && (
                <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground/70" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar shrink-0 space-y-2">
        <div className={['flex items-center', compact ? 'justify-center' : 'justify-between px-1'].join(' ')}>
          {!compact && <span className="text-[12px] text-muted-foreground">{dict.settings.language}</span>}
          <LanguageSwitcher currentLocale={locale} compact={compact} />
        </div>
        <div className={['flex items-center', compact ? 'justify-center' : 'justify-between px-1'].join(' ')}>
          {!compact && <span className="text-[12px] text-muted-foreground">{dict.settings.theme}</span>}
          <ThemeToggle />
        </div>
        <Button variant="ghost" onClick={handleSignOut} className={['w-full gap-2 h-8 text-sm', compact ? 'justify-center px-0' : 'justify-start'].join(' ')}>
          <LogOut className="size-3.5" />
          {!compact && dict.nav.logout}
        </Button>
      </div>

      {!collapsed && (
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-border/70 transition-soft"
          onMouseDown={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
        />
      )}
    </div>
  );
}
