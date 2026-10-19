import type { Paise } from './common';

export interface PriceTier {
  minQty: number;
  unitPaise: Paise;
}

/** Price for one variant at a quantity. All amounts GST-inclusive (A7). */
export interface PriceQuote {
  productId: string;
  variantId: string;
  qty: number;
  /** Online list price per unit. */
  listUnitPaise: Paise;
  /** Real old price, shown on cards only; never enters totals. */
  compareAtPaise: Paise | null;
  /** Unit price after the bulk tier for `qty` (equals list when no tier applies). */
  unitPaise: Paise;
  tier: PriceTier | null;
  nextTier: (PriceTier & { qtyToGo: number }) | null;
  gstRatePct: number;
  lineTotalPaise: Paise;
}

/** Service key `pricing`, provided by `@ecomkit/pricing`. */
export interface PricingReader {
  getPrice(variantId: string, qty: number): Promise<PriceQuote | null>;
  /** Keyed by variantId. Missing variants are absent from the record. */
  getPrices(items: readonly { variantId: string; qty: number }[]): Promise<Record<string, PriceQuote>>;
}
