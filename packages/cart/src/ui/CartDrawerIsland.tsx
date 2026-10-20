'use client';

import { buttonVariants, ImageWithFallback, Sheet, SheetContent, SheetTrigger, Skeleton } from '@ecomkit/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CART_CHANGED_EVENT } from './events';
import type { DrawerData } from '../server/view';
import { LineQtyIsland } from './LineQtyIsland';

export interface CartDrawerLabels {
  open: string;
  title: string;
  viewCart: string;
  checkout: string;
  total: string;
  loading: string;
  error: string;
  empty: string;
}

/** Path of the cart's JSON summary (the drawer reads it on open and after `cart:changed`). */
export const CART_SUMMARY_PATH = '/api/cart';

/**
 * Header cart button with the total quantity and a drawer listing the lines. Loads on first open (and refreshes
 * the count when any cart button fires `cart:changed`), so the header ships no cart data up front.
 */
export function CartDrawerIsland({ initialCount, labels }: { initialCount: number; labels: CartDrawerLabels }) {
  const [count, setCount] = useState(initialCount);
  const [data, setData] = useState<DrawerData | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(CART_SUMMARY_PATH, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as DrawerData;
      setData(d);
      setCount(d.count);
      setState('idle');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    const onChange = () => void load();
    window.addEventListener(CART_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CART_CHANGED_EVENT, onChange);
  }, [load]);

  return (
    <Sheet onOpenChange={(open) => open && void load()}>
      <SheetTrigger className="relative grid size-10 place-items-center rounded-full hover:bg-surface-2" aria-label={labels.open} data-cta="header-cart">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
          <circle cx="8" cy="21" r="1" />
          <circle cx="19" cy="21" r="1" />
          <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
        </svg>
        {count > 0 ? (
          <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-semibold text-accent-fg" aria-live="polite">
            {count}
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent title={labels.title} description={data?.countLabel}>
        {state === 'loading' && !data ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label={labels.loading}>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : null}
        {state === 'error' ? (
          <p role="alert" className="text-sm text-danger">
            {labels.error}
          </p>
        ) : null}
        {data && !data.lines.length ? <p className="text-muted">{labels.empty}</p> : null}
        {data?.lines.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {data.lines.map((l) => (
              <li key={l.lineId} className="flex gap-3 py-3">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-md bg-surface-2">
                  <ImageWithFallback image={l.image} alt={l.image?.alt ?? l.name} fill sizes="56px" className="object-cover" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-medium">{l.name}</span>
                    <span>{l.total}</span>
                  </div>
                  {l.detail ? <span className="text-xs text-muted">{l.detail}</span> : null}
                  {l.available ? <LineQtyIsland lineId={l.lineId} qty={l.qty} itemName={l.name} /> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {data?.total ? (
          <div className="mt-auto flex flex-col gap-3 border-t border-border pt-3">
            <div className="flex justify-between font-semibold">
              <span>{labels.total}</span>
              <span>{data.total}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/cart" className={buttonVariants({ variant: 'outline' })} data-cta="drawer-view-cart">
                {labels.viewCart}
              </Link>
              <Link href="/checkout" className={buttonVariants({ variant: 'accent' })} data-cta="drawer-checkout">
                {labels.checkout}
              </Link>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
