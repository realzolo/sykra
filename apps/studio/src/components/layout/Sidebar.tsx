'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Code2,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommit,
  Home,
  LogOut,
  Settings,
  Shield,
  Sliders,
  Package,
  User,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useDashboardShell } from '@/components/layout/DashboardShellContext';
import type { Dictionary } from '@/i18n';
import { recordRecentNavigation } from '@/lib/recentNavigation';
import { extractOrgFromPath, replaceOrgInPath, stripOrgPrefix, withOrgPrefix } from '@/lib/orgPath';
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

const SIDEBAR_COLLAPSED_KEY = 'studio.sidebar-collapsed.v1';

function readCollapsedState() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function NavItem({
  href,
  active,
  icon: Icon,
  label,
  collapsed,
}: {
  href: string;
  active: boolean;
  icon: React.ElementType;
  label: string;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={cn(
        'group flex h-9 w-full items-center rounded-[7px] text-[14px] transition-colors duration-150',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
        active
          ? 'bg-[hsl(var(--ds-surface-2))] text-foreground font-medium'
          : 'text-[hsl(var(--ds-text-2))] hover:text-foreground hover:bg-[hsl(var(--ds-surface-1))]',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <Icon className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-[hsl(var(--ds-text-2))')} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

export default function Sidebar({ dict }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const orgMenuTriggerId = useId();
  const userMenuTriggerId = useId();
  const projectMenuTriggerId = useId();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsedState);
  const { projects, currentProject, currentProjectId, inProjectScope } = useDashboardShell();

  const { orgId: pathOrgId } = extractOrgFromPath(pathname);
  const basePath = stripOrgPrefix(pathname);

  useEffect(() => {
    recordRecentNavigation(pathname);
  }, [pathname]);

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
      .catch(() => {
        if (!alive) return;
        setOrgs([]);
        setActiveOrgId(null);
        setUserEmail(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!activeOrgId || !pathOrgId || pathOrgId === activeOrgId) return;
    router.replace(replaceOrgInPath(pathname, activeOrgId));
  }, [activeOrgId, pathOrgId, pathname, router]);

  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgLabel = activeOrg?.name ?? dict.nav.workspaceDefault;
  const orgInitial = orgLabel.slice(0, 2).toUpperCase();

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }

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
    } catch {
      // keep current org on request failure
    }
  }

  function switchProject(projectId: string) {
    if (!projectId) return;
    router.push(withOrgPrefix(pathname, `/projects/${projectId}/commits`));
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
    if (base === '/projects' && inProjectScope) return false;
    return basePath === base || basePath.startsWith(`${base}/`);
  };

  const orgNav = [
    { base: '/', label: dict.nav.home, icon: Home },
    { base: '/projects', label: dict.nav.projects, icon: FolderOpen },
    { base: '/analytics', label: dict.nav.analytics, icon: BarChart3 },
    { base: '/rules', label: dict.nav.rules, icon: Shield },
    { base: '/settings', label: dict.nav.settings, icon: Settings },
  ];

  const projectNav = currentProjectId ? [
    { base: `/projects/${currentProjectId}/commits`, label: dict.nav.project.commits, icon: GitCommit },
    { base: `/projects/${currentProjectId}/reports`, label: dict.nav.project.reports, icon: FileText },
    { base: `/projects/${currentProjectId}/pipelines`, label: dict.nav.project.pipelines, icon: GitBranch },
    { base: `/projects/${currentProjectId}/artifacts`, label: dict.nav.project.artifacts, icon: Package },
    { base: `/projects/${currentProjectId}/codebase`, label: dict.nav.project.codebase, icon: Code2 },
    { base: `/projects/${currentProjectId}/settings`, label: dict.nav.project.settings, icon: Sliders },
  ] : [];

  const isProjectNavActive = (base: string) => basePath === base || basePath.startsWith(`${base}/`);

  return (
    <div className={cn(
      'relative hidden h-full shrink-0 flex-col overflow-hidden border-r border-border bg-[hsl(var(--ds-background-2))] transition-[width] duration-200 lg:flex',
      collapsed ? 'w-16' : 'w-64',
    )}>
      <div className={cn('flex shrink-0 items-center border-b border-border py-3', collapsed ? 'justify-center px-2' : 'gap-2 px-3')}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              id={orgMenuTriggerId}
              type="button"
              className={cn(
                'rounded-[7px] transition-colors duration-150 hover:bg-[hsl(var(--ds-surface-1))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-accent-7)/0.25)]',
                collapsed ? 'flex h-10 w-10 items-center justify-center' : 'flex h-10 flex-1 items-center gap-2 px-2.5',
              )}
              title={orgLabel}
            >
              <span className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] bg-[hsl(var(--ds-surface-3))] text-[10px] font-bold text-foreground shrink-0">
                {orgInitial}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[14px] font-medium leading-none text-foreground">{orgLabel}</span>
                  </span>
                  <ChevronsUpDown className="size-4 shrink-0 text-[hsl(var(--ds-text-2))]" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[220px]">
            <DropdownMenuLabel className="font-normal">
              {dict.nav.organizations}
            </DropdownMenuLabel>
            {orgs.map((org) => (
              <DropdownMenuItem key={org.id} onClick={() => switchOrg(org.id)} className="gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-[3px] bg-[hsl(var(--ds-surface-3))] text-[10px] font-bold shrink-0">
                  {org.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 truncate">{org.name}</span>
                {org.id === activeOrg?.id && <Check className="size-3.5 text-[hsl(var(--ds-text-2))]" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push(orgHref('/settings/organizations'))}>
              {dict.nav.manageOrganizations}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn('h-9 w-9 shrink-0', collapsed ? 'hidden' : '')}
          onClick={toggleCollapsed}
          title={collapsed ? dict.nav.expandSidebar : dict.nav.collapseSidebar}
        >
          <ChevronsLeft className="size-4" />
        </Button>
        {collapsed && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute -right-3 top-3 z-10 h-6 w-6 rounded-full border border-[hsl(var(--ds-border-2))] bg-[hsl(var(--ds-background-2))]"
            onClick={toggleCollapsed}
            title={dict.nav.expandSidebar}
          >
            <ChevronsRight className="size-3.5" />
          </Button>
        )}
      </div>

      {inProjectScope ? (
        <>
          <div className={cn('shrink-0 border-b border-border py-3', collapsed ? 'px-2' : 'px-3')}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  id={projectMenuTriggerId}
                  type="button"
                  className={cn(
                    'w-full rounded-[7px] text-left transition-colors duration-150 hover:bg-[hsl(var(--ds-surface-1))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-accent-7)/0.25)]',
                    collapsed ? 'flex h-10 items-center justify-center' : 'flex items-center gap-2 px-2.5 py-2',
                  )}
                  title={currentProject?.name ?? dict.nav.project.switchProject}
                >
                  {collapsed ? (
                    <FolderOpen className="size-4 text-[hsl(var(--ds-text-2))]" />
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-foreground">
                          {currentProject?.name ?? dict.nav.project.switchProject}
                        </span>
                        {currentProject?.repo && (
                          <span className="block truncate text-[12px] text-[hsl(var(--ds-text-2))]">{currentProject.repo}</span>
                        )}
                      </span>
                      <ChevronDown className="size-4 shrink-0 text-[hsl(var(--ds-text-2))]" />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[250px]">
                <DropdownMenuLabel className="font-normal">
                  {dict.nav.project.switchProject}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {projects.length === 0 ? (
                  <DropdownMenuItem disabled>{dict.nav.project.noProjects}</DropdownMenuItem>
                ) : (
                  projects.map((project) => (
                    <DropdownMenuItem key={project.id} onClick={() => switchProject(project.id)} className="gap-2">
                      <span className="flex-1 truncate">{project.name}</span>
                      {project.id === currentProjectId && <Check className="size-3.5 text-[hsl(var(--ds-text-2))]" />}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className={cn('mt-2')}>
              <NavItem href={orgHref('/projects')} active={basePath === '/projects'} icon={ArrowLeft} label={dict.nav.projects} collapsed={collapsed} />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <nav className={cn('flex-1 overflow-y-auto py-2', collapsed ? 'px-2' : 'px-3')}>
              <div className="space-y-0.5">
                {projectNav.map((item) => (
                  <NavItem
                    key={item.base}
                    href={orgHref(item.base)}
                    active={isProjectNavActive(item.base)}
                    icon={item.icon}
                    label={item.label}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            </nav>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <nav className={cn('flex-1 overflow-y-auto py-2', collapsed ? 'px-2' : 'px-3')}>
            <div className="space-y-0.5">
              {orgNav.map((item) => (
                <NavItem
                  key={item.base}
                  href={orgHref(item.base)}
                  active={isActive(item.base)}
                  icon={item.icon}
                  label={item.label}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </nav>
        </div>
      )}

      <div className={cn('shrink-0 border-t border-border py-3', collapsed ? 'px-2' : 'px-3')}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              id={userMenuTriggerId}
              type="button"
              className={cn(
                'w-full rounded-[7px] transition-colors duration-150 hover:bg-[hsl(var(--ds-surface-1))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-accent-7)/0.25)]',
                collapsed ? 'flex h-10 items-center justify-center' : 'flex h-10 items-center gap-2.5 px-2.5',
              )}
              title={userEmail ?? dict.nav.account}
            >
              <span className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[hsl(var(--ds-surface-3))] shrink-0">
                <User className="size-3 text-[hsl(var(--ds-text-2))]" />
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-left text-[14px] text-foreground">{userEmail ?? dict.nav.account}</span>
                  <ChevronDown className="size-4 shrink-0 text-[hsl(var(--ds-text-2))]" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[200px]">
            <DropdownMenuItem onClick={() => router.push(orgHref('/settings'))}>
              {dict.nav.settings}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="gap-2 text-danger focus:text-danger">
              <LogOut className="size-3.5" />
              {dict.nav.logout}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
