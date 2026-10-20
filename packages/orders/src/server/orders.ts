import { createHash, createHmac } from 'node:crypto';
import { audit } from '@ecomkit/core/audit';
import { db, withTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { derivedSecret } from '@ecomkit/core/http';
import { newId, orderNumber } from '@ecomkit/core/ids';
import { asPaise } from '@ecomkit/core/money';
import { getSettings } from '@ecomkit/core/settings';
import { recordOrder } from '@ecomkit/customers/server';
import { and, eq, sql } from 'drizzle-orm';
import {
  checkTransition,
  createOrderSchema,
  paymentStatusFor,
  replacementInputSchema,
  STATUS_EVENT,
  type CreateOrderInput,
  type OrderStatus,
  type ReplacementInput,
  type TransitionActor,
} from '../domain';
import { ordersEvent, ordersFulfilment, ordersLine, ordersOrder } from '../schema';
import { getOrdersPorts, inventoryPort, ordersSettings } from './ports';

export type OrderRow = typeof ordersOrder.$inferSelect;
export type OrderLineRow = typeof ordersLine.$inferSelect;

export class OrderError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_allowed' | 'forbidden' | 'out_of_stock' | 'invalid' | string,
    message = code,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export const hashGuestToken = (token: string): string => createHash('sha256').update(token).digest('base64url');

/**
 * The guest link token: a signature over the order id under the server secret (purpose `guest-order`), so a
 * replayed place-order can hand back the same link; only its hash is stored, and lookups go through the hash.
 */
export const guestTokenFor = (orderId: string): string => createHmac('sha256', derivedSecret('guest-order')).update(orderId).digest('base64url');

const run = <T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>) => (tx ? fn(tx) : withTx(fn));
const actorFields = (actor: TransitionActor) => ({ actorId: actor.type === 'staff' ? actor.id : null });

async function lockOrder(tx: Tx, orderId: string): Promise<OrderRow> {
  const [order] = await tx.select().from(ordersOrder).where(eq(ordersOrder.id, orderId)).for('update');
  if (!order) throw new OrderError('not_found');
  return order;
}

async function addEvent(tx: Tx, orderId: string, type: string, data: Record<string, unknown>, actorId: string | null = null) {
  await tx.insert(ordersEvent).values({ orderId, type, data, actorId });
}

const ref = (o: Pick<OrderRow, 'id' | 'number'>) => ({ orderId: o.id, orderNumber: o.number });

/**
 * Creates an order with its line snapshots inside the caller's transaction: the number comes from the gapless
 * `order` sequence, a random guest token is returned once (only its hash is stored) and `order.placed` is
 * emitted in the same transaction. Checkout calls this from place-order; manual and replacement orders too.
 */
export async function createOrder(raw: CreateOrderInput, options: { tx: Tx; now?: Date }): Promise<{ id: string; number: string; guestToken: string; order: OrderRow }> {
  const input = createOrderSchema.parse(raw);
  const { tx } = options;
  const settings = await getSettings(ordersSettings, tx);
  const now = options.now ?? new Date();
  const number = await orderNumber(tx, { prefix: settings.numberPrefix, at: now });
  const id = newId();
  const guestToken = guestTokenFor(id);
  const t = input.totals;
  const zeroValue = t.totalPaise === 0;
  const paymentStatus = zeroValue ? 'paid' : 'unpaid';
  const [order] = await tx
    .insert(ordersOrder)
    .values({
      id,
      number,
      customerId: input.customerId ?? null,
      guestTokenHash: hashGuestToken(guestToken),
      status: input.initialStatus,
      paymentStatus,
      paymentMode: input.paymentMode,
      contact: input.contact,
      shippingAddress: input.shippingAddress ?? null,
      billing: input.billing ?? null,
      delivery: input.delivery,
      subtotalPaise: t.subtotalPaise,
      tierSavingsPaise: t.tierSavingsPaise,
      promoPaise: t.promoPaise,
      couponPaise: t.couponPaise,
      packingPaise: t.packingPaise,
      shippingPaise: t.shippingPaise,
      taxPaise: t.taxPaise,
      totalPaise: t.totalPaise,
      balanceDuePaise: t.totalPaise,
      advancePaise: input.advancePaise ?? t.totalPaise,
      totals: { ...t.breakdown, chargesGstRatePct: t.chargesGstRatePct },
      weightKg: t.weightKg,
      isTest: input.isTest,
      source: input.source,
      parentOrderId: input.parentOrderId ?? null,
      planId: input.planId ?? null,
      reservationId: input.reservationId ?? null,
      attribution: input.attribution ?? null,
      notes: input.notes ?? null,
      placedAt: now,
    })
    .returning();
  await tx.insert(ordersLine).values(
    input.lines.map((l) => ({
      orderId: order!.id,
      variantId: l.variantId,
      productId: l.productId,
      productSnapshot: l.snapshot,
      qty: l.qty,
      listUnitPaise: l.listUnitPaise,
      unitPricePaise: l.unitPaise,
      tierApplied: l.tierApplied,
      lineDiscountPaise: l.discountPaise,
      lineTaxPaise: l.taxPaise,
      lineTotalPaise: l.lineTotalPaise,
      kind: l.kind,
      origin: l.origin ?? null,
    })),
  );
  await addEvent(tx, order!.id, 'placed', { source: input.source, status: input.initialStatus, totalPaise: t.totalPaise });
  if (input.source !== 'replacement') await emit('order.placed', ref(order!), { tx });
  if (input.initialStatus === 'confirmed' && input.source !== 'replacement') await emit('order.confirmed', ref(order!), { tx });
  return { id: order!.id, number, guestToken, order: order! };
}

/**
 * Payment hook (called by payments once the provider's status API confirms money arrived). Idempotent per
 * payment attempt. Returns `applied: false, reason: 'cancelled'` for a late payment on a cancelled order, which
 * payments turns into a critical alert and a refund task (A27); the order is never flipped back.
 */
export async function markPaymentReceived(
  input: { orderId: string; amountPaise: number; attemptId: string | null; actorId?: string | null; at?: Date },
  options: { tx?: Tx } = {},
): Promise<{ applied: true; order: OrderRow } | { applied: false; reason: 'cancelled' | 'duplicate'; order: OrderRow }> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new OrderError('invalid', 'payment amount must be positive integer paise');
  return run(options.tx, async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (order.status === 'cancelled') return { applied: false, reason: 'cancelled', order };
    if (input.attemptId) {
      const [seen] = await tx
        .select({ id: ordersEvent.id })
        .from(ordersEvent)
        .where(and(eq(ordersEvent.orderId, order.id), eq(ordersEvent.type, 'payment'), sql`${ordersEvent.data} ->> 'attemptId' = ${input.attemptId}`));
      if (seen) return { applied: false, reason: 'duplicate', order };
    }
    const paid = order.paidPaise + input.amountPaise;
    const firstPayment = order.paidPaise === 0;
    const status: OrderStatus = order.status === 'pending_payment' ? 'paid' : order.status;
    const [updated] = await tx
      .update(ordersOrder)
      .set({
        paidPaise: paid,
        balanceDuePaise: Math.max(0, order.totalPaise - paid),
        paymentStatus: paymentStatusFor(order.totalPaise, paid, order.refundedPaise),
        status,
        updatedAt: sql`now()`,
      })
      .where(eq(ordersOrder.id, order.id))
      .returning();
    await addEvent(tx, order.id, 'payment', { attemptId: input.attemptId, amountPaise: input.amountPaise, paidPaise: paid }, input.actorId ?? null);
    if (status !== order.status) await addEvent(tx, order.id, 'status', { from: order.status, to: status });
    if (order.status === 'pending_payment' && order.reservationId) {
      const inventory = await inventoryPort();
      await inventory?.commit(order.reservationId, { tx });
    }
    if (firstPayment && order.customerId && !order.isTest) await recordOrder({ userId: order.customerId, amountPaise: order.totalPaise, at: input.at ?? new Date() }, { tx });
    await emit('order.paid', { ...ref(order), amountPaise: asPaise(input.amountPaise), paymentAttemptId: input.attemptId }, { tx });
    return { applied: true, order: updated! };
  });
}

async function releaseHolds(tx: Tx, order: OrderRow) {
  if (order.reservationId) {
    const inventory = await inventoryPort();
    await inventory?.release(order.reservationId, { tx });
  }
  await getOrdersPorts().discounts?.releaseRedemptions(order.id, tx);
}

/**
 * Pending-payment sweep hook (called by the payments sweep for expired attempts): cancels the order only while it
 * is still `pending_payment`, releases the stock hold and discount uses, and emits `order.payment_failed`.
 * Returns false when the order had moved on (paid meanwhile, or already cancelled).
 */
export async function cancelPendingPayment(
  orderId: string,
  reason: 'failed' | 'expired' | 'abandoned' | 'amount_mismatch',
  options: { tx?: Tx } = {},
): Promise<boolean> {
  return run(options.tx, async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== 'pending_payment' || order.paidPaise > 0) return false;
    await tx.update(ordersOrder).set({ status: 'cancelled', paymentStatus: 'failed', updatedAt: sql`now()` }).where(eq(ordersOrder.id, order.id));
    await releaseHolds(tx, order);
    await addEvent(tx, order.id, 'status', { from: order.status, to: 'cancelled', reason });
    await emit('order.payment_failed', { ...ref(order), reason }, { tx });
    await emit('order.cancelled', { ...ref(order), reason: `payment_${reason}` }, { tx });
    return true;
  });
}

/**
 * Status change with the machine's guards and permission (staff) checks. Writes the timeline, the fulfilment
 * row (packed, dispatched, delivered), an audit row for staff moves, and emits the matching catalogue event.
 */
export async function transition(orderId: string, to: OrderStatus, options: { actor: TransitionActor; note?: string; tx?: Tx; at?: Date }): Promise<OrderRow> {
  return run(options.tx, async (tx) => {
    const order = await lockOrder(tx, orderId);
    const check = checkTransition(order, to, options.actor);
    if (!check.ok) throw new OrderError(check.reason === 'forbidden' ? 'forbidden' : 'not_allowed', `${order.status} -> ${to}: ${check.reason}`);
    const [updated] = await tx.update(ordersOrder).set({ status: to, updatedAt: sql`now()` }).where(eq(ordersOrder.id, order.id)).returning();
    const at = options.at ?? new Date();
    if (to === 'packed' || to === 'dispatched' || to === 'delivered') {
      const patch = { status: to, ...(to === 'dispatched' ? { dispatchedAt: at } : {}), ...(to === 'delivered' ? { deliveredAt: at } : {}) };
      await tx.insert(ordersFulfilment).values({ orderId: order.id, ...patch }).onConflictDoUpdate({ target: ordersFulfilment.orderId, set: patch });
    }
    if (to === 'cancelled') await releaseHolds(tx, order);
    const { actorId } = actorFields(options.actor);
    await addEvent(tx, order.id, 'status', { from: order.status, to, ...(options.note ? { note: options.note } : {}) }, actorId);
    if (options.actor.type === 'staff') {
      await audit({ actorId, actorType: 'staff', action: 'order.transition', entity: 'order', entityId: order.id, before: { status: order.status }, after: { status: to } }, { tx });
    }
    const event = STATUS_EVENT[to as keyof typeof STATUS_EVENT];
    if (event === 'order.cancelled') await emit(event, { ...ref(order), reason: options.note ?? null }, { tx });
    else if (event) await emit(event, ref(order), { tx });
    return updated!;
  });
}

/**
 * Refund hook (payments calls it when a refund settles). Moves the order to refunded or partially_refunded
 * through the machine and emits `order.refunded`. Idempotent per refund id.
 */
export async function recordRefund(input: { orderId: string; refundId: string; amountPaise: number }, options: { tx?: Tx } = {}): Promise<OrderRow> {
  return run(options.tx, async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    const [seen] = await tx
      .select({ id: ordersEvent.id })
      .from(ordersEvent)
      .where(and(eq(ordersEvent.orderId, order.id), eq(ordersEvent.type, 'refund'), sql`${ordersEvent.data} ->> 'refundId' = ${input.refundId}`));
    if (seen) return order;
    const refunded = order.refundedPaise + input.amountPaise;
    if (input.amountPaise <= 0 || refunded > order.paidPaise) throw new OrderError('invalid', 'refund exceeds the amount paid');
    const to: OrderStatus = refunded >= order.paidPaise ? 'refunded' : 'partially_refunded';
    const next = { ...order, refundedPaise: refunded };
    const check = to === order.status ? { ok: true as const } : checkTransition(next, to, { type: 'system' });
    if (!check.ok) throw new OrderError('not_allowed', `${order.status} -> ${to}: ${check.reason}`);
    const [updated] = await tx
      .update(ordersOrder)
      .set({ refundedPaise: refunded, status: to, paymentStatus: paymentStatusFor(order.totalPaise, order.paidPaise, refunded), updatedAt: sql`now()` })
      .where(eq(ordersOrder.id, order.id))
      .returning();
    await addEvent(tx, order.id, 'refund', { refundId: input.refundId, amountPaise: input.amountPaise, refundedPaise: refunded });
    if (to !== order.status) await addEvent(tx, order.id, 'status', { from: order.status, to });
    await emit('order.refunded', { ...ref(order), refundId: input.refundId, amountPaise: asPaise(input.amountPaise) }, { tx });
    return updated!;
  });
}

/**
 * Damage replacement (policy: no cancellation, damage replaced). Creates a zero-value order linked to a delivered
 * parent with the chosen lines and quantities: `source = replacement`, `payment_status = paid`, starting at
 * `confirmed`, so it enters dispatch planning like any order. Stock for the lines is taken at once when the
 * inventory module is on. The parent timeline records the link.
 */
export async function createReplacement(raw: ReplacementInput, options: { actorId: string; tx?: Tx; now?: Date }): Promise<{ id: string; number: string }> {
  const input = replacementInputSchema.parse(raw);
  return run(options.tx, async (tx) => {
    const parent = await lockOrder(tx, input.parentOrderId);
    if (parent.status !== 'delivered' && parent.status !== 'partially_refunded') throw new OrderError('not_allowed', 'replacements are for delivered orders');
    const parentLines = await tx.select().from(ordersLine).where(eq(ordersLine.orderId, parent.id));
    const lines = input.lines.map((pick) => {
      const l = parentLines.find((x) => x.id === pick.lineId);
      if (!l) throw new OrderError('invalid', `line ${pick.lineId} is not on the order`);
      if (pick.qty > l.qty) throw new OrderError('invalid', `line ${pick.lineId}: at most ${l.qty}`);
      return { l, qty: pick.qty };
    });
    const weightKg = lines.reduce((s, { l, qty }) => s + qty * Number((l.productSnapshot as { weightKg?: number }).weightKg ?? 0), 0);
    let reservationId: string | null = null;
    const inventory = await inventoryPort();
    if (inventory) {
      const held = await inventory.reserve(
        lines.map(({ l, qty }) => ({ variantId: l.variantId, qty })),
        { ttlSec: 3600, reference: `replacement:${parent.id}`, tx },
      );
      if (!held.ok) throw new OrderError('out_of_stock', held.shortages.map((s) => `${s.variantId}: ${s.available} left`).join(', '));
      reservationId = held.reservation.reservationId;
      await inventory.commit(reservationId, { tx });
    }
    const zero = 0;
    const delivery = { ...(parent.delivery as Record<string, unknown>), slotDate: null };
    const created = await createOrder(
      {
        customerId: parent.customerId,
        contact: parent.contact as never,
        shippingAddress: (parent.shippingAddress as never) ?? null,
        delivery: delivery as never,
        lines: lines.map(({ l, qty }) => ({
          variantId: l.variantId,
          productId: l.productId,
          snapshot: l.productSnapshot as never,
          qty,
          listUnitPaise: zero,
          unitPaise: zero,
          lineTotalPaise: zero,
          kind: l.kind,
          origin: { replacementOf: l.id },
        })),
        totals: {
          subtotalPaise: zero,
          tierSavingsPaise: zero,
          promoPaise: zero,
          couponPaise: zero,
          packingPaise: zero,
          shippingPaise: zero,
          taxPaise: zero,
          totalPaise: zero,
          weightKg,
          breakdown: { replacement: true },
        },
        source: 'replacement',
        paymentMode: 'none',
        initialStatus: 'confirmed',
        reservationId,
        parentOrderId: parent.id,
        isTest: parent.isTest,
        notes: input.reason,
      },
      { tx, now: options.now },
    );
    await addEvent(tx, parent.id, 'replacement_created', { childOrderId: created.id, childNumber: created.number, reason: input.reason }, options.actorId);
    await audit({ actorId: options.actorId, actorType: 'staff', action: 'order.replacement', entity: 'order', entityId: parent.id, after: { childOrderId: created.id, lines: input.lines } }, { tx });
    await emit('order.replacement_created', { orderId: created.id, orderNumber: created.number, parentOrderId: parent.id }, { tx });
    return { id: created.id, number: created.number };
  });
}

export async function addNote(orderId: string, note: string, actorId: string): Promise<void> {
  await withTx(async (tx) => {
    await lockOrder(tx, orderId);
    await addEvent(tx, orderId, 'note', { note }, actorId);
  });
}

export async function setTestFlag(orderId: string, isTest: boolean, actorId: string): Promise<void> {
  await withTx(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.isTest === isTest) return;
    await tx.update(ordersOrder).set({ isTest, updatedAt: sql`now()` }).where(eq(ordersOrder.id, orderId));
    await addEvent(tx, orderId, 'test_flag', { isTest }, actorId);
    await audit({ actorId, actorType: 'staff', action: 'order.test_flag', entity: 'order', entityId: orderId, before: { isTest: order.isTest }, after: { isTest } }, { tx });
  });
}

/** For reviews' verified-buyer flag: a delivered order of this product by this customer. */
export async function verifiedOrderId(customerId: string, productId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: ordersOrder.id })
    .from(ordersOrder)
    .innerJoin(ordersLine, eq(ordersLine.orderId, ordersOrder.id))
    .where(and(eq(ordersOrder.customerId, customerId), eq(ordersLine.productId, productId), eq(ordersOrder.status, 'delivered')))
    .limit(1);
  return row?.id ?? null;
}
