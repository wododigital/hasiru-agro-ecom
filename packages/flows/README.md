# @ecomkit/flows

Fixed automation flows with one settings form each, runs, and the cart restore link. No visual builder, no discount escalation.

| Flow (key) | Trigger | Steps (defaults) | Category |
|---|---|---|---|
| Abandoned cart (`abandoned_cart`) | `cart.abandoned` | `cart.reminder_1` at 1 h, `_2` at 24 h, `_3` at 72 h (optional single-use code on the 72 h step); quiet hours 09:00-11:00 and 18:30-21:00 IST; one sequence per contact per 7 days | marketing |
| Order updates (`order_updates`) | `order.paid` / `order.confirmed` (first wins, once), `order.packed`, `order.dispatched`, `order.delivered` | one message per stage, at once | utility |
| Delivery slot reminder (`slot_reminder`) | `slot.reminder` (shipping job) | `slot.reminder`, once per order and slot date | utility |
| Review request (`review_request`) | `order.delivered` | `review.request` at 7 days; skipped for cancelled or refunded orders | marketing |
| Back in stock (`back_in_stock`) | inventory's notify-me delivery (`backInStockSender`) | `stock.back_in_stock`, at once | marketing (explicit request) |
| Planner lead follow-up (`wizard_lead_follow_up`) | `lead.created` with source `wizard` | `lead.follow_up` at 48 h, unless an order came in | marketing |

Rules: marketing flows need recorded marketing consent (customers `hasConsent`, the single consent store); a run with no contact stops as `no_contact`, without consent as `no_consent`, both with zero messages. Purchase-sensitive flows stop on purchase (`order.placed` subscriber and a check before every send) and on reply (an inbound WhatsApp after the start). Marketing flows stop on unsubscribe (consent revoked). WhatsApp marketing templates go out through notifications, which routes them to the Marketing Messages API.

## Public API
- `@ecomkit/flows/server`: `configureFlows(ports)`, `startFlow(key, subject, context, { now, contact, once })`, `advance(runId)`, `runDue(now)`, `stopRunsForContacts(contacts, reason)`, `backInStockSender` (a `NotificationSender`), `saveFlow`, `getFlowRow`, `ensureFlows`, `restoreToken` / `verifyRestoreToken`, admin queries `listFlowCards`, `getFlowDetail`, `listAbandonedCheckouts`, `testRun`.
- `@ecomkit/flows/domain`: `FLOW_DEFS`, `FLOW_KEYS`, `flowSettingsSchema`, `parseFlowSettings`, `buildSteps`, `shiftOutOfQuietHours`, `dueAt`, `STOP_REASONS`.
- `@ecomkit/flows/admin`: `AutomationsPage`, `FlowPage`, `AbandonedCheckoutsPage`.

## Ports (bound by the host at boot, all optional)
```ts
configureFlows({
  carts: { snapshot(cartId, checkoutSessionId), restore(cartId, { couponCode }) },   // cart module
  orders: { summary(orderId), hasOrderSince(contact, since) },                        // orders module
  leads: { get(leadId) },                                                             // customers (system read)
  products: { label(productId) },                                                     // catalog
  discounts: { createSingleUseCode({ ruleId, phone, expiresAt }) },                   // discounts
});
// inventory: setNotificationsProvider(async () => backInStockSender)
```
An unbound port makes the flows that need it record `subject_missing` runs and send nothing; the other flows keep working.

## Tables
`flows_flow` (key, trigger, status, settings jsonb, version), `flows_step` (wait / stop_if / send_whatsapp / send_email rows built from settings, 4 per step, positions stable), `flows_run` (subject, contact hash, position, context ids, status, stop reason, next step; one running run per flow and subject), `flows_run_step` (what each step did). No personal data is stored: contacts are read fresh through the ports at each step.

## Routes
- `GET /r/[token]`: cart restore (HMAC token over the run id). Restores the cart through the cart port, applies the run's single-use code, records `restoredAt`, 303 to `/cart`. Invalid tokens also land on `/cart`.
- Admin: `/admin/marketing/automations` (cards), `/admin/marketing/automations/[key]` (settings form, test send to a staff phone or email, run list), `/admin/abandoned-checkouts` (Orders band). Permissions `marketing.write` and `orders.read`.

## Jobs and events
- Job `flows.run-due` every minute (singleton): advances due runs; a run whose source throws is marked `failed` with the error.
- Consumes `cart.abandoned`, `order.placed`, `order.paid`, `order.confirmed`, `order.packed`, `order.dispatched`, `order.delivered`, `slot.reminder`, `lead.created`. Emits nothing (notifications emits `message.*`).

## Settings
Per flow, in `flows_flow.settings` (not module settings): steps (enabled, template from the flow's allowed list, channel WhatsApp / email / both, hours after start), quiet-hour windows (IST, may wrap midnight), sequences per contact per 7 days, discount rule for the single-use code and its validity (abandoned cart only). Saving bumps the version and writes an audit row. Running runs continue with the new step settings at their current position.

## How to disable
Remove `flows` from `modules.config.ts`. Nothing else depends on it; inventory falls back to its own notifications provider when the host binds that instead.
