'use client';

import { cn } from '@/lib/utils';

export type AccountNavItem = {
  targetId: string;
  label: string;
};

type Props = {
  items: AccountNavItem[];
  activeTargetId?: string | null;
  onNavigate: (targetId: string) => void;
};

export default function AccountNav({ items, activeTargetId, onNavigate }: Props) {
  return (
    <nav aria-label="Account sections" className="overflow-x-auto">
      <div className="inline-flex min-w-full items-center gap-1 rounded-[10px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]/80 p-1 lg:flex lg:flex-col lg:items-stretch lg:bg-transparent lg:p-0 lg:border-0">
        {items.map((item) => (
          <button
            key={item.targetId}
            type="button"
            onClick={() => onNavigate(item.targetId)}
            className={cn(
              'inline-flex h-8 items-center rounded-[8px] px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150',
              activeTargetId === item.targetId
                ? 'bg-[hsl(var(--ds-background-1))] text-foreground shadow-[0_1px_2px_hsl(0_0%_0%/0.08)]'
                : 'text-[hsl(var(--ds-text-2))] hover:bg-[hsl(var(--ds-background-1))]/60 hover:text-foreground',
              'lg:h-8 lg:px-2.5 lg:whitespace-normal',
            )}
            aria-current={activeTargetId === item.targetId ? 'page' : undefined}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
