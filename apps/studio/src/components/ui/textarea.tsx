import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[104px] w-full rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))] px-3.5 py-2.5 text-[14px] text-foreground shadow-none placeholder:text-[hsl(var(--ds-text-2))] transition-[background-color,border-color,box-shadow] duration-150 hover:border-[hsl(var(--ds-border-2))] hover:bg-[hsl(var(--ds-surface-1))] focus-visible:outline-none focus-visible:border-[hsl(var(--ds-accent-7)/0.44)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-accent-7)/0.16)] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
