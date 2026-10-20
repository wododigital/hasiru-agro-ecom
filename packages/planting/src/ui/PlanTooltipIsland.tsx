'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

interface Tip {
  text: string;
  x: number;
  y: number;
}

/**
 * Tooltips for the server-rendered plan: hover and tap show the nearest plant's `data-tip`; the arrow keys walk the
 * plants when the diagram has focus (announced through a live region). No drawing happens here.
 */
export function PlanTooltipIsland({ label, children }: { label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const index = useRef(-1);

  const show = (el: Element | null) => {
    const root = box.current;
    if (!el || !root) return setTip(null);
    const a = el.getBoundingClientRect();
    const b = root.getBoundingClientRect();
    setTip({ text: el.getAttribute('data-tip') ?? '', x: a.left - b.left + a.width / 2, y: a.top - b.top });
  };
  const onPointer = (e: PointerEvent<HTMLDivElement>) => show((e.target as Element).closest('[data-tip]'));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dots = box.current?.querySelectorAll('[data-tip]');
    if (!dots?.length) return;
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (e.key === 'Escape') return setTip(null);
    if (!delta) return;
    e.preventDefault();
    index.current = (index.current + delta + dots.length) % dots.length;
    show(dots[index.current]!);
  };

  return (
    <div
      ref={box}
      tabIndex={0}
      role="group"
      aria-label={label}
      className="relative w-fit max-w-full rounded-md outline-offset-4"
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={() => setTip(null)}
      onKeyDown={onKey}
      onBlur={() => setTip(null)}
    >
      {children}
      <span aria-live="polite" className="sr-only">
        {tip?.text}
      </span>
      {tip ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-sm bg-primary px-2 py-1 text-xs whitespace-nowrap text-primary-fg shadow-card"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.text}
        </span>
      ) : null}
    </div>
  );
}
