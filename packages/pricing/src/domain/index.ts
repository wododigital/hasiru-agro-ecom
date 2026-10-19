// Pure pricing: tier selection, quotes, cross-line summation, input validation. Shared by server and client.
import { z } from 'zod';
import type { Paise, PriceQuote, PriceTier } from '@ecomkit/core/contracts';
import { asPaise, paise } from '@ecomkit/core/money';

export type { PriceQuote, PriceTier } from '@ecomkit/core/contracts';

/** Everything needed to price one variant at any quantity. Tiers sorted by minQty ascending. */
export interface PriceBook {
  productId: string;
  variantId: string;
  listPaise: Paise;
  compareAtPaise: Paise | null;
  tiers: readonly PriceTier[];
  gstRatePct: number;
}

const byMinQty = (a: PriceTier, b: PriceTier) => a.minQty - b.minQty;

/** The tier that applies at `qty`: the highest `minQty` not above it (boundary inclusive), else null. */
export function tierFor(tiers: readonly PriceTier[], qty: number): PriceTier | null {
  let hit: PriceTier | null = null;
  for (const t of [...tiers].sort(byMinQty)) if (qty >= t.minQty) hit = t;
  return hit;
}

/** The next tier above `qty` and how many more units reach it (the "37 more for bulk" hint). */
export function nextTierFor(tiers: readonly PriceTier[], qty: number): (PriceTier & { qtyToGo: number }) | null {
  const next = [...tiers].sort(byMinQty).find((t) => t.minQty > qty);
  return next ? { ...next, qtyToGo: next.minQty - qty } : null;
}

/**
 * Quote for `qty` units. `tierQty` (defaults to qty) is the quantity that selects the tier, so a line
 * can be priced by the total of every line in its group (see quoteLines).
 */
export function quote(book: PriceBook, qty: number, tierQty = qty): PriceQuote {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError(`qty must be a positive integer, got ${qty}`);
  const tier = tierFor(book.tiers, tierQty);
  // A tier never raises the price: bad data falls back to list rather than charging more.
  const unit = tier && tier.unitPaise < book.listPaise ? tier.unitPaise : book.listPaise;
  return {
    productId: book.productId,
    variantId: book.variantId,
    qty,
    listUnitPaise: book.listPaise,
    compareAtPaise: book.compareAtPaise,
    unitPaise: unit,
    tier: unit === book.listPaise ? null : tier,
    nextTier: nextTierFor(book.tiers, tierQty),
    gstRatePct: book.gstRatePct,
    lineTotalPaise: asPaise(unit * qty),
  };
}

export interface PricedLineInput {
  lineId: string;
  variantId: string;
  qty: number;
}

/**
 * Groups lines whose quantities add up before the tier is chosen. Default: lines of the same variant
 * (a plant added on its own and again inside a package unlocks bulk on both). A store can widen it,
 * e.g. `(line, book) => book.productId` to pool every variant of a product.
 */
export type TierGroupKey = (line: PricedLineInput, book: PriceBook) => string;
export const byVariant: TierGroupKey = (line) => line.variantId;

/**
 * Cross-line summation: every line is priced at the tier its group's total quantity reaches.
 * Lines without a price book are left out of the result (the caller shows them as unavailable).
 */
export function quoteLines(
  lines: readonly PricedLineInput[],
  books: Readonly<Record<string, PriceBook>>,
  groupKey: TierGroupKey = byVariant,
): Record<string, PriceQuote> {
  const totals = new Map<string, number>();
  const keyed: [PricedLineInput, PriceBook, string][] = [];
  for (const line of lines) {
    const book = books[line.variantId];
    if (!book) continue;
    const key = groupKey(line, book);
    totals.set(key, (totals.get(key) ?? 0) + line.qty);
    keyed.push([line, book, key]);
  }
  return Object.fromEntries(keyed.map(([line, book, key]) => [line.lineId, quote(book, line.qty, totals.get(key)!)]));
}

// ---- admin input -----------------------------------------------------------

const money = z.number().int().nonnegative().max(1_000_000_000);
const MAX_TIERS = 10;

/** One variant's prices as the admin saves them (integer paise). */
export const variantPricingSchema = z
  .object({
    productId: z.uuid(),
    variantId: z.uuid(),
    pricePaise: money,
    compareAtPaise: money.nullable(),
    offlinePricePaise: money.nullable(),
    costPaise: money.nullable(),
    tiers: z.array(z.object({ minQty: z.number().int().min(2).max(1_000_000), unitPaise: money })).max(MAX_TIERS),
  })
  .superRefine((v, ctx) => {
    if (v.compareAtPaise !== null && v.compareAtPaise <= v.pricePaise)
      ctx.addIssue({ code: 'custom', path: ['compareAtPaise'], message: 'Compare-at must be above the price, or empty' });
    const sorted = [...v.tiers].sort((a, b) => a.minQty - b.minQty);
    sorted.forEach((t, i) => {
      if (i > 0 && t.minQty === sorted[i - 1]!.minQty)
        ctx.addIssue({ code: 'custom', path: ['tiers'], message: `Two tiers start at ${t.minQty}` });
      if (t.unitPaise >= (i === 0 ? v.pricePaise : sorted[i - 1]!.unitPaise))
        ctx.addIssue({ code: 'custom', path: ['tiers'], message: `The tier from ${t.minQty} must be cheaper than the price below it` });
    });
  })
  .transform((v) => ({ ...v, tiers: [...v.tiers].sort((a, b) => a.minQty - b.minQty) }));

export type VariantPricingInput = z.input<typeof variantPricingSchema>;
export type VariantPricing = z.output<typeof variantPricingSchema>;

const list = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const rupeesOrNull = (v: unknown) => (text(v) === '' ? null : rupeesToPaise(text(v)));

/** Admin form values are rupees ("490" or "355.50"); anything else becomes NaN and fails validation. */
function rupeesToPaise(value: string): number {
  return /^\d+(\.\d{1,2})?$/.test(value) ? paise(Number(value)) : Number.NaN;
}

/**
 * The Pricing tab's form (rupee strings, repeated `tierMinQty` / `tierPrice` fields; a row with both
 * empty is ignored) to `VariantPricing`.
 */
export const variantPricingFormSchema = z
  .record(z.string(), z.unknown())
  .transform((f) => {
    const minQtys = list(f.tierMinQty).map(text);
    const prices = list(f.tierPrice).map(text);
    const tiers = minQtys
      .map((q, i) => [q, prices[i] ?? ''] as const)
      .filter(([q, p]) => q !== '' || p !== '')
      .map(([q, p]) => ({ minQty: /^\d+$/.test(q) ? Number(q) : Number.NaN, unitPaise: rupeesToPaise(p) }));
    return {
      productId: text(f.productId),
      variantId: text(f.variantId),
      pricePaise: rupeesToPaise(text(f.price)),
      compareAtPaise: rupeesOrNull(f.compareAt),
      offlinePricePaise: rupeesOrNull(f.offlinePrice),
      costPaise: rupeesOrNull(f.cost),
      tiers,
    };
  })
  .pipe(variantPricingSchema);
