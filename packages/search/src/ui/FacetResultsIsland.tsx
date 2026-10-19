'use client';

import { Button, buttonVariants, cn } from '@ecomkit/ui';
import type { ReactNode } from 'react';
import { fmt } from '../domain';
import { removeChip } from '../domain/engine';
import { useFacets } from './FacetProviderIsland';

export interface FacetResultsProps {
  /**
   * Server-rendered cards keyed by product id for every product in the listing scope. The island only
   * picks and orders them; cards never re-render on a filter change (stable keys, images stay mounted).
   * ponytail: all cards of the scope travel in the RSC payload; switch to a cards endpoint past ~300 per listing.
   */
  cards: Readonly<Record<string, ReactNode>>;
  /** Zero-result CTAs (empty hides). */
  assistanceUrl?: string;
  guidedHref?: string;
  className?: string;
  gridClassName?: string;
}

/** Sorted, filtered grid with "Show more" (24 at a time), or the zero-results panel. */
export function FacetResults({ cards, assistanceUrl, guidedHref, className, gridClassName }: FacetResultsProps) {
  const { view, url, config, messages, pending, showMore } = useFacets();
  if (view.total === 0) return <ZeroResults cards={cards} assistanceUrl={assistanceUrl} guidedHref={guidedHref} className={className} />;
  const visible = view.ids.slice(0, config.pageSize * url.page);
  return (
    <div className={cn('flex flex-col gap-6', className)} aria-busy={pending}>
      <ul className={cn('grid grid-cols-2 gap-3 transition-opacity md:grid-cols-3 md:gap-5 xl:grid-cols-4', pending && 'opacity-60', gridClassName)}>
        {visible.map((id) => (cards[id] ? <li key={id}>{cards[id]}</li> : null))}
      </ul>
      {visible.length < view.total ? (
        <Button variant="outline" className="self-center" data-cta="listing-show-more" onClick={showMore}>
          {messages.filters.showMore}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Never a dead end: one-tap removal of each filter with the count it would give, the closest matches
 * (least important filters relaxed), then assistance and guided-choice links.
 */
export function ZeroResults({ cards, assistanceUrl, guidedHref, className }: Omit<FacetResultsProps, 'gridClassName'>) {
  const ctx = useFacets();
  const { view, messages, url } = ctx;
  const z = messages.zero;
  const labelOf = (key: string) => {
    const chip = view.chips.find((c) => c.key === key);
    return chip?.kind === 'value' ? (view.groups.find((g) => g.key === key)?.label ?? chip.label) : (messages.ranges[key] ?? key);
  };
  return (
    <section className={cn('flex flex-col gap-5 rounded-lg border border-dashed border-border p-5', className)} aria-live="polite">
      <h2 className="font-display text-2xl text-primary">{view.chips.length === 1 ? z.titleOne : fmt(z.title, { count: view.chips.length })}</h2>
      {view.drops.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{z.dropHint}</p>
          <div className="flex flex-wrap gap-2">
            {view.drops.map(({ chip, count }) => {
              const label = chip.kind === 'range' ? ctx.rangeLabel(chip) : chip.label;
              return (
                <button
                  key={chip.kind === 'range' ? chip.key : `${chip.key}:${chip.value}`}
                  type="button"
                  data-cta="zero-drop-filter"
                  disabled={count === 0}
                  onClick={() => ctx.apply(removeChip(url.state, chip))}
                  className="min-h-11 rounded-full border border-border bg-surface px-4 text-sm text-primary hover:bg-surface-2 disabled:opacity-50"
                >
                  {fmt(z.drop, { label, count })}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {view.closest?.ids.length ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold text-primary">{z.closest}</h3>
          <p className="text-sm text-muted">{fmt(z.closestHint, { labels: view.closest.relaxed.map(labelOf).join(', ') })}</p>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4">{view.closest.ids.map((id) => (cards[id] ? <li key={id}>{cards[id]}</li> : null))}</ul>
        </div>
      ) : null}
      <ZeroCtas assistanceUrl={assistanceUrl} guidedHref={guidedHref} assistance={z.assistance} guided={z.guided} />
    </section>
  );
}

export function ZeroCtas({ assistanceUrl, guidedHref, assistance, guided }: { assistanceUrl?: string; guidedHref?: string; assistance: string; guided: string }) {
  if (!assistanceUrl && !guidedHref) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {assistanceUrl ? (
        <a href={assistanceUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'accent' })} data-cta="zero-assistance">
          {assistance}
        </a>
      ) : null}
      {guidedHref ? (
        <a href={guidedHref} className={buttonVariants({ variant: 'outline' })} data-cta="zero-guided">
          {guided}
        </a>
      ) : null}
    </div>
  );
}
