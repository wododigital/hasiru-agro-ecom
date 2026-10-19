'use client';

import { Tabs as T } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return <T.List className={cn('flex flex-wrap gap-2', className)} {...props} />;
}

/** Pill tab with an optional count ("Fruiting 42"). Arrow keys move between tabs. */
export function TabsTrigger({ className, count, children, ...props }: ComponentProps<typeof T.Trigger> & { count?: ReactNode }) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-border bg-surface px-4 py-2 font-semibold text-primary transition-colors hover:border-primary data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-fg',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? <span className="text-sm font-normal opacity-75 tabular-nums">{count}</span> : null}
    </T.Trigger>
  );
}
