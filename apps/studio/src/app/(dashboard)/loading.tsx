import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-32 rounded-[6px]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={`dash-card-skeleton-${index}`} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-5 space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-2 border-b border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))]">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-24 ml-auto" />
          </div>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`dash-row-skeleton-${index}`} className="flex items-center gap-4 px-4 py-3 border-b border-[hsl(var(--ds-border-1))] last:border-0">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-24 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
