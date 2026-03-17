import { Skeleton } from '@/components/ui/skeleton';

export default function RulesLoading() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-4">
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-32 rounded-[6px]" />
        </div>
        <div className="border border-[hsl(var(--ds-border-1))] rounded-[8px] overflow-hidden bg-[hsl(var(--ds-background-2))]">
          <div className="flex items-center px-4 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] gap-4">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-16 ml-auto" />
          </div>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`ruleset-skeleton-${index}`} className="flex items-center gap-4 px-4 py-3 border-b border-[hsl(var(--ds-border-1))] last:border-0">
              <Skeleton className="h-7 w-7 rounded-[6px]" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-5 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
