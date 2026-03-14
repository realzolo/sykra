import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-muted text-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success: 'bg-success/15 text-success border-success/20',
        warning: 'bg-warning/15 text-warning border-warning/20',
        danger: 'bg-danger/15 text-danger border-danger/20',
        accent: 'bg-accent/15 text-accent border-accent/20',
        muted: 'bg-muted/60 text-muted-foreground border-border',
      },
      size: {
        sm: 'text-[10px] px-2 py-0.5',
        default: 'text-xs px-2.5 py-0.5',
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
