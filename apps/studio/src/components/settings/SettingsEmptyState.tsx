'use client';

import type { ReactNode } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export default function SettingsEmptyState({
  title,
  description,
  icon,
  action,
  className,
}: Props) {
  return (
    <Card className={cn('border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] shadow-none', className)}>
      <CardContent className="flex flex-col items-start gap-3 px-6 py-6">
        {icon && (
          <div className="flex size-10 items-center justify-center rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-2))] text-[hsl(var(--ds-text-2))]">
            {icon}
          </div>
        )}
        <div className="space-y-1">
          <div className="text-[13px] font-medium text-foreground">{title}</div>
          {description && (
            <p className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">{description}</p>
          )}
        </div>
        {action && <div>{action}</div>}
      </CardContent>
    </Card>
  );
}
