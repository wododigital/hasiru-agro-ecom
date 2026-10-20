# Hasiru Agro e-commerce: final build report (2026-10-20, 07:40 IST)

For Shyam. Branch `ecom-build` (not pushed). pnpm monorepo, Next.js 16, 33 `@ecomkit/*` packages, two apps (`apps/shop` = Hasiru store, `apps/minimal` = bare proof store). Postgres 17 local on port 5433, Node 22.

Honest status: **the modules are built and verified in isolation; the shop's boot wiring is not finished**, so the money path (add to cart -> order -> PhonePe -> paid) does not run end to end yet. Details in "Open" below. This is the first thing to fix when you resume.

## 1. Run it locally

```bash
cd hasiru-agro-ecom && pnpm install
pnpm db:fresh shop                      # drops/creates ecomkit_shop from ecomkit_template (pg_trgm); prints DATABASE_URL
export DATABASE_URL=postgres://localhost:5433/ecomkit_shop
export SITE_URL=http://localhost:3000 SETTINGS_MASTER_KEY=<32+ random bytes, base64> INTERNAL_SECRET=<random>
export MEDIA_ROOT="$PWD/storage/media"  # absolute; shared by web, worker, seed
pnpm -F shop exec drizzle-kit migrate   # 6 migrations
pnpm jobs:install                       # queues + schedules (50 queues, 20 schedules)
pnpm seed:build && pnpm seed:load --app shop   # slow: ~588 media assets through sharp (minutes). Clone a seeded DB with CREATE DATABASE x TEMPLATE y for repeats
pnpm dev                                # shop on :3000 (minimal: pnpm -F minimal dev, :3100)
pnpm -F shop build && pnpm -F shop start     # or node apps/shop/.next/standalone/server.js (output: standalone)
cd apps/shop && NODE_OPTIONS=--conditions=react-server pnpm exec tsx worker.ts   # job worker, same env
pnpm typecheck && pnpm test             # turbo, per package
ENABLE_MOCKS=1 ALLOW_MOCKS_IN_PROD=1 node tooling/smoke.mjs --base=http://localhost:3000 --only=routes,money,jobs,admin
```

Mocks: `ENABLE_MOCKS=1` swaps PhonePe, Gmail, WhatsApp, hasiru-ops for in-process fakes. Never set `ALLOW_MOCKS_IN_PROD` on the VPS.

## 2. What was built

### Buyers (plant e-commerce)
Home, `/plants` with collections (`timber`, `fruiting` with desi/exotic sub-filter, `other`), filters/sort/pagination, PDP `/plant/[slug]` with two-tier pricing (normal + per-plant bulk threshold), `/inputs` + `/input/[slug]`, search (`/search`, suggest API, facets), cart (cookie carts, coupons rate-limited 30/h per IP and per cart, abandoned-cart restore link: GET is read-only, POST same-origin single-use), checkout (pincode/shipping slots, GST, idempotent orders), PhonePe (mock + signed webhook, bad signature -> 401, sweep job for failed/expired), orders + invoice PDF, customer account (login, orders, addresses, land, reviews), notify-me on out-of-stock, reviews, truck-meter.

### Discoverers (content + planning)
Farm plan wizard `/plan` (generate -> blurred preview -> soft unlock with name+phone, plan bound to visitor/customer, never re-assigned), planting models `/models/[slug]` with 3D view and 36x36 ft canvas chart, `/plants/for/[model]`, calculators (plants, compost), `/grow-in/[district]` (places), guides and videos (CMS posts), SEO module (sitemap index, robots, llms.txt, OG images, soft-404 noindex on unknown slugs).

### Services (farm development)
`/build-farm-with-us` enquiry form (303 -> `?enquiry=sent`, `enquiries_enquiry` row, notification jobs), CMS pages for about/contact/why-choose-us/farm-development, enquiries index in admin.

### Admin (Shopify-style structure, WP-29)
Sidebar with sub-menus, index tables + detail pages, Settings bottom-left with its own layout (17 module sections, each with save forms), Analytics. Areas: Orders (list, detail, invoice PDF, phone search for full-PII staff only), Products/Catalog (products, variants, prices, stock counts), Customers, Discounts (rules + codes), Content (CMS pages, posts, menus, media library), Marketing (flows, feeds, pixels), Enquiries, Inventory, Reviews, Monitoring/Health (dead-letter + integration-failure alerts), AI assistant, Settings (store, payments, shipping, taxes, notifications, integrations with sealed secrets `{v,ct,iv}` and redacted audit, ERP sync, feeds, SEO). Role matrix: owner vs support (support: no Settings/Analytics, no key fields, no full PII). Audit log on every save.

### Module recipe
`docs/NEW-STORE-RECIPE.md`: copy `apps/minimal`, edit `modules.config.ts`, `pnpm modules:sync --app <store>`. `apps/minimal` proves the subset (core, ui, auth, media, catalog, pricing, inventory, cart, checkout, payments, orders, customers, seo) typechecks, builds and serves.

## 3. Check results (real numbers, 2026-10-20 07:12 build)

Full per-check tables: `BUILD-STATUS/verify-{storefront,admin,money,jobs}.md`.

| Area | Result |
|---|---|
| Typecheck (all packages) | final re-run 07:30-07:38:  Tasks:    38 successful, 38 total, exit 0 |
| Unit tests (vitest, real Postgres) | passed at wave 3 gate per package; not re-run in the final 12 minutes |
| `next build` apps/shop + apps/minimal | both built 07:12 (standalone output) |
| Storefront routes smoke (`--only=routes`, seeded DB) | **137 PASS, 12 FAIL, 27 SKIP** |
| Admin smoke (`--only=admin`) | **63 PASS, 0 FAIL, 7 SKIP** (skips: unseeded detail pages) |
| Jobs smoke (`--only=jobs`) | 4 PASS, 0 FAIL, 4 SKIP; worker boots 50 queues / 20 schedules; alerts fire for dead-letter and phonepe/gmail/whatsapp failures |
| Money smoke (`--only=money`) | quote/cart/checkout render, webhook 401: PASS; **add-to-cart 500 (`configureCart` never called)**: FAIL; order/pay/paid/invoice: not reached |

The 12 storefront fails: 4 anonymous `/account/{profile,addresses,land,reviews}` render a NotFoundError inside Suspense (should redirect to login), empty sitemap (no `configureSeo`), footer links to 4 CMS pages 404 (build ran against unseeded DB, `'use cache'` kept nulls: rebuild against seeded DB), 5 draft policy pages linked from footer, menu slug `fruiting-trees` vs catalog `fruiting`.

## 4. Open (do these first)

1. **Boot wiring in `apps/shop/instrumentation.ts` `register()` and `worker.ts`** (WP-28): `configureCart`, `configurePricing`, `configurePayments({ orders })`, `configureShipping`, `configureSeo({ registry })`, `configureFlows`, `configureMarketing`, checkout/orders ports (markConverted, bookSlot, redeem, reserve/commit, recordOrder). Blocks the whole money path, sitemap and abandoned-cart flows. Then rerun `--only=money` against `ecomkit_verify_money`.
2. Customers account pages: redirect anonymous to `/account/login?next=`.
3. Seed data: `fruiting-trees` -> `fruiting` in menu + `data/seed/redirects.json`; publish placeholder policies or hide draft menu items; 10 products skipped (description length over zod max); media seed not idempotent (duplicate `media_derivative`); ERP mock SKUs do not match seeded SKUs.
4. Rebuild shop against a seeded DB before deploy (cached CMS pages).

## 5. Sample / dummy data
Catalog from the WooCommerce export (282 products seeded, prices and images partly missing), placeholder policy pages (draft), planting models and districts from research, mock PhonePe/Gmail/WhatsApp/hasiru-ops adapters, demo flows. No real customer or order data.

## 6. Admin keys checklist (Settings > Integrations, stored sealed)
PhonePe merchant id + salt key/index + webhook secret; Gmail OAuth client id/secret + per-site refresh token (Connect Gmail button, agency client from vault); Meta WhatsApp Cloud API token + phone number id + webhook verify token; Meta catalog id, pixel id, CAPI access token; Google Merchant Center id + feed token, GA4 measurement id + API secret, Google Ads conversion id/labels; Claude API key (AI assistant); hasiru-ops read-only Postgres URL (TLS enforced for non-loopback). Server env: `DATABASE_URL`, `SITE_URL`, `SETTINGS_MASTER_KEY`, `INTERNAL_SECRET`, `MEDIA_ROOT`.

## 7. Security items still open (`BUILD-STATUS/orchestrator-security.md`)
All listed gates are marked FIXED/DONE (cart restore single path, coupon rate limit, consent-gated purchase tags, refund cap, order idempotency and PII scoping, hasiru-ops TLS, plan unlock binding). Remaining: anonymous account pages leak a render error (item 2 above), real 404 status on unknown slugs (SEO polish), and the boot wiring itself (unconfigured modules fail closed with 500, not open).

## 8. Skipped
Playwright E2E, Lighthouse, separate redundancy audit, final full smoke on a fresh :3299 DB (time: session ended 07:42; verifiers' 07:14-07:32 runs are the numbers above).

## 9. Deploy prerequisites, shop.hasiruagro.com
Postgres 17 on the Hostinger VPS (needs your approval, plus `pg_trgm`), Node 22 + pnpm 12, nginx reverse proxy that sets `X-Real-IP`/`X-Forwarded-For` (rate limits and audit depend on it), env from section 1 with real keys, `MEDIA_ROOT` on persistent disk, pm2 for `server.js` and `worker.ts`, seeded DB before `next build`. Deploy steps per the vault entry; nothing has been pushed or deployed.
