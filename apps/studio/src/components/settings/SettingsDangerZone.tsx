'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type Props = {
  title: string;
  description?: string;
  warning?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export default function SettingsDangerZone({
  title,
  description,
  warning,
  action,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-[hsl(var(--ds-danger-7)/0.16)] bg-[hsl(var(--background))]',
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="space-y-1.5">
          <div className="text-[13px] font-medium tracking-[-0.01em] text-danger">{title}</div>
          {description ? (
            <p className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">{description}</p>
          ) : null}
        </div>

        {warning ? (
          <div className="rounded-[10px] border border-[hsl(var(--ds-danger-7)/0.12)] bg-[hsl(var(--ds-danger-7)/0.04)] px-3.5 py-3 text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">
            {warning}
          </div>
        ) : null}

        {action ? <div className="flex justify-end">{action}</div> : null}
      </div>
    </div>
  );
}
