import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface MarqueeProps {
  /** Items in one pass; the track is rendered twice for a seamless loop (second copy hidden from assistive tech). */
  children: ReactNode;
  /** Seconds per loop. */
  duration?: number;
  className?: string;
}

/** CSS-only looping band. Pauses on hover and focus; static under prefers-reduced-motion. */
export function Marquee({ children, duration = 30, className }: MarqueeProps) {
  return (
    <div className={cn('group overflow-hidden', className)} style={{ ['--marquee-duration' as string]: `${duration}s` }}>
      <div className="flex w-max animate-marquee group-focus-within:[animation-play-state:paused] group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        <div className="flex shrink-0 items-center gap-12 pr-12">{children}</div>
        <div aria-hidden="true" className="flex shrink-0 items-center gap-12 pr-12 motion-reduce:hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
