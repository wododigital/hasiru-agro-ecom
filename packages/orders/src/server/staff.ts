import { audit } from '@ecomkit/core/audit';
import { requirePermission } from '@ecomkit/core/auth-context';
import { db, withTx } from '@ecomkit/core/db';
import { asPaise } from '@ecomkit/core/money';
import { getSettings } from '@ecomkit/core/settings';
import { computeTotals } from '@ecomkit/core/totals';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { addressSchema, contactSchema, deliverySchema, isInterState, noteInputSchema, refundInputSchema, transitionInputSchema, type ReplacementInput } from '../domain';
import { ordersEvent, ordersOrder } from '../schema';
import { addNote, createOrder, createReplacement, markPaymentReceived, OrderError, setTestFlag, transition } from './orders';
import { getOrdersPorts, ordersSettings } from './ports';

/**
 * Admin refund: asks payments to refund through the provider (payment anomalies only; policy is no cancellation).
 * The order changes when payments reports the refund settled (`recordRefund`).
 */
export async function requestRefund(raw: z.input<typeof refundInputSchema>): Promise<{ refundId: string }> {
  const staff = await requirePermission('orders.refund');
  const input = refundInputSchema.parse(raw);
  const payments = getOrdersPorts().payments;
  if (!payments) throw new OrderError('payments_unavailable');
  const [order] = await db.select().from(ordersOrder).where(eq(ordersOrder.id, input.orderId));
  if (!order) throw new OrderError('not_found');
  if (input.amountPaise > order.paidPaise - order.refundedPaise) throw new OrderError('invalid', 'refund exceeds the refundable amount');
  const res = await payments.refund({ orderId: order.id, amountPaise: asPaise(input.amountPaise), reason: input.reason, actorId: staff.userId });
  if (!res.ok) throw new OrderError('refund_failed', res.error);
  await withTx(async (tx) => {
    await tx.insert(ordersEvent).values({ orderId: order.id, type: 'refund_requested', data: { refundId: res.refundId, amountPaise: input.amountPaise, reason: input.reason }, actorId: staff.userId });
    await audit({ actorId: staff.userId, actorType: 'staff', action: 'order.refund', entity: 'order', entityId: order.id, after: { amountPaise: input.amountPaise, reason: input.reason } }, { tx });
  });
  return { refundId: res.refundId };
}

/** Money taken at the nursery or by bank transfer, recorded by staff (orders.write). */
export async function recordOfflinePayment(raw: { orderId: string; amountPaise: number }): Promise<void> {
  const staff = await requirePermission('orders.write');
  const input = z.object({ orderId: z.uuid(), amountPaise: z.number().int().positive() }).parse(raw);
  await withTx(async (tx) => {
    const res = await markPaymentReceived({ orderId: input.orderId, amountPaise: input.amountPaise, attemptId: null, actorId: staff.userId }, { tx });
    if (!res.applied) throw new OrderError('not_allowed', `payment not applied: ${res.reason}`);
    await audit({ actorId: staff.userId, actorType: 'staff', action: 'order.offline_payment', entity: 'order', entityId: input.orderId, after: { amountPaise: input.amountPaise } }, { tx });
  });
}

export async function addStaffNote(raw: z.input<typeof noteInputSchema>): Promise<void> {
  const staff = await requirePermission('orders.write');
  const input = noteInputSchema.parse(raw);
  await addNote(input.orderId, input.note, staff.userId);
}

export const manualOrderSchema = z.object({
  contact: contactSchema,
  address: addressSchema.nullish(),
  delivery: deliverySchema.pick({ kind: true, label: true, slotDate: true, vehicle: true }),
  lines: z.array(z.object({ sku: z.string().trim().min(1).max(80), qty: z.number().int().positive(), unitPaise: z.number().int().min(0).nullish() })).min(1).max(200),
  deliveryFeePaise: z.number().int().min(0).default(0),
  paymentMode: z.enum(['online', 'offline']),
  isTest: z.boolean().default(false),
  notes: z.string().max(2000).nullish(),
});
export type ManualOrderInput = z.input<typeof manualOrderSchema>;

/**
 * Manual order (phone or walk-in): SKUs resolved through the catalog port, totals through `core.computeTotals`,
 * created as `pending_payment` with a payment link when payments is on (`online`), or confirmed for collection
 * of money offline. No stock hold is taken; staff adjust inventory when they pack.
 */
export async function createManualOrder(raw: ManualOrderInput): Promise<{ id: string; number: string; paymentUrl: string | null }> {
  const staff = await requirePermission('orders.write');
  const input = manualOrderSchema.parse(raw);
  const { catalog, payments } = getOrdersPorts();
  if (!catalog) throw new OrderError('catalog_unavailable');
  const refs = await Promise.all(input.lines.map((l) => catalog.variantBySku(l.sku)));
  const missing = input.lines.filter((_, i) => !refs[i]).map((l) => l.sku);
  if (missing.length) throw new OrderError('invalid', `unknown SKU: ${missing.join(', ')}`);
  const lines = input.lines.map((l, i) => ({ ...refs[i]!, qty: l.qty, unitPaise: l.unitPaise ?? refs[i]!.unitPaise, lineId: String(i) }));
  const settings = await getSettings(ordersSettings);
  const totals = computeTotals({
    lines: lines.map((l) => ({
      lineId: l.lineId,
      productId: l.productId,
      variantId: l.variantId,
      qty: l.qty,
      listUnitPaise: asPaise(l.unitPaise),
      tierUnitPaise: asPaise(l.unitPaise),
      gstRatePct: l.snapshot.gstRatePct,
      weightKg: l.snapshot.weightKg,
    })),
    automaticPromos: [],
    coupon: null,
    packingPaise: asPaise(0),
    transportPaise: asPaise(input.deliveryFeePaise),
    interState: isInterState(input.address?.stateCode ?? null, settings.sellerStateCode),
  });
  const created = await withTx(async (tx) => {
    const order = await createOrder(
      {
        contact: input.contact,
        shippingAddress: input.address ?? null,
        delivery: { methodId: 'manual', ...input.delivery },
        lines: lines.map((l, i) => {
          const t = totals.lines[i]!;
          return {
            variantId: l.variantId,
            productId: l.productId,
            snapshot: l.snapshot,
            qty: l.qty,
            listUnitPaise: l.unitPaise,
            unitPaise: l.unitPaise,
            discountPaise: t.discountPaise,
            taxPaise: t.taxPaise,
            lineTotalPaise: t.lineTotalPaise,
          };
        }),
        totals: {
          subtotalPaise: totals.subtotalPaise,
          tierSavingsPaise: totals.tierSavingsPaise,
          promoPaise: 0,
          couponPaise: 0,
          packingPaise: 0,
          shippingPaise: totals.transportPaise,
          taxPaise: totals.tax.totalTaxPaise,
          totalPaise: totals.totalPaise,
          weightKg: totals.totalWeightKg,
          breakdown: totals as unknown as Record<string, unknown>,
        },
        source: 'manual',
        paymentMode: input.paymentMode === 'online' ? 'online' : 'offline',
        initialStatus: input.paymentMode === 'online' ? 'pending_payment' : 'confirmed',
        isTest: input.isTest,
        notes: input.notes ?? null,
      },
      { tx },
    );
    await audit({ actorId: staff.userId, actorType: 'staff', action: 'order.manual_create', entity: 'order', entityId: order.id, after: { number: order.number, totalPaise: totals.totalPaise } }, { tx });
    return order;
  });
  const paymentUrl = input.paymentMode === 'online' && payments ? await payments.paymentLink({ orderId: created.id, amountPaise: totals.totalPaise }) : null;
  return { id: created.id, number: created.number, paymentUrl };
}

/** A staff status move: the machine checks the move's own permission (orders.write, orders.dispatch). */
export async function staffTransition(raw: z.input<typeof transitionInputSchema>) {
  const staff = await requirePermission('orders.read');
  const input = transitionInputSchema.parse(raw);
  return transition(input.orderId, input.to, { actor: { type: 'staff', id: staff.userId, permissions: staff.permissions }, note: input.note });
}

export async function staffCreateReplacement(raw: ReplacementInput) {
  const staff = await requirePermission('orders.write');
  return createReplacement(raw, { actorId: staff.userId });
}

export async function staffSetTestFlag(orderId: string, isTest: boolean) {
  const staff = await requirePermission('orders.write');
  await setTestFlag(z.uuid().parse(orderId), isTest, staff.userId);
}
