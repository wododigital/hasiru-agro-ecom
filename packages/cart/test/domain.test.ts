import type { Paise, PriceQuote } from '@ecomkit/core/contracts';
import { describe, expect, it } from 'vitest';
import { addLineSchema, bulkNudge, formAddSchema, formatDeliveryDate, lineWeightKg, needsInputsSuggestion, originSchema, replacePackageSchema, toTotalsInput } from '../src/domain';
import { cartMessages, mergeMessages } from '../src/messages';

const P = (n: number) => n as Paise;
const quote = (unit: number, next: { minQty: number; unitPaise: number; qtyToGo: number } | null): PriceQuote => ({
  productId: 'p',
  variantId: 'v',
  qty: 1,
  listUnitPaise: P(49_000),
  compareAtPaise: null,
  unitPaise: P(unit),
  tier: null,
  nextTier: next && { ...next, unitPaise: P(next.unitPaise) },
  gstRatePct: 0,
  lineTotalPaise: P(unit),
});

describe('cart domain', () => {
  it('weight per unit: origin override, then the variant, then 0', () => {
    expect(lineWeightKg(2.5, { weightKg: 0.8 })).toBe(0.8);
    expect(lineWeightKg(2.5, null)).toBe(2.5);
    expect(lineWeightKg(null, {})).toBe(0);
  });

  it('bulk nudge only toward a cheaper next tier', () => {
    expect(bulkNudge(quote(49_000, { minQty: 100, unitPaise: 34_000, qtyToGo: 37 }))).toEqual({ minQty: 100, qtyToGo: 37, unitPaise: 34_000 });
    expect(bulkNudge(quote(49_000, null))).toBeNull();
    expect(bulkNudge(quote(30_000, { minQty: 100, unitPaise: 34_000, qtyToGo: 37 }))).toBeNull();
    expect(cartMessages.line.bulkAt(100, 37)).toBe('Bulk at 100 (37 more)');
  });

  it('inputs suggestion: plants and no inputs', () => {
    expect(needsInputsSuggestion(['plant', 'plant'])).toBe(true);
    expect(needsInputsSuggestion(['plant', 'input'])).toBe(false);
    expect(needsInputsSuggestion([null])).toBe(false);
  });

  it('totals input leaves unpriced lines out and passes charges through', () => {
    const input = toTotalsInput(
      [
        { lineId: 'a', qty: 2, weightKg: 1, quote: quote(35_500, null) },
        { lineId: 'b', qty: 1, weightKg: 1, quote: null },
      ],
      { promos: [], coupon: null },
      { packingPaise: 100, transportPaise: 900 },
    );
    expect(input.lines.map((l) => [l.lineId, l.listUnitPaise, l.tierUnitPaise])).toEqual([['a', 49_000, 35_500]]);
    expect([input.packingPaise, input.transportPaise, input.interState]).toEqual([100, 900, false]);
  });

  it('validates every boundary input', () => {
    expect(addLineSchema.safeParse({ variantId: crypto.randomUUID(), qty: 0 }).success).toBe(false);
    expect(addLineSchema.safeParse({ variantId: crypto.randomUUID(), qty: 1.5 }).success).toBe(false);
    expect(originSchema.safeParse({ source: 'planting', weightKg: -1 }).success).toBe(false);
    expect(originSchema.safeParse({ source: 'planting', extra: 1 }).success).toBe(false);
    expect(formAddSchema.parse({ variantId: '0190a0a0-0000-7000-8000-000000000000', qty: '3' })).toMatchObject({ qty: 3, intent: 'add' });
    expect(replacePackageSchema.safeParse({ packageId: '', lines: [] }).success).toBe(false);
  });

  it('formats delivery dates as the India calendar date', () => {
    expect(formatDeliveryDate('2026-10-24')).toBe('Saturday 24 Oct');
  });

  it('host messages override one key without losing the rest', () => {
    const m = mergeMessages({ summary: { noReturns: 'Custom policy' } });
    expect(m.summary.noReturns).toBe('Custom policy');
    expect(m.summary.total).toBe('Total');
  });
});
