import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export function PageLoading({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('h-full w-full flex items-center justify-center', className)}>
      <div className="w-full max-w-lg px-6 py-10 space-y-4">
        {label ? <span className="sr-only">{label}</span> : null}
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
        <div className="grid grid-cols-3 gap-3 pt-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    </div>
  );
}
