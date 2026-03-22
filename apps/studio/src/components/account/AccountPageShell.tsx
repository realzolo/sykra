'use client';

import type { ReactNode, RefObject } from 'react';

import { cn } from '@/lib/utils';

type Props = {
  title: ReactNode;
  description: ReactNode;
  navigation: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
};

export default function AccountPageShell({
  title,
  description,
  navigation,
  actions,
  children,
  className,
  scrollContainerRef,
}: Props) {
  return (
    <div ref={scrollContainerRef} className={cn('h-full min-h-0 overflow-y-auto', className)}>
      <div className="mx-auto w-full max-w-[1240px] px-6 py-8">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-[720px] space-y-2">
              <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-foreground">{title}</h1>
              <p className="text-[14px] leading-6 text-[hsl(var(--ds-text-2))]">{description}</p>
            </div>
            {actions && <div className="shrink-0">{actions}</div>}
          </div>

          <div className="grid items-start gap-10 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-8">
                {navigation}
              </div>
            </aside>

            <div className="min-w-0 space-y-6">
              <div className="lg:hidden">
                {navigation}
              </div>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
