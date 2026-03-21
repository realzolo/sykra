'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type Props = {
  left: ReactNode;
  right?: ReactNode;
  align?: 'center' | 'start';
  className?: string;
};

export default function SettingsRow({ left, right, align = 'center', className }: Props) {
  return (
    <div
      data-settings-row
      className={cn(
        'grid gap-4 px-0 py-4.5 md:grid-cols-[minmax(0,1fr)_minmax(160px,420px)]',
        align === 'start' ? 'items-start' : 'items-start md:items-center',
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">{left}</div>
      {right && <div className="min-w-0 md:justify-self-end">{right}</div>}
    </div>
  );
}
