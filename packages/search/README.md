# @ecomkit/search

Search and faceted filtering for small catalogues (under ~500 products). `/search` runs trigram `ILIKE` in Postgres. Listings filter in the browser against a static facet index of bitsets, `/facets.json`, so filter clicks make no network round trip. The typeahead runs against the same index.

## Responsibility
- Text search over a product's name, local-language name, scientific name and aliases. It reads `catalog_product.search_aliases`, so English, Kannada, scientific and romanised aliases all match. There is no separate document or synonym table.
- Builds the facet index from the catalog. Facets are size, purpose (model), rainfall, temperature, drought, water need, propagation, nitrogen fixer, sunlight, bearing time, tags, stock and price. Labels come from `messages.ts`.
- The engine combines selections with OR within a facet and AND across facets. Counts are disjunctive.
- Auto-hide rule: a facet is hidden when the current scope has fewer than 2 values for it, or more than 60% of the scope is unknown for it. A toggle facet is hidden when its value covers none or all of the known products. An active facet is never hidden.
- Zero results never leave the visitor stuck. The page shows chips that each drop one filter, with the count that drop would give. It then shows the closest matches: first the least important single filter that, dropped alone, gives results; failing that, filters relaxed one after another, least important first. Assistance and guided-choice links follow, and each empty combination is logged.
- URL state uses a fixed parameter order: `q, f, sort, page`. All filters live in one readable `f` parameter, for example `f=model:food_forest,miyawaki;price:-300;size:large`.
  - Keys and values are sorted.
  - Default values are left out (in stock on, recommended sort, page 1).
  - `key:` with nothing after it means "explicitly off" for a facet that is on by default.
  - Facet toggles push a history entry. Range typing and "Show more" replace the current entry.
  - Back and forward restore the selection.
- Query log and the Search insights admin page: top searches, searches with no results, and filter combinations with no results.

Not built: a yield facet (`yield_text` is free text with no buckets), plus "Bulk deals" and "Rating 4+" quick chips (tier and review data are not in the index).

## Public API
| Export | What |
|---|---|
| `./domain` | `buildSearchIndex`, `loadIndex`, `withExtraFacets`, `computeView`, `matchBits`, state transitions (`toggleValue`, `setRange`, `removeChip`, `clearAll`, `togglePreset`), `parseUrlState` / `serializeUrlState` / `encodeFilters`, `prepareSuggest` / `suggest`, `facetValuesFromProduct`, `DEFAULT_FACET_CONFIG`, bitset helpers, `fmt`, `itemHref` |
| `./server` | `searchProducts(db, q)`, `loadSearchSource(db)`, `buildIndexFromDb(db)`, `getSearchIndex()` (`'use cache'`, tag `catalog`), `prepared(index)`, `facetPageProps({ index, searchParams, scopeIds?, extra?, config?, defaultSort? })`, `logSearch`, `queryStats`, `zeroFilterStats`, handler factories `suggestHandler`, `facetsHandler`, `logHandler`, `searchSettings` |
| `./ui` | `FacetProvider` (spread `facetPageProps()` into it), `FacetSidebar`, `FilterSheet`, `AppliedChips`, `QuickChips`, `ResultCount`, `SortSelect`, `FacetResults` (takes `cards: Record<productId, ReactNode>`), `ZeroResults`, `ZeroCtas`, `SearchBox`, `SearchHitCard`, `useFacets` |
| `./messages` | `searchMessages` (brand-neutral; templates use `{name}` placeholders so they can be passed to client islands) |
| `./admin` | `InsightsPage` |

### Using it on a listing (catalog collection pages)
```tsx
const index = await getSearchIndex();
const props = facetPageProps({ index, searchParams: await searchParams, scopeIds: collectionProductIds, extra: fitFacet ? [fitFacet] : [] });
return (
  <FacetProvider {...props} messages={hostMessages}>
    <QuickChips /> <AppliedChips /> <ResultCount /> <SortSelect />
    <FacetSidebar /> <FacetResults cards={cardsById} assistanceUrl={...} guidedHref="/plan" /> <FilterSheet />
  </FacetProvider>
);
```
The server computes the first view, so the HTML is complete and the counts are correct before any JavaScript runs. `/facets.json` loads on the first sign of intent: pointer over the sidebar, focus, or opening the sheet. After that, every change is computed locally inside a `startTransition`.

The "Fits my district" facet is an extra facet supplied at request time: `{ key: 'fit', label, values: { yes: { label, ids } } }`. The host computes `ids` with the places service for the visitor's district. When no extra facet is supplied, the facet and its quick chip are not shown.

## Tables
- `search_query_log(id bigserial, q, results, filters jsonb {f}, session_id, created_at)`, index `(results, created_at)`. Queries are stored normalised, with no personal data.
- `sql/trgm.sql` is hand-written DDL. It creates the immutable function `search_haystack(name, name_kn, scientific_name, aliases)` and one trgm GIN expression index on `catalog_product`.

## Routes
| Path | Kind | Module |
|---|---|---|
| `/search` | page (noindex) | `routes/search-page` |
| `/api/search/suggest?q=` | GET | `routes/suggest` |
| `/api/search/log` | POST, rate limited 30/min per IP hash | `routes/log` |
| `/facets.json` | GET, ETag + 304, `max-age=300, stale-while-revalidate=86400` | `routes/facets` |
| `/admin/search` | admin page (`analytics.read`) | `routes/admin-insights` |

## Settings (`/admin/settings/search`)
| Setting | What it does |
|---|---|
| `assistanceUrl` | https chat link, e.g. WhatsApp click-to-chat |
| `guidedHref` | store path of a guided chooser, e.g. `/plan` |
| `logQueries` | turns query logging on or off |

Leaving `assistanceUrl` or `guidedHref` empty hides that CTA.

## Events and jobs
None are emitted or consumed. The index is cached under the `catalog` tag, so any product save expires it.

## Migration notes
After `catalog_product` exists, copy `sql/trgm.sql` into a `drizzle-kit generate --custom --name search_trgm` migration. The SQL is idempotent.

## Performance (tests, 350 synthetic products)
- `/facets.json`: 63 KB raw, 16.6 KB gzip. The budget is 40 KB.
- Suggest through the HTTP handler, 200 queries: p95 about 2 ms alone and 9 ms with the full suite running in parallel. The budget is 80 ms.
- `pnpm -F @ecomkit/search bench` runs the Vitest benchmark: mean 1.35 ms per query, p99 1.9 ms.

## How to disable
Remove `search` from the app's module list. Listings then render without filters, and nothing else depends on this module.
