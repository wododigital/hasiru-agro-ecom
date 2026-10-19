/**
 * Static facet index served at /facets.json (built by `@ecomkit/search` from `catalog.facetSource()`).
 * `bits` is a base64 bitset over `ids` (bit i = product ids[i] has the value).
 */
export interface FacetIndex {
  version: 1;
  generatedAt: string;
  ids: readonly string[];
  facets: Readonly<Record<string, { label: string; values: Readonly<Record<string, { label: string; bits: string }>> }>>;
  /** Numeric columns aligned with `ids` (price in paise, height, bearing years...). */
  numeric: Readonly<Record<string, readonly (number | null)[]>>;
}

/** One row per product from `catalog.facetSource()`. */
export interface FacetSourceRow {
  productId: string;
  facets: Readonly<Record<string, readonly string[]>>;
  numeric: Readonly<Record<string, number | null>>;
}
