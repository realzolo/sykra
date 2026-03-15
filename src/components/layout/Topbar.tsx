'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, LayoutGrid, List as ListIcon, MoreHorizontal, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Dictionary } from '@/i18n';

function useQueryParamUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) params.delete(key);
      else params.set(key, value);
    });
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

export default function Topbar({ dict }: { dict: Dictionary }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const updateQuery = useQueryParamUpdater();

  const isProjects = pathname.startsWith('/projects');
  const isReports = pathname.startsWith('/reports');
  const isRules = pathname.startsWith('/rules');
  const isSettings = pathname.startsWith('/settings');

  const title =
    isProjects ? dict.projects.allProjects :
    isReports ? dict.reports.title :
    isRules ? dict.rules.title :
    isSettings ? dict.settings.title :
    dict.dashboard.overview;


  const q = searchParams.get('q') ?? '';
  const view = searchParams.get('view') === 'list' ? 'list' : 'grid';
  const [search, setSearch] = useState(q);

  useEffect(() => {
    setSearch(q);
  }, [q]);

  return (
    <div className="border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0">
      <div className="px-6 h-12 flex items-center gap-4">
        {isProjects ? (
          <button className="flex items-center gap-2 text-sm font-medium text-foreground transition-soft hover:text-foreground/80">
            {dict.projects.allProjects}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
        ) : (
          <div className="text-sm font-medium text-foreground">{title}</div>
        )}

        <div className="mx-auto text-sm text-muted-foreground">
          {isProjects ? dict.projects.overview : ''}
        </div>

        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Open page menu">
          <MoreHorizontal className="size-4 text-muted-foreground" />
        </Button>
      </div>

      {isProjects && (
        <div className="px-6 pb-3 flex items-center gap-3">
          <div className="relative flex-1 max-w-[600px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={dict.projects.searchProjects}
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                setSearch(value);
                updateQuery({ q: value || null });
              }}
              className="pl-9 h-8 bg-muted/40 text-sm"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md border border-border bg-muted/40 p-1 transition-soft">
            <button
              onClick={() => updateQuery({ view: 'grid' })}
              className={[
                'h-7 w-7 rounded-md flex items-center justify-center transition-soft',
                view === 'grid' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              onClick={() => updateQuery({ view: 'list' })}
              className={[
                'h-7 w-7 rounded-md flex items-center justify-center transition-soft',
                view === 'list' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <ListIcon className="size-4" />
            </button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="gap-1.5 h-8 text-sm">
                <Plus className="h-4 w-4" />
                {dict.projects.addProject}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('open-add-project'));
                  }
                }}
              >
                {dict.projects.addProject}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
