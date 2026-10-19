import type { ComponentProps } from 'react';
import { cn } from '../cn';

/**
 * Bottom-fixed bar (mobile cart bar, PDP buy bar). Visibility rules belong to the caller
 * (e.g. cart has lines and route is not cart or checkout). `mobileOnly` hides it from md up.
 */
export function StickyBar({ className, mobileOnly = true, ...props }: ComponentProps<'div'> & { mobileOnly?: boolean }) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-card',
        mobileOnly && 'md:hidden',
        className,
      )}
      {...props}
    />
  );
}
