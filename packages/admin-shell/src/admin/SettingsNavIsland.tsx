'use client';

import { cn } from '@ecomkit/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeHref } from '../domain/nav';

/** Settings left list; highlights the open page. Scrolls sideways on phones. */
export function SettingsNavIsland({ links }: { links: readonly { label: string; href: string }[] }) {
  const active = activeHref(
    links.map((l) => l.href),
    usePathname() ?? '',
  );
  return (
    <ul className="flex gap-0.5 md:flex-col">
      {links.map((l) => (
        <li key={l.href}>
          <Link
            href={l.href}
            aria-current={l.href === active ? 'page' : undefined}
            className={cn('block rounded-sm px-3 py-2 text-sm whitespace-nowrap hover:bg-surface-2', l.href === active && 'bg-surface-2 font-semibold text-primary')}
          >
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
