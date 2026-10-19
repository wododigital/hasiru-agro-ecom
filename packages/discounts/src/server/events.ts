import { releaseRedemptions } from './discounts';

/** order.cancelled / order.payment_failed: the order's discount uses no longer count against limits. */
export async function releaseOnOrderEnd(payload: { orderId: string }): Promise<void> {
  await releaseRedemptions(payload.orderId);
}
