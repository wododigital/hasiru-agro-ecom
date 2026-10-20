# verify-jobs (2026-10-20, 07:15-07:25 IST)

Setup: `ecomkit_verify_jobs` cloned from `ecomkit_wp_28` (fresh `seed:load` crashed in the media step: duplicate key on
`media_derivative` insert, see below), `drizzle-kit migrate` + `jobs:install`, shared `.next` build (07:12) under
`next start --port 3204` with `ENABLE_MOCKS=1 ALLOW_MOCKS_IN_PROD=1`, worker `NODE_OPTIONS=--conditions=react-server tsx worker.ts`.

| Check | Result | Evidence |
|---|---|---|
| Worker boots | PASS | `worker started` 50 queues, 20 schedules |
| Abandoned cart -> flow run -> reminder with restore link | FAIL (not wired) | `configureFlows` is never called (web or worker), `flows_flow` empty; smoke SKIP 0 runs |
| notify-me | PASS* | 201, `inventory_subscription` row. *Only after inserting `inventory_level` rows by hand: the wp_28 seed has 284 variants and 0 levels, so every variant answers 404 `unknown_variant` |
| Enquiry submit | PASS | 303 `?enquiry=sent`, `enquiries_enquiry` row |
| Wizard generate | PASS | 200 planId (smoke payload fixed) |
| Wizard unlock (soft) | PASS | 200 `{"status":"unlocked"}` (smoke payload fixed) |
| ERP sync against mock | PASS (worker) | `syncNowAction` -> `erp-sync.pull-inventory`: 200 items, 0 changed, 200 unmapped (mock SKUs don't match seeded SKUs); `erp_sync_run` 0 -> 1. Needed the adapter binding in `worker.ts` |
| Feed regeneration | PASS (pipeline) | `regenerateAction` -> `feeds_run` 0 -> 2; 0 items / 165 errors because this DB has no prices or images (data, not code) |
| Google feed served | SKIP | 403 without a valid feed token |
| Monitoring: dead-letter alert | PASS | `jobs.dead-letter` high alert for `payments.sweep.dead` |
| Monitoring: payment/email/WhatsApp failure alert | PASS | 3 failed `integrationCall`s each for phonepe/gmail/whatsapp -> `integration.failed` alerts `phonepe:payment.create`, `gmail:email.send`, `whatsapp:message.send` |
| Smoke `--only=jobs` | 4 pass, 0 fail, 4 skip | ERP/feeds buttons are JS-only (`type="button"`), so the no-JS form submit can't drive them |

## Fixed
- `apps/shop/worker.ts`: `configureErpSync({ adapter: opsAdapter })`. Without it every ERP pull/push in the worker had no adapter.
- `tooling/smoke.mjs` jobs section: wizard generate payload (`sqft` + single `purpose` = a `planting_model` slug, district
  from `places_district`), unlock payload (`step: 'soft'`), notify-me picks a variant from `inventory_level`, ERP/feeds
  action pages moved to `/admin/settings/{erp-sync,feeds}` (where module settings actions render).

## Open (outside jobs scope or out of time)
1. **Worker boot wiring is mostly missing** (WP-28). `payments.sweep` dead-letters in the worker: `configurePayments({ orders })`
   was never called, and no orders-side `PaymentsOrdersPort` implementation exists anywhere. Same for `configureFlows`
   (carts.snapshot/restoreLink, orders, leads, products, discounts) and `configureMarketing`. Instrumentation (`apps/shop/instrumentation.ts`)
   has no `register()` at all, so the web process has none of these bindings either. Cart has `restoreToken(cartId, { days, couponCode })`
   for `restoreLink` (URL `${SITE_URL}/api/cart/restore?token=`), but a `snapshot(cartId, checkoutSessionId)` port (status, contact, total, itemCount) still has to be written.
2. Settings-action buttons (ERP "Sync stock now", feeds "Rebuild feeds now") are client buttons, not forms. Smoke cannot drive them without JS; verified by calling the actions directly.
3. Seed data: `inventory_level` is empty in the wp_28 DB (notify-me 404s for every variant). A fresh `seed:load` crashed on a duplicate `media_derivative` insert (asset `01a156fc-...`, includes a `jpeg 640` share row), so the media seed is not idempotent under some conditions. Belongs to media / seed owners.
4. ERP mock SKUs do not match seeded catalog SKUs (200 unmapped), so a mock pull changes no stock.
