'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  ChevronRight,
  Code2,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommit,
  Home,
  Package,
  Search,
  Settings,
  Shield,
} from 'lucide-react';
import { useDashboardShell } from '@/components/layout/DashboardShellContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Dictionary } from '@/i18n';
import { readRecentNavigation } from '@/lib/recentNavigation';
import { stripOrgPrefix, withOrgPrefix } from '@/lib/orgPath';
import { cn } from '@/lib/utils';

type CommandItem = {
  id: string;
  group: 'recent' | 'project' | 'global' | 'projects';
  label: string;
  hint: string;
  href: string;
  searchText: string;
  icon: React.ElementType;
};

function resolveProjectScopeLabel(basePath: string, dict: Dictionary) {
  if (basePath.includes('/commits')) return dict.nav.project.commits;
  if (basePath.includes('/reports')) return dict.nav.project.reports;
  if (basePath.includes('/pipelines')) return dict.nav.project.pipelines;
  if (basePath.includes('/artifacts')) return dict.nav.project.artifacts;
  if (basePath.includes('/codebase')) return dict.nav.project.codebase;
  if (basePath.includes('/settings')) return dict.nav.project.settings;
  return dict.nav.projects;
}

function resolvePathIcon(basePath: string) {
  if (basePath.includes('/reports')) return FileText;
  if (basePath.includes('/pipelines')) return GitBranch;
  if (basePath.includes('/artifacts')) return Package;
  if (basePath.includes('/codebase')) return Code2;
  if (basePath.includes('/commits')) return GitCommit;
  if (basePath.startsWith('/projects')) return FolderOpen;
  if (basePath.startsWith('/analytics')) return BarChart3;
  if (basePath.startsWith('/rules')) return Shield;
  if (basePath.startsWith('/settings')) return Settings;
  return Home;
}

export default function CommandPalette({ dict }: { dict: Dictionary }) {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, currentProjectId, inProjectScope } = useDashboardShell();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shortcutLabel = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac') ? '⌘K' : 'Ctrl K';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const hasModifier = isMac ? event.metaKey : event.ctrlKey;
      if (!hasModifier || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setOpen((value) => {
        const next = !value;
        if (next) {
          setActiveIndex(0);
        }
        return next;
      });
    };
    const onOpenPalette = () => {
      setOpen(true);
      setActiveIndex(0);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('command-palette:open', onOpenPalette as EventListener);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('command-palette:open', onOpenPalette as EventListener);
    };
  }, []);

  const baseItems = useMemo<CommandItem[]>(() => {
    const globalItems: CommandItem[] = [
      { id: 'home', group: 'global', label: dict.nav.home, hint: dict.nav.quickJumpGlobal, href: withOrgPrefix(pathname, '/'), searchText: `${dict.nav.home} home`, icon: Home },
      { id: 'projects', group: 'global', label: dict.nav.projects, hint: dict.nav.quickJumpGlobal, href: withOrgPrefix(pathname, '/projects'), searchText: `${dict.nav.projects} projects`, icon: FolderOpen },
      { id: 'analytics', group: 'global', label: dict.nav.analytics, hint: dict.nav.quickJumpGlobal, href: withOrgPrefix(pathname, '/analytics'), searchText: `${dict.nav.analytics} analytics`, icon: BarChart3 },
      { id: 'rules', group: 'global', label: dict.nav.rules, hint: dict.nav.quickJumpGlobal, href: withOrgPrefix(pathname, '/rules'), searchText: `${dict.nav.rules} rules`, icon: Shield },
      { id: 'settings', group: 'global', label: dict.nav.settings, hint: dict.nav.quickJumpGlobal, href: withOrgPrefix(pathname, '/settings'), searchText: `${dict.nav.settings} settings`, icon: Settings },
    ];
    if (!inProjectScope || !currentProjectId) return globalItems;
    const projectItems: CommandItem[] = [
      { id: 'p-commits', group: 'project', label: dict.nav.project.commits, hint: dict.nav.quickJumpProject, href: withOrgPrefix(pathname, `/projects/${currentProjectId}/commits`), searchText: `${dict.nav.project.commits} commits`, icon: GitCommit },
      { id: 'p-reports', group: 'project', label: dict.nav.project.reports, hint: dict.nav.quickJumpProject, href: withOrgPrefix(pathname, `/projects/${currentProjectId}/reports`), searchText: `${dict.nav.project.reports} reports`, icon: FileText },
      { id: 'p-pipelines', group: 'project', label: dict.nav.project.pipelines, hint: dict.nav.quickJumpProject, href: withOrgPrefix(pathname, `/projects/${currentProjectId}/pipelines`), searchText: `${dict.nav.project.pipelines} pipelines`, icon: GitBranch },
      { id: 'p-artifacts', group: 'project', label: dict.nav.project.artifacts, hint: dict.nav.quickJumpProject, href: withOrgPrefix(pathname, `/projects/${currentProjectId}/artifacts`), searchText: `${dict.nav.project.artifacts} artifacts`, icon: Package },
      { id: 'p-codebase', group: 'project', label: dict.nav.project.codebase, hint: dict.nav.quickJumpProject, href: withOrgPrefix(pathname, `/projects/${currentProjectId}/codebase`), searchText: `${dict.nav.project.codebase} codebase`, icon: Code2 },
      { id: 'p-settings', group: 'project', label: dict.nav.project.settings, hint: dict.nav.quickJumpProject, href: withOrgPrefix(pathname, `/projects/${currentProjectId}/settings`), searchText: `${dict.nav.project.settings} settings`, icon: Settings },
    ];
    return [...projectItems, ...globalItems];
  }, [currentProjectId, dict, inProjectScope, pathname]);

  const projectItems = useMemo<CommandItem[]>(() => {
    return projects.slice(0, 20).map((project) => ({
      id: `project-${project.id}`,
      group: 'projects',
      label: project.name,
      hint: dict.nav.quickJumpProjectList,
      href: withOrgPrefix(pathname, `/projects/${project.id}/commits`),
      searchText: `${project.name} ${dict.nav.quickJumpProjectList}`,
      icon: FolderOpen,
    }));
  }, [dict.nav.quickJumpProjectList, pathname, projects]);

  const recentItems = useMemo<CommandItem[]>(() => {
    const recents = readRecentNavigation(8);
    return recents.map((item, index) => {
      const itemBasePath = stripOrgPrefix(item.path);
      const label = itemBasePath.startsWith('/projects/')
        ? resolveProjectScopeLabel(itemBasePath, dict)
        : (
          itemBasePath.startsWith('/analytics') ? dict.nav.analytics :
          itemBasePath.startsWith('/rules') ? dict.nav.rules :
          itemBasePath.startsWith('/settings') ? dict.nav.settings :
          itemBasePath.startsWith('/projects') ? dict.nav.projects :
          dict.nav.home
        );
      const icon = resolvePathIcon(itemBasePath);
      return {
        id: `recent-${index}-${item.path}`,
        group: 'recent',
        label,
        hint: dict.nav.recentNavigation,
        href: item.path,
        searchText: `${label} ${dict.nav.recentNavigation} ${item.path}`,
        icon,
      };
    });
  }, [dict]);

  const allItems = useMemo(() => {
    const byHref = new Map<string, CommandItem>();
    for (const item of [...recentItems, ...baseItems, ...projectItems]) {
      if (!byHref.has(item.href)) {
        byHref.set(item.href, item);
      }
    }
    return Array.from(byHref.values());
  }, [baseItems, projectItems, recentItems]);

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return allItems.slice(0, 16);
    return allItems
      .filter((item) => item.searchText.toLowerCase().includes(keyword))
      .slice(0, 16);
  }, [allItems, query]);

  const groupedItems = useMemo(() => {
    const groups = {
      recent: [] as CommandItem[],
      project: [] as CommandItem[],
      global: [] as CommandItem[],
      projects: [] as CommandItem[],
    };
    for (const item of filteredItems) {
      groups[item.group].push(item);
    }
    return groups;
  }, [filteredItems]);
  const currentActiveIndex = filteredItems.length === 0
    ? 0
    : Math.min(activeIndex, filteredItems.length - 1);

  useEffect(() => {
    if (!open) return;
    const target = itemRefs.current[currentActiveIndex];
    target?.scrollIntoView({ block: 'nearest' });
  }, [currentActiveIndex, open]);

  function navigate(href: string) {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    router.push(href);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (filteredItems.length === 0) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((value) => (value + 1) % filteredItems.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((value) => (value - 1 + filteredItems.length) % filteredItems.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = filteredItems[currentActiveIndex];
      if (item) navigate(item.href);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  const groupOrder: Array<keyof typeof groupedItems> = ['recent', 'project', 'global', 'projects'];
  const groupLabelMap = {
    recent: dict.nav.commandPaletteGroupRecent,
    project: dict.nav.commandPaletteGroupProject,
    global: dict.nav.commandPaletteGroupGlobal,
    projects: dict.nav.commandPaletteGroupProjects,
  } as const;

  let itemCursor = -1;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setActiveIndex(0);
      }}
    >
      <DialogContent className="max-w-[760px] p-0">
        <DialogHeader className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-[15px]">{dict.nav.quickJump}</DialogTitle>
            <span className="keycap">{shortcutLabel}</span>
          </div>
        </DialogHeader>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[hsl(var(--ds-text-2))]" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder={dict.nav.commandPalettePlaceholder}
              className="h-10 pl-9"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-[56vh] overflow-y-auto border-t border-[hsl(var(--ds-border-1))] px-2 py-2">
          {filteredItems.length === 0 ? (
            <div className="px-3 py-7 text-center text-[14px] text-[hsl(var(--ds-text-2))]">
              {dict.nav.commandPaletteEmpty}
            </div>
          ) : groupOrder.map((groupKey) => {
            const items = groupedItems[groupKey];
            if (items.length === 0) return null;
            return (
              <div key={groupKey} className="pb-1">
                <div className="px-3 py-1 text-[11px] uppercase tracking-wider text-[hsl(var(--ds-text-2))]">
                  {groupLabelMap[groupKey]}
                </div>
                {items.map((item) => {
                  itemCursor += 1;
                  const localIndex = itemCursor;
                  const active = localIndex === currentActiveIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      ref={(element) => {
                        itemRefs.current[localIndex] = element;
                      }}
                      type="button"
                      onMouseEnter={() => setActiveIndex(localIndex)}
                      onClick={() => navigate(item.href)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[8px] px-3.5 py-2.5 text-left transition-colors duration-150',
                        active ? 'bg-[hsl(var(--ds-surface-1))]' : 'hover:bg-[hsl(var(--ds-surface-1))]',
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-[hsl(var(--ds-text-2))]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-foreground">{item.label}</span>
                        <span className="block truncate text-[13px] text-[hsl(var(--ds-text-2))]">{item.hint}</span>
                      </span>
                      <ChevronRight className="size-3.5 shrink-0 text-[hsl(var(--ds-text-2))]" />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
