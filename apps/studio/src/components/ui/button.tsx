import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] text-[13px] font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ds-accent-7))] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default:     'bg-foreground text-background border border-transparent hover:bg-foreground/90',
        secondary:   'bg-[hsl(var(--ds-surface-2))] text-foreground border border-[hsl(var(--ds-border-2))] hover:bg-[hsl(var(--ds-surface-3))]',
        outline:     'bg-transparent text-foreground border border-[hsl(var(--ds-border-2))] hover:bg-[hsl(var(--ds-surface-1))]',
        ghost:       'bg-transparent text-[hsl(var(--ds-text-2))] border border-transparent hover:bg-[hsl(var(--ds-surface-1))] hover:text-foreground',
        link:        'text-[hsl(var(--ds-accent-8))] underline-offset-4 hover:underline border border-transparent',
        destructive: 'bg-danger text-white border border-transparent hover:bg-danger/90',
      },
      size: {
        default: 'h-8 px-3',
        sm:      'h-7 px-2.5 text-[12px]',
        lg:      'h-9 px-4 text-[14px]',
        icon:    'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
