'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDashboardShell } from '@/components/layout/DashboardShellContext';
import type { Dictionary } from '@/i18n';
import type { Locale } from '@/i18n/config';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { stripOrgPrefix, withOrgPrefix } from '@/lib/orgPath';
import { cn } from '@/lib/utils';

export default function Topbar({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const pathname = usePathname();
  const basePath = stripOrgPrefix(pathname);
  const { projects, currentProject, currentProjectId, inProjectScope, projectSection } = useDashboardShell();
  const inProjectDomain = inProjectScope || basePath.startsWith('/projects');
  const shortcutLabel = 'Ctrl/⌘ K';
  const scopeLabel = currentProject?.name ?? dict.nav.scopeTeam;

  const teamScopeHref = withOrgPrefix(pathname, '/projects');
  const projectScopeHref = (projectId: string) => withOrgPrefix(pathname, `/projects/${projectId}/${projectSection}`);

  let primaryLabel = dict.nav.home;
  if (basePath.startsWith('/projects')) primaryLabel = dict.nav.projects;
  else if (basePath.startsWith('/analytics')) primaryLabel = dict.nav.analytics;
  else if (basePath.startsWith('/rules')) primaryLabel = dict.nav.rules;
  else if (basePath.startsWith('/account')) primaryLabel = dict.nav.account;
  else if (basePath.startsWith('/settings')) primaryLabel = dict.nav.settings;

  let secondaryLabel: string | null = null;
  if (currentProjectId) {
    if (basePath.includes('/commits')) secondaryLabel = dict.nav.project.commits;
    else if (basePath.includes('/reports')) secondaryLabel = dict.nav.project.reports;
    else if (basePath.includes('/pipelines')) secondaryLabel = dict.nav.project.pipelines;
    else if (basePath.includes('/artifacts')) secondaryLabel = dict.nav.project.artifacts;
    else if (basePath.includes('/codebase')) secondaryLabel = dict.nav.project.codebase;
    else if (basePath.includes('/settings')) secondaryLabel = dict.nav.project.settings;
  }

  return (
    <header className="h-12 flex items-center px-4 border-b border-border bg-[hsl(var(--ds-background-2))] shrink-0 gap-3">
      <div className="flex min-w-0 items-center gap-1.5">
        {basePath.startsWith('/projects') ? (
          <Link
            href={withOrgPrefix(pathname, '/projects')}
            className="text-[14px] text-[hsl(var(--ds-text-2))] hover:text-foreground transition-colors duration-150"
          >
            {dict.nav.projects}
          </Link>
        ) : (
          <span className={cn(
            'text-[14px]',
            currentProjectId ? 'text-[hsl(var(--ds-text-2))]' : 'text-foreground font-medium',
          )}>
            {primaryLabel}
          </span>
        )}

        {secondaryLabel && (
          <>
            <span className="text-[hsl(var(--ds-border-3))] text-[13px] select-none">/</span>
            <span className="text-[14px] font-medium text-foreground">{secondaryLabel}</span>
          </>
        )}

        {inProjectDomain && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-2 inline-flex h-9 items-center gap-1 rounded-[7px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))] px-2.5 text-[14px] text-foreground transition-colors duration-150 hover:bg-[hsl(var(--ds-surface-1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-accent-7)/0.2)]"
              >
                <span className="max-w-[140px] truncate sm:max-w-[220px]">{scopeLabel}</span>
                <ChevronDown className="size-3.5 text-[hsl(var(--ds-text-2))]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px]">
              <DropdownMenuLabel>{dict.nav.scopePickProject}</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href={teamScopeHref} className="flex w-full items-center gap-2">
                  <span className="flex-1">{dict.nav.scopeTeam}</span>
                  {!currentProjectId && <Check className="size-3.5 text-[hsl(var(--ds-text-2))]" />}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {projects.length === 0 ? (
                <DropdownMenuItem disabled>{dict.nav.project.noProjects}</DropdownMenuItem>
              ) : (
                projects.map((project) => (
                  <DropdownMenuItem key={project.id} asChild>
                    <Link href={projectScopeHref(project.id)} className="flex w-full items-center gap-2">
                      <span className="flex-1 truncate">{project.name}</span>
                      {project.id === currentProjectId && <Check className="size-3.5 text-[hsl(var(--ds-text-2))]" />}
                    </Link>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 sm:hidden"
          onClick={() => window.dispatchEvent(new Event('command-palette:open'))}
          title={dict.nav.quickJump}
        >
          <Search className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="hidden h-9 gap-1.5 px-2.5 text-[13px] text-[hsl(var(--ds-text-2))] sm:inline-flex"
          onClick={() => window.dispatchEvent(new Event('command-palette:open'))}
          title={dict.nav.quickJump}
        >
          <Search className="size-3.5" />
          <span>{dict.nav.quickJump}</span>
          <span className="keycap">{shortcutLabel}</span>
        </Button>
        <LanguageSwitcher
          currentLocale={locale}
          compact
          className="h-9 border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))] text-foreground hover:bg-[hsl(var(--ds-surface-1))]"
        />
        <ThemeToggle className="h-9 w-9 border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))] text-foreground hover:bg-[hsl(var(--ds-surface-1))]" />
      </div>
    </header>
  );
}
