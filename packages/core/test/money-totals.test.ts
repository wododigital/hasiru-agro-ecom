import { describe, expect, it } from 'vitest';
import type { AppliedDiscountInput, TotalsInput, TotalsLineInput } from '../src/contracts';
import { asPaise, formatINR, gstSplit, paise, pct, roundToRs, splitGstInclusive, sum } from '../src/money';
import { computeTotals } from '../src/totals';

const P = asPaise;

describe('money', () => {
  it('converts rupees to integer paise without float drift', () => {
    expect(paise(355.5)).toBe(35550);
    expect(paise(0.1 + 0.2)).toBe(30);
    expect(paise(19.99)).toBe(1999);
    expect(() => asPaise(1.5)).toThrow();
    expect(() => paise(Number.NaN)).toThrow();
  });

  it('formats with en-IN grouping and Rs', () => {
    expect(formatINR(paise(123456))).toBe('Rs 1,23,456');
    expect(formatINR(paise(99.5))).toBe('Rs 99.50');
    expect(formatINR(P(0))).toBe('Rs 0');
    expect(formatINR(paise(-50))).toBe('-Rs 50');
    expect(formatINR(paise(1234567), { compact: true })).toBe('Rs 12.3L');
    expect(formatINR(paise(4500), { compact: true })).toBe('Rs 4.5K');
  });

  it('splits GST-inclusive amounts at 0, 5 and 18 percent', () => {
    expect(splitGstInclusive(P(10_000), 0)).toEqual({ taxablePaise: 10_000, taxPaise: 0 });
    expect(splitGstInclusive(P(10_500), 5)).toEqual({ taxablePaise: 10_000, taxPaise: 500 });
    expect(splitGstInclusive(P(11_800), 18)).toEqual({ taxablePaise: 10_000, taxPaise: 1_800 });
    // rounding to the paisa, parts always add back up
    const s = splitGstInclusive(P(90_000), 5);
    expect(s.taxPaise).toBe(4_286);
    expect(s.taxablePaise + s.taxPaise).toBe(90_000);
    expect(() => splitGstInclusive(P(100), -1)).toThrow();
  });

  it('splits tax into CGST + SGST or IGST', () => {
    expect(gstSplit(P(1_801), { interState: false })).toEqual({ cgstPaise: 900, sgstPaise: 901, igstPaise: 0 });
    expect(gstSplit(P(1_801), { interState: true })).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 1_801 });
  });

  it('rounds to rupee steps, sums and takes percentages', () => {
    expect(roundToRs(paise(352), 5)).toBe(35_000);
    expect(roundToRs(paise(352.5), 5)).toBe(35_500);
    expect(roundToRs(paise(10.49))).toBe(1_000);
    expect(sum([P(100), P(250)])).toBe(350);
    expect(pct(P(50_000), 10)).toBe(5_000);
    expect(pct(P(999), 33.3)).toBe(333);
  });
});

const line = (lineId: string, list: number, tier: number, qty: number, gst: number, kg: number): TotalsLineInput => ({
  lineId,
  productId: `p-${lineId}`,
  variantId: `v-${lineId}`,
  qty,
  listUnitPaise: P(list),
  tierUnitPaise: P(tier),
  gstRatePct: gst,
  weightKg: kg,
});
const discount = (id: string, kind: 'automatic' | 'coupon', stackable: boolean, allocations: [string, number][]): AppliedDiscountInput => ({
  id,
  kind,
  label: id,
  stackable,
  allocations: allocations.map(([lineId, a]) => ({ lineId, amountPaise: P(a) })),
});

// 50 saplings at the bulk tier (0% GST), 2 bags of compost (5%), 1 bio-pesticide (18%), packing + transport at 18%.
const base: TotalsInput = {
  lines: [line('plant', 49_000, 35_500, 50, 0, 2), line('compost', 50_000, 50_000, 2, 5, 50), line('bio', 30_000, 30_000, 1, 18, 1)],
  automaticPromos: [discount('compost-10', 'automatic', true, [['compost', 10_000]])],
  coupon: discount('SAVE500', 'coupon', false, [['plant', 50_000]]),
  packingPaise: P(20_000),
  transportPaise: P(150_000),
  chargesGstRatePct: 18,
  interState: false,
};

describe('computeTotals', () => {
  it('applies tier -> automatic promo -> coupon -> packing -> transport -> GST (intra-state)', () => {
    const t = computeTotals(base);
    expect(t.subtotalPaise).toBe(2_580_000); // list x qty (F2)
    expect(t.tierSavingsPaise).toBe(675_000); // (490 - 355) x 50
    expect(t.promoDiscountPaise).toBe(10_000);
    expect(t.couponDiscountPaise).toBe(50_000);
    expect(t.totalPaise).toBe(2_015_000);
    expect(t.lines.map((l) => [l.lineId, l.unitPaise, l.discountPaise, l.lineTotalPaise, l.taxPaise])).toEqual([
      ['plant', 35_500, 50_000, 1_725_000, 0],
      ['compost', 50_000, 10_000, 90_000, 4_286],
      ['bio', 30_000, 0, 30_000, 4_576],
    ]);
    // total = sum of line totals + charges
    expect(t.lines.reduce((s, l) => s + l.lineTotalPaise, 0) + t.packingPaise + t.transportPaise).toBe(t.totalPaise);
    expect(t.tax.byRate).toEqual([
      { ratePct: 0, taxablePaise: 1_725_000, taxPaise: 0 },
      { ratePct: 5, taxablePaise: 85_714, taxPaise: 4_286 },
      { ratePct: 18, taxablePaise: 169_492, taxPaise: 30_508 },
    ]);
    expect(t.tax).toMatchObject({ interState: false, cgstPaise: 17_397, sgstPaise: 17_397, igstPaise: 0, totalTaxPaise: 34_794 });
    expect(t.totalWeightKg).toBe(201);
    expect(t.appliedDiscounts.map((d) => [d.id, d.amountPaise])).toEqual([
      ['compost-10', 10_000],
      ['SAVE500', 50_000],
    ]);
    expect(t.rejectedDiscounts).toEqual([]);
  });

  it('puts all tax into IGST for inter-state delivery without changing the total', () => {
    const t = computeTotals({ ...base, interState: true });
    expect(t.totalPaise).toBe(2_015_000);
    expect(t.tax).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 34_794, totalTaxPaise: 34_794 });
  });

  it('never lets compare-at or tier savings double count: no tier, no discounts', () => {
    const t = computeTotals({ lines: [line('a', 10_000, 10_000, 3, 0, 1)], automaticPromos: [], coupon: null, packingPaise: P(0), transportPaise: P(0), interState: false });
    expect(t).toMatchObject({ subtotalPaise: 30_000, tierSavingsPaise: 0, totalPaise: 30_000, packingPaise: 0 });
    expect(t.tax.byRate).toEqual([{ ratePct: 0, taxablePaise: 30_000, taxPaise: 0 }]);
  });

  it('best-of when a coupon meets a non-stackable promo (A8)', () => {
    const promo = discount('auto-200', 'automatic', false, [['plant', 20_000]]);
    const couponWins = computeTotals({ ...base, automaticPromos: [promo] });
    expect(couponWins.rejectedDiscounts).toEqual([{ id: 'auto-200', reason: 'not_stackable' }]);
    expect(couponWins.couponDiscountPaise).toBe(50_000);
    expect(couponWins.promoDiscountPaise).toBe(0);

    const promoWins = computeTotals({ ...base, automaticPromos: [promo], coupon: discount('SAVE100', 'coupon', false, [['plant', 10_000]]) });
    expect(promoWins.rejectedDiscounts).toEqual([{ id: 'SAVE100', reason: 'not_stackable' }]);
    expect(promoWins.promoDiscountPaise).toBe(20_000);
    expect(promoWins.couponDiscountPaise).toBe(0);
  });

  it('caps a discount at what is left on its line', () => {
    const t = computeTotals({
      ...base,
      automaticPromos: [discount('big', 'automatic', true, [['bio', 25_000]])],
      coupon: discount('more', 'coupon', false, [['bio', 25_000]]),
    });
    const bio = t.lines.find((l) => l.lineId === 'bio')!;
    expect(bio.lineTotalPaise).toBe(0);
    expect(t.couponDiscountPaise).toBe(5_000);
  });

  it('rejects bad input', () => {
    expect(() => computeTotals({ ...base, lines: [line('x', 100, 100, 0, 0, 0)], automaticPromos: [], coupon: null })).toThrow(/qty/);
    expect(() => computeTotals({ ...base, lines: [line('x', 100, 200, 1, 0, 0)], automaticPromos: [], coupon: null })).toThrow(/tier/);
    expect(() => computeTotals({ ...base, coupon: discount('c', 'coupon', false, [['nope', 1]]) })).toThrow(/unknown line/);
  });
});
