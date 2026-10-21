import { tags } from '@ecomkit/core/cache-tags';
import { db, type DbOrTx } from '@ecomkit/core/db';
import { cacheLife, cacheTag } from 'next/cache';
import { buildSearchIndex, type SearchIndex } from '../domain/build-index';
import { computeView, loadIndex, scopeBits, withExtraFacets, type ExtraFacet, type FacetView, type LoadedIndex } from '../domain/engine';
import { DEFAULT_FACET_CONFIG, type FacetConfig, type SortKey } from '../domain/facets';
import { prepareSuggest, type SuggestIndex } from '../domain/suggest';
import { parseUrlState, type UrlState } from '../domain/url-state';
import { searchMessages, type SearchMessages } from '../messages';
import { loadSearchSource } from './source';

/** Builds the index from the database (uncached). Labels come from messages; tag labels from catalog_tag. */
export async function buildIndexFromDb(dbOrTx: DbOrTx, messages: SearchMessages = searchMessages, now?: Date): Promise<SearchIndex> {
  const { rows, tagLabels, labels } = await loadSearchSource(dbOrTx);
  return buildSearchIndex(rows, { facets: messages.facets, values: { ...messages.values, ...labels, tag: tagLabels } }, now);
}

/** The cached index (tag `catalog`: any product save expires it). */
export async function getSearchIndex(): Promise<SearchIndex> {
  'use cache';
  cacheTag(tags.catalog);
  cacheLife('hours');
  return buildIndexFromDb(db);
}

let memo: { key: string; loaded: LoadedIndex; suggest: SuggestIndex } | null = null;

/** Decoded bitsets and suggest trigrams, memoised per index build (the cache hands back fresh objects). */
export function prepared(index: SearchIndex): { loaded: LoadedIndex; suggest: SuggestIndex } {
  const key = `${index.generatedAt}:${index.ids.length}`;
  if (memo?.key !== key) memo = { key, loaded: loadIndex(index), suggest: prepareSuggest(index.ids, index.docs) };
  return memo;
}

export interface FacetPageInput {
  index: SearchIndex;
  searchParams: URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;
  config?: FacetConfig;
  /** Listing scope (a collection's product ids, or search hits in relevance order). Omit for the whole catalog. */
  scopeIds?: readonly string[] | null;
  /** Request-time facets, e.g. "fits my district" from the places service. */
  extra?: readonly ExtraFacet[];
  defaultSort?: SortKey;
}

export interface FacetPageProps {
  config: FacetConfig;
  url: UrlState;
  view: FacetView;
  scopeIds: readonly string[] | null;
  extra: readonly ExtraFacet[];
  defaultSort: SortKey;
}

/**
 * Server half of a faceted listing: parse the URL, compute the first view (counts, chips, sorted ids)
 * so the page is complete HTML before the browser fetches /facets.json. Spread the result into
 * `<FacetProvider>`.
 */
export function facetPageProps(input: FacetPageInput): FacetPageProps {
  const config = input.config ?? DEFAULT_FACET_CONFIG;
  const defaultSort = input.defaultSort ?? 'recommended';
  const extra = input.extra ?? [];
  const ix = withExtraFacets(prepared(input.index).loaded, extra);
  const url = parseUrlState(input.searchParams, config, defaultSort);
  const scopeIds = input.scopeIds ?? null;
  const view = computeView(ix, config, url.state, { scope: scopeBits(ix, scopeIds), sort: url.sort, order: scopeIds ?? undefined });
  return { config, url, view, scopeIds, extra, defaultSort };
}
