'use client';

import { cn, fieldClass } from '@ecomkit/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { SearchGroup } from '../server/search';

/**
 * Top bar search across orders, products, customers and enquiries (whatever enabled modules offer).
 * Debounced server action; "/" or Ctrl/Cmd+K focuses it; Esc closes the results.
 */
export function SearchIsland({ search }: { search: (query: string) => Promise<SearchGroup[]> }) {
  const [groups, setGroups] = useState<SearchGroup[] | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer.current);
    };
  }, []);

  const query = (q: string) => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) return setGroups(null);
    timer.current = setTimeout(() => {
      const mine = ++seq.current;
      startTransition(async () => {
        const result = await search(q);
        if (mine === seq.current) setGroups(result);
      });
    }, 250);
  };

  return (
    <div className="relative max-w-xl flex-1" onKeyDown={(e) => e.key === 'Escape' && setGroups(null)}>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        ref={input}
        type="search"
        aria-label="Search the admin"
        aria-controls={listId}
        aria-expanded={groups !== null}
        placeholder="Search orders, products, customers"
        onChange={(e) => query(e.target.value)}
        className={cn(fieldClass, 'py-2 pl-9', pending && 'opacity-80')}
        data-cta="admin-search"
      />
      {groups !== null ? (
        <div id={listId} role="region" aria-live="polite" className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70dvh] overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-card">
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">No matches.</p>
          ) : (
            groups.map((g) => (
              <section key={g.id} className="py-1">
                <h2 className="px-2 py-1 text-xs font-semibold tracking-wide text-muted uppercase">{g.label}</h2>
                <ul>
                  {g.hits.map((h) => (
                    <li key={h.id}>
                      <Link href={h.href} onClick={() => setGroups(null)} className="flex flex-col rounded-sm px-2 py-1.5 hover:bg-surface-2">
                        <span className="text-sm font-medium">{h.title}</span>
                        {h.subtitle ? <span className="text-xs text-muted">{h.subtitle}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
