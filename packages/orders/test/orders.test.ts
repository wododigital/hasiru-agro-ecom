import './viewers';
import { withTx } from '@ecomkit/core/db';
import { newId } from '@ecomkit/core/ids';
import { fakeInventory, type TestDb } from '@ecomkit/core/testing';
import { setSettings } from '@ecomkit/core/settings';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ordersEvent, ordersLine, ordersOrder } from '../src/schema';
import {
  cancelPendingPayment,
  configureOrders,
  createManualOrder,
  markPaymentReceived,
  ordersSettings,
  recordRefund,
  requestRefund,
  staffCreateReplacement,
  staffTransition,
  transition,
  verifiedOrderId,
  OrderError,
} from '../src/server';
import { orderInput, ordersDb, outboxEvents, placeTestOrder } from './helpers';
import { asGuest, asStaff } from './viewers';

let t: TestDb;
const inventory = fakeInventory();
const released: string[] = [];

beforeAll(async () => {
  t = await ordersDb('core');
  await setSettings(ordersSettings, { numberPrefix: 'TS', sellerStateCode: 'KA' }, { actorId: null });
});
afterAll(async () => {
  await t?.close();
});
beforeEach(() => {
  asGuest();
  configureOrders({ inventory: async () => inventory, discounts: { releaseRedemptions: async (orderId) => (released.push(orderId), 1) }, payments: null, catalog: null });
});

const statusOf = async (id: string) => (await t.db.select().from(ordersOrder).where(eq(ordersOrder.id, id)))[0]!;
const timeline = async (id: string) => (await t.db.select().from(ordersEvent).where(eq(ordersEvent.orderId, id))).map((e) => e.type);

describe('createOrder', () => {
  it('numbers orders from the gapless sequence with the store prefix and emits order.placed in the transaction', async () => {
    const a = await placeTestOrder();
    const b = await placeTestOrder();
    expect(a.number).toMatch(/^TS-\d{4}-\d{5}$/);
    expect(Number(b.number.slice(-5))).toBe(Number(a.number.slice(-5)) + 1);
    expect(a.guestToken.length).toBeGreaterThanOrEqual(32);
    const row = await statusOf(a.id);
    expect(row).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid', totalPaise: 264_300, balanceDuePaise: 264_300 });
    expect(row.guestTokenHash).not.toBe(a.guestToken);
    expect((await outboxEvents(t, 'order.placed')).map((e) => e.payload.orderId)).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it('a rolled back order returns its number (no gap)', async () => {
    const before = await placeTestOrder();
    await expect(
      withTx(async (tx) => {
        const { createOrder } = await import('../src/server');
        await createOrder(orderInput(), { tx });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const after = await placeTestOrder();
    expect(Number(after.number.slice(-5))).toBe(Number(before.number.slice(-5)) + 1);
  });
});

describe('payment hooks', () => {
  it('marks paid once per attempt, commits the stock hold and emits order.paid', async () => {
    const held = await inventory.reserve([{ variantId: newId(), qty: 2 }], { ttlSec: 900, reference: 'x' });
    if (!held.ok) throw new Error('reserve');
    const o = await placeTestOrder({ reservationId: held.reservation.reservationId });
    const first = await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: 'att-1' });
    expect(first.applied).toBe(true);
    const again = await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: 'att-1' });
    expect(again).toMatchObject({ applied: false, reason: 'duplicate' });
    expect(await statusOf(o.id)).toMatchObject({ status: 'paid', paymentStatus: 'paid', paidPaise: 264_300, balanceDuePaise: 0 });
    expect(inventory.reservations.has(held.reservation.reservationId)).toBe(false);
    expect((await outboxEvents(t, 'order.paid')).filter((e) => e.payload.orderId === o.id)).toHaveLength(1);
  });

  it('partial advance leaves a balance and the order counts as paid for fulfilment', async () => {
    const o = await placeTestOrder({ paymentMode: 'partial_advance', advancePaise: 79_300 });
    await markPaymentReceived({ orderId: o.id, amountPaise: 79_300, attemptId: 'adv-1' });
    expect(await statusOf(o.id)).toMatchObject({ status: 'paid', paymentStatus: 'partially_paid', balanceDuePaise: 185_000, advancePaise: 79_300 });
  });

  it('sweep cancels an unpaid order, releases stock and discounts, emits order.payment_failed; a late payment is refused', async () => {
    const held = await inventory.reserve([{ variantId: newId(), qty: 1 }], { ttlSec: 900, reference: 'y' });
    if (!held.ok) throw new Error('reserve');
    const o = await placeTestOrder({ reservationId: held.reservation.reservationId });
    expect(await cancelPendingPayment(o.id, 'expired')).toBe(true);
    expect(await cancelPendingPayment(o.id, 'expired')).toBe(false);
    expect(await statusOf(o.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
    expect(inventory.reservations.has(held.reservation.reservationId)).toBe(false);
    expect(released).toContain(o.id);
    const failed = (await outboxEvents(t, 'order.payment_failed')).find((e) => e.payload.orderId === o.id);
    expect(failed?.payload.reason).toBe('expired');
    const late = await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: 'late' });
    expect(late).toMatchObject({ applied: false, reason: 'cancelled' });
    expect((await statusOf(o.id)).status).toBe('cancelled');
  });

  it('a paid order is never swept', async () => {
    const o = await placeTestOrder();
    await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: 'p' });
    expect(await cancelPendingPayment(o.id, 'expired')).toBe(false);
  });
});

describe('transitions', () => {
  it('fulfilment walks the order to delivered; timeline and events follow; support is refused', async () => {
    const o = await placeTestOrder();
    await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: 'w' });
    asStaff('support');
    await expect(staffTransition({ orderId: o.id, to: 'confirmed' })).rejects.toMatchObject({ code: 'forbidden' });
    asStaff('fulfilment');
    for (const to of ['confirmed', 'packed', 'dispatched', 'delivered'] as const) await staffTransition({ orderId: o.id, to });
    await expect(staffTransition({ orderId: o.id, to: 'packed' })).rejects.toMatchObject({ code: 'not_allowed' });
    expect((await statusOf(o.id)).status).toBe('delivered');
    expect(await timeline(o.id)).toEqual(['placed', 'payment', 'status', 'status', 'status', 'status', 'status']);
    const names = (await outboxEvents(t)).filter((e) => e.payload.orderId === o.id).map((e) => e.event);
    expect(names).toEqual(['order.placed', 'order.paid', 'order.confirmed', 'order.packed', 'order.dispatched', 'order.delivered']);
    expect(await verifiedOrderId('00000000-0000-7000-8000-000000000000', newId())).toBeNull();
  });

  it('refunds: payments settles a refund, the order becomes partially then fully refunded, idempotent per refund id', async () => {
    const o = await placeTestOrder();
    await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: 'r' });
    await recordRefund({ orderId: o.id, refundId: 'rf-1', amountPaise: 100_000 });
    await recordRefund({ orderId: o.id, refundId: 'rf-1', amountPaise: 100_000 });
    expect(await statusOf(o.id)).toMatchObject({ status: 'partially_refunded', refundedPaise: 100_000 });
    await recordRefund({ orderId: o.id, refundId: 'rf-2', amountPaise: 164_300 });
    expect(await statusOf(o.id)).toMatchObject({ status: 'refunded', paymentStatus: 'refunded', refundedPaise: 264_300 });
    await expect(recordRefund({ orderId: o.id, refundId: 'rf-3', amountPaise: 1 })).rejects.toBeInstanceOf(OrderError);
  });

  it('admin refund goes through the payments port and is capped at the refundable amount', async () => {
    const calls: unknown[] = [];
    configureOrders({ payments: { refund: async (i) => (calls.push(i), { ok: true, refundId: 'prov-1' }), paymentLink: async () => null } });
    const o = await placeTestOrder();
    await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: 'q' });
    asStaff('fulfilment');
    await expect(requestRefund({ orderId: o.id, amountPaise: 1000, reason: 'double charge' })).rejects.toThrow();
    asStaff('manager');
    await expect(requestRefund({ orderId: o.id, amountPaise: 264_301, reason: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    await requestRefund({ orderId: o.id, amountPaise: 1000, reason: 'double charge' });
    expect(calls).toEqual([expect.objectContaining({ orderId: o.id, amountPaise: 1000 })]);
    expect(await timeline(o.id)).toContain('refund_requested');
  });
});

describe('replacement orders', () => {
  it('creates a zero-value, paid, confirmed order linked to the delivered parent, with stock taken', async () => {
    const o = await placeTestOrder({ customerId: newId() });
    await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: 'rep' });
    for (const to of ['confirmed', 'packed', 'dispatched', 'delivered'] as const) await transition(o.id, to, { actor: { type: 'staff', id: newId(), permissions: ['orders.write', 'orders.dispatch'] } });
    const [line] = await t.db.select().from(ordersLine).where(eq(ordersLine.orderId, o.id)).orderBy(ordersLine.unitPricePaise).limit(1);
    asStaff('support');
    await expect(staffCreateReplacement({ parentOrderId: o.id, lines: [{ lineId: line!.id, qty: 3 }], reason: 'broken' })).rejects.toThrow();
    asStaff('fulfilment');
    await expect(staffCreateReplacement({ parentOrderId: o.id, lines: [{ lineId: line!.id, qty: 99 }], reason: 'broken' })).rejects.toMatchObject({ code: 'invalid' });
    const child = await staffCreateReplacement({ parentOrderId: o.id, lines: [{ lineId: line!.id, qty: 3 }], reason: 'three saplings broken in transit' });
    const row = await statusOf(child.id);
    expect(row).toMatchObject({ source: 'replacement', parentOrderId: o.id, totalPaise: 0, paymentStatus: 'paid', status: 'confirmed', paymentMode: 'none', customerId: (await statusOf(o.id)).customerId });
    const lines = await t.db.select().from(ordersLine).where(eq(ordersLine.orderId, child.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ qty: 3, unitPricePaise: 0, lineTotalPaise: 0, variantId: line!.variantId });
    expect(Number(row.weightKg)).toBe(3 * 2);
    expect(await timeline(o.id)).toContain('replacement_created');
    const ev = (await outboxEvents(t, 'order.replacement_created')).find((e) => e.payload.orderId === child.id);
    expect(ev?.payload.parentOrderId).toBe(o.id);
    // it then flows through fulfilment like any order
    asStaff('fulfilment');
    await staffTransition({ orderId: child.id, to: 'packed' });
    expect((await statusOf(child.id)).status).toBe('packed');
  });

  it('refuses a replacement for an order that is not delivered', async () => {
    const o = await placeTestOrder();
    const [line] = await t.db.select().from(ordersLine).where(eq(ordersLine.orderId, o.id)).limit(1);
    asStaff('owner');
    await expect(staffCreateReplacement({ parentOrderId: o.id, lines: [{ lineId: line!.id, qty: 1 }], reason: 'x' })).rejects.toMatchObject({ code: 'not_allowed' });
  });
});

describe('manual orders', () => {
  it('resolves SKUs through the catalog port, totals through computeTotals, and returns a payment link', async () => {
    const variantId = newId();
    configureOrders({
      catalog: {
        variantBySku: async (sku) =>
          sku === 'SKU-M' ? { variantId, productId: newId(), unitPaise: 10_500, snapshot: { name: 'Compost', sku, hsn: '3101', gstRatePct: 5, sizeClass: null, weightKg: 10 } } : null,
      },
      payments: { refund: async () => ({ ok: false, error: 'n/a' }), paymentLink: async ({ orderId }) => `https://pay.example.test/${orderId}` },
    });
    asStaff('support');
    await expect(createManualOrder({ contact: { name: 'Ravi', phone: null, email: null }, delivery: { kind: 'pickup' }, lines: [{ sku: 'SKU-M', qty: 2 }], paymentMode: 'online' })).rejects.toThrow();
    asStaff('manager');
    await expect(createManualOrder({ contact: { name: 'Ravi', phone: null, email: null }, delivery: { kind: 'pickup' }, lines: [{ sku: 'NOPE', qty: 1 }], paymentMode: 'online' })).rejects.toMatchObject({ code: 'invalid' });
    const res = await createManualOrder({
      contact: { name: 'Ravi', phone: '+919900000000', email: null },
      delivery: { kind: 'pickup', label: 'Collect Saturday' },
      lines: [{ sku: 'SKU-M', qty: 2 }],
      deliveryFeePaise: 0,
      paymentMode: 'online',
    });
    expect(res.paymentUrl).toBe(`https://pay.example.test/${res.id}`);
    expect(await statusOf(res.id)).toMatchObject({ source: 'manual', status: 'pending_payment', totalPaise: 21_000, taxPaise: 1_000 });
    const offline = await createManualOrder({ contact: { name: 'Ravi', phone: null, email: null }, delivery: { kind: 'pickup' }, lines: [{ sku: 'SKU-M', qty: 1, unitPaise: 9_000 }], paymentMode: 'offline' });
    expect(await statusOf(offline.id)).toMatchObject({ status: 'confirmed', paymentMode: 'offline', totalPaise: 9_000 });
    expect(offline.paymentUrl).toBeNull();
  });
});

