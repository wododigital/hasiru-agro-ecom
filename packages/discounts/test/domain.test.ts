import { describe, expect, it } from 'vitest';
import type { Paise, TotalsInput } from '@ecomkit/core/contracts';
import { computeTotals } from '@ecomkit/core/totals';
import {
  allocate,
  evaluate,
  generateCodes,
  istLocalToDate,
  normaliseCode,
  ruleFormSchema,
  selectPromos,
  targetLines,
  toIstLocal,
  windowState,
  type DiscountCart,
  type DiscountRule,
} from '../src/domain';

const NOW = new Date('2026-10-20T10:00:00+05:30');
const rule = (patch: Partial<DiscountRule> = {}): DiscountRule => ({
  id: patch.id ?? 'r1', name: 'Season offer', kind: 'automatic', status: 'active', startsAt: null, endsAt: null, valueType: 'percent', value: 10,
  appliesTo: 'order', targetIds: [], minQty: null, minSubtotalPaise: null, customerEligibility: 'all', segmentId: null, usageLimitTotal: null,
  usageLimitPerCustomer: null, stackable: false, priority: 0, descriptionPublic: null, ...patch,
});
// Mango at bulk tier (A8: tiers first): list 490, tier 355 x 60; compost 250 x 4.
const cart: DiscountCart = {
  lines: [
    { lineId: 'mango', productId: 'p-mango', qty: 60, unitPaise: 35_500, collectionIds: ['c-fruit'], tagIds: ['t-desi'] },
    { lineId: 'compost', productId: 'p-compost', qty: 4, unitPaise: 25_000, collectionIds: ['c-inputs'] },
  ],
  customer: { isFirstOrder: true, segmentIds: ['bulk_buyer'] },
};
const totalsInput = (promos: TotalsInput['automaticPromos'], coupon: TotalsInput['coupon']): TotalsInput => ({
  lines: [
    { lineId: 'mango', productId: 'p-mango', variantId: 'v-mango', qty: 60, listUnitPaise: 49_000 as Paise, tierUnitPaise: 35_500 as Paise, gstRatePct: 0, weightKg: 3 },
    { lineId: 'compost', productId: 'p-compost', variantId: 'v-compost', qty: 4, listUnitPaise: 25_000 as Paise, tierUnitPaise: 25_000 as Paise, gstRatePct: 5, weightKg: 25 },
  ],
  automaticPromos: promos,
  coupon,
  packingPaise: 0 as Paise,
  transportPaise: 0 as Paise,
  interState: false,
});
const MANGO_VALUE = 60 * 35_500;
const ORDER_VALUE = MANGO_VALUE + 4 * 25_000;

describe('IST date windows', () => {
  it('admin datetime-local values are India time', () => {
    expect(istLocalToDate('2026-10-31T23:59')!.toISOString()).toBe('2026-10-31T18:29:00.000Z');
    expect(istLocalToDate('')).toBeNull();
    expect(Number.isNaN(istLocalToDate('31/10/2026')!.getTime())).toBe(true);
    expect(toIstLocal(new Date('2026-10-31T18:29:00Z'))).toBe('2026-10-31T23:59');
    expect(toIstLocal(new Date('2026-10-19T18:30:00Z'))).toBe('2026-10-20T00:00');
  });

  it('starts inclusive and ends exclusive, on IST midnights (not UTC dates)', () => {
    const r = rule({ startsAt: istLocalToDate('2026-10-20T00:00'), endsAt: istLocalToDate('2026-11-01T00:00') });
    expect(windowState(r, new Date('2026-10-19T23:59:59+05:30'))).toBe('not_started');
    // 00:10 IST on the 20th is still the 19th in UTC: the promo must already be live.
    expect(windowState(r, new Date('2026-10-20T00:10:00+05:30'))).toBe('live');
    expect(windowState(r, new Date('2026-10-31T23:59:59+05:30'))).toBe('live');
    expect(windowState(r, new Date('2026-11-01T00:00:00+05:30'))).toBe('ended');
    expect(windowState({ ...r, status: 'paused' }, NOW)).toBe('inactive');
    expect(windowState({ ...r, status: 'draft' }, NOW)).toBe('inactive');
  });
});

describe('eligibility and amounts', () => {
  it('targets order, products, collections and tags', () => {
    expect(targetLines(rule(), cart.lines).map((l) => l.lineId)).toEqual(['mango', 'compost']);
    expect(targetLines(rule({ appliesTo: 'products', targetIds: ['p-compost'] }), cart.lines).map((l) => l.lineId)).toEqual(['compost']);
    expect(targetLines(rule({ appliesTo: 'collection', targetIds: ['c-fruit'] }), cart.lines).map((l) => l.lineId)).toEqual(['mango']);
    expect(targetLines(rule({ appliesTo: 'tags', targetIds: ['t-desi'] }), cart.lines).map((l) => l.lineId)).toEqual(['mango']);
  });

  it('percent applies to the bulk-tier value of matching lines', () => {
    const e = evaluate(rule({ appliesTo: 'collection', targetIds: ['c-fruit'] }), cart, NOW);
    expect(e).toMatchObject({ ok: true, amountPaise: MANGO_VALUE / 10, discount: { kind: 'automatic', label: 'Season offer', allocations: [{ lineId: 'mango', amountPaise: MANGO_VALUE / 10 }] } });
  });

  it('fixed amounts split by line value and never exceed what the lines hold', () => {
    const e = evaluate(rule({ valueType: 'fixed', value: 10_001 }), cart, NOW);
    expect(e.ok && e.amountPaise).toBe(10_001);
    expect(e.ok && e.discount.allocations.reduce((s, a) => s + a.amountPaise, 0)).toBe(10_001);
    expect(allocate(1_000_000, [{ lineId: 'a', valuePaise: 300 }, { lineId: 'b', valuePaise: 700 }])).toEqual([{ lineId: 'a', amountPaise: 300 }, { lineId: 'b', amountPaise: 700 }]);
    expect(allocate(100, [{ lineId: 'a', valuePaise: 1 }, { lineId: 'b', valuePaise: 1 }, { lineId: 'c', valuePaise: 1 }]).map((a) => a.amountPaise).sort()).toEqual([1, 1, 1]);
    expect(allocate(2, [{ lineId: 'a', valuePaise: 1 }, { lineId: 'b', valuePaise: 1 }, { lineId: 'c', valuePaise: 1 }]).length).toBe(2);
  });

  it('minimum quantity and spend report what is missing', () => {
    expect(evaluate(rule({ minQty: 100 }), cart, NOW)).toEqual({ ok: false, reason: 'min_qty', shortBy: 36 });
    expect(evaluate(rule({ minSubtotalPaise: ORDER_VALUE + 1 }), cart, NOW)).toEqual({ ok: false, reason: 'min_subtotal', shortBy: 1 });
    expect(evaluate(rule({ minSubtotalPaise: ORDER_VALUE }), cart, NOW).ok).toBe(true);
    expect(evaluate(rule({ appliesTo: 'products', targetIds: ['nope'] }), cart, NOW)).toEqual({ ok: false, reason: 'no_matching_items' });
  });

  it('customer eligibility: first order, segment, guests', () => {
    expect(evaluate(rule({ customerEligibility: 'first_order' }), cart, NOW).ok).toBe(true);
    expect(evaluate(rule({ customerEligibility: 'first_order' }), { ...cart, customer: { isFirstOrder: false, segmentIds: [] } }, NOW)).toEqual({ ok: false, reason: 'not_eligible' });
    expect(evaluate(rule({ customerEligibility: 'segment', segmentId: 'bulk_buyer' }), cart, NOW).ok).toBe(true);
    expect(evaluate(rule({ customerEligibility: 'segment', segmentId: 'other' }), cart, NOW).ok).toBe(false);
    expect(evaluate(rule({ customerEligibility: 'first_order' }), { ...cart, customer: null }, NOW).ok).toBe(false);
    expect(evaluate(rule(), { ...cart, customer: null }, NOW).ok).toBe(true);
  });
});

describe('A8 stacking matrix (selectPromos + core.computeTotals)', () => {
  const promo10 = rule({ id: 'promo10', appliesTo: 'collection', targetIds: ['c-fruit'] });
  const promoStack = rule({ id: 'stack5', value: 5, stackable: true });
  const coupon = (value: number, id = 'coupon') => {
    const e = evaluate(rule({ id, kind: 'code', valueType: 'fixed', value, name: 'Code' }), cart, NOW);
    if (!e.ok) throw new Error('coupon should apply');
    return e.discount;
  };

  it('bulk tier only: savings are tier savings, no discounts', () => {
    const t = computeTotals(totalsInput(selectPromos([], cart, NOW), null));
    expect(t).toMatchObject({ tierSavingsPaise: 60 * (49_000 - 35_500), promoDiscountPaise: 0, couponDiscountPaise: 0, totalPaise: ORDER_VALUE });
  });

  it('automatic promo applies to the tier unit price, not the list price', () => {
    const t = computeTotals(totalsInput(selectPromos([promo10], cart, NOW), null));
    expect(t.promoDiscountPaise).toBe(MANGO_VALUE / 10);
    expect(t.totalPaise).toBe(ORDER_VALUE - MANGO_VALUE / 10);
  });

  it('non-stackable promo vs a bigger coupon: the coupon wins, the promo is dropped', () => {
    const t = computeTotals(totalsInput(selectPromos([promo10], cart, NOW), coupon(300_000)));
    expect(t).toMatchObject({ promoDiscountPaise: 0, couponDiscountPaise: 300_000, rejectedDiscounts: [{ id: 'promo10', reason: 'not_stackable' }] });
  });

  it('non-stackable promo vs a smaller coupon: the promo wins, the coupon is dropped', () => {
    const t = computeTotals(totalsInput(selectPromos([promo10], cart, NOW), coupon(10_000)));
    expect(t).toMatchObject({ promoDiscountPaise: MANGO_VALUE / 10, couponDiscountPaise: 0, rejectedDiscounts: [{ id: 'coupon', reason: 'not_stackable' }] });
  });

  it('stackable promo and a coupon both apply', () => {
    const t = computeTotals(totalsInput(selectPromos([promoStack], cart, NOW), coupon(10_000)));
    expect(t.promoDiscountPaise).toBe(Math.round(ORDER_VALUE * 0.05));
    expect(t.couponDiscountPaise).toBe(10_000);
    expect(t.rejectedDiscounts).toEqual([]);
  });

  it('two non-stackable promos: only the better one applies', () => {
    const promo20fruit = rule({ id: 'p20', value: 20, appliesTo: 'collection', targetIds: ['c-fruit'] });
    expect(selectPromos([promo10, promo20fruit], cart, NOW).map((d) => d.id)).toEqual(['p20']);
    const tieHigh = rule({ id: 'z-high', priority: 5, appliesTo: 'collection', targetIds: ['c-fruit'] });
    expect(selectPromos([promo10, tieHigh], cart, NOW).map((d) => d.id)).toEqual(['z-high']);
  });

  it('stackable + non-stackable + bigger coupon: stackable and coupon apply', () => {
    const t = computeTotals(totalsInput(selectPromos([promo10, promoStack], cart, NOW), coupon(300_000)));
    expect(t.appliedDiscounts.map((d) => d.id).sort()).toEqual(['coupon', 'stack5']);
    expect(t.rejectedDiscounts).toEqual([{ id: 'promo10', reason: 'not_stackable' }]);
  });

  it('code rules and ineligible promos are never automatic', () => {
    expect(selectPromos([rule({ kind: 'code' }), rule({ id: 'x', status: 'paused' }), rule({ id: 'y', minQty: 1000 })], cart, NOW)).toEqual([]);
  });
});

describe('codes', () => {
  it('normalises typed codes and rejects junk without a lookup', () => {
    expect(normaliseCode('  monsoon10 ')).toBe('MONSOON10');
    expect(normaliseCode('ab')).toBeNull();
    expect(normaliseCode("x' or 1=1")).toBeNull();
  });

  it('generates unique codes without look-alike characters', () => {
    const codes = generateCodes(200, { prefix: 'GROW-' });
    expect(new Set(codes).size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^GROW-[A-HJKMNP-Z2-9]{8}$/);
  });
});

describe('admin rule form', () => {
  const form = { name: 'Diwali', kind: 'code', status: 'active', startsAt: '2026-11-01T00:00', endsAt: '2026-11-03T23:59', valueType: 'fixed', value: '150.50', appliesTo: 'order', targetIds: '', minQty: '', minSubtotal: '1000', customerEligibility: 'all', usageLimitTotal: '100', usageLimitPerCustomer: '1', stackable: 'on', priority: '' };

  it('parses IST dates, rupees and checkboxes', () => {
    const r = ruleFormSchema.parse(form);
    expect(r).toMatchObject({ id: null, value: 15_050, minSubtotalPaise: 100_000, stackable: true, priority: 0, usageLimitPerCustomer: 1 });
    expect(r.startsAt!.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it.each([
    ['percent over 100', { valueType: 'percent', value: '101' }],
    ['ends before starts', { endsAt: '2026-10-31T00:00' }],
    ['targets missing', { appliesTo: 'products' }],
    ['segment missing', { customerEligibility: 'segment' }],
    ['bad date', { startsAt: '01/11/2026' }],
    ['no value', { value: '' }],
  ])('rejects %s', (_n, patch) => {
    expect(ruleFormSchema.safeParse({ ...form, ...patch }).success).toBe(false);
  });
});
