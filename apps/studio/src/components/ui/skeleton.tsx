import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('skeleton block rounded-md', className)} />
  );
}
