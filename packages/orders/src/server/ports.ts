import type { InventoryOps, Paise } from '@ecomkit/core/contracts';
import type { DbOrTx } from '@ecomkit/core/db';
import { defineSettings } from '@ecomkit/core/settings';
import { ordersSettingsSchema, type ProductSnapshot } from '../domain';

export const ordersSettings = defineSettings('orders', ordersSettingsSchema);

/** A catalogue variant resolved by SKU for the manual order form. */
export interface ManualLineRef {
  variantId: string;
  productId: string;
  unitPaise: number;
  snapshot: ProductSnapshot;
}

/**
 * What orders needs from optional modules. The host binds them at boot (`configureOrders`), normally from the
 * registry; each may stay null and the matching feature degrades (no stock release, no refund button, no SKU lookup).
 */
export interface OrdersPorts {
  /** The `inventory` service: commit the order's hold on payment, release it on cancel. */
  inventory: (() => Promise<Pick<InventoryOps, 'reserve' | 'commit' | 'release'> | null>) | null;
  /** discounts `releaseRedemptions`: a cancelled order frees its coupon and promo uses. */
  discounts: { releaseRedemptions(orderId: string, conn: DbOrTx): Promise<number> } | null;
  /** payments: refund through the provider (it calls `recordRefund` when the refund settles) and payment links. */
  payments: {
    refund(input: { orderId: string; amountPaise: Paise; reason: string; actorId: string }): Promise<{ ok: true; refundId: string } | { ok: false; error: string }>;
    paymentLink(input: { orderId: string; amountPaise: Paise }): Promise<string | null>;
  } | null;
  /** catalog: SKU lookup for manual orders. */
  catalog: { variantBySku(sku: string): Promise<ManualLineRef | null> } | null;
}

// On globalThis: instrumentation (boot) and route bundles are separate module instances in Next.
const ports: OrdersPorts = ((globalThis as Record<symbol, OrdersPorts | undefined>)[Symbol.for('ecomkit.orders.ports')] ??= { inventory: null, discounts: null, payments: null, catalog: null });
export const getOrdersPorts = (): Readonly<OrdersPorts> => ports;
export function configureOrders(next: Partial<OrdersPorts>): void {
  Object.assign(ports, next);
}

export async function inventoryPort() {
  return ports.inventory ? ports.inventory() : null;
}
