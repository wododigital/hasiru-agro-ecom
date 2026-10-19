'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { uiMessages } from '../messages';

export interface RailProps {
  /** Region name, e.g. the section heading. */
  label: string;
  children: ReactNode;
  /** Width of each item (any CSS length). */
  itemWidth?: string;
  labels?: Partial<(typeof uiMessages)['rail']>;
  className?: string;
}

/**
 * Horizontal list with CSS scroll-snap (touch and trackpad native). Desktop gets previous / next
 * arrows that scroll by one viewport; they disable at either end. Items render on the server as children.
 */
export function Rail({ label, children, itemWidth = '200px', labels, className }: RailProps) {
  const l = { ...uiMessages.rail, ...labels };
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A few px of slack: snap alignment and the focus-ring padding leave scrollLeft at 1-2 px at rest.
    const update = () => setEdges({ start: el.scrollLeft <= 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  const arrow = 'absolute top-1/2 z-10 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-surface text-primary shadow-card transition-opacity hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-0 md:grid';
  return (
    <div role="region" aria-label={label} className={cn('relative', className)}>
      <button type="button" aria-label={l.previous} disabled={edges.start} onClick={() => scroll(-1)} className={cn(arrow, '-left-3')}>
        <ChevronLeft aria-hidden="true" className="size-5" />
      </button>
      <div
        ref={ref}
        style={{ ['--rail-item' as string]: itemWidth }}
        className="flex snap-x snap-mandatory gap-3.5 overflow-x-auto scroll-smooth px-0.5 pt-1 pb-3.5 [scrollbar-width:thin] *:shrink-0 *:grow-0 *:basis-(--rail-item) *:snap-start"
      >
        {children}
      </div>
      <button type="button" aria-label={l.next} disabled={edges.end} onClick={() => scroll(1)} className={cn(arrow, '-right-3')}>
        <ChevronRight aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
