import { describe, expect, it } from 'vitest';
import { DEFAULT_FACET_CONFIG as cfg, clearAll, defaultState, parseUrlState, serializeUrlState, type FacetState } from '../src/domain';

const s = (values: Record<string, string[]>, ranges: FacetState['ranges'] = {}): FacetState => ({ values: { ...defaultState(cfg).values, ...values }, ranges });

describe('URL state', () => {
  it('writes the fixed param order q, f, sort, page with sorted keys and values', () => {
    const qs = serializeUrlState({ q: 'mango tree', state: s({ size: ['medium', 'large'], model: ['miyawaki'] }, { price: { min: 100, max: 500 } }), sort: 'price_asc', page: 3 }, cfg);
    expect(qs).toBe('q=mango%20tree&f=model:miyawaki;price:100-500;size:large,medium&sort=price_asc&page=3');
  });

  it('omits defaults: in stock on, recommended sort, page 1', () => {
    expect(serializeUrlState({ state: defaultState(cfg), sort: 'recommended', page: 1 }, cfg)).toBe('');
    // In stock switched off is written explicitly as an empty value.
    expect(serializeUrlState({ state: s({ stock: [] }) }, cfg)).toBe('f=stock:');
    expect(serializeUrlState({ state: clearAll(cfg) }, cfg)).toBe('f=stock:');
  });

  it('round-trips', () => {
    const state = s({ size: ['large'], drought: ['high'], stock: [] }, { price: { min: null, max: 300 } });
    const qs = serializeUrlState({ q: 'teak', state, sort: 'newest', page: 2 }, cfg);
    const back = parseUrlState(new URLSearchParams(qs), cfg);
    expect(back).toEqual({ q: 'teak', state: { values: { ...state.values }, ranges: { price: { min: null, max: 300 } } }, sort: 'newest', page: 2 });
    expect(serializeUrlState(back, cfg)).toBe(qs);
  });

  it('parses Next searchParams objects (arrays take the first value)', () => {
    const u = parseUrlState({ f: ['size:small', 'size:large'], sort: 'bearing' }, cfg);
    expect(u.state.values.size).toEqual(['small']);
    expect(u.sort).toBe('bearing');
  });

  it('drops junk instead of throwing (untrusted input)', () => {
    const u = parseUrlState(new URLSearchParams('f=size:LARGE,large,<script>;nosuch:x;price:abc;drought:low;:x;stock&sort=evil&page=-4&q=' + 'x'.repeat(200)), cfg);
    expect(u.state.values.size).toEqual(['large']);
    expect(u.state.values.nosuch).toBeUndefined();
    expect(u.state.values.drought).toEqual([]); // toggle facet accepts only its toggle value
    expect(u.state.values.stock).toEqual(['in']); // malformed part ignored, default kept
    expect(u.state.ranges).toEqual({});
    expect(u.sort).toBe('recommended');
    expect(u.page).toBe(1);
    expect(u.q).toBe('');
  });

  it('normalises an inverted range and keeps open ends', () => {
    expect(parseUrlState(new URLSearchParams('f=price:900-100'), cfg).state.ranges.price).toEqual({ min: 100, max: 900 });
    expect(parseUrlState(new URLSearchParams('f=price:250-'), cfg).state.ranges.price).toEqual({ min: 250, max: null });
  });

  it('uses the page default sort (relevance on search) and omits it from the URL', () => {
    const u = parseUrlState(new URLSearchParams('q=neem'), cfg, 'relevance');
    expect(u.sort).toBe('relevance');
    expect(serializeUrlState(u, cfg, 'relevance')).toBe('q=neem');
  });
});
