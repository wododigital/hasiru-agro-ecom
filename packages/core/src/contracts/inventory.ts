export type Availability = 'in_stock' | 'preorder' | 'out_of_stock';

export interface StockInfo {
  variantId: string;
  /** onHand minus active reservations, floored at 0. */
  available: number;
  onHand: number;
  reserved: number;
  availability: Availability;
  readyInDays: number | null;
  lowStock: boolean;
}

export interface ReserveLine {
  variantId: string;
  qty: number;
}

export interface Reservation {
  reservationId: string;
  expiresAt: Date;
  lines: readonly ReserveLine[];
}

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; shortages: readonly { variantId: string; requested: number; available: number }[] };

/** Service key `inventory`, provided by `@ecomkit/inventory`. `tx` is the caller's Drizzle transaction. */
export interface InventoryOps {
  getStock(variantId: string): Promise<StockInfo | null>;
  /** Keyed by variantId. */
  getStocks(variantIds: readonly string[]): Promise<Record<string, StockInfo>>;
  /** `reference` is the payment attempt or order id the hold belongs to; `ttlSec` ties it to the attempt expiry (A27). */
  reserve(lines: readonly ReserveLine[], options: { ttlSec: number; reference: string; tx?: unknown }): Promise<ReserveResult>;
  commit(reservationId: string, options?: { tx?: unknown }): Promise<void>;
  release(reservationId: string, options?: { tx?: unknown }): Promise<void>;
}
