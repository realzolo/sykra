'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, LayoutGrid, List as ListIcon, Plus, Search } from 'lucide-react';
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
    isProjects ? 'All Projects' :
    isReports ? dict.reports.title :
    isRules ? dict.rules.title :
    isSettings ? dict.settings.title :
    'Overview';

  const q = searchParams.get('q') ?? '';
  const view = searchParams.get('view') === 'list' ? 'list' : 'grid';
  const [search, setSearch] = useState(q);

  useEffect(() => {
    setSearch(q);
  }, [q]);

  return (
    <div className="border-b border-border bg-background shrink-0">
      <div className="px-6 h-14 flex items-center gap-3">
        {isProjects ? (
          <button className="flex items-center gap-2 text-sm font-medium text-foreground">
            {title}
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        ) : (
          <div className="text-sm font-medium text-foreground">{title}</div>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          {isProjects ? 'Overview' : ''}
        </div>
      </div>

      {isProjects && (
        <div className="px-6 pb-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-[520px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={dict.projects.searchProjects}
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                setSearch(value);
                updateQuery({ q: value || null });
              }}
              className="pl-9 h-8 bg-muted/40"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
            <button
              onClick={() => updateQuery({ view: 'grid' })}
              className={[
                'h-7 w-7 rounded-md flex items-center justify-center',
                view === 'grid' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              onClick={() => updateQuery({ view: 'list' })}
              className={[
                'h-7 w-7 rounded-md flex items-center justify-center',
                view === 'list' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <ListIcon className="size-4" />
            </button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add New
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
                New Project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
