import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-[4px] border border-transparent px-1.5 py-0.5 text-[11px] font-medium leading-none transition-colors',
  {
    variants: {
      variant: {
        default:   'bg-[hsl(var(--ds-surface-2))] text-foreground border-[hsl(var(--ds-border-1))]',
        secondary: 'bg-[hsl(var(--ds-surface-2))] text-[hsl(var(--ds-text-2))] border-[hsl(var(--ds-border-1))]',
        outline:   'border-[hsl(var(--ds-border-2))] text-foreground',
        success:   'bg-[hsl(var(--ds-success-7)/0.12)] text-success border-[hsl(var(--ds-success-7)/0.25)]',
        warning:   'bg-[hsl(var(--ds-warning-7)/0.12)] text-warning border-[hsl(var(--ds-warning-7)/0.25)]',
        danger:    'bg-[hsl(var(--ds-danger-7)/0.12)] text-danger border-[hsl(var(--ds-danger-7)/0.25)]',
        accent:    'bg-[hsl(var(--ds-accent-7)/0.12)] text-accent border-[hsl(var(--ds-accent-7)/0.25)]',
        muted:     'bg-[hsl(var(--ds-surface-1))] text-[hsl(var(--ds-text-2))] border-[hsl(var(--ds-border-1))]',
      },
      size: {
        sm:      'text-[10px] px-1.5 py-0.5',
        default: 'text-[11px] px-1.5 py-0.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, size, className }))} {...props} />;
}

export { Badge, badgeVariants };
