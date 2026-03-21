"use client";

import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export default function SettingsSection({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: Props) {
  return (
    <Card className={cn("border-[hsl(var(--ds-border-1))] bg-background shadow-none", className)}>
      <CardHeader className="space-y-1.5 border-b border-[hsl(var(--ds-border-1))] pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-[14px]">{title}</CardTitle>
            {description && (
              <CardDescription className="text-[12px] leading-5 text-[hsl(var(--ds-text-2))]">
                {description}
              </CardDescription>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-4 pt-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
