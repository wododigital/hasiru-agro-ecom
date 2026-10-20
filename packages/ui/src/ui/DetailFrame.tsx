import { ArrowLeft, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { uiMessages } from '../messages';

export interface DetailFrameProps {
  title: ReactNode;
  /** Where the back arrow goes (the index page). */
  backHref: string;
  backLabel?: string;
  /** Status badges next to the title. */
  badges?: ReactNode;
  /** Primary action (button or link) on the right. */
  primary?: ReactNode;
  /** Items for the "More actions" menu (links or form buttons). */
  more?: ReactNode;
  /** Subtitle under the title (dates, ids). */
  meta?: ReactNode;
  /** Main cards (left, wide). */
  children: ReactNode;
  /** Summary / side cards (right, narrow). Omit for a single column. */
  aside?: ReactNode;
}

/**
 * Admin detail page (Shopify): back arrow + title + badges, primary action and a "More actions" menu, then two
 * columns of cards. Pair edit forms with `SaveBarIsland` for the sticky "Unsaved changes" bar.
 */
export function DetailFrame({ title, backHref, backLabel = uiMessages.detail.back, badges, primary, more, meta, children, aside }: DetailFrameProps) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={backHref} aria-label={backLabel} className="grid size-9 place-items-center rounded-sm hover:bg-surface-2" data-cta="detail-back">
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text">{title}</h1>
            {badges}
          </div>
          {meta ? <p className="text-sm text-muted">{meta}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {more ? (
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-1 rounded-sm border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">
                {uiMessages.detail.more} <Ellipsis aria-hidden="true" className="size-4" />
              </summary>
              <div className="absolute right-0 z-30 mt-1 flex min-w-48 flex-col rounded-md border border-border bg-surface p-1 shadow-card [&>*]:rounded-sm [&>*]:px-3 [&>*]:py-2 [&>*]:text-left [&>*]:text-sm [&>*:hover]:bg-surface-2">{more}</div>
            </details>
          ) : null}
          {primary}
        </div>
      </header>
      <div className={cn('grid gap-4', aside && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')}>
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
        {aside ? <aside className="flex min-w-0 flex-col gap-4">{aside}</aside> : null}
      </div>
    </div>
  );
}

/** A white card for detail pages. */
export function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3 rounded-md border border-border bg-surface p-4', className)}>
      {title ? <h2 className="text-sm font-semibold text-text">{title}</h2> : null}
      {children}
    </section>
  );
}
