# @ecomkit/orders

Orders after checkout: line snapshots, the status machine with guards, the timeline, gapless order numbers, GST invoices (B2C/B2B, CGST + SGST or IGST, one gapless series per financial year), customer and guest order pages, admin orders with saved views, dispatch planner, manual orders and zero-value replacement orders.

## Public API (`@ecomkit/orders/server`)

| Function | Use |
|---|---|
| `createOrder(input, { tx })` | Inside the caller's transaction (checkout place-order, manual, replacement). Number from `core.orderNumber` (`<numberPrefix>-YYMM-NNNNN`), signed guest token (only its hash stored), emits `order.placed`. Returns `{ id, number, guestToken }`. |
| `markPaymentReceived({ orderId, amountPaise, attemptId }, { tx? })` | Payments hook after the provider status API confirms money. Idempotent per attempt; commits the stock hold; `pending_payment -> paid`; `customers.recordOrder` on the first payment; emits `order.paid`. Returns `{ applied: false, reason: 'cancelled' }` for a late payment on a cancelled order (payments raises the alert and refund task, A27). |
| `cancelPendingPayment(orderId, reason, { tx? })` | Sweep hook for expired attempts: cancels only a still-unpaid `pending_payment` order, releases the stock hold and discount uses, emits `order.payment_failed` + `order.cancelled`. |
| `transition(orderId, to, { actor })` | Guarded move (see `TRANSITIONS` in domain); writes timeline, fulfilment row, audit; emits `order.confirmed/packed/dispatched/delivered/cancelled`. |
| `recordRefund({ orderId, refundId, amountPaise })` | Payments hook when a refund settles: `refunded` or `partially_refunded`, emits `order.refunded`. Idempotent per refund id. |
| `createReplacement({ parentOrderId, lines, reason }, { actorId })` | Zero-value linked order (`source = replacement`, `parent_order_id`, `payment_status = paid`, starts `confirmed`) for a delivered order; takes stock when inventory is on; emits `order.replacement_created`. |
| `issueInvoice(orderId)` / `invoicePdf(doc)` / `invoiceResponse(orderId)` | Issue once per paid order (subscriber of `order.paid`); PDF rendered on demand from the frozen invoice document. |
| `getMyOrder`, `listMyOrders`, `getOrderByToken`, `orderForBuyer` | Buyer reads, owner-scoped (NotFound for anyone else). |
| `listOrdersAdmin`, `getOrderForStaff`, `dispatchPlan`, `ordersForSlot` | Admin reads (`orders.read` / `orders.dispatch`), personal data masked for `support`. |
| `exportOrders`, `ORDER_EXPORT_HEADER` | CSV export of the admin view or ticked rows (`orders.read` + `orders.export`, owner/manager by default); same filter as the list, phone/email masked unless the viewer sees full PII, audit `orders.export` (filters + row count), id-keyset batches of 500. |
| `requestRefund`, `recordOfflinePayment`, `createManualOrder`, `staffTransition`, `staffCreateReplacement`, `addStaffNote`, `staffSetTestFlag` | Staff actions with their permission checks. |
| `verifiedOrderId(customerId, productId)` | For reviews' verified-buyer flag. |
| `guestTokenFor(orderId)` | The signed guest link token (checkout's replay path). |
| `configureOrders({ inventory, discounts, payments, catalog })` | Ports the host binds at boot (all optional). |

Domain (`@ecomkit/orders/domain`): `TRANSITIONS`, `checkTransition`, `staffMoves`, `paymentStatusFor`, `invoiceTax`, `placeOfSupply`, `isInterState`, `SAVED_VIEWS`, `slotLabel`, `parseManualLines`, input schemas, `ordersSettingsSchema`.

## Tables

`orders_order`, `orders_line`, `orders_event` (timeline), `orders_invoice`, `orders_fulfilment`. No foreign keys into other modules. Extra columns beyond the plan: `payment_mode`, `refunded_paise`, `advance_paise`, `totals` (frozen breakdown), `reservation_id`; `orders_invoice.taxable_paise`, `total_paise`, `document`.

## Routes

Storefront: `/account/orders`, `/account/orders/[id]`, `/account/orders/[id]/invoice.pdf`, `/order/[token]`, `/order/[token]/invoice.pdf`. Admin: `/admin/orders` (saved views: All, Unfulfilled, Pending payment, Today's slot, Outstation, Replacements), `/admin/orders/[id]`, `/admin/orders/dispatch`, `/admin/orders/new`, `/admin/orders/[id]/invoice.pdf`, `/admin/orders/export.csv` (`?view=&q=&status=&placed=` or `?ids=..`; Export button on the index and Export selected in the bulk bar). The index also has a Date filter (`placed`: today, last 7/30/90 days, last 12 months, IST days).

## Admin (Shopify structure)

- `/admin/orders`: saved-view tabs (Unfulfilled, Pending payment, Today's slot, Outstation, Replacements), search, status filter, row checkboxes with bulk Confirm / Mark packed (`orders.write`, each through the guarded transition; refused ones are counted), whole-row click. `/admin/orders/[id]` uses the detail frame: next status move as primary action, other moves, invoice, test flag and cancel under More actions.
- Home KPI cards (`analytics.read`): `orders.kpi.sales` (net of refunds), `orders.kpi.orders`, `orders.kpi.aov`. Reports: sales over time, average order value, top products, returning customers (`server/reports.ts`: aggregates only, test orders, replacements, unpaid and cancelled orders excluded, IST days).
- Home "Things to do" (`adminTodos`): orders to dispatch, payments pending (the saved views' totals).

## Settings (`orders`)

`numberPrefix` (default `ORD`; the store sets its own), `invoicePrefix` (`INV`), `sellerLegalName`, `sellerGstin`, `sellerAddress`, `sellerStateCode` (CGST + SGST inside it, IGST outside), `chargesHsn` (`9965`).

## Events

Emits `order.placed`, `order.paid`, `order.payment_failed`, `order.confirmed`, `order.packed`, `order.dispatched`, `order.delivered`, `order.cancelled`, `order.refunded`, `order.replacement_created`. Consumes `order.paid` (issues the GST invoice). Customer messages are sent by flows/notifications from these events.

## Wiring (host, at boot)

```ts
configureOrders({
  inventory: () => registry.service('inventory'),
  discounts: { releaseRedemptions },            // @ecomkit/discounts/server
  payments: { refund, paymentLink },            // @ecomkit/payments/server adapters
  catalog: { variantBySku },                    // @ecomkit/catalog/server adapter
});
```

## How to disable

Remove `orders` from the app's modules list. Checkout depends on it (a store without orders cannot sell); reviews treat orders as optional.
