import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, withTx, type Tx } from '@ecomkit/core/db';
import { newId } from '@ecomkit/core/ids';
import { getSettings } from '@ecomkit/core/settings';
import { DATE_RE, isBeforeCutoff, parseBlackout, roundKg, weekdayOf } from '../domain';
import { shippingSlot, shippingSlotBooking } from '../schema';
import { shippingSettings } from '../settings';

export interface BookSlotInput {
  orderId: string;
  orderNumber: string;
  /** YYYY-MM-DD (IST), one of the dates `nextSlots` offered. */
  slotDate: string;
  weightKg: number;
}

export type BookSlotResult = { ok: true; bookingId: string } | { ok: false; reason: 'slot_closed' | 'slot_full' };

/**
 * Books the order onto a local slot day. Call it inside checkout's place-order transaction (`tx`) so the booking
 * exists only if the order does. Capacity is checked under a row lock on the slot, so two orders racing for the
 * last room cannot both get it. Idempotent per order: a second call returns the existing booking.
 */
export async function bookSlot(input: BookSlotInput, options: { tx?: Tx; now?: Date } = {}): Promise<BookSlotResult> {
  const run = async (tx: Tx): Promise<BookSlotResult> => {
    const now = options.now ?? new Date();
    const [existing] = await tx
      .select({ id: shippingSlotBooking.id })
      .from(shippingSlotBooking)
      .where(and(eq(shippingSlotBooking.orderId, input.orderId), isNull(shippingSlotBooking.cancelledAt)))
      .limit(1);
    if (existing) return { ok: true, bookingId: existing.id };
    if (!DATE_RE.test(input.slotDate)) return { ok: false, reason: 'slot_closed' };
    const settings = await getSettings(shippingSettings, tx);
    if (parseBlackout(settings.blackout_dates).has(input.slotDate)) return { ok: false, reason: 'slot_closed' };

    const slots = await tx
      .select()
      .from(shippingSlot)
      .where(and(eq(shippingSlot.weekday, weekdayOf(input.slotDate)), eq(shippingSlot.isActive, true)))
      .orderBy(shippingSlot.createdAt)
      .for('update');
    const open = slots.filter((s) => isBeforeCutoff(input.slotDate, s.cutoffHours, now));
    if (!open.length) return { ok: false, reason: 'slot_closed' };

    const [booked] = await tx
      .select({ kg: sql<string>`coalesce(sum(${shippingSlotBooking.weightKg}), 0)` })
      .from(shippingSlotBooking)
      .where(and(eq(shippingSlotBooking.slotDate, input.slotDate), isNull(shippingSlotBooking.cancelledAt)));
    const weightKg = roundKg(input.weightKg);
    const slot = open.find((s) => s.capacityKg === null || Number(booked?.kg ?? 0) + weightKg <= s.capacityKg);
    if (!slot) return { ok: false, reason: 'slot_full' };

    const id = newId();
    // A cancelled booking for the same order is replaced (the unique index is per order).
    await tx.delete(shippingSlotBooking).where(eq(shippingSlotBooking.orderId, input.orderId));
    await tx.insert(shippingSlotBooking).values({ id, slotId: slot.id, slotDate: input.slotDate, orderId: input.orderId, orderNumber: input.orderNumber, weightKg });
    return { ok: true, bookingId: id };
  };
  return options.tx ? run(options.tx) : withTx(run);
}

/** Frees the order's slot room (order cancelled or payment failed). Returns whether a booking was released. */
export async function cancelBooking(orderId: string, options: { tx?: Tx } = {}): Promise<boolean> {
  const rows = await (options.tx ?? db)
    .update(shippingSlotBooking)
    .set({ cancelledAt: new Date() })
    .where(and(eq(shippingSlotBooking.orderId, orderId), isNull(shippingSlotBooking.cancelledAt)))
    .returning({ id: shippingSlotBooking.id });
  return rows.length > 0;
}

/** Orders and kg booked on one date (dispatch planner, dashboard "truck fill" card). */
export async function slotLoad(slotDate: string): Promise<{ orders: number; weightKg: number }> {
  const [row] = await db
    .select({ orders: sql<number>`count(*)::int`, kg: sql<string>`coalesce(sum(${shippingSlotBooking.weightKg}), 0)` })
    .from(shippingSlotBooking)
    .where(and(eq(shippingSlotBooking.slotDate, slotDate), isNull(shippingSlotBooking.cancelledAt)));
  return { orders: row?.orders ?? 0, weightKg: Number(row?.kg ?? 0) };
}
