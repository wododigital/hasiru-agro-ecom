import { describe, expect, it } from 'vitest';
import { barRects, clampQty, decrementQty, incrementQty, nextSort, pageCount, parseQty, parseTableParams, showQuickChips, sparkPoints, stepFor, tableQuery } from '../src/domain';

describe('qty rules', () => {
  it('steps by 1 below 100 and by 10 from 100', () => {
    expect(stepFor(99)).toBe(1);
    expect(stepFor(100)).toBe(10);
    expect(incrementQty(99)).toBe(100);
    expect(incrementQty(100)).toBe(110);
    expect(decrementQty(100)).toBe(90);
    expect(decrementQty(90)).toBe(89);
  });
  it('never goes below 0 and respects max', () => {
    expect(decrementQty(0)).toBe(0);
    expect(clampQty(-5)).toBe(0);
    expect(clampQty(-5, { min: -10 })).toBe(0);
    expect(incrementQty(5, { max: 5 })).toBe(5);
    expect(clampQty(Number.NaN)).toBe(0);
    expect(clampQty(3.7)).toBe(3);
  });
  it('shows +10 / +50 chips from 10', () => {
    expect(showQuickChips(9)).toBe(false);
    expect(showQuickChips(10)).toBe(true);
  });
  it('parses typed text; rejects non-digits', () => {
    expect(parseQty('1,250')).toBe(1250);
    expect(parseQty(' 40 ')).toBe(40);
    expect(parseQty('-3')).toBeNull();
    expect(parseQty('2.5')).toBeNull();
    expect(parseQty('')).toBeNull();
    expect(parseQty('abc')).toBeNull();
    expect(parseQty('900', { max: 500 })).toBe(500);
  });
});

describe('table params', () => {
  const spec = { filters: { status: ['paid', 'pending'] }, sorts: ['total', 'id'], defaultSort: { id: 'id', dir: 'desc' as const } };

  it('parses and validates every param', () => {
    const p = parseTableParams({ q: '  mango ', status: 'paid', sort: 'total', dir: 'asc', page: '3' }, spec);
    expect(p).toEqual({ q: 'mango', filters: { status: 'paid' }, sort: 'total', dir: 'asc', page: 3 });
  });
  it('drops unknown values and falls back to defaults', () => {
    const p = parseTableParams(new URLSearchParams('status=hacked&sort=password&dir=sideways&page=-2'), spec);
    expect(p).toEqual({ q: '', filters: {}, sort: 'id', dir: 'desc', page: 1 });
    expect(parseTableParams({ page: ['4', '9'] }, spec).page).toBe(4);
    expect(parseTableParams({ page: 'x' }).page).toBe(1);
  });
  it('builds stable query strings and resets page when the result set changes', () => {
    const p = parseTableParams({ q: 'teak', status: 'paid', sort: 'total', dir: 'asc', page: '3' }, spec);
    expect(tableQuery(p)).toBe('?q=teak&status=paid&sort=total&dir=asc&page=3');
    expect(tableQuery(p, { page: 4 })).toBe('?q=teak&status=paid&sort=total&dir=asc&page=4');
    expect(tableQuery(p, { q: 'neem' })).toBe('?q=neem&status=paid&sort=total&dir=asc');
    expect(tableQuery(p, { filters: { status: null } })).toBe('?q=teak&sort=total&dir=asc');
    expect(tableQuery(parseTableParams({}))).toBe('');
  });
  it('toggles sort direction on the same column', () => {
    const p = parseTableParams({ sort: 'total', dir: 'asc' }, spec);
    expect(nextSort(p, 'total')).toEqual({ sort: 'total', dir: 'desc' });
    expect(nextSort(p, 'id')).toEqual({ sort: 'id', dir: 'asc' });
  });
  it('counts pages', () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(101, 50)).toBe(3);
  });
});

describe('chart geometry', () => {
  it('maps values into the box, min at the bottom', () => {
    expect(sparkPoints([0, 10], { width: 100, height: 20, pad: 0 })).toBe('0,20 100,0');
    expect(sparkPoints([], { width: 10, height: 10 })).toBe('');
    expect(sparkPoints([5], { width: 10, height: 10, pad: 0 }).split(' ')).toHaveLength(2);
  });
  it('draws bars from a zero baseline', () => {
    const bars = barRects([0, 5, 10], { width: 30, height: 10 }, 0);
    expect(bars.map((b) => b.height)).toEqual([0, 5, 10]);
    expect(bars[2]).toMatchObject({ x: 20, y: 0, width: 10 });
    expect(barRects([-3], { width: 10, height: 10 })[0]!.height).toBe(0);
  });
});
