import type { StockInfo } from '@ecomkit/core/contracts';
import type { AvailabilityOverride, Status } from './enums';

/**
 * What the storefront shows for a product. `hidden` products are not listed and their PDP 404s.
 * Derived from: product status, the admin override, and live stock (null when the inventory module is off).
 */
export type AvailabilityState = 'in_stock' | 'low_stock' | 'preorder' | 'out_of_stock' | 'temporarily_unavailable' | 'coming_soon' | 'hidden';

export interface AvailabilityInput {
  status: Status;
  override: AvailabilityOverride | null;
  deletedAt?: Date | null;
  stock: StockInfo | null;
}

export function deriveAvailability({ status, override, deletedAt, stock }: AvailabilityInput): AvailabilityState {
  if (status !== 'active' || deletedAt || override === 'hidden') return 'hidden';
  if (override === 'out_of_stock' || override === 'temporarily_unavailable' || override === 'coming_soon') return override;
  if (override === 'available' || !stock) return 'in_stock';
  if (stock.availability === 'preorder') return 'preorder';
  if (stock.availability === 'out_of_stock' || stock.available <= 0) return 'out_of_stock';
  return stock.lowStock ? 'low_stock' : 'in_stock';
}

/** Can be added to the cart (pre-orders included). */
export const isPurchasable = (state: AvailabilityState): boolean => state === 'in_stock' || state === 'low_stock' || state === 'preorder';

/** Shows the Notify me form instead of Add to cart. */
export const wantsNotify = (state: AvailabilityState): boolean => state === 'out_of_stock' || state === 'temporarily_unavailable' || state === 'coming_soon';

/** Schema.org availability bucket for the Offer. */
export function offerAvailability(state: AvailabilityState): 'in_stock' | 'preorder' | 'out_of_stock' {
  if (state === 'in_stock' || state === 'low_stock') return 'in_stock';
  if (state === 'preorder' || state === 'coming_soon') return 'preorder';
  return 'out_of_stock';
}
