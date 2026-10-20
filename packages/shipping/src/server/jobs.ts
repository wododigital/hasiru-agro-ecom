import { and, eq, isNull } from 'drizzle-orm';
import type { EventHandler, JobHandler } from '@ecomkit/core/contracts';
import { withTx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { addDays, istDate } from '../domain';
import { shippingSlotBooking } from '../schema';
import { cancelBooking } from './bookings';

/**
 * Emits `slot.reminder` once per order booked for tomorrow (IST). The event and the `reminded_at` stamp are written
 * in one transaction (outbox), so a rerun, a retry or a second worker never reminds the same order twice.
 */
export async function sendSlotReminders(options: { now?: Date } = {}): Promise<number> {
  const tomorrow = addDays(istDate(options.now ?? new Date()), 1);
  return withTx(async (tx) => {
    const due = await tx
      .select({ id: shippingSlotBooking.id, orderId: shippingSlotBooking.orderId, orderNumber: shippingSlotBooking.orderNumber })
      .from(shippingSlotBooking)
      .where(and(eq(shippingSlotBooking.slotDate, tomorrow), isNull(shippingSlotBooking.remindedAt), isNull(shippingSlotBooking.cancelledAt)))
      .for('update', { skipLocked: true });
    for (const b of due) {
      await emit('slot.reminder', { orderId: b.orderId, orderNumber: b.orderNumber, slotDate: tomorrow }, { tx });
      await tx.update(shippingSlotBooking).set({ remindedAt: new Date() }).where(eq(shippingSlotBooking.id, b.id));
    }
    return due.length;
  });
}

/** `shipping.slot-reminders`, hourly in the day: bookings made late on the day before still get their reminder. */
export const slotRemindersJob: JobHandler<unknown> = async (_data, ctx) => {
  const sent = await sendSlotReminders();
  if (sent) ctx.log.info('slot reminders emitted', { orders: sent });
};

export const onOrderCancelled: EventHandler<'order.cancelled'> = async (payload) => {
  await cancelBooking(payload.orderId);
};

export const onPaymentFailed: EventHandler<'order.payment_failed'> = async (payload) => {
  await cancelBooking(payload.orderId);
};
