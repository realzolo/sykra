'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type Variant = 'info' | 'success' | 'warning' | 'danger';

type Props = {
  variant: Variant;
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

const variantStyles: Record<Variant, string> = {
  info: 'border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] text-foreground',
  success: 'border-success/30 bg-success/5 text-foreground',
  warning: 'border-warning/30 bg-warning/5 text-foreground',
  danger: 'border-danger/30 bg-danger/5 text-foreground',
};

const iconStyles: Record<Variant, string> = {
  info: 'border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-2))] text-[hsl(var(--ds-text-2))]',
  success: 'border-success/20 bg-success/10 text-success',
  warning: 'border-warning/20 bg-warning/10 text-warning',
  danger: 'border-danger/20 bg-danger/10 text-danger',
};

export default function SettingsNotice({
  variant,
  title,
  description,
  icon,
  action,
  className,
}: Props) {
  const centered = !description && !action;

  return (
    <div
      className={cn(
        'flex gap-3 rounded-[8px] border px-4 py-3 shadow-none',
        centered ? 'items-center' : 'items-start',
        variantStyles[variant],
        className,
      )}
    >
      {icon && (
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-[8px] border', iconStyles[variant])}>
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <div className="text-[13px] font-medium">{title}</div>}
        {description && <p className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
