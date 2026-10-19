// Server-render the islands (react-dom/server, no DOM library): markup, counts, disabled options, chips,
// zero-results panel and the search box. Interaction (sheet apply, back/forward) is in apps/shop/e2e/wp-05.spec.ts;
// the state transitions they run are unit-tested in engine.test.ts and url-state.test.ts.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FACET_CONFIG, buildSearchIndex, computeView, loadIndex, parseUrlState, type SearchSourceRow } from '../src/domain';
import { searchMessages } from '../src/messages';
import { AppliedChips, FacetProvider, FacetResults, FacetSidebar, FilterSheet, QuickChips, ResultCount, SearchBox, SearchHitCard, SortSelect } from '../src/ui';

const row = (id: string, size: string, stock: string, price: number, model: string[] = []): SearchSourceRow => ({
  productId: id,
  slug: id,
  kind: 'plant',
  name: id,
  facets: { size: [size], stock: [stock], model },
  numeric: { price, bear: null, newest: null },
});
const rows = [row('p1', 'large', 'in', 20000, ['food_forest']), row('p2', 'large', 'out', 60000, ['miyawaki']), row('p3', 'medium', 'in', 15000, ['food_forest']), row('p4', 'small', 'in', 9000)];
const index = buildSearchIndex(rows, { facets: searchMessages.facets, values: searchMessages.values });
const ix = loadIndex(index);

function render(query: string, children: React.ReactNode) {
  const url = parseUrlState(new URLSearchParams(query), DEFAULT_FACET_CONFIG);
  const view = computeView(ix, DEFAULT_FACET_CONFIG, url.state, { sort: url.sort });
  return renderToString(
    <FacetProvider config={DEFAULT_FACET_CONFIG} url={url} view={view} scopeIds={null} extra={[]} defaultSort="recommended">
      {children}
    </FacetProvider>,
  );
}
const cards = Object.fromEntries(rows.map((r) => [r.productId, <SearchHitCard key={r.productId} hit={{ ...r, nameLocal: null, scientificName: null }} itemHref="/{kind}/{slug}" />]));

describe('FacetSidebar', () => {
  it('renders fieldsets with live counts; zero-count options disabled, not hidden', () => {
    const html = render('f=size:small', <FacetSidebar />);
    expect(html).toContain('<legend class="sr-only">Size</legend>');
    // stock=in (default) + size=small: food forest count is 0 -> disabled checkbox still rendered.
    expect(html).toMatch(/id="fs-model-food_forest"[^>]*disabled/);
    expect(html).toMatch(/Large tree<\/span><span class="text-muted tabular-nums">\(<!-- -->1<!-- -->\)/);
    expect(html).toMatch(/id="fs-size-small"[^>]*checked/);
    expect(html).toContain('placeholder="90"'); // price bounds in rupees
    expect(html).toContain('Rs 300 to Rs 1,000'); // money presets
  });
});

describe('AppliedChips, QuickChips, ResultCount, SortSelect', () => {
  it('lists applied filters with remove buttons and Clear all', () => {
    const html = render('f=price:-300;size:large', <AppliedChips />);
    expect(html).toContain('Large tree');
    expect(html).toContain('Price: Under Rs 300');
    expect(html).toContain('aria-label="Remove Large tree"');
    expect(html).toContain('data-cta="filter-clear-all"');
    expect(render('f=stock:', <AppliedChips />)).toBe('');
  });
  it('quick chips show only presets whose facets exist, with pressed state', () => {
    const html = render('f=model:food_forest', <QuickChips />);
    expect(html).toContain('For food forest');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-cta="quick-chip-food_forest"/);
    expect(html).not.toContain('Fits my district'); // no district facet supplied
  });
  it('announces the count politely and offers sorts', () => {
    expect(render('', <ResultCount />)).toContain('aria-live="polite"');
    expect(render('', <ResultCount />)).toContain('>3 results<');
    const sort = render('sort=price_asc', <SortSelect />);
    expect(sort).toContain('Price: low to high');
    expect(sort).not.toContain('Best match'); // relevance only on search
  });
});

describe('FacetResults and ZeroResults', () => {
  it('renders matching cards in sorted order', () => {
    const html = render('sort=price_asc', <FacetResults cards={cards} />);
    expect(html.indexOf('/plant/p4')).toBeLessThan(html.indexOf('/plant/p3'));
    expect(html).not.toContain('/plant/p2'); // out of stock, default filter
  });
  it('zero results: drop chips with counts, closest matches and the CTAs', () => {
    const html = render('f=model:food_forest;size:small', <FacetResults cards={cards} assistanceUrl="https://wa.me/910000000000" guidedHref="/guide" />);
    expect(html).toContain('No results match all 3 filters');
    expect(html).toContain('Remove Food forest: 1');
    expect(html).toContain('Closest matches');
    expect(html).toContain('href="https://wa.me/910000000000"');
    expect(html).toContain('href="/guide"');
  });
});

describe('FilterSheet', () => {
  it('renders the sticky Filter · Sort bar with the applied-count badge (sheet content mounts on open)', () => {
    const html = render('f=size:large', <FilterSheet />);
    expect(html).toContain('data-cta="filter-sheet-open"');
    expect(html).toMatch(/>2<\/span>/); // stock (default) + size
    expect(html).toContain('md:hidden');
  });
});

describe('SearchBox', () => {
  it('is a plain GET form with an ARIA combobox (works before hydration)', () => {
    const html = renderToString(<SearchBox defaultValue="mango" />);
    expect(html).toContain('role="search"');
    expect(html).toContain('action="/search"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="mango"');
  });
});
