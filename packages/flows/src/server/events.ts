import type { EventPayloads, NotificationSender } from '@ecomkit/core/contracts';
import { hashContact } from '@ecomkit/core/http';
import { newId } from '@ecomkit/core/ids';
import { send } from '@ecomkit/notifications/server';
import { flowPorts } from './ports';
import { startFlow, stopRunsForContacts } from './runner';

// Event subscribers (manifest `on`). Payloads carry ids; the runner reads fresh state through the ports.

export async function onCartAbandoned({ cartId, checkoutSessionId }: EventPayloads['cart.abandoned']): Promise<void> {
  await startFlow('abandoned_cart', { type: 'cart', id: cartId }, { cartId, ...(checkoutSessionId ? { checkoutSessionId } : {}) });
}

/** A purchase ends abandoned-cart and lead follow-up runs for the buyer's phone and email. */
export async function onOrderPlaced({ orderId }: EventPayloads['order.placed']): Promise<void> {
  const order = await flowPorts().orders?.summary(orderId);
  if (order) await stopRunsForContacts([order.contact], 'purchased');
}

/** Order update stages: index into the order_updates steps (confirmed, packed, dispatched, delivered). */
const stage = (index: number, name: string) => async ({ orderId }: EventPayloads['order.confirmed']) => {
  await startFlow('order_updates', { type: 'order', id: `${orderId}:${name}` }, { orderId, only: String(index) }, { once: true });
};
/** Paid and confirmed both mean "confirmed" to the customer; whichever comes first sends it, once. */
export const onOrderConfirmed = stage(0, 'confirmed');
export const onOrderPacked = stage(1, 'packed');
export const onOrderDispatched = stage(2, 'dispatched');
const deliveredStage = stage(3, 'delivered');

export async function onOrderDelivered(payload: EventPayloads['order.delivered']): Promise<void> {
  await deliveredStage(payload);
  await startFlow('review_request', { type: 'order', id: payload.orderId }, { orderId: payload.orderId }, { once: true });
}

export async function onSlotReminder({ orderId, slotDate }: EventPayloads['slot.reminder']): Promise<void> {
  await startFlow('slot_reminder', { type: 'order', id: `${orderId}:${slotDate}` }, { orderId, slotDate }, { once: true });
}

export async function onLeadCreated({ leadId, source }: EventPayloads['lead.created']): Promise<void> {
  if (source !== 'wizard') return;
  await startFlow('wizard_lead_follow_up', { type: 'lead', id: leadId }, { leadId }, { once: true });
}

/**
 * Notification sender for inventory's back-in-stock delivery (`setNotificationsProvider`): `stock.back_in_stock`
 * goes through the back_in_stock flow (enable switch, channel, run log, product name and link); every other key
 * passes straight to notifications. A paused flow sends nothing for that request.
 */
export const backInStockSender: NotificationSender = {
  async send(templateKey, to, vars, options) {
    if (templateKey !== 'stock.back_in_stock') return send(templateKey, to, vars, options);
    const productId = String(vars.productId ?? '');
    const variantId = String(vars.variantId ?? '');
    const who = hashContact(to.phone) ?? hashContact(to.email) ?? newId();
    const started = await startFlow('back_in_stock', { type: 'direct', id: `${variantId}:${who}` }, { productId, variantId }, { contact: to });
    return { messageIds: started?.messageIds ?? [] };
  },
};
