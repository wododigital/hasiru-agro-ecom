import type { Paise } from './common';

/**
 * Input to `computeTotals` (implemented once in `@ecomkit/core/totals`; used by cart preview,
 * checkout quote and order snapshot). Plain data only, no DB access. All amounts GST-inclusive.
 */
export interface TotalsLineInput {
  lineId: string;
  productId: string;
  variantId: string;
  qty: number;
  /** Online list price per unit. */
  listUnitPaise: Paise;
  /** Unit price after the bulk tier (equals list when no tier applies). */
  tierUnitPaise: Paise;
  gstRatePct: number;
  weightKg: number;
}

/** A discount already computed by `@ecomkit/discounts`, allocated to lines so GST can be split per rate. */
export interface AppliedDiscountInput {
  id: string;
  kind: 'automatic' | 'coupon';
  label: string;
  /** A coupon stacks with an automatic promo only when that promo is stackable (A8). */
  stackable: boolean;
  allocations: readonly { lineId: string; amountPaise: Paise }[];
}

export interface TotalsInput {
  lines: readonly TotalsLineInput[];
  automaticPromos: readonly AppliedDiscountInput[];
  /** At most one coupon per order. */
  coupon: AppliedDiscountInput | null;
  packingPaise: Paise;
  transportPaise: Paise;
  /** GST rate included in packing and transport charges. Defaults to 0. */
  chargesGstRatePct?: number;
  /** Seller state differs from delivery state: IGST instead of CGST + SGST. */
  interState: boolean;
}

export interface TotalsLine {
  lineId: string;
  qty: number;
  listUnitPaise: Paise;
  unitPaise: Paise;
  discountPaise: Paise;
  /** unitPaise x qty minus discountPaise. */
  lineTotalPaise: Paise;
  gstRatePct: number;
  taxPaise: Paise;
}

export interface TotalsTaxRate {
  ratePct: number;
  taxablePaise: Paise;
  taxPaise: Paise;
}

/**
 * Pinned definitions (prototype fix F2):
 * subtotalPaise = sum(list unit x qty); tierSavingsPaise = sum((list - tier) x qty);
 * totalPaise = subtotal - tierSavings - promo - coupon + packing + transport.
 * Tax is the inclusive component, reported, never added on top.
 */
export interface TotalsBreakdown {
  lines: readonly TotalsLine[];
  subtotalPaise: Paise;
  tierSavingsPaise: Paise;
  promoDiscountPaise: Paise;
  couponDiscountPaise: Paise;
  appliedDiscounts: readonly { id: string; kind: 'automatic' | 'coupon'; label: string; amountPaise: Paise }[];
  /** Discounts dropped by the stacking rule (best-of when not stackable). */
  rejectedDiscounts: readonly { id: string; reason: 'not_stackable' }[];
  packingPaise: Paise;
  transportPaise: Paise;
  totalPaise: Paise;
  tax: {
    interState: boolean;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    totalTaxPaise: Paise;
    byRate: readonly TotalsTaxRate[];
  };
  totalWeightKg: number;
}

export type ComputeTotals = (input: TotalsInput) => TotalsBreakdown;
