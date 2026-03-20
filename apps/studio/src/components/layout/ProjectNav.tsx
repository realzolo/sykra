'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GitCommit, FileText, GitBranch, Code2, Sliders } from 'lucide-react';
import type { Dictionary } from '@/i18n';
import { stripOrgPrefix, withOrgPrefix } from '@/lib/orgPath';
import { cn } from '@/lib/utils';

interface TabItem {
  tab: string;
  label: string;
  icon: React.ElementType;
}

export default function ProjectNav({
  projectId,
  dict,
}: {
  projectId: string;
  dict: Dictionary;
}) {
  const pathname = usePathname();
  const basePath = stripOrgPrefix(pathname);

  const tabs: TabItem[] = [
    { tab: 'commits', label: dict.nav.project.commits, icon: GitCommit },
    { tab: 'code-reviews', label: dict.nav.project.codeReviews, icon: FileText },
    { tab: 'pipelines', label: dict.nav.project.pipelines, icon: GitBranch },
    { tab: 'codebase', label: dict.nav.project.codebase, icon: Code2 },
    { tab: 'settings', label: dict.nav.project.settings, icon: Sliders },
  ];

  function isActive(tab: string) {
    const prefix = `/projects/${projectId}/${tab}`;
    return basePath === prefix || basePath.startsWith(`${prefix}/`);
  }

  return (
    <nav className="flex items-center gap-0 px-4 border-b border-border bg-[hsl(var(--ds-background-2))] shrink-0 overflow-x-auto">
      {tabs.map(({ tab, label, icon: Icon }) => {
        const active = isActive(tab);
        return (
          <Link
            key={tab}
            href={withOrgPrefix(pathname, `/projects/${projectId}/${tab}`)}
            className={cn(
              'relative flex items-center gap-1.5 h-11 px-3 text-[13px] transition-colors duration-100 whitespace-nowrap shrink-0',
              active
                ? 'text-foreground font-medium'
                : 'text-[hsl(var(--ds-text-2))] hover:text-foreground',
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            {label}
            {/* Active indicator underline */}
            {active && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-foreground" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
