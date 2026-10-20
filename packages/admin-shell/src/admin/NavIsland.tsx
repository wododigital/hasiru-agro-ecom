'use client';

import { cn, Sheet, SheetContent, SheetTrigger } from '@ecomkit/ui';
import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { activeHref, activeSection } from '../domain/nav';

export interface NavSectionView {
  band: string;
  label: string;
  items: { label: string; href: string; icon: ReactNode }[];
}

/**
 * Sidebar links, Shopify style: one parent link per section; the section's other links show indented under it only
 * while that section is active. The settings section is not listed here: the shell pins it bottom-left.
 */
export function NavList({ sections, onNavigate }: { sections: readonly NavSectionView[]; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
  const active = activeHref(
    sections.flatMap((s) => s.items.map((i) => i.href)),
    pathname,
  );
  const open = activeSection(sections, pathname);
  return (
    <ul className="flex flex-col gap-0.5">
      {sections.map((section) => (
        <li key={section.band} className="flex flex-col gap-0.5">
          <ul>
            {section.items.map((item, i) =>
              i > 0 && section.band !== open ? null : (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={item.href === active ? 'page' : undefined}
                    data-cta={`admin-nav-${item.href.replace(/^\/admin\/?/, '').replace(/\//g, '-') || 'home'}`}
                    className={cn(
                      'flex items-center gap-2.5 rounded-sm px-3 py-1.5 text-sm text-text hover:bg-surface-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted',
                      i === 0 && section.band === open && 'font-semibold',
                      i > 0 && 'pl-9 text-muted [&_svg]:hidden',
                      item.href === active && 'bg-surface-2 font-semibold text-primary [&_svg]:text-primary',
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Phone and tablet: the same nav in a left drawer, opened from the top bar. */
export function MobileNavIsland({ sections, title, settings }: { sections: readonly NavSectionView[]; title: string; settings?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger aria-label="Open menu" className="grid size-10 place-items-center rounded-sm hover:bg-surface-2 lg:hidden" data-cta="admin-menu-open">
        <Menu aria-hidden="true" className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" title={title} className="p-3" data-surface="admin">
        <nav aria-label="Admin">
          <NavList sections={sections} onNavigate={() => setOpen(false)} />
        </nav>
        {settings}
      </SheetContent>
    </Sheet>
  );
}
