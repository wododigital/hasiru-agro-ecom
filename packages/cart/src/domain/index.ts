// Pure cart rules: input schemas, line weight, bulk nudges, totals input. No React, no Next, no DB.
import type { AppliedDiscountInput, Paise, PriceQuote, TotalsInput } from '@ecomkit/core/contracts';
import { SLUG_RE } from '@ecomkit/core/ids';
import { asPaise } from '@ecomkit/core/money';
import { z } from 'zod';

export const MAX_LINE_QTY = 100_000;
export const MAX_LINES = 200;
/** Name of the httpOnly cookie that carries the cart token. */
export const CART_COOKIE = 'cart';
/** `cart.updated` is emitted at most once per cart in this window (subscribers read fresh state anyway). */
export const UPDATED_EVENT_GAP_MS = 60_000;

export const cartSettingsSchema = z.object({
  abandonAfterMinutes: z
    .number()
    .int()
    .min(15)
    .max(7 * 24 * 60)
    .default(60)
    .meta({ group: 'Abandoned carts', help: 'A cart with items and no activity for this long is marked abandoned (cart.abandoned).' }),
  restoreLinkDays: z.number().int().min(1).max(90).default(30).meta({ group: 'Abandoned carts', help: 'How long a cart restore link in a reminder message keeps working.' }),
  cookieDays: z.number().int().min(1).max(365).default(60).meta({ group: 'Cart', help: 'How long a visitor keeps the same cart on one device.' }),
  inputsHref: z.string().startsWith('/').max(200).default('/inputs').meta({ group: 'Cart', help: 'Where "Recommended inputs" sends shoppers with plants and no inputs in the cart.' }),
});
export type CartSettings = z.infer<typeof cartSettingsSchema>;

const qty = z.number().int().min(1).max(MAX_LINE_QTY);

/** CartLineOrigin (cart-block contract) plus the planting extras kept on package lines. */
export const originSchema = z
  .object({
    source: z.enum(['shop', 'planting', 'calculator', 'assistant', 'restore']),
    modelSlug: z.string().max(80).regex(SLUG_RE).optional(),
    weightKg: z.number().positive().max(10_000).optional(),
    role: z.string().max(40).optional(),
    recommendedQty: qty.optional(),
  })
  .strict();
export type LineOrigin = z.infer<typeof originSchema>;

export const addLineSchema = z.object({ variantId: z.uuid(), qty, origin: originSchema.nullable().default(null) });
export type AddLineInput = z.input<typeof addLineSchema>;

/** The catalog buttons' JSON body (`POST /api/cart/lines`). */
export const deltaSchema = z.object({
  variantId: z.uuid(),
  delta: z
    .number()
    .int()
    .min(-MAX_LINE_QTY)
    .max(MAX_LINE_QTY)
    .refine((n) => n !== 0, 'delta must not be 0'),
});

/** The no-JS form post: `variantId, qty, intent=add|buy`. */
export const formAddSchema = z.object({ variantId: z.uuid(), qty: z.coerce.number().pipe(qty).default(1), intent: z.enum(['add', 'buy']).default('add') });

export const setQtySchema = z.object({ lineId: z.uuid(), qty: z.number().int().min(0).max(MAX_LINE_QTY) });

export const replacePackageSchema = z.object({
  packageId: z.string().min(1).max(80),
  landSqft: z.number().positive().max(1e9).nullable().default(null),
  lines: z.array(z.object({ variantId: z.uuid(), qty, origin: originSchema.nullable().default(null) })).max(MAX_LINES),
});
export type ReplacePackageInput = z.input<typeof replacePackageSchema>;

export const couponSchema = z.object({ code: z.string().trim().min(1).max(40) });
export const methodSchema = z.object({ methodId: z.string().trim().min(1).max(60).nullable() });

/** Per-unit weight: the planting override (e.g. Miyawaki saplings 0.8 kg) wins over the catalog variant. */
export function lineWeightKg(variantWeightKg: number | null | undefined, origin: Pick<LineOrigin, 'weightKg'> | null | undefined): number {
  return origin?.weightKg ?? variantWeightKg ?? 0;
}

export interface BulkNudge {
  minQty: number;
  qtyToGo: number;
  unitPaise: Paise;
}

/** "Bulk at 100 (37 more)": the next tier the line's group has not reached yet. */
export function bulkNudge(quote: PriceQuote | null | undefined): BulkNudge | null {
  const next = quote?.nextTier;
  if (!next || next.unitPaise >= quote.unitPaise) return null;
  return { minQty: next.minQty, qtyToGo: next.qtyToGo, unitPaise: next.unitPaise };
}

/** "Recommended inputs for your plants": plants in the cart and no inputs yet. */
export function needsInputsSuggestion(kinds: Iterable<'plant' | 'input' | null>): boolean {
  let plant = false;
  for (const k of kinds) {
    if (k === 'input') return false;
    if (k === 'plant') plant = true;
  }
  return plant;
}

export interface TotalsCartLine {
  lineId: string;
  qty: number;
  weightKg: number;
  /** Null when the variant has no price: the line is unavailable and stays out of the totals. */
  quote: PriceQuote | null;
}

/** The single totals pipeline's input (core.computeTotals); the cart never sums money itself. */
export function toTotalsInput(
  lines: readonly TotalsCartLine[],
  discounts: { promos: readonly AppliedDiscountInput[]; coupon: AppliedDiscountInput | null },
  delivery: { packingPaise: number; transportPaise: number } | null,
): TotalsInput {
  return {
    lines: lines.flatMap((l) =>
      l.quote
        ? [{ lineId: l.lineId, productId: l.quote.productId, variantId: l.quote.variantId, qty: l.qty, listUnitPaise: l.quote.listUnitPaise, tierUnitPaise: l.quote.unitPaise, gstRatePct: l.quote.gstRatePct, weightKg: l.weightKg }]
        : [],
    ),
    automaticPromos: discounts.promos,
    coupon: discounts.coupon,
    packingPaise: asPaise(delivery?.packingPaise ?? 0),
    transportPaise: asPaise(delivery?.transportPaise ?? 0),
    interState: false,
  };
}

const slotDate = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Saturday 24 Oct" for a `YYYY-MM-DD` delivery date (already an India-local calendar date). */
export function formatDeliveryDate(isoDate: string): string {
  const parts = Object.fromEntries(slotDate.formatToParts(new Date(`${isoDate}T00:00:00Z`)).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}
