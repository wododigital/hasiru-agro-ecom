import type { ComponentProps } from 'react';
import { cn } from '../cn';

/** Placeholder block. Size it with classes; hidden from assistive tech (announce loading on the container). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-sm bg-surface-2', className)} {...props} />;
}
