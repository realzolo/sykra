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
      className={cn(
        'flex gap-4 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-4 py-3',
        align === 'start' ? 'items-start' : 'items-center',
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">{left}</div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
