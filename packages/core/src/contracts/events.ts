import type { Logger, Paise } from './common';

export type LeadSource = 'wizard' | 'notify_me' | 'enquiry' | 'chat' | 'checkout';
export type ConsentPurpose = 'order_updates' | 'marketing' | 'analytics_identity';
export type AlertSeverity = 'critical' | 'high' | 'low';

interface OrderRef {
  orderId: string;
  orderNumber: string;
}

/** Event catalogue (names frozen). Payloads carry ids; subscribers read fresh state through public server APIs. */
export interface EventPayloads {
  'product.updated': { productId: string };
  'product.published': { productId: string; slug: string };
  'price.changed': { productId: string; variantId: string };
  'stock.changed': { productId: string; variantId: string; available: number };
  'stock.low': { productId: string; variantId: string; available: number; threshold: number };
  'cart.updated': { cartId: string };
  'cart.abandoned': { cartId: string; checkoutSessionId: string | null };
  'checkout.started': { checkoutSessionId: string; cartId: string };
  'checkout.contact_saved': { checkoutSessionId: string; cartId: string; phone: string | null; email: string | null };
  'order.placed': OrderRef;
  'order.paid': OrderRef & { amountPaise: Paise; paymentAttemptId: string | null };
  'order.payment_failed': OrderRef & { reason: 'failed' | 'expired' | 'abandoned' | 'amount_mismatch' };
  'order.confirmed': OrderRef;
  'order.packed': OrderRef;
  'order.dispatched': OrderRef;
  'order.delivered': OrderRef;
  'order.cancelled': OrderRef & { reason: string | null };
  'order.refunded': OrderRef & { refundId: string; amountPaise: Paise };
  'order.replacement_created': OrderRef & { parentOrderId: string };
  'slot.reminder': OrderRef & { slotDate: string };
  'customer.created': { customerId: string };
  'lead.created': { leadId: string; source: LeadSource };
  'consent.changed': { customerId: string | null; leadId: string | null; purpose: ConsentPurpose; granted: boolean };
  'review.submitted': { reviewId: string; productId: string };
  'review.approved': { reviewId: string; productId: string };
  'enquiry.created': { enquiryId: string; leadId: string | null };
  'enquiry.status_changed': { enquiryId: string; from: string; to: string };
  'plan.generated': { planId: string; modelSlug: string };
  'plan.unlocked': { planId: string; leadId: string; mode: 'otp' | 'soft' };
  'message.sent': { messageId: string; channel: string; templateKey: string };
  'message.failed': { messageId: string; channel: string; templateKey: string; error: string };
  'integration.failed': { provider: string; operation: string; error: string };
  'erp.synced': { runId: string; kind: 'inventory' | 'orders' | 'leads'; changed: number };
  'alert.raised': { alertId: string; severity: AlertSeverity; fingerprint: string };
}
export type EventName = keyof EventPayloads;

export const EVENT_NAMES = [
  'product.updated',
  'product.published',
  'price.changed',
  'stock.changed',
  'stock.low',
  'cart.updated',
  'cart.abandoned',
  'checkout.started',
  'checkout.contact_saved',
  'order.placed',
  'order.paid',
  'order.payment_failed',
  'order.confirmed',
  'order.packed',
  'order.dispatched',
  'order.delivered',
  'order.cancelled',
  'order.refunded',
  'order.replacement_created',
  'slot.reminder',
  'customer.created',
  'lead.created',
  'consent.changed',
  'review.submitted',
  'review.approved',
  'enquiry.created',
  'enquiry.status_changed',
  'plan.generated',
  'plan.unlocked',
  'message.sent',
  'message.failed',
  'integration.failed',
  'erp.synced',
  'alert.raised',
] as const satisfies readonly EventName[];

// Compile-time guard: the list above names every key of EventPayloads.
type _MissingEvents = Exclude<EventName, (typeof EVENT_NAMES)[number]>;
const _allEventsListed: [_MissingEvents] extends [never] ? true : _MissingEvents = true;
void _allEventsListed;

export interface EventContext {
  eventId: string;
  emittedAt: Date;
  log: Logger;
}
export type EventHandler<E extends EventName> = (payload: EventPayloads[E], ctx: EventContext) => Promise<void>;

/** `tx` is the caller's Drizzle transaction; the job is enqueued in it (transactional outbox). */
export interface EmitOptions {
  tx?: unknown;
}
export type Emit = <E extends EventName>(event: E, payload: EventPayloads[E], options?: EmitOptions) => Promise<void>;
