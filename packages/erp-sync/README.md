# @ecomkit/erp-sync

Generic connector between the store and an ERP or operations system: an outbox for orders and leads (retry with backoff, dead letter, alerts), a scheduled inventory pull into `inventory.setFromErp` (manual overrides win, A26), variant to ERP item mapping (automatic by SKU or name similarity, the rest resolved by an admin), a sync log and a stock drift report. The transport comes from an adapter module (for this store `@ecomkit/hasiru-ops-adapter`) implementing the `ErpAdapter` contract (`@ecomkit/core/contracts`, erp.ts).

## Dependencies

- Hard: `core`, `inventory`.
- Optional: `orders`, `customers`, `catalog`. Their data arrives through ports bound by the host, so the module also works in a store without orders (stock in only) or without customers (no lead push).

## Boot wiring (host: `instrumentation.ts` and `worker.ts`)

```ts
import { configureErpSync } from '@ecomkit/erp-sync/server';
configureErpSync({
  adapter: () => import('@ecomkit/hasiru-ops-adapter/server').then((m) => m.opsAdapter()), // resolved per run
  orderPayload: (orderId) => orders.erpOrderPayload(orderId),       // ErpOrderPayload | null
  applyOrderStatus: (s) => orders.applyErpStatus(s),                // status callback -> transition, false if unknown
  leadPayload: (leadId) => customers.leadForErp(leadId),            // ErpLeadPayload | null
  onPushed: async ({ kind, refId }) => { if (kind === 'lead') await customers.markLeadPushed(refId); },
  variantCandidates: () => catalog.variantsForErp(),                // [{ variantId, sku, name, variety }]
});
```

Every port is optional. Without `adapter` nothing moves (rows wait as pending). Without `orderPayload` / `leadPayload` rows wait as pending with "source not configured" and no attempt is spent. Without `variantCandidates` auto-mapping uses inventory SKUs only.

## Public API (`@ecomkit/erp-sync/server`)

| Function | What |
|---|---|
| `configureErpSync(ports)` | bind adapter and ports (above) |
| `enqueueOutbox({ kind, refId }, { tx? })` | idempotent on (kind, refId) |
| `pushDue({ now?, limit? })` | push due rows, one transaction and row lock each (`skip locked`) |
| `retryOutbox(id, actorId)` | failed or dead row back to pending with a fresh attempt budget (audited) |
| `erpRefFor(orderId)` | `{ status, externalRef, invoiceNumber }` for an order |
| `pullInventory({ now?, force? })` | one stock pull (keyset pages, snapshot, auto-map, `setFromErp`) |
| `mapSku({ variantId, erpItemId }, actorId)`, `unmapSku(variantId, actorId)` | admin mapping (audited) |
| `erpItemIdsFor(variantIds)` | linked ERP item id per variant (fills `lines[].erpItemId` in the order payload) |
| `mappingOverview()`, `driftReport()`, `outboxCounts()`, `listOutbox()`, `listRuns()`, `pendingOrderRows()` | admin data |
| `acceptStatusCallback(nonce, body)` | used by the adapter's signed webhook route; nonce stored once |

`@ecomkit/erp-sync/domain`: settings schema, boundary schemas (`erpInventoryPageSchema`, `erpOrderPayloadSchema`, `erpLeadPayloadSchema`, `statusCallbackSchema`), `similarity`, `proposeMatches`, `backoffMs`, `csvLine`.

## Tables

- `erp_outbox(id, kind order|lead, ref_id, payload, status pending|sent|failed|dead, attempts, last_error, next_attempt_at, sent_at, external_ref, invoice_number)`, unique `(kind, ref_id)`, index `(status, next_attempt_at)`.
- `erp_item_map(variant_id pk, erp_item_id unique, erp_name, mapped_by auto|manual, confidence)`.
- `erp_item(erp_item_id pk, sku, name, variety, available, ready_in_days, cost_paise, erp_updated_at, seen_at)`: last-seen ERP catalogue (unmapped list, drift).
- `erp_sync_run(id, direction inventory_in|orders_out, transport, started_at, finished_at, items, changed, errors, log)`.
- `erp_webhook_event(nonce pk, ecom_order_number, status, outcome, received_at)`.

## Routes and admin

- `GET /api/admin/erp/pending-orders`: CSV of orders not yet in the ERP (staff with `orders.write`).
- `/admin/erp` (nav: Health band, `health.read`): counts, outbox with Retry, sync log, CSV link.
- Settings page (rendered by admin-shell): interval, auto-map threshold, retry budget; actions **Sync stock now**, **Push outbox now**; custom panel **Item mapping**.
- Dashboard widget "Orders waiting for ops sync"; report "Stock drift vs ERP" (group `inventory`, CSV).

## Settings (`erp-sync`)

`enabled` (true), `pullEveryMinutes` (10, 5..1440), `autoMapMinConfidence` (0.8), `maxAttempts` (10), `notConfiguredRetryMinutes` (15).

## Events and jobs

- Consumes `order.paid`, `order.confirmed` (one row per order), `lead.created` (the only lead path; enquiries never push directly).
- Emits `erp.synced` (`inventory`, `orders`, `leads`). `inventory` emits `stock.changed` per changed variant.
- Jobs: `erp-sync.pull-inventory` and `erp-sync.push-outbox`, singleton queues, scheduled every minute (the pull skips itself until the interval has passed).
- Health checks: `erp-sync.pull-age` (degraded after 3 intervals), `erp-sync.dead-letter` (critical: down while dead rows exist).

## How to disable

Remove `erp-sync` (and its adapter module) from `modules.config.ts` and run `modules:sync`. Orders and leads are unaffected; stock stays as last set (seed or manual). Or switch `enabled` off in settings: pulls and pushes stop, rows keep queueing.

## Tests

`pnpm turbo run typecheck lint test --filter=@ecomkit/erp-sync` (real Postgres, databases `ecomkit_wp_27_*`): domain rules, idempotent push and enqueue, concurrent workers, backoff and dead letter with health, not-configured waits, invalid payloads, paging past 1000, auto-map and manual mapping, manual override kept, drift, interval and pull age, the real worker routing events to outbox rows, status callback dedupe, admin views render.
