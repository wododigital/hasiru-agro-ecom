// System-side order reads and transitions other modules reach through their ports (payments, flows, marketing,
// erp-sync), bound by the host at boot. Shapes match those ports structurally; orders never imports them.
import { db, type Tx } from '@ecomkit/core/db';
import { env } from '@ecomkit/core/env';
import { asPaise } from '@ecomkit/core/money';
import { and, eq, gte, or, sql } from 'drizzle-orm';
import { slotLabel } from '../domain';
import { ordersLine, ordersOrder } from '../schema';
import { cancelPendingPayment, guestTokenFor, markPaymentReceived, recordRefund } from './orders';

type Contact = { name: string | null; phone: string | null; email: string | null };
const contactOf = (o: { contact: unknown }): Contact => ({ name: null, phone: null, email: null, ...(o.contact as Partial<Contact>) });
const UUID = /^[0-9a-f-]{36}$/i;

async function byId(orderId: string, tx?: Tx) {
  if (!UUID.test(orderId)) return null;
  const [o] = await (tx ?? db).select().from(ordersOrder).where(eq(ordersOrder.id, orderId));
  return o ?? null;
}

/** Guest link of an order (absolute on SITE_URL when set). */
export const orderLinkFor = (orderId: string): string => `${env.SITE_URL ?? ''}/order/${guestTokenFor(orderId)}`;

/** payments' `PaymentsOrdersPort`. */
export const paymentsOrdersPort = {
  async get(orderId: string, options: { tx?: Tx }) {
    const o = await byId(orderId, options.tx);
    return o ? { id: o.id, number: o.number, status: o.status, totalPaise: asPaise(o.totalPaise), paidPaise: asPaise(o.paidPaise), isTest: o.isTest, contact: contactOf(o) } : null;
  },
  async markPaid(input: { orderId: string; amountPaise: number; attemptId: string }, options: { tx: Tx }) {
    const r = await markPaymentReceived(input, options);
    return { applied: r.applied || r.reason === 'duplicate' };
  },
  async paymentExpired(input: { orderId: string; reason: 'failed' | 'expired' }, options: { tx: Tx }) {
    await cancelPendingPayment(input.orderId, input.reason, options);
  },
  async markRefunded(input: { orderId: string; refundId: string; amountPaise: number }, options: { tx: Tx }) {
    await recordRefund(input, options);
  },
  async orderLink(orderId: string) {
    return `/order/${guestTokenFor(orderId)}`;
  },
};

/** flows' `orders` port. */
export const flowsOrdersPort = {
  async summary(orderId: string) {
    const o = await byId(orderId);
    if (!o) return null;
    const delivery = (o.delivery ?? {}) as { slotDate?: string | null; label?: string | null };
    return {
      number: o.number,
      status: o.status,
      isTest: o.isTest,
      contact: { customerId: o.customerId, ...contactOf(o) },
      totalPaise: asPaise(o.totalPaise),
      deliveryDate: delivery.slotDate ? slotLabel(delivery.slotDate) : null,
      slotWindow: delivery.label ?? null,
      link: orderLinkFor(o.id),
    };
  },
  async hasOrderSince(contact: { customerId?: string | null; phone?: string | null; email?: string | null }, since: Date) {
    const who = [
      contact.customerId ? eq(ordersOrder.customerId, contact.customerId) : undefined,
      contact.phone ? sql`${ordersOrder.contact} ->> 'phone' = ${contact.phone}` : undefined,
      contact.email ? sql`lower(${ordersOrder.contact} ->> 'email') = ${contact.email.toLowerCase()}` : undefined,
    ].filter(Boolean);
    if (!who.length) return false;
    const [hit] = await db.select({ id: ordersOrder.id }).from(ordersOrder).where(and(gte(ordersOrder.placedAt, since), or(...who))).limit(1);
    return !!hit;
  },
};

/** marketing's `ConversionOrder` for an order. */
export async function conversionOrder(orderId: string) {
  const o = await byId(orderId);
  if (!o) return null;
  const lines = await db.select().from(ordersLine).where(eq(ordersLine.orderId, o.id));
  const c = contactOf(o);
  const addr = (o.shippingAddress ?? {}) as { city?: string; district?: string; state?: string; stateCode?: string; pincode?: string };
  const [first, ...rest] = (c.name ?? '').trim().split(/\s+/);
  const applied = ((o.totals as { appliedDiscounts?: { kind?: string; label?: string }[] }).appliedDiscounts ?? []).find((d) => d.kind === 'coupon');
  return {
    orderId: o.id,
    orderNumber: o.number,
    valuePaise: o.totalPaise,
    currency: 'INR' as const,
    isTest: o.isTest,
    placedAt: o.placedAt,
    lines: lines.map((l) => {
      const s = l.productSnapshot as { name: string; sku: string | null };
      return { productId: l.productId, variantId: l.variantId, sku: s.sku ?? l.variantId, name: s.name, qty: l.qty, unitPaise: l.unitPricePaise };
    }),
    shippingPaise: o.shippingPaise,
    taxPaise: o.taxPaise,
    couponCode: applied?.label ?? null,
    customerId: o.customerId,
    contact: {
      email: c.email,
      phone: c.phone,
      firstName: first || null,
      lastName: rest.join(' ') || null,
      city: addr.city ?? addr.district ?? null,
      state: addr.stateCode ?? addr.state ?? null,
      pincode: addr.pincode ?? null,
      country: 'in',
    },
    sourceUrl: env.SITE_URL ? `${env.SITE_URL}/order` : null,
  };
}
