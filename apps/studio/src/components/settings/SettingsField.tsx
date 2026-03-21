'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type Props = {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
  descriptionClassName?: string;
  contentClassName?: string;
};

export default function SettingsField({
  label,
  description,
  htmlFor,
  children,
  className,
  labelClassName,
  descriptionClassName,
  contentClassName,
}: Props) {
  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="space-y-1.5">
        {htmlFor ? (
          <label
            htmlFor={htmlFor}
            className={cn('block text-[12px] font-medium leading-5 text-[hsl(var(--ds-text-2))]', labelClassName)}
          >
            {label}
          </label>
        ) : (
          <div className={cn('text-[12px] font-medium leading-5 text-[hsl(var(--ds-text-2))]', labelClassName)}>
            {label}
          </div>
        )}
        {description ? (
          <p className={cn('text-[12px] leading-5 text-[hsl(var(--ds-text-2))]', descriptionClassName)}>
            {description}
          </p>
        ) : null}
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
