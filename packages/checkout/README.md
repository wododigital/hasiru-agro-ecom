# @ecomkit/checkout

One-page checkout: contact (phone first, guest by default, autosaved on blur), address (pincode first with district and state autofill), delivery options with dates, payment choice per COD mode, a server quote through `core.computeTotals`, and an idempotent place-order transaction.

## Public API (`@ecomkit/checkout/server`)

| Function | Use |
|---|---|
| `saveContact({ name, phone, email })` | Autosave: stores the contact on `checkout_session`; emits `checkout.started` (first time) and `checkout.contact_saved` when the phone or email changes. Never writes consent. |
| `setMarketingConsent(granted, meta)` | The marketing checkbox: records the grant or revocation in `customers_consent` with the exact text and version. |
| `quote({ address, methodId })` | Server quote: shipping methods (or pickup only without shipping), discounts, `computeTotals`, payment choices, advance amount. The coupon is validated on the first quote and at place-order only. |
| `placeOrder(input, meta)` | Idempotent (key per page render). One transaction: lock session, reprice, hold stock (TTL = payment attempt expiry, A27), create the order (number from `core_sequence`, `order.placed`), redeem discounts, record `order_updates` (and marketing when ticked) consent, convert the cart. Then starts the payment and returns where to send the buyer. |
| `retryPayment(orderId, token)` | Pay page retry for a pending order. |
| `openCheckout()` | Page data (quote, lines, saved contact and address, states). |
| `checkoutContact(sessionId)` | For flows' abandoned-checkout messages. |
| `configureCheckout(ports)` | Ports the host binds at boot (see below). |

Domain: `paymentChoices`, `advanceFor`, `totalsInput`, `reserveLines`, `slotLabel`, input schemas, `checkoutSettingsSchema`.

## Ports (`configureCheckout`)

Required to place orders: `cart` (`current()`, `markConverted()`), `orders` (`createOrder`, `guestToken`, `sellerStateCode`, `forBuyer`), `payments` (`config()` with `codMode`, `advancePct`, `attemptExpiryMinutes`; `start()`). Optional: `inventory` (no stock hold without it), `shipping` (pickup only without it), `discounts` (`promos`, `coupon`, `redeem`), `regions` (state list), `attribution` (UTM on the order).

## Tables

`checkout_session` (one per cart; contact, address draft, method, frozen quote, `idempotency_key` unique, `order_id`).

## Routes

`/checkout`, `/checkout/[orderId]/pay` (guest `?t=` token or the signed-in owner). The guest confirmation page `/order/[token]` belongs to orders.

## Settings (`checkout`)

`chargesGstRatePct` (GST included in packing and delivery, default 18), `sessionDays` (7). The COD mode and attempt expiry are payments settings, read through the port.

## Events

Emits `checkout.started`, `checkout.contact_saved`. (`order.placed` is emitted by orders inside the place-order transaction.)

## How to disable

Remove `checkout` from the modules list; the cart then has no way to pay. It depends on `cart`, `auth`, `customers`, `orders`.
