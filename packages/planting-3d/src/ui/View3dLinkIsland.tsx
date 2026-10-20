'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

let warmed = false;
/** Starts downloading the three chunk once, on hover, focus or touch of a "View in 3D" link (intent preload). */
export function preload3d(): void {
  if (warmed) return;
  warmed = true;
  void import('./scene').catch(() => {
    warmed = false;
  });
}

/** "View in 3D" link for model and plan pages: same-tab navigation to /models/<model>/3d, chunk preloaded on intent. */
export function View3dLinkIsland({ href, children, className, cta = 'view-in-3d' }: { href: string; children: ReactNode; className?: string; cta?: string }) {
  return (
    <Link href={href} className={className} data-cta={cta} onPointerEnter={preload3d} onFocus={preload3d} onTouchStart={preload3d}>
      {children}
    </Link>
  );
}
