import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FACET_CONFIG,
  EMPTY_STATE,
  KNOWN,
  and,
  bitsFrom,
  buildSearchIndex,
  clearAll,
  computeView,
  decodeBits,
  encodeBits,
  fullBits,
  loadIndex,
  or,
  popcount,
  positions,
  presetActive,
  rainBuckets,
  removeChip,
  scopeBits,
  setRange,
  toggleValue,
  togglePreset,
  withExtraFacets,
  type FacetConfig,
  type FacetState,
  type SearchSourceRow,
} from '../src/domain';
import { searchMessages } from '../src/messages';

const labels = { facets: searchMessages.facets, values: searchMessages.values };

// Six products. size: a,b large; c,d medium; e small; f unknown. stock: a,c,e in; b,d out; f in.
function row(id: string, facets: Record<string, string[]>, price: number | null = null, bear: number | null = null): SearchSourceRow {
  return { productId: id, slug: id, kind: 'plant', name: id.toUpperCase(), facets, numeric: { price, bear, newest: null } };
}
const rows: SearchSourceRow[] = [
  row('a', { kind: ['plant'], size: ['large'], stock: ['in'], model: ['food_forest', 'miyawaki'], drought: ['high'] }, 20000, 3),
  row('b', { kind: ['plant'], size: ['large'], stock: ['out'], model: ['commercial'], drought: ['low'] }, 50000, 6),
  row('c', { kind: ['plant'], size: ['medium'], stock: ['in'], model: ['food_forest'], drought: ['high'] }, 15000, 1),
  row('d', { kind: ['plant'], size: ['medium'], stock: ['out'], model: [], drought: ['moderate'] }, 120000, null),
  row('e', { kind: ['plant'], size: ['small'], stock: ['in'], model: ['miyawaki'], drought: ['high'] }, 8000, 2),
  row('f', { kind: ['plant'], stock: ['in'] }, null, null),
];
const index = buildSearchIndex(rows, labels, new Date('2026-10-20T04:30:00Z'));
const ix = loadIndex(index);
const cfg = DEFAULT_FACET_CONFIG;
const state = (values: Record<string, string[]>, ranges: FacetState['ranges'] = {}): FacetState => ({ values, ranges });
const ids = (s: FacetState, opts = {}) => computeView(ix, cfg, s, opts).ids;

describe('bitsets', () => {
  it('round-trips through base64 and does word ops', () => {
    for (const n of [1, 7, 31, 32, 33, 350]) {
      const pos = Array.from({ length: n }, (_, i) => i).filter((i) => i % 3 === 0 || i === n - 1);
      const b = bitsFrom(n, pos);
      expect(positions(decodeBits(encodeBits(b, n), n))).toEqual(pos);
      expect(popcount(fullBits(n))).toBe(n);
    }
    const a = bitsFrom(70, [0, 5, 40, 69]);
    const b = bitsFrom(70, [5, 41, 69]);
    expect(positions(and(a, b))).toEqual([5, 69]);
    expect(positions(or(a, b))).toEqual([0, 5, 40, 41, 69]);
  });
});

describe('index build', () => {
  it('keeps the frozen FacetIndex shape, labels from messages and a _known marker only where needed', () => {
    expect(index.version).toBe(1);
    expect(index.ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(index.facets.size!.label).toBe('Size');
    expect(index.facets.size!.values.large!.label).toBe('Large tree');
    // d has model [] (known, no value): model needs the marker; size does not.
    expect(index.facets.model!.values[KNOWN]).toBeDefined();
    expect(index.facets.size!.values[KNOWN]).toBeUndefined();
    expect(Object.keys(index.facets.size!.values)).toEqual(['large', 'medium', 'small']); // label order, not alphabetical
    expect(index.numeric.price).toEqual([20000, 50000, 15000, 120000, 8000, null]);
  });
});

describe('matching: OR within a facet, AND across facets', () => {
  it('OR within', () => {
    expect(ids(state({ size: ['large', 'small'] }))).toEqual(['a', 'e', 'b']); // recommended: in stock first
  });
  it('AND across', () => {
    expect(ids(state({ size: ['large', 'medium'], stock: ['in'] }))).toEqual(['a', 'c']);
    expect(ids(state({ model: ['food_forest'], size: ['medium'] }))).toEqual(['c']);
  });
  it('multi-valued products match any of their values', () => {
    expect(ids(state({ model: ['miyawaki'] }))).toEqual(['a', 'e']);
  });
  it('price range in URL units (rupees) against paise, nulls excluded', () => {
    expect(ids(state({}, { price: { min: 100, max: 500 } }))).toEqual(['a', 'c', 'b']);
    expect(ids(state({}, { price: { min: null, max: 100 } }))).toEqual(['e']);
  });
  it('unknown facet keys in the state are ignored, unknown values match nothing', () => {
    expect(ids(state({ nosuch: ['x'] }))).toHaveLength(6);
    expect(ids(state({ size: ['huge'] }))).toEqual([]);
  });
});

describe('counts (disjunctive)', () => {
  it('counts each option against the other active facets, not its own', () => {
    const v = computeView(ix, cfg, state({ size: ['large'], stock: ['in'] }));
    const size = v.groups.find((g) => g.key === 'size')!;
    // stock=in applies; own facet (size) does not: large a, medium c, small e.
    expect(Object.fromEntries(size.values.map((x) => [x.value, x.count]))).toEqual({ large: 1, medium: 1, small: 1 });
    const stock = v.groups.find((g) => g.key === 'stock')!;
    expect(stock.values).toEqual([{ value: 'in', label: 'In stock', count: 1, selected: true }]); // toggle shows its value only
    expect(v.total).toBe(1);
  });
  it('zero-count options are reported (UI disables them) not dropped', () => {
    const v = computeView(ix, cfg, state({ model: ['commercial'] }));
    const size = v.groups.find((g) => g.key === 'size')!;
    expect(size.values.find((x) => x.value === 'small')!.count).toBe(0);
  });
});

describe('auto-hide rule', () => {
  it('hides a facet with fewer than 2 values in scope', () => {
    const v = computeView(ix, cfg, EMPTY_STATE);
    expect(v.groups.map((g) => g.key)).not.toContain('kind'); // every product is a plant
    expect(v.groups.map((g) => g.key)).toContain('size');
  });
  it('hides a facet when more than 60% of the scope is unknown, unless it is active', () => {
    const few = [...rows.slice(0, 2), ...['g', 'h', 'i', 'j'].map((id) => row(id, { kind: ['plant'], stock: ['in'] }))];
    const ix2 = loadIndex(buildSearchIndex(few, labels));
    expect(computeView(ix2, cfg, EMPTY_STATE).groups.map((g) => g.key)).not.toContain('size'); // 2 of 6 known
    expect(computeView(ix2, cfg, state({ size: ['large'] })).groups.map((g) => g.key)).toContain('size');
  });
  it('a toggle needs both sides present in scope', () => {
    const scope = scopeBits(ix, ['a', 'c', 'e']); // all drought high, all in stock
    const keys = computeView(ix, cfg, EMPTY_STATE, { scope }).groups.map((g) => g.key);
    expect(keys).not.toContain('drought');
    expect(keys).not.toContain('stock');
    expect(computeView(ix, cfg, EMPTY_STATE).groups.map((g) => g.key)).toEqual(expect.arrayContaining(['drought', 'stock']));
  });
  it('range facet hides when values are too sparse', () => {
    expect(computeView(ix, cfg, EMPTY_STATE).ranges.map((r) => r.key)).toEqual(['price']);
    expect(computeView(ix, cfg, EMPTY_STATE, { scope: scopeBits(ix, ['f', 'a']) }).ranges).toEqual([]);
  });
});

describe('sorting and scope', () => {
  it('sorts by price both ways with nulls last, by bearing, and by relevance order', () => {
    expect(ids(EMPTY_STATE, { sort: 'price_asc' })).toEqual(['e', 'c', 'a', 'b', 'd', 'f']);
    expect(ids(EMPTY_STATE, { sort: 'price_desc' })).toEqual(['d', 'b', 'a', 'c', 'e', 'f']);
    expect(ids(EMPTY_STATE, { sort: 'bearing' })).toEqual(['c', 'e', 'a', 'b', 'd', 'f']);
    const order = ['e', 'b', 'a'];
    expect(ids(EMPTY_STATE, { sort: 'relevance', order, scope: scopeBits(ix, order) })).toEqual(['e', 'b', 'a']);
  });
});

describe('zero results', () => {
  it('reports what removing each filter yields and relaxes least-important filters for closest matches', () => {
    const s = state({ size: ['small'], model: ['commercial'] });
    const v = computeView(ix, cfg, s);
    expect(v.total).toBe(0);
    expect(v.drops.map((d) => [d.chip.kind === 'value' ? d.chip.value : d.chip.key, d.count])).toEqual([
      ['commercial', 1], // removing model:commercial leaves small -> e
      ['small', 1], // removing size:small leaves commercial -> b
    ]);
    // size (priority 4) is less important than model (3): relaxed first.
    expect(v.closest).toEqual({ relaxed: ['size'], ids: ['b'] });
  });
  it('prefers dropping one filter, relaxes several only when no single drop helps', () => {
    // in stock + large + commercial: only b is commercial and it is out of stock -> dropping stock alone finds b.
    expect(computeView(ix, cfg, state({ stock: ['in'], size: ['large'], model: ['commercial'] })).closest).toEqual({ relaxed: ['stock'], ids: ['b'] });
    // small + commercial + drought high: dropping drought (least important) or size still gives 0; dropping purpose finds e.
    expect(computeView(ix, cfg, state({ size: ['small'], model: ['commercial'], drought: ['high'] })).closest).toEqual({ relaxed: ['model'], ids: ['e'] });
    // Cumulative relaxation when no single drop helps: size small + purpose commercial + price over Rs 1,000.
    const v = computeView(ix, cfg, state({ size: ['small'], model: ['commercial'] }, { price: { min: 1000, max: null } }));
    expect(v.drops.every((d) => d.count === 0)).toBe(true);
    expect(v.closest).toEqual({ relaxed: ['price', 'size'], ids: ['b'] });
  });
});

describe('extra facets (request-time, e.g. fits my district)', () => {
  it('merges an id-set facet that filters and counts like any other', () => {
    const ix2 = withExtraFacets(ix, [{ key: 'fit', label: 'Fits my district', values: { yes: { label: 'Fits', ids: ['a', 'c'] } } }]);
    const v = computeView(ix2, cfg, state({ fit: ['yes'] }));
    expect(v.ids).toEqual(['a', 'c']);
    expect(v.groups[0]!.key).toBe('fit');
  });
});

describe('state transitions (sidebar, sheet draft, chips, presets)', () => {
  it('toggle, range, chip removal and clear all', () => {
    let s = toggleValue(EMPTY_STATE, 'size', 'large');
    s = toggleValue(s, 'size', 'small');
    s = toggleValue(s, 'size', 'large');
    expect(s.values.size).toEqual(['small']);
    s = setRange(s, 'price', { min: 10, max: null });
    expect(s.ranges.price).toEqual({ min: 10, max: null });
    s = removeChip(s, { kind: 'range', key: 'price', min: 10, max: null });
    expect(s.ranges).toEqual({});
    const cleared = clearAll(cfg);
    expect(cleared.values.stock).toEqual([]); // explicit off beats the in-stock default
  });
  it('quick presets toggle on and off without clobbering other choices', () => {
    const preset = cfg.presets.find((p) => p.id === 'under_300')!;
    const on = togglePreset(state({ size: ['large'] }), preset);
    expect(presetActive(on, preset)).toBe(true);
    expect(on.values.size).toEqual(['large']);
    const off = togglePreset(on, preset);
    expect(presetActive(off, preset)).toBe(false);
    expect(off.ranges).toEqual({});
  });
});

describe('facet value derivation', () => {
  it('rainfall buckets match by overlap', () => {
    expect(rainBuckets(800, 1600)).toEqual(['600-1000', '1000-1500', '1500-2500']);
    expect(rainBuckets(null, 500)).toEqual(['lt600']);
    expect(rainBuckets(null, null)).toEqual([]);
  });
  it('a custom config can drop facets', () => {
    const only: FacetConfig = { ...cfg, facets: cfg.facets.filter((f) => f.key === 'size') };
    expect(computeView(ix, only, EMPTY_STATE).groups.map((g) => g.key)).toEqual(['size']);
  });
});
