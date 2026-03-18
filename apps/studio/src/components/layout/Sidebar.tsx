'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Home,
  FolderOpen,
  Shield,
  Settings,
  LogOut,
  User,
  ChevronsUpDown,
  BarChart3,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Dictionary } from '@/i18n';
import {
  extractOrgFromPath,
  replaceOrgInPath,
  stripOrgPrefix,
  withOrgPrefix,
} from '@/lib/orgPath';
import { cn } from '@/lib/utils';

interface SidebarProps {
  dict: Dictionary;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
}

function NavItem({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-2.5 h-8 px-2.5 rounded-[6px] text-[13px] w-full transition-colors duration-100',
        active
          ? 'bg-[hsl(var(--ds-surface-2))] text-foreground font-medium'
          : 'text-[hsl(var(--ds-text-2))] hover:text-foreground hover:bg-[hsl(var(--ds-surface-1))]',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <Icon className={cn('size-[15px] shrink-0', active ? 'text-foreground' : 'text-[hsl(var(--ds-text-2))]')} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export default function Sidebar({ dict }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const { orgId: pathOrgId } = extractOrgFromPath(pathname);
  const basePath = stripOrgPrefix(pathname);

  // Extract project id from /projects/:id/... paths
  const projectMatch = basePath.match(/^\/projects\/([^/]+)(\/|$)/);
  const currentProjectId = projectMatch?.[1] ?? null;

  useEffect(() => {
    let alive = true;
    Promise.all([fetch('/api/orgs'), fetch('/api/orgs/active'), fetch('/api/auth/me')])
      .then(([orgRes, activeRes, meRes]) =>
        Promise.all([
          orgRes.ok ? orgRes.json() : [],
          activeRes.ok ? activeRes.json() : null,
          meRes.ok ? meRes.json() : null,
        ]),
      )
      .then(([orgData, activeData, meData]) => {
        if (!alive) return;
        const list = Array.isArray(orgData) ? orgData : [];
        setOrgs(list);
        setActiveOrgId(activeData?.orgId ?? list[0]?.id ?? null);
        setUserEmail(meData?.user?.email ?? null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Sync org cookie when URL org changes
  useEffect(() => {
    if (!activeOrgId || !pathOrgId || pathOrgId === activeOrgId) return;
    router.replace(replaceOrgInPath(pathname, activeOrgId));
  }, [activeOrgId, pathOrgId, pathname, router]);

  const activeOrg = orgs.find(o => o.id === activeOrgId) ?? orgs[0];
  const orgLabel = activeOrg?.name ?? dict.nav.workspaceDefault;
  const orgInitial = orgLabel.slice(0, 2).toUpperCase();

  async function switchOrg(orgId: string) {
    if (orgId === activeOrgId) return;
    try {
      await fetch('/api/orgs/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      setActiveOrgId(orgId);
      router.push(replaceOrgInPath(pathname, orgId));
      router.refresh();
    } catch {}
  }

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  function orgHref(path: string) {
    return withOrgPrefix(pathname, path);
  }

  const isActive = (base: string) => {
    if (base === '/') return basePath === '/';
    if (base === '/projects' && currentProjectId) return false;
    return basePath === base || basePath.startsWith(`${base}/`);
  };

  const orgNav = [
    { base: '/', label: dict.nav.home, icon: Home },
    { base: '/projects', label: dict.nav.projects, icon: FolderOpen },
    { base: '/analytics', label: dict.nav.analytics, icon: BarChart3 },
    { base: '/rules', label: dict.nav.rules, icon: Shield },
    { base: '/settings', label: dict.nav.settings, icon: Settings },
  ];

  return (
    <div className="relative h-screen flex flex-col shrink-0 border-r border-border bg-[hsl(var(--ds-background-2))]" style={{ width: 240 }}>
      {/* Org switcher */}
      <div className="px-3 py-3 border-b border-border shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 w-full h-9 px-2 rounded-[6px] hover:bg-[hsl(var(--ds-surface-1))] transition-colors duration-100 outline-none group">
              {/* Org avatar */}
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] bg-[hsl(var(--ds-surface-3))] text-[10px] font-bold text-foreground shrink-0">
                {orgInitial}
              </span>
              <span className="flex-1 min-w-0 text-left">
                <span className="block text-[13px] font-medium leading-none truncate text-foreground">{orgLabel}</span>
              </span>
              <ChevronsUpDown className="size-3.5 text-[hsl(var(--ds-text-2))] shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[220px]">
            <DropdownMenuLabel className="text-[11px] text-[hsl(var(--ds-text-2))] font-normal uppercase tracking-wider px-2 py-1.5">
              Organizations
            </DropdownMenuLabel>
            {orgs.map(org => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => switchOrg(org.id)}
                className="gap-2 text-[13px]"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-[3px] bg-[hsl(var(--ds-surface-3))] text-[10px] font-bold shrink-0">
                  {org.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 truncate">{org.name}</span>
                {org.id === activeOrg?.id && <Check className="size-3.5 text-[hsl(var(--ds-text-2))]" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push(orgHref('/settings/organizations'))}
              className="text-[13px]"
            >
              Manage organizations
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {orgNav.map(item => (
          <NavItem
            key={item.base}
            href={orgHref(item.base)}
            active={isActive(item.base)}
            icon={item.icon}
            label={item.label}
          />
        ))}
      </nav>

      {/* Footer — user + sign out */}
      <div className="px-3 py-3 border-t border-border shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 w-full h-9 px-2 rounded-[6px] hover:bg-[hsl(var(--ds-surface-1))] transition-colors duration-100 outline-none">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[hsl(var(--ds-surface-3))] shrink-0">
                <User className="size-3 text-[hsl(var(--ds-text-2))]" />
              </span>
              <span className="flex-1 text-left text-[13px] text-foreground truncate">{userEmail ?? 'Account'}</span>
              <ChevronDown className="size-3.5 text-[hsl(var(--ds-text-2))] shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[200px]">
            <DropdownMenuItem
              onClick={() => router.push(orgHref('/settings'))}
              className="text-[13px]"
            >
              {dict.nav.settings}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-[13px] text-danger focus:text-danger gap-2"
            >
              <LogOut className="size-3.5" />
              {dict.nav.logout}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
