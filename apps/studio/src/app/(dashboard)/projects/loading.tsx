import { Skeleton } from '@/components/ui/skeleton';

export default function ProjectsLoading() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full px-6 py-6">
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <div className="space-y-6">
            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4  space-y-3">
              <Skeleton className="h-3 w-24" />
              <div className="grid grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={`stats-skeleton-${idx}`} className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4  space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-8 w-28 rounded-[6px]" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={`project-skeleton-${index}`} className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-2))] p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-[6px]" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-16 rounded-[4px]" />
                    <Skeleton className="h-5 w-20 rounded-[4px]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
