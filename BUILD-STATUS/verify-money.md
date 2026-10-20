# verify-money (2026-10-20, 10:20-11:00 IST, boot agent)

Setup: `pnpm db:fresh boot2` -> `ecomkit_boot2`, `drizzle-kit migrate`, `pnpm jobs:install`, `pnpm seed:load --app shop`
(media masters imported as-is, no derivatives: a temporary local edit per Shyam's 09:55 instruction, not committed;
WP-32 owns the permanent change). `next build` apps/shop (370 pages, exit 0), `next start --port 3301`, worker
(`NODE_OPTIONS=--conditions=react-server tsx worker.ts`, 50 queues / 20 schedules), `ENABLE_MOCKS=1 ALLOW_MOCKS_IN_PROD=1`.
Command: `node tooling/smoke.mjs --base=http://localhost:3301` (full) and `--only=money`.

## Result (money section, 19 checks)

| Check | Result | Evidence |
|---|---|---|
| unknown variant refused | PASS | 404 `unknown_variant` (was a 500 before boot) |
| add to cart | PASS | 200 `{"qty":10}` |
| coupon applied (no-JS cart form, live 10% code rule) | PASS | `cart_cart.coupon_code` set |
| cart quote | PASS | 10 items, Rs 2,385 |
| place order (no-JS checkout form, local slot delivery, Bengaluru 560060) | PASS | order `pending_payment` |
| order totals: delivery + GST + coupon | PASS | total 388500, shipping 150000, tax 22881 (18% GST on delivery and packing; plants are 0%), coupon 26500 |
| coupon redeemed | PASS | `discounts_redemption` row |
| stock reserved | PASS | reservation `held`, reserved 0 -> 10 |
| payment attempt (mock PhonePe) | PASS | redirect to `/api/_mock/phonepe/paypage` |
| mock pay page: success | PASS | 303 -> `/pay/return` |
| signed webhook received | PASS | 1 signed `payments_webhook_event` (posted by the mock to `INTERNAL_BASE_URL`) |
| order paid | PASS | `paid` (worker: webhook job -> status check -> `markPaymentReceived`) |
| stock committed | PASS | reservation `committed`, on hand -10, reserved back to 0 |
| invoice issued | PASS | `orders_invoice` row (subscriber of `order.paid`, about 30 s after payment) |
| notification queued (email) | PASS | `order.confirmed` queued |
| notification queued (whatsapp) | PASS | `order.confirmed` queued |
| conversion recorded (marketing) | PASS | ga4 + meta rows, `skipped_not_configured` (no vendor ids set) |
| failure: payment failed -> order cancelled, stock released | PASS | mock `fail` -> attempt failed -> window closed -> sweep: order `cancelled`, reservation `released` |
| failure: oversell refused | PASS | more than free stock in the cart: place-order creates no order |

Full smoke on the same server: **210 pass, 0 fail, 17 skip** (routes 166 / money 19 / jobs 12 / admin 13). Skips: detail
routes without a seeded sample, `/api/health/ready` 503 until the worker heartbeat, Google feed 403 (token-protected).

## What it took (root causes fixed)
1. No boot wiring at all: `apps/shop/src/boot.ts` binds every module port (see BUILD-STATUS.md, WP-28).
2. Module port state lived in module scope; Next compiles instrumentation and routes as separate module instances, so a
   binding made at boot was invisible to routes. All port holders now live on `globalThis` (core auth provider, pricing,
   checkout, orders, payments, enquiries, reviews, flows, erp-sync, marketing, monitoring, inventory sender).
3. Registry component thunks (pdpSections, cartBlocks) resolved through the instrumentation copy of the registry, so
   their client islands were missing from the route's client manifest (PDP render error). The root layout publishes the
   route copy (`src/route-registry.ts`); boot's registry reads through to it.
4. `proxy.ts` 301'd the worker's loopback calls (revalidation POST, uptime, mock gateway, webhooks) to the canonical host.
   Machine prefixes `/api/internal/ /api/health/ /api/webhooks/ /api/_mock/` are never redirected (test added).
5. Core settings: Drizzle's jsonb reader JSON-parsed stored strings again, so an admin save of a numeric-looking text
   field (payments `clientVersion` "1") broke checkout with a ZodError. `readRows` parses `value::text` once (test added).
6. Seed: no prices were ever seeded (pricing had no seed hook) and no shipping setup existed (`data/seed/shipping.json`
   missing). Added `pricing.prices` hook (284 prices, 277 bulk tiers) and the shipping seed file (WP-18 request 1).
