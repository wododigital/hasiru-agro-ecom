import { db } from '@ecomkit/core/db';
import { getSettings } from '@ecomkit/core/settings';
import { Skeleton } from '@ecomkit/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { Suspense } from 'react';
import { DEFAULT_FACET_CONFIG, fmt, itemHref, parseUrlState, suggest } from '../domain';
import { searchMessages } from '../messages';
import { facetPageProps, getSearchIndex, logSearchLimited, prepared, searchProducts, searchSettings } from '../server';
import { AppliedChips, FacetProvider, FacetResults, FacetSidebar, FilterSheet, ResultCount, SearchBox, SearchHitCard, SortSelect, ZeroCtas } from '../ui';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Product link template; `kind` is the catalog kind (`plant`, `input`). */
const ITEM_HREF = '/{kind}/{slug}';
const m = searchMessages;

export function generateMetadata(): Metadata {
  return { title: m.search.title, robots: { index: false, follow: true } };
}

/** /search?q= : trgm results with facets scoped to the hits, typo suggestions and a no-dead-end empty state. */
export default function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pt-6 pb-24 md:px-6">
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    </div>
  );
}

async function Results({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { q } = parseUrlState(params, DEFAULT_FACET_CONFIG, 'relevance');
  const [index, settings] = await Promise.all([getSearchIndex(), getSettings(searchSettings)]);
  const hits = q.length >= 2 ? await searchProducts(db, q) : [];
  if (q && settings.logQueries) {
    const source = { headers: await headers() };
    after(() => logSearchLimited(db, { q, results: hits.length }, source));
  }

  const box = <SearchBox defaultValue={q} itemHref={ITEM_HREF} messages={m.search} />;
  if (!q) {
    return (
      <>
        <h1 className="font-display text-3xl text-primary">{m.search.headingEmpty}</h1>
        {box}
      </>
    );
  }

  if (!hits.length) {
    const close = suggest(prepared(index).suggest, q, 6);
    return (
      <>
        {box}
        <section className="flex flex-col gap-4 rounded-lg border border-dashed border-border p-5">
          <h1 className="font-display text-2xl text-primary">{fmt(m.search.noResults, { q })}</h1>
          <p className="text-muted">{m.search.noResultsBody}</p>
          {close.length ? (
            <div className="flex flex-col gap-2">
              <h2 className="font-semibold text-primary">{m.search.didYouMean}</h2>
              <ul className="flex flex-wrap gap-2">
                {close.map((s) => (
                  <li key={s.id}>
                    <a href={itemHref(ITEM_HREF, s)} data-cta="search-did-you-mean" className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm text-primary hover:bg-surface-2">
                      {s.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ZeroCtas assistanceUrl={settings.assistanceUrl} guidedHref={settings.guidedHref} assistance={m.zero.assistance} guided={m.zero.guided} />
        </section>
      </>
    );
  }

  const props = facetPageProps({ index, searchParams: params, scopeIds: hits.map((h) => h.id), defaultSort: 'relevance' });
  const cards = Object.fromEntries(hits.map((h) => [h.id, <SearchHitCard key={h.id} hit={h} itemHref={ITEM_HREF} />]));
  return (
    <FacetProvider {...props} messages={m}>
      {box}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-primary">{fmt(m.search.heading, { q })}</h1>
          <ResultCount />
        </div>
        <SortSelect className="hidden md:flex" />
      </div>
      <AppliedChips />
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <FacetSidebar />
        <FacetResults cards={cards} assistanceUrl={settings.assistanceUrl} guidedHref={settings.guidedHref} />
      </div>
      <FilterSheet />
    </FacetProvider>
  );
}
