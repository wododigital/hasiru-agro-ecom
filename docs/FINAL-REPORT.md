# Hasiru Agro e-commerce: final build report (2026-10-20, 14:10 IST)

For Shyam. Branch `ecom-build` (local, not pushed). pnpm monorepo, Next.js 16.4 (cache components), 33 `@ecomkit/*` packages, two apps (`apps/shop` = Hasiru store, `apps/minimal` = bare proof store). Postgres 17 local on port 5433, Node 22.

Honest status: **the store runs end to end on a fresh database.** Money path (add to cart -> checkout -> mock PhonePe -> webhook -> paid -> stock committed -> invoice -> email + WhatsApp queued and sent through the mocks), abandoned-cart reminder with a working restore link, storefront with real product images and real 404s, Shopify-style admin with Home KPIs, analytics reports and role gating all pass the smoke on the final tree. What is still open is listed in section 4; none of it blocks a staging deploy.

## 1. Run it locally

```bash
cd hasiru-agro-ecom && pnpm install
pnpm db:fresh shop                      # drops/creates ecomkit_shop from ecomkit_template (pg_trgm); prints DATABASE_URL
export DATABASE_URL=postgres://localhost:5433/ecomkit_shop
export SITE_URL=http://localhost:3000 NEXT_PUBLIC_SITE_URL=http://localhost:3000 INTERNAL_BASE_URL=http://127.0.0.1:3000
export SETTINGS_MASTER_KEY=<base64 of 32 random bytes> INTERNAL_SECRET=<32+ random chars>
export MEDIA_ROOT="$PWD/storage/media"  # ABSOLUTE and the same for web, worker and seed:load (the default is cwd-relative: seed from the repo root and `next start` from apps/shop would otherwise use two different folders and every /media URL 404s)
pnpm -F shop exec drizzle-kit migrate   # 6 migrations
pnpm jobs:install                       # pg-boss schema (50 queues, 20 schedules are declared by the worker)
pnpm seed:load --app shop               # ~1 min: 587 media masters (no derivatives for seed images), 292 products, 294 stock levels, 15 cms pages / 39 blocks, 645 districts
DATABASE_POOL_MAX=2 pnpm -F shop build  # against the seeded DB (cms pages and product shells are prerendered from it); 2 connections per prerender worker keeps the build well under max_connections
cd apps/shop && NODE_ENV=production pnpm exec next start --port 3000      # deploy uses node .next/standalone/server.js
cd apps/shop && NODE_ENV=production NODE_OPTIONS=--conditions=react-server pnpm exec tsx worker.ts   # same env
ENABLE_MOCKS=1 ALLOW_MOCKS_IN_PROD=1 node tooling/smoke.mjs --base=http://localhost:3000   # or --only=routes,money,jobs,admin
```

Mocks: `ENABLE_MOCKS=1` swaps PhonePe, Gmail, WhatsApp, hasiru-ops for in-process fakes. Never set `ALLOW_MOCKS_IN_PROD` on the VPS. `pnpm seed:build` regenerates `data/seed/*.json` from the raw sources (not needed to run; the files are committed).

## 2. What was built

### Buyers (plant e-commerce)
Home (two-path hero + cms blocks: why choose us, testimonials, trust band, farm development steps), `/plants` with collections (`timber`, `fruiting` with desi/exotic sub-filter, `other`), filters/sort/pagination, PDP `/plant/[slug]` with gallery, two-tier pricing (normal + per-plant bulk threshold), JSON-LD, `/inputs` + `/input/[slug]`, search (`/search`, suggest API, facets), cart (cookie carts, coupons rate-limited 30/h per IP and per cart, abandoned-cart restore link: GET is read-only, POST same-origin single-use), checkout (pincode/shipping slots, GST, idempotent orders), PhonePe (mock + signed webhook, bad signature -> 401 and a monitoring alert, sweep job for failed/expired), orders + invoice PDF, customer account (login, orders, addresses, land, reviews; signed-out visitors are sent to `/account/login?next=`), notify-me on out-of-stock, reviews, truck-meter.

### Discoverers (content + planning)
Farm plan wizard `/plan` (generate -> blurred preview -> soft unlock with name+phone, plan bound to visitor/customer, never re-assigned), planting models `/models/[slug]` with 3D view and 36x36 ft canvas chart, `/plants/for/[model]`, calculators (plants, compost), `/grow-in/[district]` (places), guides and videos (cms), SEO module (sitemap index, robots, llms.txt, OG images, redirects, 404 log). Unknown slugs answer a real 404 on 10 routes and on the catch-all.

### Services (farm development)
`/build-farm-with-us` enquiry form (303 -> `?enquiry=sent`, `enquiries_enquiry` row, notification jobs), cms pages about / contact / why-choose-us / farm-development + 5 service pages (hero with image, rich text, farm development step rail, enquiry CTA), 5 policy pages published + noindex with the SRS sentences or a holding line, enquiries index in admin.

### Admin (Shopify-style structure, WP-29 + WP-33)
Sidebar with sub-menus, Settings bottom-left with its own layout (17 module sections with save forms, sealed secrets, redacted audit), Home with date range + compare, KPI strip (sessions, total sales, orders, conversion rate, AOV with sparklines) and "Things to do" (orders to dispatch, payments pending, new enquiries, failed messages, low stock, open alerts, reviews to moderate), Analytics overview / reports (8 named reports with compare) / live view, DataTable index pages with saved views, filters, bulk actions and detail frames for orders, products, inputs, customers, enquiries, discounts, abandoned checkouts, reviews; Content (cms pages, posts, menus, media library), Marketing (flows, feeds, pixels), Inventory, Monitoring/Health (dead-letter + integration-failure alerts, error issues), AI assistant. Role matrix: owner vs support (support: no Settings/Analytics, no revenue cards, no key fields, no full PII). Audit log on every save.

### Module recipe
`docs/NEW-STORE-RECIPE.md`: copy `apps/minimal`, edit `modules.config.ts`, `pnpm modules:sync --app <store>`. `apps/minimal` (core, ui, auth, media, catalog, pricing, inventory, cart, checkout, payments, orders, customers, seo) typechecks and builds.

## 3. Check results (final tree, fresh `ecomkit_final`, 2026-10-20 13:30-14:05 IST)

All numbers below are from the final merged tree after every fix in section 5, built against the seeded database, `next start :3399` + worker, mocks on. Per-check tables: `BUILD-STATUS/wp-32.md`, `wp-33.md`, `verify-money.md`, `verify-jobs.md`; smoke output in the gate's scratchpad.

| Area | Result |
|---|---|
| `pnpm install` | lockfile unchanged |
| `pnpm modules:sync --check` shop (154 files) and minimal (67) | 0 out of date |
| `drizzle-kit generate` apps/shop | no schema changes (6 migrations through `0005_wave2_commerce`) |
| `pnpm turbo run typecheck lint` (all 38 projects) | 76/76 tasks pass |
| `pnpm turbo run test` (vitest, real Postgres) | 38/38 packages pass (core 79 incl. the new revalidate case) |
| `next build` apps/shop and apps/minimal | both exit 0 (4 Turbopack warnings: core observability `process.stderr` traced into the edge instrumentation bundle; harmless) |
| Full smoke `node tooling/smoke.mjs` | **226 pass, 0 fail, 17 skip** |
| `--only=routes` | **169 pass, 0 fail, 16 skip** (skips: dynamic routes without a seeded sample such as `/order/[token]`, `/guides/[slug]`, admin detail pages with no record; `/api/health/ready` 503 because this Mac's disk is at 97%, see section 4) |
| `--only=money` | **19 pass, 0 fail, 0 skip**: quote, cart, checkout, order placed, mock PhonePe, webhook (bad signature 401), paid, stock committed (`inventory_movement order -10`), invoice `INV-2026-27-0000x`, `order.confirmed` email sent + WhatsApp read through the mocks |
| `--only=jobs` | **12 pass, 0 fail, 1 skip** (Google feed is token protected); abandoned cart -> `cart.reminder_1` email + WhatsApp with a `/api/cart/restore?t=` link, back-in-stock, ERP pull, feeds, alerts |
| `--only=admin` | **26 pass, 0 fail, 0 skip**: every nav entry and sub-entry, Home KPIs + things to do + custom range with previous year, analytics overview + live, 8 named reports with compare, 7 DataTable index pages, 17 settings sections, support role matrix |
| Manual adversarial checks | PDP `/plant/amla` 200 with `/media/w/...` image 200 `image/webp`; unknown slug 404 on `/plant /input /plants /plants/fruiting /policies /guides /models /grow-in /plants/for` and the catch-all `/no-such-page`; signed-out `/account/profile` carries the `/account/login?next=%2Faccount%2Fprofile` redirect (streamed, no render error); policy and content pages show their text; admin Home + `orders.sales-over-time` render for owner; support sees no revenue cards, no Analytics nav entry, "not found" on analytics pages; anonymous `/admin/*` lists nothing |
| Runtime log after the crawls | web: 0 "Functions cannot be passed", 0 `new Date()` / `Date.now()` prerender warnings, only `ForbiddenError` lines (support role probes); worker: 0 `revalidate failed`, alerts only from the smoke's bad-signature webhooks and this Mac's disk |

## 4. Open items

Nothing here blocks a staging deploy; ordered by value.

1. **ERP payloads**: erp-sync `orderPayload` / `leadPayload` / `applyOrderStatus` / `variantCandidates` are not bound (orders `erpOrderPayload`, customers `leadForErp` do not exist yet), so order and lead push to hasiru-ops is a no-op; stock pull works.
2. **Marketing vendors in the proxy CSP**: DONE in WP-37: `apps/shop/proxy.ts` merges marketing's `cspSources()` (configured vendors + active custom tags, 60 s memo) into script/connect/img/frame-src; `CSP_VENDOR_SOURCES` stays as an extra allowlist.
3. **Orders number prefix** is the default `ORD-`: set `HA` in Settings > Orders before go-live (`numberPrefix`).
4. **Unknown ids on private or token routes answer 200 + noindex**, not 404: `/account/orders/[id]`, `/checkout/[orderId]/pay`, `/order/[token]`, `/plan/results/[planId]`, `/models/[model]/3d`, `/og/[...slug]`, and admin detail pages (the layouts' Suspense boundary has already sent headers). Anonymous `/admin/*` likewise answers 200 with an empty noindex shell instead of a 404 or a redirect (A08-3 proxy pre-check not built). Signed-out `/account/*` redirects are streamed (200 + client redirect), not a 307.
5. **`unstable_paramMatching: { slug: 'blocking' }`** (10 routes, gives the real 404s) is marked unstable in Next 16.4.0: recheck on the bump after 2026-10-29.
6. **Home page product rails and calculator teasers**: done in WP-34 (cms `product_rail` and `component` blocks rendered through boot-bound ports, listing filters bound to the search facet UI); see `BUILD-STATUS/wp-34.md`, which also records the open prerender-shell issue (shells built without bound ports).
7. **Cart `noteContact`** is never called (nothing consumes `checkout.contact_saved`), so a cart abandoned after the contact step but before order placement is only reminded if the cart already had a contact.
8. **Photos**: 10 products have no image (7 inputs HAI-001..007, plants HAP-0060 Biriba, HAP-0120 Khanduchi, HAP-0200 Grapes Mango); 69 live plants use Wikimedia Commons photos with credit lines, flagged "replace photo" for the client; invoices are rendered on request (`pdf_media_id` stays null).
9. **Analytics pages for support** throw `ForbiddenError` (logged as an error line and captured in Health > Errors) and render "not found"; fine functionally, noisy in the error list.
10. **Orders CSV export** (F2-2) not built; admin bulk bars for orders, enquiries and reviews are unit-tested only (no seeded rows to exercise them in the smoke).
11. **Environment**: this Mac is at 97% disk (6.7 GiB free), so monitoring's disk check reports `down` and `/api/health/ready` is 503 locally; it will pass on the VPS. `MEDIA_ROOT` must be absolute and shared by web, worker and seed (section 1).
12. **Skipped**: Playwright E2E (`apps/shop/e2e/*.spec.ts` exist, not run), Lighthouse budgets, the separate redundancy audit (Wave 5 items F1-3, F1-4, F1-5), WP-34 docs pass.

## 5. What changed in the final gate (2026-10-20, 11:00-14:10 IST)

- Merged `wp/wp-32` (seed: 587 masters with `derive: 'none'` and status `ready`, 69 Wikimedia photos linked, all 292 products, footer links and policies, account redirects, real 404s) and `wp/wp-33` (Shopify admin Home, analytics, DataTable index pages, detail frames, save bars) into `ecom-build`; one conflict (`tooling/scripts/seed/run.ts`, kept wp-32's boot call with the warning). Worktrees and branches removed.
- Core contracts: `adminTodos?: readonly AdminTodo[]` on `ModuleManifest`; `compare?: DateRange | null` on `DashboardWidget` and `Report` component props (admin-shell now imports the core type); the `segmentConfig` widening from wp-32 is type-only and kept.
- **cms content was mostly invisible**: the data pipeline wrote a block vocabulary (`page_hero`, `text`, `feature_list`, `enquiry_cta`, `product_rail`, ...) the cms module never implemented, so only 3 of 44 seeded blocks loaded and the five policy pages had no body. The pipeline (`tooling/scripts/seed/cms-content.ts`) now emits the module's own types (`hero`, `rich_text`, `cta`, `rail`, `video`, `trust_band`, `testimonials`, `team`); 39 blocks load, 0 skipped. `data/seed/cms.json` regenerated.
- **cms images were never linked**: `boot()` skipped `@ecomkit/cms/server` outside the Next process because that entry re-exported React page components (which pull client islands). `CmsPageBody`, `pageMetadataFor`, `cmsMetadata`, `JsonLdGraph`, `NO_PAGE` moved to `@ecomkit/cms/ui`; `configureCms` now runs in every process with `resolveMediaIds`, and the cms seed hook maps master paths to media ids for block images (hero, rail items), team photos, testimonial avatars and trust logos (4/4, 3/3, 3/4 linked; one claim has no logo by design).
- **Worker cache expiry never reached the web process**: `POST /api/internal/revalidate` answered 404 to every call because `next start` itself sets `x-forwarded-for` to the socket address and the handler treated any such header as a proxy. It now accepts loopback entries only (still refuses `x-real-ip` and non-loopback hosts); test added. 0 `revalidate failed` in the worker log afterwards.
- **Catch-all `/[...slug]` 500 on unknown paths**: the seo redirect memo used `Date.now()` for its TTL inside the blocking prerender (cache components flag the clock), which turned into a static-generation bailout once seo was bound by boot. TTL now uses `performance.now()`; unknown paths are real 404s and still logged.
- **`media.warm` scheduled run crashed** (`Cannot read properties of null (reading 'assetId')`): pg-boss stores a scheduled job's payload as null; the core job runner now hands handlers `{}` instead of null.
- PDP `new Date()` prerender warning: JSON-LD `priceValidUntil` reads a `'use cache'` hourly clock (`cachedNow`). `/build-farm-with-us` `Date.now()` warning: `EnquiryForm` awaits `connection()` before issuing its per-request time token.
- The boot agent's "Functions cannot be passed directly to Client Components" (244 times in one admin crawl) does not reproduce on the merged tree: 0 occurrences in the web log and none in `core_error_issue` across two full admin crawls. wp-33 replaced the per-row `<form>` index pages with DataTable + `ActionForm`, which is the most likely reason; not proven.
- `docs/ORCHESTRATOR-RUN.md` note committed.

## 6. Sample / dummy data
Catalog from the WooCommerce export (292 products, 294 stock levels, prices from the data sheet, 10 without photos), cms pages from the current hasiruagro.com copy and the SRS policy sentences (published + noindex, holding line where the SRS has none), 3 real testimonials, 4 team members, planting models and 645 districts from research, mock PhonePe/Gmail/WhatsApp/hasiru-ops adapters, demo flows. No real customer or order data; the smoke's orders use `smoke-*@example.invalid` contacts.

## 7. Admin keys checklist (Settings > Integrations, stored sealed)
PhonePe merchant id + salt key/index + webhook secret; Gmail OAuth client id/secret + per-site refresh token (Connect Gmail button, agency client from the vault); Meta WhatsApp Cloud API token + phone number id + webhook verify token; Meta catalog id, pixel id, CAPI access token; Google Merchant Center id + feed token, GA4 measurement id + API secret, Google Ads conversion id/labels; Claude API key (AI assistant); hasiru-ops read-only Postgres URL (TLS enforced for non-loopback). Server env: `DATABASE_URL`, `DATABASE_OWNER_URL`, `DATABASE_POOL_MAX` (optional, default 10; 2 for builds), `SITE_URL`, `NEXT_PUBLIC_SITE_URL`, `INTERNAL_BASE_URL`, `SETTINGS_MASTER_KEY`, `INTERNAL_SECRET`, `MEDIA_ROOT` (absolute), `CSP_VENDOR_SOURCES`. Keys only, commented, in `apps/shop/.env.example`.

## 8. Security
All gates in `BUILD-STATUS/orchestrator-security.md` are FIXED/DONE (cart restore single path, coupon rate limit, consent-gated purchase tags, refund cap, order idempotency and PII scoping, hasiru-ops TLS, plan unlock binding). The internal revalidate endpoint stays HMAC-signed, loopback-only and refuses `x-real-ip` (nginx). Remaining: item 4 above (200 + noindex instead of 404 on private routes; anonymous admin shell), and the proxy pre-check for `/admin/*`.

## 9. Deploy prerequisites, shop.hasiruagro.com
Postgres 17 on the Hostinger VPS (needs your approval, plus `pg_trgm`), Node 22 + pnpm 12, nginx reverse proxy that sets `X-Real-IP` and `X-Forwarded-For` (rate limits, audit and the revalidate guard depend on it), env from section 7 with real keys, `MEDIA_ROOT` on persistent disk (seed masters: 132 MB), pm2 for `node .next/standalone/server.js` and `tsx worker.ts`, seeded DB before `next build`, `pnpm jobs:install` after migrate. Nothing has been pushed or deployed.
