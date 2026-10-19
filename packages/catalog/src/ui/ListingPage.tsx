import { Breadcrumbs, EmptyState, Select, Skeleton, buttonVariants, cn, type Crumb } from '@ecomkit/ui';
import Link from 'next/link';
import { Suspense } from 'react';
import { readCatalogSettings } from '../server/cards';
import { loadListing, parseListingQuery, SORTS } from '../server/listing';
import type { ListFilter } from '../server/queries';
import { catalogRuntime } from '../server/runtime';
import { ProductGrid } from './ProductCard';
import { JsonLdScript } from './PdpParts';

type SearchParams = Record<string, string | string[] | undefined>;

export interface ListingPageProps {
  title: string;
  titleKn?: string | null;
  intro?: string | null;
  /** Sanitised collection or tag intro (rendered server-side for crawlers). */
  introHtml?: string | null;
  path: string;
  breadcrumbs: readonly Crumb[];
  filter: Omit<ListFilter, 'limit' | 'offset' | 'sort'>;
  tabs?: readonly { href: string; label: string; count: number; active: boolean }[];
  subcollections?: readonly { href: string; label: string; active: boolean }[];
  collectionSlug?: string | null;
  searchParams: Promise<SearchParams>;
}

/** Listing template for /plants, collections, sub-collections, curated trait pages and /inputs. */
export function ListingPage(props: ListingPageProps) {
  const rt = catalogRuntime();
  const m = rt.messages.listing;
  const planner = rt.registry?.has('planting') ?? false;
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">
      <Breadcrumbs items={props.breadcrumbs} />
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-primary-strong">{props.title}</h1>
        {props.titleKn ? (
          <p lang="kn" className="text-muted">
            {props.titleKn}
          </p>
        ) : null}
        {props.intro ? <p className="max-w-3xl text-muted">{props.intro}</p> : null}
        {props.introHtml ? (
          // eslint-disable-next-line react/no-danger -- sanitised by core.safeHtml when saved
          <div className="prose max-w-3xl text-muted" dangerouslySetInnerHTML={{ __html: props.introHtml }} />
        ) : null}
      </header>
      {props.tabs?.length ? (
        <nav aria-label={m.subcollections}>
          <ul className="flex flex-wrap gap-2">
            {props.tabs.map((t) => (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={t.active ? 'page' : undefined}
                  className={cn('inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold', t.active ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-primary')}
                  data-cta="plants-collection-tab"
                >
                  {t.label}
                  <span className="tabular-nums opacity-80">{t.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {props.subcollections?.length ? (
          <ul className="flex flex-wrap gap-2" aria-label={m.subcollections}>
            {props.subcollections.map((s) => (
              <li key={s.href}>
                <Link href={s.href} aria-current={s.active ? 'page' : undefined} className={cn('rounded-full border px-3 py-1 text-sm', s.active ? 'border-primary text-primary font-semibold' : 'border-border')} data-cta="plants-subcollection">
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        {planner ? (
          <Link href="/plan" className={buttonVariants({ variant: 'accent', size: 'sm' })} data-cta="plants-help-me-choose">
            {m.helpMeChoose}
          </Link>
        ) : null}
      </div>
      <Suspense fallback={<GridSkeleton />}>
        <ListingResults {...props} />
      </Suspense>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="aspect-[3/4] rounded-md" />
      ))}
    </div>
  );
}

async function ListingResults({ title, filter, path, searchParams, collectionSlug = null }: ListingPageProps) {
  const rt = catalogRuntime();
  const m = rt.messages.listing;
  const [sp, settings] = await Promise.all([searchParams, readCatalogSettings()]);
  const query = parseListingQuery(sp);
  const listing = await loadListing(filter, { ...query, pageSize: settings.pageSize });
  const cartEnabled = rt.registry?.has('cart') ?? false;
  const Aside = rt.listingAside;
  const href = (page: number) => {
    const q = new URLSearchParams();
    if (query.sort !== 'featured') q.set('sort', query.sort);
    if (page > 1) q.set('page', String(page));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const jsonLd = rt.jsonLd
    ? rt.jsonLd.graph([rt.jsonLd.collectionPage({ name: title, path, items: listing.cards.slice(0, 24).map((c) => ({ name: c.name, path: c.href })) })])
    : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {Aside ? (
        <aside className="lg:w-64 lg:shrink-0">
          <Aside productIds={listing.productIds} collectionSlug={collectionSlug} />
        </aside>
      ) : null}
      <section className="flex flex-1 flex-col gap-4" aria-live="polite">
        <JsonLdScript json={jsonLd} />
        <form method="get" action={path} className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">{m.count(listing.total)}</p>
          <label className="flex items-center gap-2 text-sm">
            {m.sort}
            <Select name="sort" defaultValue={query.sort} className="h-9 w-auto">
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {m.sortOptions[s]}
                </option>
              ))}
            </Select>
            <button type="submit" className={buttonVariants({ variant: 'subtle', size: 'sm' })} data-cta="plants-sort-apply">
              {m.apply}
            </button>
          </label>
        </form>
        {listing.cards.length ? (
          <ProductGrid cards={listing.cards} cartEnabled={cartEnabled} messages={rt.messages} />
        ) : (
          <EmptyState
            title={m.empty}
            body={m.emptyBody}
            action={
              rt.registry?.has('planting') ? (
                <Link href="/plan" className={buttonVariants({ size: 'sm' })} data-cta="plants-empty-help">
                  {m.helpMeChoose}
                </Link>
              ) : undefined
            }
          />
        )}
        {listing.pages > 1 ? (
          <nav className="flex items-center justify-center gap-3 text-sm">
            {listing.page > 1 ? (
              <Link rel="prev" href={href(listing.page - 1)} className="underline" data-cta="plants-page-prev">
                {m.previous}
              </Link>
            ) : null}
            <span>{m.pageOf(listing.page, listing.pages)}</span>
            {listing.page < listing.pages ? (
              <Link rel="next" href={href(listing.page + 1)} className="underline" data-cta="plants-page-next">
                {m.next}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
