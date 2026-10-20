# hasiru-ops sync: contract and change request

Owner: WP-27 (`@ecomkit/erp-sync` + `@ecomkit/hasiru-ops-adapter`). Written 2026-10-20.

The store and the operations app (hasiru-ops) stay separate. **hasiru-ops code is never modified by this project.** Everything the store needs from the operations side is listed in section 7 as a change request for the operations team: one database role (no code) for stock, and two signed HTTPS endpoints (code, written by the operations team when they choose) for orders. Until the endpoints exist, nothing is lost: orders wait in the store's outbox and can be exported as CSV.

| Flow | Direction | Transport today | Transport later | Needs from the operations team |
|---|---|---|---|---|
| Stock (inventory) | ops to store | `pg`: read-only database role, every 10 min | `ops-api`: `GET /api/ecom/inventory` | Create the `ecom_sync` role (section 2) |
| Orders | store to ops | outbox holds them (pending) + CSV export | `ops-api`: `POST /api/ecom/orders` | Build the endpoint (section 4) |
| Order status | ops to store | none | `POST <store>/api/webhooks/ops` | Optional: call it on packed / dispatched / delivered (section 5) |
| Leads | store to ops | existing `POST /api/leads/intake` | same | Share the intake secret (section 6) |

Store admin: **Settings > Hasiru ops adapter** (transport, connection string, base URL, secrets, Test connection) and **Settings > ERP sync** (interval, auto-map threshold, retry budget, Sync now, item mapping panel). **Health > ERP sync** (`/admin/erp`) shows the outbox, dead letter with Retry, the sync log and the pending-orders CSV.

## 1. Data model on the operations side (read-only study)

From hasiru-ops migrations `0025_invoice_gst_foundation`, `0033_inventory_foundation`, `0092_item_vendor_cost`:

- `items(id uuid, name, variety, size_grade, category, unit, hsn, default_rate, gst_rate, cost_rate, is_active, track_stock, ...)`. There is no SKU column, so the store matches items by name and variety (section 3).
- `stock_batches(item_id, location_id, qty_available numeric, status 'growing'|'ready'|'depleted', expected_ready date, unit_cost, ...)`.
- Both tables have row level security on with staff-only policies. Hosted queries are capped at 1000 rows, so every read pages with a stable key.

Stock the store shows for an item = sum of `qty_available` over its `ready` batches. When that is zero and a `growing` batch with plants exists, the earliest `expected_ready` becomes "ready in N days" (preorder). Inactive items and items with `track_stock = false` are not read.

## 2. Stock in over Postgres: the `ecom_sync` role

Why a database role: there is no inventory API today, the anon key has no read policy for an outside reader, and the service-role key is full access (never acceptable for a sync). A role with column-level SELECT and a read policy is a database change, not a code change.

Run once as the database owner (Supabase SQL editor). Choose the password yourselves and share it out of band:

```sql
create role ecom_sync login password '<set-by-ops-team>' nosuperuser nocreatedb nocreaterole noinherit;
alter role ecom_sync set default_transaction_read_only = on;
alter role ecom_sync set statement_timeout = '10s';
grant usage on schema public to ecom_sync;
grant select (id, name, variety, size_grade, cost_rate, is_active, track_stock) on public.items to ecom_sync;
create policy ecom_sync_read on public.items for select to ecom_sync using (true);
grant select (item_id, qty_available, status, expected_ready) on public.stock_batches to ecom_sync;
create policy ecom_sync_read on public.stock_batches for select to ecom_sync using (true);
```

This text is generated from the adapter's column allowlist (`grantScript()` in `packages/hasiru-ops-adapter/src/domain`); the test suite runs exactly this script against a local copy of the two tables (with staff-only RLS) and proves that the role reads stock, that `select unit_cost` / `select *` / `UPDATE` are refused, and that paging passes 1000 rows.

To revoke: `drop policy ecom_sync_read on public.items; drop policy ecom_sync_read on public.stock_batches; drop owned by ecom_sync; drop role ecom_sync;`

Connection string for store admin (encrypted at rest): `postgresql://ecom_sync:<password>@<host>:5432/postgres?sslmode=verify-full` (direct connection or the session pooler). TLS is mandatory; the adapter refuses `sslmode=disable` for any non-local host. Every read runs inside `BEGIN TRANSACTION READ ONLY` with a 10 s statement timeout on a short-lived connection and is rolled back, so it also works through a transaction pooler.

The query (keyset paging by `items.id`, 1000 rows per page):

```sql
select i.id::text as id, i.name, i.variety, i.size_grade, i.cost_rate::text as cost_rate,
  coalesce(sum(b.qty_available) filter (where b.status = 'ready'), 0)::text as available,
  (min(b.expected_ready) filter (where b.status = 'growing' and b.qty_available > 0))::text as expected_ready
from items i left join stock_batches b on b.item_id = i.id
where i.is_active and i.track_stock and ($1::uuid is null or i.id > $1::uuid)
group by i.id order by i.id limit $2
```

## 3. What the store does with stock

- Schedule: the pull job is checked every minute and runs when `pullEveryMinutes` (default 10, admin editable) has passed; **Sync now** forces one. Singleton queue: two pulls never overlap.
- Every ERP item is snapshotted (`erp_item`). Items the store has not linked yet are auto-linked by exact SKU (when an ERP sends one) or by (name, variety) similarity at or above 0.8 (admin editable); the rest are listed with a suggestion in the mapping panel for an admin to link.
- Linked items update `inventory_level` through the inventory module. A level an admin set by hand (`source = manual`) is never overwritten; the ERP number is still recorded so the **Stock drift vs ERP** report shows both, manual rows highlighted. A linked item the ERP stops reporting (deactivated) drops to zero stock after a complete, error-free pull.
- Health: "ERP stock pull" turns degraded after three intervals without a clean pull.

## 4. Orders out: `POST /api/ecom/orders` (to be built by the operations team)

Sent for every order once it is paid online (`order.paid`) or confirmed for cash or pay-at-nursery (`order.confirmed`). One outbox row per order; the store never sends a second order for the same `ecomOrderNumber`, and the endpoint must also be idempotent on it (a retry after a lost response must return the same result).

Request (signed, section 4.1), `content-type: application/json`:

```json
{
  "ecomOrderNumber": "HA-2610-00042",
  "placedAt": "2026-10-20T05:00:00.000Z",
  "customer": { "name": "...", "phone": "+9198...", "email": null, "gstin": null },
  "deliver": { "method": "pickup | local_slot | outstation", "slotDate": "2026-10-25", "district": "Bengaluru Urban", "address": "..." },
  "lines": [{ "erpItemId": "<items.id or null>", "sku": "...", "name": "...", "qty": 25, "unitPaise": 15000, "lineTotalPaise": 375000 }],
  "totals": { "subtotalPaise": 375000, "discountPaise": 0, "shippingPaise": 150000, "taxPaise": 0, "totalPaise": 525000, "paidPaise": 525000 },
  "status": "paid"
}
```

Money is integer paise (Rs 1 = 100), GST-inclusive. `erpItemId` is the linked `items.id` when the variant is linked, else null (match by name).

Response `200` or `201`: `{ "opsOrderId": "<your id>", "invoiceNumber": "<or null>" }`. The store keeps `opsOrderId` against the order.
Errors: `401` bad signature, `422` invalid body (not retried usefully; fix and use Retry in admin), `5xx` / timeout retried with backoff (30 s doubling to 1 h, 10 attempts by default), then dead letter, which raises a critical health alert.

Until the endpoint exists: rows stay `pending` without spending attempts, the admin dashboard tile shows "Orders waiting for ops sync", and **Download pending orders (CSV)** on `/admin/erp` is the manual bridge.

### 4.1 Signing (both directions)

| Header | Value |
|---|---|
| `X-Timestamp` | Unix seconds; rejected when more than 300 s from the receiver's clock |
| `X-Nonce` | 16 to 128 chars `[A-Za-z0-9_-]`, unique per request; the receiver stores it and rejects a repeat |
| `X-Signature` | hex HMAC-SHA256 with the shared secret over the signing string |

Signing string: `timestamp + "\n" + nonce + "\n" + METHOD + "\n" + path-with-query + "\n" + raw body` (empty body for GET). Compare signatures in constant time. The shared secret (32+ random bytes) is exchanged once out of band and entered in store admin (`opsHmacSecret`, encrypted at rest).

### 4.2 Optional later: `GET /api/ecom/inventory?cursor=<last id>` (replaces the `pg` role)

Signed like 4.1. Response: `{ "items": [{ "erpItemId", "sku", "name", "variety", "available", "readyInDays", "costPaise", "updatedAt" }], "nextCursor": "<last id or null>" }`, stable order by id, at most 1000 items per page. Switch the store's transport to `ops-api` and drop the role.

## 5. Status callbacks: `POST <store>/api/webhooks/ops` (optional)

Signed like 4.1 with the same secret. Body `{ "ecomOrderNumber": "...", "status": "packed | dispatched | delivered", "at": "<iso, optional>" }`. Responses: `200 { ok: true, outcome: applied | duplicate | unknown_order | no_handler }`, `400` invalid body, `401` bad or stale signature (same body every time), `413` body over 64 KB, `429` over 120 requests a minute. Each nonce is applied once.

## 6. Leads: existing `POST /api/leads/intake` (no change needed)

Every lead in the store (planting wizard unlock, notify-me, chat, farm enquiry) becomes one customer lead, and only the `lead.created` event queues it for the operations app; enquiries never push on their own. The store calls the existing endpoint with header `x-intake-secret` and body `{ name, phone, email, message, source: "ecom-<wizard|notify-me|enquiry|chat|checkout>", lead_type: "service" for enquiries else "nursery" }`; `message` carries purpose, land size, district, notes and the store lead id. The endpoint is create-only and returns no id, so a retry after a lost `201` can create a duplicate lead on the operations side; the store's lead id in `message` makes such duplicates easy to merge.

## 7. Change request for the operations team

1. Create the `ecom_sync` role with the script in section 2 and share the connection string (TLS) with the store owner. Needed for stock.
2. Build `POST /api/ecom/orders` per section 4 (idempotent on `ecomOrderNumber`, HMAC per 4.1). Needed for orders.
3. Optionally build `GET /api/ecom/inventory` (4.2) and call `POST <store>/api/webhooks/ops` (section 5).
4. Exchange the HMAC secret and the existing `LEAD_INTAKE_SECRET` value out of band.

## 8. Testing without the operations app

Transport `mock` (default in dev and test) talks to the in-app mock at `/api/_mock/hasiru-ops/*` (only when `ENABLE_MOCKS=1`): 200 items in keyset pages, a drift toggle, an orders endpoint that verifies the signature and nonce and is idempotent, and a lead intake that checks the secret. `POST /api/_mock/hasiru-ops/_control` with `{ "drift": true }`, `{ "failOrders": 3 }` or `{ "items": 500 }`; `GET .../_state` shows received orders and leads.
