'use client';

import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';

export interface RecentItem {
  href: string;
  name: string;
}

const KEY = 'catalog:recently-viewed';
const MAX = 8;

function snapshot(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '[]';
  } catch {
    return '[]';
  }
}
const serverSnapshot = () => '[]';
const subscribe = (onChange: () => void) => {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
};

function parse(raw: string): RecentItem[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is RecentItem => typeof x?.href === 'string' && typeof x?.name === 'string') : [];
  } catch {
    return [];
  }
}

/** Remembers this product in localStorage and lists the others viewed before (per browser, best effort). */
export function RecentlyViewedIsland({ current, title }: { current: RecentItem; title: string }) {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const items = parse(raw)
    .filter((i) => i.href !== current.href)
    .slice(0, 6);
  useEffect(() => {
    try {
      const previous = parse(window.localStorage.getItem(KEY) ?? '[]').filter((i) => i.href !== current.href);
      window.localStorage.setItem(KEY, JSON.stringify([{ href: current.href, name: current.name }, ...previous].slice(0, MAX)));
    } catch {
      // storage blocked: nothing to remember
    }
  }, [current.href, current.name]);
  if (!items.length) return null;
  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-2">
      <h2 id="recent-title" className="font-display text-lg">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-2" data-cta="pdp-recently-viewed">
              {i.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
