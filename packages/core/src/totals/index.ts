import type { AppliedDiscountInput, Paise, TotalsBreakdown, TotalsInput, TotalsLine, TotalsTaxRate } from '../contracts';
import { asPaise, gstSplit, splitGstInclusive } from '../money';

export type { TotalsBreakdown, TotalsInput } from '../contracts';

const amount = (d: AppliedDiscountInput) => d.allocations.reduce((s, a) => s + a.amountPaise, 0);

/**
 * Stacking rule (A8): automatic promos apply; at most one coupon; a coupon never stacks with a
 * non-stackable automatic promo, and when both are present the larger side wins (best-of).
 */
function resolveStacking(input: TotalsInput) {
  const rejected: { id: string; reason: 'not_stackable' }[] = [];
  let promos = [...input.automaticPromos];
  let coupon = input.coupon;
  const blocking = promos.filter((p) => !p.stackable);
  if (coupon && blocking.length) {
    const blockingTotal = blocking.reduce((s, p) => s + amount(p), 0);
    if (amount(coupon) > blockingTotal) {
      rejected.push(...blocking.map((p) => ({ id: p.id, reason: 'not_stackable' as const })));
      promos = promos.filter((p) => p.stackable);
    } else {
      rejected.push({ id: coupon.id, reason: 'not_stackable' });
      coupon = null;
    }
  }
  return { promos, coupon, rejected };
}

function assertInput(input: TotalsInput): void {
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new RangeError(`line ${l.lineId}: qty must be a positive integer`);
    if (l.tierUnitPaise > l.listUnitPaise) throw new RangeError(`line ${l.lineId}: tier price above list price`);
    for (const v of [l.listUnitPaise, l.tierUnitPaise]) if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`line ${l.lineId}: bad price`);
  }
  for (const v of [input.packingPaise, input.transportPaise])
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError('charges must be non-negative integer paise');
}

/**
 * The single totals pipeline (cart preview, checkout quote, order snapshot). Pure: plain data in, plain data out.
 * Order: bulk tier unit price -> automatic promos -> coupon -> packing -> transport -> GST (inclusive, per line rate).
 * Definitions (F2): subtotal = list x qty; tierSavings = (list - tier) x qty; compare-at never enters totals.
 * A discount allocation is capped at what is left on its line, so a line never goes negative.
 */
export function computeTotals(input: TotalsInput): TotalsBreakdown {
  assertInput(input);
  const { promos, coupon, rejected } = resolveStacking(input);

  const remaining = new Map(input.lines.map((l) => [l.lineId, l.tierUnitPaise * l.qty]));
  const discountByLine = new Map<string, number>();
  const applied: { id: string; kind: 'automatic' | 'coupon'; label: string; amountPaise: Paise }[] = [];
  let promoTotal = 0;
  let couponTotal = 0;
  for (const d of [...promos, ...(coupon ? [coupon] : [])]) {
    let taken = 0;
    for (const a of d.allocations) {
      const left = remaining.get(a.lineId);
      if (left === undefined) throw new RangeError(`discount ${d.id} allocated to unknown line ${a.lineId}`);
      const take = Math.min(Math.max(a.amountPaise, 0), left);
      remaining.set(a.lineId, left - take);
      discountByLine.set(a.lineId, (discountByLine.get(a.lineId) ?? 0) + take);
      taken += take;
    }
    applied.push({ id: d.id, kind: d.kind, label: d.label, amountPaise: asPaise(taken) });
    if (d.kind === 'coupon') couponTotal += taken;
    else promoTotal += taken;
  }

  const byRate = new Map<number, { taxable: number; tax: number }>();
  const addTax = (rate: number, gross: number) => {
    const { taxablePaise, taxPaise } = splitGstInclusive(asPaise(gross), rate);
    const bucket = byRate.get(rate) ?? { taxable: 0, tax: 0 };
    bucket.taxable += taxablePaise;
    bucket.tax += taxPaise;
    byRate.set(rate, bucket);
    return taxPaise;
  };

  let subtotal = 0;
  let tierSavings = 0;
  let weight = 0;
  const lines: TotalsLine[] = input.lines.map((l) => {
    subtotal += l.listUnitPaise * l.qty;
    tierSavings += (l.listUnitPaise - l.tierUnitPaise) * l.qty;
    weight += l.weightKg * l.qty;
    const discount = discountByLine.get(l.lineId) ?? 0;
    const lineTotal = l.tierUnitPaise * l.qty - discount;
    return {
      lineId: l.lineId,
      qty: l.qty,
      listUnitPaise: l.listUnitPaise,
      unitPaise: l.tierUnitPaise,
      discountPaise: asPaise(discount),
      lineTotalPaise: asPaise(lineTotal),
      gstRatePct: l.gstRatePct,
      taxPaise: addTax(l.gstRatePct, lineTotal),
    };
  });

  const charges = input.packingPaise + input.transportPaise;
  if (charges > 0) addTax(input.chargesGstRatePct ?? 0, charges);

  const rates: TotalsTaxRate[] = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ratePct, b]) => ({ ratePct, taxablePaise: asPaise(b.taxable), taxPaise: asPaise(b.tax) }));
  // Split CGST/SGST per rate, as the invoice prints it, then sum.
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const r of rates) {
    const s = gstSplit(r.taxPaise, { interState: input.interState });
    cgst += s.cgstPaise;
    sgst += s.sgstPaise;
    igst += s.igstPaise;
  }

  return {
    lines,
    subtotalPaise: asPaise(subtotal),
    tierSavingsPaise: asPaise(tierSavings),
    promoDiscountPaise: asPaise(promoTotal),
    couponDiscountPaise: asPaise(couponTotal),
    appliedDiscounts: applied,
    rejectedDiscounts: rejected,
    packingPaise: input.packingPaise,
    transportPaise: input.transportPaise,
    totalPaise: asPaise(subtotal - tierSavings - promoTotal - couponTotal + charges),
    tax: {
      interState: input.interState,
      cgstPaise: asPaise(cgst),
      sgstPaise: asPaise(sgst),
      igstPaise: asPaise(igst),
      totalTaxPaise: asPaise(cgst + sgst + igst),
      byRate: rates,
    },
    totalWeightKg: Math.round(weight * 1000) / 1000,
  };
}
