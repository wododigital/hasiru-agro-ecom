# @ecomkit/hasiru-ops-adapter

The `ErpAdapter` (contract in `@ecomkit/core/contracts`, erp.ts) for the Hasiru operations app. The operations app is never modified; the contract and the change request for its team are in `docs/hasiru-ops-sync-spec.md`.

| Transport (setting `transport`) | Stock in | Orders out | Leads |
|---|---|---|---|
| `mock` (default) | in-app mock, signed HTTP | in-app mock, signed HTTP | in-app mock intake |
| `pg` | read-only `ecom_sync` Postgres role, keyset pages of 1000, column allowlist | `ops-api` when `opsBaseUrl` + secret are set, else orders wait in the outbox | existing `/api/leads/intake` |
| `ops-api` | `GET /api/ecom/inventory`, signed | `POST /api/ecom/orders`, signed | existing `/api/leads/intake` |

## Dependencies

Hard: `core`, `erp-sync`. Plugs in through `configureErpSync({ adapter: () => opsAdapter() })` at boot (see erp-sync README); the adapter reads its settings on every run, so a change in admin applies on the next run.

## Public API (`@ecomkit/hasiru-ops-adapter/server`)

- `opsAdapter()`: adapter built from saved settings. `createOpsAdapter(settings, { http?, now? })`: same from explicit settings (tests, scripts).
- `pullPgPage(url, cursor)`, `withReadOnly(url, fn)`, `checkPgUrl(url)`: the read-only transport (every read inside `BEGIN READ ONLY`, 10 s statement timeout, always rolled back; TLS required off loopback).
- `signRequest(...)`, `verifyRequest(...)`: HMAC-SHA256 over `timestamp \n nonce \n METHOD \n path \n body`, 5-minute window.
- `testConnectionAction`: settings action.

`@ecomkit/hasiru-ops-adapter/domain`: `opsSettingsSchema`, `PG_ALLOWLIST`, `PG_INVENTORY_SQL`, `grantScript(role)` (the `CREATE ROLE` script in the spec is generated from the allowlist), `pgRowToItem`, `toIntakeBody`, `signingString`.

## Routes

- `POST /api/webhooks/ops`: status callbacks (packed, dispatched, delivered). Signed with the shared secret (mock secret in `mock` mode), 64 KB cap, 120 a minute per caller, nonce applied once via erp-sync. 404 while no secret is configured.
- Mock (dev and test configs only, and only with `ENABLE_MOCKS=1`): `/api/_mock/hasiru-ops/[...path]` with `api/ecom/inventory`, `api/ecom/orders`, `api/leads/intake`, `_control`, `_state`.

## Settings (`hasiru-ops-adapter`)

`transport` (`mock`), `pgUrl` (secret), `opsBaseUrl` (https), `opsHmacSecret` (secret), `leadsIntakeUrl` (https), `leadsIntakeSecret` (secret). Action: **Test connection**.

## Tables, events, jobs

None of its own: it uses erp-sync's tables, events and jobs.

## How to disable

Remove `hasiru-ops-adapter` from `modules.config.ts` and drop its `configureErpSync` adapter line; erp-sync then reports "not configured" and queues without sending.

## Tests

`pnpm turbo run typecheck lint test --filter=@ecomkit/hasiru-ops-adapter`: the `pg` transport against a local copy of `items` / `stock_batches` with staff-only RLS and the role from `grantScript()` (2,345 items, paging past 1000, column allowlist, UPDATE refused, read-only even for a stronger role, TLS rule); the mock transport end to end (paging, drift, idempotent order push, tampered / stale / replayed signatures, lead intake, not configured); erp-sync pull and push through the mock; the webhook route (applied once, duplicate nonce, identical 401s, 400, 413, 404 without a secret).
