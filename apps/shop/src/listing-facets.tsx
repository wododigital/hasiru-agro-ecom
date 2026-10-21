import type { ListingFacetsProps } from '@ecomkit/catalog/server';
import { listProducts } from '@ecomkit/catalog/server';
import { getSettings } from '@ecomkit/core/settings';
import { facetPageProps, getSearchIndex, searchSettings } from '@ecomkit/search/server';
import { AppliedChips, FacetProvider, FacetResults, FacetSidebar, FilterSheet, QuickChips, ResultCount, SortSelect } from '@ecomkit/search/ui';
import { searchMessages } from '@ecomkit/search/messages';
import { cookies } from 'next/headers';
import { registry } from './generated/registry';

type ExtraFacet = NonNullable<Parameters<typeof facetPageProps>[0]['extra']>[number];

/** "Fits my district": products whose climate is a good fit for the visitor's district cookie (places service). */
async function fitFacet(productIds: readonly string[]): Promise<ExtraFacet[]> {
  const district = (await cookies()).get('district')?.value;
  const places = district && /^[a-z0-9-]{2,60}$/.test(district) ? await registry.service('places') : null;
  if (!places || !district) return [];
  const { rows } = await listProducts({ ids: productIds });
  const fits = await Promise.all(rows.map(async (r) => (r.climate && (await places.fit(district, r.climate)).level === 'good' ? r.id : null)));
  const ids = fits.filter((id): id is string => id !== null);
  const label = searchMessages.facets.fit!;
  return ids.length ? [{ key: 'fit', label, values: { yes: { label, ids } } }] : [];
}

/**
 * Catalog listing body with the search module's filters: desktop sidebar, mobile filter sheet, applied chips, sort.
 * Filtering runs in the browser against /facets.json, with the URL as state (no reload); counts update per click.
 */
export async function ListingFacets({ productIds, cards, searchParams }: ListingFacetsProps) {
  const [index, settings, extra] = await Promise.all([getSearchIndex(), getSettings(searchSettings), fitFacet(productIds)]);
  const props = facetPageProps({ index, searchParams, scopeIds: productIds, extra });
  return (
    <FacetProvider {...props} messages={searchMessages}>
      <div className="flex flex-col gap-3">
        <QuickChips />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ResultCount />
          <SortSelect className="hidden md:flex" />
        </div>
        <AppliedChips />
        <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
          <FacetSidebar />
          <FacetResults cards={cards} assistanceUrl={settings.assistanceUrl} guidedHref={settings.guidedHref || '/plan'} gridClassName="grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" />
        </div>
        <FilterSheet />
      </div>
    </FacetProvider>
  );
}
