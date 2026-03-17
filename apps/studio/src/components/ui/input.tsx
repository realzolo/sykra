import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-8 w-full rounded-[6px] border border-[hsl(var(--ds-border-2))] bg-[hsl(var(--ds-surface-1))] px-3 py-2 text-[13px] text-foreground placeholder:text-[hsl(var(--ds-text-2))] transition-colors duration-100 focus:outline-none focus:border-[hsl(var(--ds-accent-7))] hover:bg-[hsl(var(--ds-surface-2))] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
