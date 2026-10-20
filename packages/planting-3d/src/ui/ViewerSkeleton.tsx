import { Skeleton } from '@ecomkit/ui';

/** Same box as the viewer, so nothing shifts when it streams in. */
export function ViewerSkeleton() {
  return <Skeleton className="h-[calc(100dvh-9rem)] min-h-[30rem] w-full rounded-lg" />;
}
