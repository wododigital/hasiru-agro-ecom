# verify-money (2026-10-20, 07:14-07:20 IST)

Setup: `pnpm db:fresh verify-money` -> `ecomkit_verify_money`, `drizzle-kit migrate` (6 migrations), `jobs:install`, `seed:load --app shop` with the media hook skipped (media is ~588 assets through sharp and would not finish in the budget). `next start --port 3203` on the existing `apps/shop/.next` (07:12 build, not rebuilt), worker (`tsx --conditions=react-server worker.ts`) on the same DB, `ENABLE_MOCKS=1 ALLOW_MOCKS_IN_PROD=1`. Command: `node tooling/smoke.mjs --base=http://localhost:3203 --only=money`.

## Result table

| Check | Result | Detail |
|---|---|---|
| seed: purchasable variant (inventory_level rows) | FIXED -> PASS | was 0 rows: inventory seed needs catalog `variantRefsBySku`, which catalog never exported. Now 284 levels, 15540 units on hand |
| GET /api/cart (quote) | PASS | 200, empty cart JSON |
| /cart, /checkout render | PASS | 200 |
| PhonePe webhook, bad signature | PASS | 401 |
| add to cart (POST /api/cart/lines) | **FAIL** | 500 `cart is not configured: call configureCart({ variants }) at boot` |
| place order | SKIP (blocked) | no Place order form: cart is empty because add-to-cart 500s |
| mock PhonePe pay + signed webhook | not reached | blocked by add-to-cart |
| order paid / stock committed / invoice / email + WhatsApp queued / analytics | not reached | blocked |
| failure path: payment failed | not reached | blocked (code path exists: `payments/src/server/jobs.ts` sweep -> `orders.paymentExpired({ reason: 'failed' })`) |
| failure path: oversell / unknown variant | **FAIL** | unknown variant id also 500s (same missing `configureCart`), should be a 4xx |

## Fixed (in scope, uncommitted)

- `packages/inventory/src/server/seed.ts`: when `@ecomkit/catalog/server` has no `variantRefsBySku`, resolve sku -> variant with a seed-time SQL read (`product.sku || variant.sku_suffix`, the rule in `catalog/src/domain/seed.ts:262`). Without it `seed:load` wrote no `inventory_level` rows, so nothing was purchasable and the smoke money section always SKIPped.

## Root blocker (outside the money scope: apps/shop)

The web process has **no boot wiring at all**: `apps/shop/instrumentation.ts` only exports `onRequestError`; there is no `register()` and nothing in `apps/shop` calls `configureCart`, `configurePricing`, `configurePayments`, checkout/orders ports, `configureShipping`, etc. (BUILD-STATUS.md open rows for WP-28 boot wiring, Wave 1 + Wave 2 lists). Every money step after the empty quote depends on it. Needed in `instrumentation.ts register()` (nodejs runtime) and mirrored in `worker.ts`:

1. `configureCart({ variants, registry, discounts, shipping, inventory, messages })`: `variants` needs a catalog adapter returning `CartVariant` (no such export exists in catalog yet; write it in the app from catalog read APIs).
2. `configurePricing({ gstRates, variantsOf })` (throws `pricing is not configured` otherwise).
3. Checkout/orders ports: `markConverted`, `noteContact` (cart), `bookSlot` (shipping), `redeem` (discounts), `reserve/commit` (inventory), `recordOrder` (customers).
4. `configurePayments({ orders, alert })` with `orderForPayments`; `configureShipping({ places, resolvePincode })`.
5. Unknown/oversold variant on `/api/cart/lines` should return 4xx once cart is configured; recheck.

After wiring: rebuild shop, rerun `node tooling/smoke.mjs --only=money` against `ecomkit_verify_money` (DB is migrated + seeded, can be reused).

## Other findings

- Catalog seed skips 10 products (HAP-0006, 0045, 0092, 0093, 0171, 0174, 0188, 0197, 0225, 0273): `seoDescription` > 320 chars or `shortDescription` > 1000 chars in `data/seed/products.json`. Data or schema owner to decide (truncate in seed build, or relax the zod max).
- `next start` warns that `output: 'standalone'` wants `node .next/standalone/server.js`; it served fine for this check.
- The smoke has no failure-path cases (payment failed, oversell); not added since the happy path cannot run yet.
- Agents sharing one scratchpad overwrote each other's `env.sh`; per-agent subfolders avoid it.
