import { describe, expect, it } from 'vitest';
import type { Paise } from '@ecomkit/core/contracts';
import { nextTierFor, quote, quoteLines, tierFor, variantPricingFormSchema, variantPricingSchema, type PriceBook } from '../src/domain';

const P = (n: number) => n as Paise;
const V1 = '0190a000-0000-7000-8000-000000000001';
const V2 = '0190a000-0000-7000-8000-000000000002';
const PROD = '0190a000-0000-7000-8000-0000000000aa';
const tiers = [
  { minQty: 50, unitPaise: P(35_500) },
  { minQty: 200, unitPaise: P(32_000) },
  { minQty: 100, unitPaise: P(34_000) },
];
const book = (variantId = V1, productId = PROD): PriceBook => ({ productId, variantId, listPaise: P(49_000), compareAtPaise: P(70_000), tiers, gstRatePct: 0 });

describe('tier selection (n tiers, boundaries)', () => {
  it.each([
    [1, null],
    [49, null],
    [50, 35_500],
    [99, 35_500],
    [100, 34_000],
    [199, 34_000],
    [200, 32_000],
    [5000, 32_000],
  ])('qty %i -> %s', (qty, unit) => {
    expect(tierFor(tiers, qty)?.unitPaise ?? null).toBe(unit);
  });

  it('quote at min_qty-1 is list price with a hint; at min_qty it is the tier price', () => {
    const below = quote(book(), 49);
    expect(below).toMatchObject({ unitPaise: 49_000, tier: null, lineTotalPaise: 49 * 49_000, nextTier: { minQty: 50, unitPaise: 35_500, qtyToGo: 1 } });
    const at = quote(book(), 50);
    expect(at).toMatchObject({ unitPaise: 35_500, tier: { minQty: 50 }, lineTotalPaise: 50 * 35_500, nextTier: { minQty: 100, qtyToGo: 50 } });
    expect(quote(book(), 200).nextTier).toBeNull();
    expect(nextTierFor([], 3)).toBeNull();
  });

  it('a tier priced at or above list never raises the price', () => {
    const bad: PriceBook = { ...book(), tiers: [{ minQty: 10, unitPaise: P(60_000) }] };
    expect(quote(bad, 10)).toMatchObject({ unitPaise: 49_000, tier: null });
  });

  it('refuses a non-positive or fractional qty', () => {
    expect(() => quote(book(), 0)).toThrow(RangeError);
    expect(() => quote(book(), 1.5)).toThrow(RangeError);
  });
});

describe('cross-line summation', () => {
  it('lines of one variant share the tier their total reaches (package 30 + extra 25 = 55)', () => {
    const q = quoteLines([
      { lineId: 'pkg', variantId: V1, qty: 30 },
      { lineId: 'extra', variantId: V1, qty: 25 },
      { lineId: 'other', variantId: V2, qty: 10 },
      { lineId: 'unpriced', variantId: 'nope', qty: 1 },
    ], { [V1]: book(V1), [V2]: book(V2) });
    expect(q.pkg).toMatchObject({ qty: 30, unitPaise: 35_500, lineTotalPaise: 30 * 35_500 });
    expect(q.extra).toMatchObject({ qty: 25, unitPaise: 35_500 });
    expect(q.other).toMatchObject({ unitPaise: 49_000, nextTier: { qtyToGo: 40 } });
    expect(q.unpriced).toBeUndefined();
  });

  it('the group key hook can pool every variant of a product', () => {
    const lines = [
      { lineId: 'a', variantId: V1, qty: 30 },
      { lineId: 'b', variantId: V2, qty: 20 },
    ];
    const books = { [V1]: book(V1), [V2]: book(V2) };
    expect(quoteLines(lines, books).a!.tier).toBeNull();
    const pooled = quoteLines(lines, books, (_l, b) => b.productId);
    expect(pooled.a!.unitPaise).toBe(35_500);
    expect(pooled.b!.unitPaise).toBe(35_500);
  });
});

describe('admin input validation', () => {
  const base = { productId: PROD, variantId: V1, pricePaise: 49_000, compareAtPaise: 70_000, offlinePricePaise: 35_000, costPaise: null, tiers: [{ minQty: 100, unitPaise: 34_000 }, { minQty: 50, unitPaise: 35_500 }] };

  it('accepts valid prices and sorts tiers', () => {
    expect(variantPricingSchema.parse(base).tiers.map((t) => t.minQty)).toEqual([50, 100]);
  });

  it.each([
    ['compare-at not above price', { compareAtPaise: 49_000 }],
    ['tier not cheaper than price', { tiers: [{ minQty: 50, unitPaise: 49_000 }] }],
    ['tiers not decreasing', { tiers: [{ minQty: 50, unitPaise: 35_000 }, { minQty: 100, unitPaise: 36_000 }] }],
    ['duplicate min qty', { tiers: [{ minQty: 50, unitPaise: 35_000 }, { minQty: 50, unitPaise: 34_000 }] }],
    ['min qty of 1', { tiers: [{ minQty: 1, unitPaise: 35_000 }] }],
    ['fractional paise', { pricePaise: 490.5 }],
    ['negative', { pricePaise: -1 }],
  ])('rejects %s', (_name, patch) => {
    expect(variantPricingSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it('parses the admin form (rupees, repeated tier fields, blank rows ignored)', () => {
    const v = variantPricingFormSchema.parse({ productId: PROD, variantId: V1, price: '490', compareAt: '', offlinePrice: '350.50', cost: '', tierMinQty: ['50', '', '100'], tierPrice: ['355', '', '340'] });
    expect(v).toMatchObject({ pricePaise: 49_000, compareAtPaise: null, offlinePricePaise: 35_050, costPaise: null, tiers: [{ minQty: 50, unitPaise: 35_500 }, { minQty: 100, unitPaise: 34_000 }] });
    expect(variantPricingFormSchema.safeParse({ productId: PROD, variantId: V1, price: '4,90' }).success).toBe(false);
    expect(variantPricingFormSchema.safeParse({ productId: PROD, variantId: V1, price: '490', tierMinQty: '50', tierPrice: '' }).success).toBe(false);
  });
});
