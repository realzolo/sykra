'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, HardDrive, Plug, Shield, Users } from 'lucide-react';
import { stripOrgPrefix, withOrgPrefix } from '@/lib/orgPath';
import { cn } from '@/lib/utils';
import { useClientDictionary } from '@/i18n/client';

export default function SettingsNav() {
  const pathname = usePathname();
  const basePath = stripOrgPrefix(pathname);
  const dict = useClientDictionary();
  const items = [
    { href: '/settings/organizations', label: dict.settings.organizations, icon: Users },
    { href: '/settings/notifications', label: dict.settings.notifications, icon: Bell },
    { href: '/settings/integrations', label: dict.settings.integrations, icon: Plug },
    { href: '/settings/storage', label: dict.settings.storage, icon: HardDrive },
    { href: '/settings/security', label: dict.settings.security, icon: Shield },
  ];

  return (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const href = withOrgPrefix(pathname, item.href);
        const active = basePath.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] transition-colors duration-100',
              active
                ? 'bg-[hsl(var(--ds-surface-2))] text-foreground font-medium'
                : 'text-[hsl(var(--ds-text-2))] hover:text-foreground hover:bg-[hsl(var(--ds-surface-1))]',
            )}
          >
            <Icon className="size-[15px] shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
