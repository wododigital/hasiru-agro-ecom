# @ecomkit/payments

Takes money for orders: an online gateway (PhonePe Standard Checkout, OAuth client written as a small typed `fetch` client, no vendor SDK), an in-app mock of that gateway for dev and tests, a partial advance (pay a share online, the balance on delivery), bank transfer, and pay at pickup as a checkout option. Owns payment attempts, gateway webhooks, reconciliation (return page, webhook job, poll, sweep) and refunds.

Rule: nothing is marked paid from a redirect or a webhook body. Every signal ends in `applyPaymentState` after a server-side status check, inside one transaction with the orders transition.

## Public API (`@ecomkit/payments/server`)

| Function | What |
|---|---|
| `configurePayments({ orders, alert })` | Boot binding. `orders` implements `PaymentsOrdersPort` (below); `alert` is monitoring's `alert()` when enabled (else anomalies go to the error log). |
| `paymentOptions({ totalPaise, pickup })` | What checkout may offer, with `payNowPaise` and `windowSec` (the stock hold to pass to `inventory.reserve`, A27). |
| `createPayment({ orderId, method })` | `method`: `online` / `cod_partial` / `bank_transfer`. Starts or resumes an attempt; returns `redirectUrl` (null for bank transfer, with `instructions`). One open attempt per order; retries stay inside the first attempt's window. |
| `fetchStatus(attemptId)` / `syncAttempt` | Asks the gateway and applies the answer. |
| `applyPaymentState(attemptId, { state, amountPaise, raw })` | The single, idempotent state application path. |
| `refund({ orderId, amountPaise, reason, actorId })` | Partial or full refund of an order's applied payment (orders admin calls it). |
| `startRefundTask({ refundId, actorId })` | Starts a refund task created by an anomaly. |
| `markBankTransferReceived({ attemptId, amountPaise, actorId })` | Staff confirm an offline payment (audited). |
| `returnView(attemptId)` | Data for `/pay/return`. |
| `pollPending()`, `sweep()` | Job bodies (also callable in tests with `{ now }`). |
| `attemptsForOrder`, `listAttempts`, `listRefunds`, `listOpenBankTransfers` | Admin reads. |

`PaymentsOrdersPort` (the orders transition API, bound at boot): `get(orderId, { tx })`, `markPaid({ orderId, amountPaise, attemptId, method }, { tx })` (may return `{ applied: false }` if the order moved on under its own lock), `paymentExpired({ orderId, reason }, { tx })` (no-op unless still `pending_payment`), `markRefunded({ orderId, refundId, amountPaise }, { tx })`, `orderLink(orderId)`, optional `payLink(orderId)` (default `/checkout/<orderId>/pay`) and `sweepWithoutAttempt(cutoff)`. The orders side emits `order.paid`, `order.payment_failed`, `order.refunded` from the transaction it is given. With `@ecomkit/orders` (WP-19): `markPaid` -> `markPaymentReceived` (map `applied`), `paymentExpired` -> `cancelPendingPayment`, `markRefunded` -> `recordRefund`.

Other exports: `./domain` (state machine `decide`, ids, amounts, gateway wire schemas), `./ui` (`PayReturn`), `./admin` (`PaymentsPage`), `./messages` (`paymentsMessages`), `./mocks/phonepe`.

## State machine

Only `pending` moves (`-> completed | failed | expired`); `completed` is final. A capture the order cannot take (attempt already failed or expired, order cancelled or already paid, amount different from what was requested or owed) is stored as `completed` with `anomaly` (`late_completed` / `amount_mismatch`), never applied to the order, and creates a `payments_refund` row in state `task` plus a critical alert. Staff start the refund from `/admin/payments`.

## Tables

- `payments_attempt`: one per try; `merchant_order_id = <order number>-<attempt no>` (unique, never reused); `provider` = gateway holding the money (`phonepe`, `mock`, `bank_transfer`); `method` = buyer's choice; `expires_at` = end of the payment window; `applied_at`, `anomaly`, `next_poll_at`, `poll_count`, `swept_at`.
- `payments_webhook_event`: verified events deduped on `<event>:<merchant id>:<state>`; rejected ones stored with `signature_ok = false` and no payload (pruned after 7 days).
- `payments_refund`: `merchant_refund_id = <merchant order id>-R<n>`; states `task | pending | completed | failed`.

No foreign keys into other modules (`order_id` is the orders id).

## Routes

| Path | What |
|---|---|
| `POST /api/webhooks/phonepe` | Rate limited (600/min per IP hash), body capped at 64 KB, `Authorization: SHA256(username:password)` checked in constant time as hex or base64, stored once, job queued in the same transaction. 401 on bad auth (3 in 10 min raise a critical alert). |
| `/pay/return?a=<attempt id>` | Buyer return page. Asks the status API (30 checks per attempt per 10 min), shows paid / pending (refreshes itself every 5 s, no JS) / failed (retry link while the window is open) / under review. |
| `/admin/payments` | Attempts (URL-bound filters), refund tasks with "Refund now", bank transfers with "Mark received". Permissions: `orders.read`, `orders.refund`, `orders.write`. |
| `/api/_mock/phonepe/[...path]` | Mock gateway (mock configs only, and 404 unless `ENABLE_MOCKS=1`): token (60 s expiry), pay, status, refund, refund status, pay page with Success / Fail / Pending / Abandon that posts authenticated webhooks, `_control` toggles (`rateLimitNext`, `tokenTtlSec`, `webhookDelayMs`, `duplicateWebhooks`, `hashEncoding`, `refundAutoComplete`, `settle`). |

## Settings (`/admin/settings/payments`, rendered by admin-shell)

Gateway: `mode` (mock / sandbox / live), `merchantId`, `clientId`, `clientSecret` (secret), `clientVersion`. Webhook: `webhookUsername`, `webhookPassword` (secret); in sandbox or live without both, every webhook is refused and the poll reconciles. Checkout: `attemptExpiryMinutes` (default 15, also the stock hold), `codMode` (`online_only` default, `partial_advance`), `advancePercent` (30), `payAtPickup`, `bankTransfer`, `bankTransferHours` (48), `bankTransferNote`. Action: Test connection (fetches a token; reports the webhook URL to register).

## Jobs

- `payments.process-webhook`: per stored event; status check then apply (retries 5, back-off).
- `payments.poll` (every minute, singleton): status of due pending attempts (first after 20 s, then 20/30/60 s by age) and pending refunds; a 429 stops the run and pushes the rest back 30 s doubling to 5 min.
- `payments.sweep` (every minute, singleton): attempts past their window get a last status check, then `expired`; orders with nothing open or applied go to `orders.paymentExpired` once; `orders.sweepWithoutAttempt` if provided.

## Health checks

`payments-gateway` (configuration and last hour's gateway failure rate), `payments-anomalies` (critical: attempts open 15 min past their window = sweep not running; refund tasks waiting = degraded).

## Events

Emits none itself (the orders port emits the order events in the same transaction); gateway calls log to `core_integration_log` and emit `integration.failed` through core `integrationCall`.

## Disable

Remove `payments` from `modules.config.ts`. Checkout then has no payment step (orders created by it stay `pending_payment` unless the host handles them); the orders refund button reports payments unavailable.

## Go-live checks

Sandbox callback to confirm the Authorization hash encoding (hex vs base64; both accepted today) and `expireAt` vs `expiryAt` in the pay response (both parsed).
