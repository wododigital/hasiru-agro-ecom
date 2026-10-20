// Pricing server API. No `server-only` import here: the worker and scripts load it under plain Node
// (the manifest's `provides.pricing` points at this file); `./index.ts` adds the guard for app code.
import { asc, eq, inArray } from 'drizzle-orm';
import { audit } from '@ecomkit/core/audit';
import { requirePermission } from '@ecomkit/core/auth-context';
import { invalidateTags, tags } from '@ecomkit/core/cache-tags';
import type { Paise, PriceQuote, PricingReader, TotalsLineInput } from '@ecomkit/core/contracts';
import { db, withTx, type DbOrTx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { asPaise } from '@ecomkit/core/money';
import { byVariant, quote, quoteLines, variantPricingSchema, type PriceBook, type PricedLineInput, type TierGroupKey, type VariantPricingInput } from '../domain';
import { pricingPrice, pricingTier } from '../schema';

/** What pricing needs from the catalog, wired by the app at boot (catalog owns variants and GST rates). */
export interface PricingDeps {
  /** GST rate (percent) per product id. A missing product prices at 0 and is the catalog's data gap. */
  gstRates(productIds: readonly string[]): Promise<Record<string, number>>;
  /** Variants of a product, for the admin Pricing tab. */
  variantsOf(productId: string): Promise<{ variantId: string; label: string }[]>;
}

// On globalThis: instrumentation (boot) and route bundles are separate module instances in Next.
const state: { deps: PricingDeps | null } = ((globalThis as Record<symbol, { deps: PricingDeps | null } | undefined>)[Symbol.for('ecomkit.pricing.deps')] ??= { deps: null });

export function configurePricing(next: PricingDeps): void {
  state.deps = next;
}

function requireDeps(): PricingDeps {
  if (!state.deps) throw new Error('pricing is not configured: call configurePricing({ gstRates, variantsOf }) at boot');
  return state.deps;
}

const p = (n: number) => asPaise(n);

/** Price books for the given variants (variants without a price row are absent). */
export async function loadBooks(variantIds: readonly string[], options: { db?: DbOrTx } = {}): Promise<Record<string, PriceBook>> {
  const ids = [...new Set(variantIds)];
  if (!ids.length) return {};
  const conn = options.db ?? db;
  const [prices, tiers] = await Promise.all([
    conn.select().from(pricingPrice).where(inArray(pricingPrice.variantId, ids)),
    conn.select().from(pricingTier).where(inArray(pricingTier.variantId, ids)).orderBy(asc(pricingTier.minQty)),
  ]);
  if (!prices.length) return {};
  const gst = await requireDeps().gstRates([...new Set(prices.map((r) => r.productId))]);
  const books: Record<string, PriceBook> = {};
  for (const r of prices) {
    books[r.variantId] = {
      productId: r.productId,
      variantId: r.variantId,
      listPaise: p(r.pricePaise),
      compareAtPaise: r.compareAtPaise === null ? null : p(r.compareAtPaise),
      tiers: tiers.filter((t) => t.variantId === r.variantId).map((t) => ({ minQty: t.minQty, unitPaise: p(t.unitPricePaise) })),
      gstRatePct: gst[r.productId] ?? 0,
    };
  }
  return books;
}

export async function getPrice(variantId: string, qty: number): Promise<PriceQuote | null> {
  const book = (await loadBooks([variantId]))[variantId];
  return book ? quote(book, qty) : null;
}

/** Quotes keyed by variant. Repeated variants are summed first, so their total picks the tier. */
export async function getPrices(items: readonly { variantId: string; qty: number }[]): Promise<Record<string, PriceQuote>> {
  const qty = new Map<string, number>();
  for (const i of items) qty.set(i.variantId, (qty.get(i.variantId) ?? 0) + i.qty);
  const books = await loadBooks([...qty.keys()]);
  return Object.fromEntries(Object.values(books).map((b) => [b.variantId, quote(b, qty.get(b.variantId)!)]));
}

/** The tier that applies to `qty` units of a variant, or null. */
export async function tierFor(variantId: string, qty: number) {
  return (await getPrice(variantId, qty))?.tier ?? null;
}

/**
 * Cross-line summation hook: prices cart or order lines so the lines in one group (default: same
 * variant) share the tier their combined quantity reaches. Keyed by lineId; unpriced lines are absent.
 */
export async function priceLines(lines: readonly PricedLineInput[], options: { groupKey?: TierGroupKey } = {}): Promise<Record<string, PriceQuote>> {
  return quoteLines(lines, await loadBooks(lines.map((l) => l.variantId)), options.groupKey ?? byVariant);
}

export class UnpricedLineError extends Error {
  constructor(readonly lineIds: readonly string[]) {
    super(`no price for line(s) ${lineIds.join(', ')}`);
    this.name = 'UnpricedLineError';
  }
}

/**
 * Price facts frozen onto an order or fed to `core.computeTotals` (weight comes from the cart line).
 * Every line must be priced; an unpriced line throws rather than going into an order at zero.
 */
export async function priceSnapshot(
  lines: readonly (PricedLineInput & { productId?: string })[],
  options: { groupKey?: TierGroupKey } = {},
): Promise<Omit<TotalsLineInput, 'weightKg'>[]> {
  const quotes = await priceLines(lines, options);
  const missing = lines.filter((l) => !quotes[l.lineId]).map((l) => l.lineId);
  if (missing.length) throw new UnpricedLineError(missing);
  return lines.map((l) => {
    const q = quotes[l.lineId]!;
    return { lineId: l.lineId, productId: q.productId, variantId: q.variantId, qty: l.qty, listUnitPaise: q.listUnitPaise, tierUnitPaise: q.unitPaise, gstRatePct: q.gstRatePct };
  });
}

/** Service `pricing` (core contract `PricingReader`). */
export const pricingReader: PricingReader = { getPrice, getPrices };

// ---- admin -----------------------------------------------------------------

export interface AdminVariantPricing {
  variantId: string;
  label: string;
  pricePaise: Paise | null;
  compareAtPaise: Paise | null;
  /** Nursery counter price. Admin only: never in a quote, feed or page. */
  offlinePricePaise: Paise | null;
  costPaise: Paise | null;
  tiers: { minQty: number; unitPaise: Paise }[];
}

/** Full pricing (including offline and cost) for one product's variants. Staff with products.read only. */
export async function getAdminPricing(productId: string): Promise<AdminVariantPricing[]> {
  await requirePermission('products.read');
  const variants = await requireDeps().variantsOf(productId);
  const ids = variants.map((v) => v.variantId);
  if (!ids.length) return [];
  const [prices, tiers] = await Promise.all([
    db.select().from(pricingPrice).where(inArray(pricingPrice.variantId, ids)),
    db.select().from(pricingTier).where(inArray(pricingTier.variantId, ids)).orderBy(asc(pricingTier.minQty)),
  ]);
  return variants.map((v) => {
    const r = prices.find((x) => x.variantId === v.variantId);
    const n = (x: number | null | undefined) => (x == null ? null : p(x));
    return {
      variantId: v.variantId,
      label: v.label,
      pricePaise: n(r?.pricePaise),
      compareAtPaise: n(r?.compareAtPaise),
      offlinePricePaise: n(r?.offlinePricePaise),
      costPaise: n(r?.costPaise),
      tiers: tiers.filter((t) => t.variantId === v.variantId).map((t) => ({ minQty: t.minQty, unitPaise: p(t.unitPricePaise) })),
    };
  });
}

type Snapshot = { pricePaise: number; compareAtPaise: number | null; offlinePricePaise: number | null; costPaise: number | null; tiers: { minQty: number; unitPaise: number }[] };

/**
 * Saves one variant's prices and tiers (validated again here, whatever the caller did). A real change
 * writes a core audit row with before/after and emits `price.changed` in the same transaction, then
 * expires the product's price tag. Saving identical values changes nothing and records nothing.
 * Permission is the caller's job (the admin action checks `pricing.write`; the seed runs as system).
 */
export async function saveVariantPricing(
  input: VariantPricingInput,
  actor: { actorId: string | null; actorType?: 'staff' | 'system' },
): Promise<{ changed: boolean }> {
  const v = variantPricingSchema.parse(input);
  const after: Snapshot = { pricePaise: v.pricePaise, compareAtPaise: v.compareAtPaise, offlinePricePaise: v.offlinePricePaise, costPaise: v.costPaise, tiers: v.tiers };
  const changed = await withTx(async (tx) => {
    const [row] = await tx.select().from(pricingPrice).where(eq(pricingPrice.variantId, v.variantId)).for('update');
    const oldTiers = row ? await tx.select().from(pricingTier).where(eq(pricingTier.variantId, v.variantId)).orderBy(asc(pricingTier.minQty)) : [];
    const before: Snapshot | null = row
      ? { pricePaise: row.pricePaise, compareAtPaise: row.compareAtPaise, offlinePricePaise: row.offlinePricePaise, costPaise: row.costPaise, tiers: oldTiers.map((t) => ({ minQty: t.minQty, unitPaise: t.unitPricePaise })) }
      : null;
    if (before && row!.productId === v.productId && JSON.stringify(before) === JSON.stringify(after)) return false;

    const values = { productId: v.productId, pricePaise: v.pricePaise, compareAtPaise: v.compareAtPaise, offlinePricePaise: v.offlinePricePaise, costPaise: v.costPaise, updatedAt: new Date() };
    await tx.insert(pricingPrice).values({ variantId: v.variantId, ...values }).onConflictDoUpdate({ target: pricingPrice.variantId, set: values });
    await tx.delete(pricingTier).where(eq(pricingTier.variantId, v.variantId));
    if (v.tiers.length) await tx.insert(pricingTier).values(v.tiers.map((t) => ({ variantId: v.variantId, minQty: t.minQty, unitPricePaise: t.unitPaise })));
    await audit({ actorId: actor.actorId, actorType: actor.actorType ?? 'staff', action: 'price.update', entity: 'variant', entityId: v.variantId, before, after }, { tx });
    await emit('price.changed', { productId: v.productId, variantId: v.variantId }, { tx });
    return true;
  });
  if (changed) await invalidateTags([tags.price(v.productId)]);
  return { changed };
}
