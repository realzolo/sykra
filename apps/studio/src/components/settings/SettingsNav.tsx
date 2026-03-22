'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, HardDrive, Plug, SlidersHorizontal, Users } from 'lucide-react';
import { stripOrgPrefix, withOrgPrefix } from '@/lib/orgPath';
import { cn } from '@/lib/utils';
import { useClientDictionary } from '@/i18n/client';

export default function SettingsNav() {
  const pathname = usePathname();
  const basePath = stripOrgPrefix(pathname);
  const dict = useClientDictionary();
  const items = [
    { href: '/settings/organizations', label: dict.settings.organizations, icon: Users },
    { href: '/settings/runtime', label: dict.settings.runtime, icon: SlidersHorizontal },
    { href: '/settings/notifications', label: dict.settings.notifications, icon: Bell },
    { href: '/settings/integrations', label: dict.settings.integrations, icon: Plug },
    { href: '/settings/storage', label: dict.settings.storage, icon: HardDrive },
  ];

  return (
    <>
      <nav aria-label="Settings sections" className="hidden lg:flex lg:flex-col lg:gap-0.5">
        {items.map((item) => {
          const href = withOrgPrefix(pathname, item.href);
          const active = basePath.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={href}
              className={cn(
                'flex h-8 items-center rounded-[8px] px-2.5 text-[13px] font-medium transition-[background-color,color] duration-150',
                active
                  ? 'bg-[hsl(var(--ds-surface-1))] text-foreground'
                  : 'text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-surface-1))] hover:text-foreground',
              )}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <nav
        aria-label="Settings sections"
        className="overflow-x-auto lg:hidden"
      >
        <div className="inline-flex min-w-full items-center gap-1 rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]/80 p-1">
          {items.map((item) => {
            const href = withOrgPrefix(pathname, item.href);
            const active = basePath.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-[8px] px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150',
                  active
                    ? 'bg-[hsl(var(--ds-background-1))] text-foreground shadow-[0_1px_2px_hsl(0_0%_0%/0.14)]'
                    : 'text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-background-1))]/60 hover:text-foreground',
                )}
              >
                <Icon className="size-[14px] shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
