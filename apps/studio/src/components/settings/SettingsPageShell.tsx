"use client";

import type { ReactNode } from "react";

import SettingsNav from "@/components/settings/SettingsNav";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export default function SettingsPageShell({
  title,
  description,
  actions,
  children,
  className,
}: Props) {
  return (
    <div className={cn("flex-1 overflow-auto", className)}>
      <div className="max-w-5xl px-6 py-6">
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <SettingsNav />

          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h1 className="text-[16px] font-semibold text-foreground">{title}</h1>
                <p className="text-[13px] text-[hsl(var(--ds-text-2))]">{description}</p>
              </div>
              {actions && <div className="shrink-0">{actions}</div>}
            </div>

            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
