# BUILD STATUS  (updated 2026-10-20T06:30+0530)
Current wave: 1 (done, gate round 1 green)   Next action: start Wave 2 (WP-17 cart, WP-18 shipping + truck-meter, WP-19 checkout + orders, WP-20 payments, WP-22 flows, WP-23 marketing + feeds, WP-24 planting, WP-25 farm-calculators + planting-3d, WP-26 ai-assistant, WP-27 erp-sync + hasiru-ops-adapter) in parallel from `ecom-build`. Each agent: `pnpm db:fresh wp-xx`, `drizzle-kit push` of `core,<deps>,<mod>`, gate with `pnpm turbo run typecheck lint test --filter=@ecomkit/<mod>`; read the Wave 1 lessons at the end of this file and CONVENTIONS section 15. After the wave: enable the merged modules in both `modules.config.ts`, `pnpm modules:sync` (+ `--app minimal`), `DATABASE_URL=<migrated db> pnpm -F shop exec drizzle-kit generate --name wave2_<...>`, full gate with `DATABASE_URL` set for the builds, merge `BUILD-STATUS/*.md`, commit `wave 2: <packages>`.

Only the orchestrator edits this file; per-agent detail stays in `BUILD-STATUS/wp-xx.md`.

## Wave table
| WP | Package | Model | Agent/session | Status (todo, running, blocked, done, failed) | Tests (unit/e2e) | Last commit | Notes |
|---|---|---|---|---|---|---|---|
| WP-00a | Workspace, tooling, contracts, conventions | opus | wave-0 agent | done | 50 unit / 0 e2e | wave 0 | BUILD-STATUS/wp-00a.md |
| WP-00b | Core implementations | opus | wave-0 agent | done | 78 unit (gate added settings partial-update + hashContact tests) / 0 e2e | wave 1 | BUILD-STATUS/wp-00b.md |
| WP-01 | UI + tokens + shell | opus | wave-0 agent | done | 26 unit / `e2e/wp-01.spec.ts` (runs once WP-31's config exists) | wave 0 | BUILD-STATUS/wp-01.md |
| WP-02 | auth | opus | wave-1 agent | done | 45 unit (4 files, real Postgres) / 0 e2e | wave 1 | BUILD-STATUS/wp-02.md; gate read: OTP generic answers, 2FA gate, 12 h staff sessions, lockout, matrix == CONVENTIONS table; security pass applied on the branch (owner-only owner management, strict next-path, X-Real-IP only) |
| WP-03 | media | opus | wave-1 agent | done | 67 unit (4 files, real sharp + Postgres) / 0 e2e | wave 1 | BUILD-STATUS/wp-03.md; gate: upload route now uses core `isSameOrigin` (fail closed); custom `next/image` loader wired in both apps (R1) |
| WP-04 | catalog | opus | wave-1 agent | done | 64 unit (5 files) / 0 e2e | wave 1 | BUILD-STATUS/wp-04.md; PDP page tests against the core fakes in 3 fit x 2 stock states; import idempotency; slug 301; product form hosts `productFormTabs` |
| WP-05 | search + facets | opus | wave-1 agent | done | 60 unit (7 files) / `e2e/wp-05.spec.ts` | wave 1 | BUILD-STATUS/wp-05.md; index 16.6 KB gz for 350 products, suggest p95 2 to 9 ms; trgm migration `0003_search_trgm` |
| WP-06 | pricing + discounts | opus | wave-1 agent | done | 33 + 37 unit / 0 e2e | wave 1 | BUILD-STATUS/wp-06.md; `hashPhone` now wraps core `hashContact` |
| WP-07 | inventory | opus | wave-1 agent | done | 49 unit (7 files) / 0 e2e | wave 1 | BUILD-STATUS/wp-07.md; 25 parallel reservations never oversell; TTL sweep job; ERP pull leaves manual rows; notify-me per-contact cap |
| WP-08 | admin-shell | opus | wave-1 agent | done | 43 unit (3 files, React prerender of the real shell) / 0 e2e | wave 1 | BUILD-STATUS/wp-08.md; `x-pathname` now set by proxy.ts (A08-2 resolved) |
| WP-09 | seo + cms | opus | wave-1 agent | done | 34 + 29 unit / 0 e2e | wave 1 | BUILD-STATUS/wp-09.md; JSON-LD zod shapes + escaping, sitemap filters, redirect loop guard; cache helper copies removed (now core) |
| WP-10 | notifications | opus | wave-1 agent | done | 39 unit (4 files) / 0 e2e | wave 1 | BUILD-STATUS/wp-10.md; every frozen key has a template per channel, exact-text pins, wamid+status dedupe, category routing; core `setSettings` bug it found is fixed |
| WP-11 | monitoring | opus | wave-1 agent | done | 82 unit (6 files) / 0 e2e | wave 1 | BUILD-STATUS/wp-11.md; dedupe windows, repeat until ack, webhook fallback; `/api/health/*` generated from the manifest |
| WP-12 | analytics | opus | wave-1 agent | done | 46 unit (6 files) / 0 e2e | wave 1 | BUILD-STATUS/wp-12.md; beacon 2.3 KB gz; partition migration `0004_analytics_event_partitions`; local `clientIp` replaced by core |
| WP-13 | places + data assets | sonnet | wave-1 agent | done | 54 unit + 30 scripts tests / 0 e2e | wave 1 | BUILD-STATUS/wp-13.md; 645 districts, 65 Wikimedia photos with licence log; `xlsx` now a declared dependency (pnpm-store hack removed); `_none` placeholder param for the build |
| WP-14 | data pipeline | opus | wave-1 agent | done | 25 scripts tests (byte-identical re-run, self-check) / 0 e2e | wave 1 | BUILD-STATUS/wp-14.md; 159 + 1 + 7 + 125 rows (A14-2), `docs/CLIENT-QUESTIONS.md` 12 sections |
| WP-16 | customers + enquiries + reviews | opus | wave-1 agent | done | 9 + 10 + 9 unit + 1 shop test / `e2e/wp-16.spec.ts` | wave 1 | BUILD-STATUS/wp-16.md; masking by role, consent audit, no-JS submit, IDOR, one lead + one `lead.created` per enquiry; reviews `orders` dependency made optional (A50) |
| WP-17 | cart | opus | | todo | | | |
| WP-18 | shipping + truck-meter | opus | | todo | | | |
| WP-19 | checkout + orders | opus | | todo | | | |
| WP-20 | payments | opus | | todo | | | |
| WP-22 | flows | opus | | todo | | | |
| WP-23 | marketing + feeds | opus | | todo | | | |
| WP-24 | planting | opus | | todo | | | |
| WP-25 | farm-calculators + planting-3d | opus | | todo | | | |
| WP-26 | ai-assistant | opus | | todo | | | |
| WP-27 | erp-sync + hasiru-ops-adapter | opus | | todo | | | |
| WP-28 | apps/shop assembly + integration gate | opus | | todo | | | long request list below |
| WP-29 | admin dashboard + reports + keys checklist | opus | | todo | | | |
| WP-30 | apps/minimal proof + recipe | sonnet | | todo | | | minimal already enables the Wave 1 part of its target set and builds |
| WP-31 | E2E flow (a) + CTA crawler | opus | | todo | | | |
| WP-32 | E2E flows (b)(c) + admin + webhooks + sync | opus | | todo | | | |
| WP-33 | Lighthouse + budgets + security + structural visual | opus | | todo | | | |
| WP-34 | Redundancy audit + docs + status | read | | todo | | | |

## Wave 1 gate (round 1, 2026-10-20) - what the orchestrator ran on the merged tree
| Check | Result |
|---|---|
| Merges | 14 `wp/*` branches merged in dependency order; only `packages/core/src/http/*` conflicted (cherry-picked security commits), resolved to ecom-build's version (byte-identical core); worktrees removed, branches deleted |
| `pnpm install` | lockfile updated once for `xlsx: catalog:` in `@tooling/scripts` (requests from WP-13 and WP-14) |
| `pnpm modules:sync` (shop, 19 modules) and `--app minimal` (9 modules) | 99 and 47 planned files; `--check` 0 out of date for both; `_mock` stubs only for gmail and meta (dev config) |
| `drizzle-kit generate` | `0002_wave1_modules.sql` (74 tables, 4 views), custom `0003_search_trgm.sql`, `0004_analytics_event_partitions.sql` (copied verbatim from `packages/{search,analytics}/sql`); `drizzle-kit migrate` on fresh `ecomkit_gate_w1`: 82 tables, `analytics_event` partitioned with 4 partitions, trgm index, 4 segment views |
| `pnpm turbo run typecheck lint test` | 901 unit tests in 22 packages, all green (second run after gate fixes; see per-package counts above) |
| `next build` shop and minimal | exit 0 with `DATABASE_URL` pointing at the migrated gate database (builds read the DB for `generateStaticParams`; see A63); no `AGENTS.md` written |
| `pnpm turbo boundaries` | 952 files, no issues (11 type-only seed imports marked `@boundaries-ignore`, A61) |
| `pnpm audit --prod` | 0 high, 0 critical, 1 moderate (unchanged esbuild dev-server advisory via better-auth > drizzle-kit peer) |
| Review greps | no em dashes in packages, app, messages or seed JSON; no "phase"/"v1"/"v2" in copy; no `@ecomkit/*/src` deep imports; no hex outside `tokens.css`/`theme.css`; forbidden names absent (only `logNotFound`-style identifiers in seo, which are not the forbidden PHP class names, and crawler user-agent strings in seo/analytics per A09-9/A12-7); no brand strings in `packages/*/src` outside `places` seed names; no `x-forwarded-for` reads left outside core |

Gate fixes applied directly (recorded as assumptions A50 to A66 below): reviews `orders` optional; `xlsx` declared and `districts.ts` imports it; core `cacheFor`/`expireTags` replace three module copies; core `hashContact` replaces the discounts and customers hashes; core `setSettings` partial-update bug; core `getViewer`/`requirePermission`/`requireOwner` call `connection()` first; `clientIp`/`isSameOrigin` consolidation in analytics, enquiries, places, media; `x-pathname` from proxy.ts; custom image loader; `_none` placeholder in `/grow-in/[district]`; Turbopack ignore on the inventory seed file read; `freshDatabase` test timeout; `.gitignore` for `storage/` and `data/raw/pincodes/`; CONVENTIONS section 15.

## Assumptions (numbered, dated; A1.. from BUILD-PLAN plus new ones)
- A1 to A28: BUILD-PLAN.md section 0 (2026-10-20).
- A29 to A49: Wave 0 (see the Wave 0 block in git history of this file, kept verbatim in `BUILD-STATUS/wp-00a.md`, `wp-00b.md`, `wp-01.md`); the gate ones: A47 `ui` enabled in both apps, A48 UNLOGGED migration hand-written and audit REVOKE moved to docs/DEPLOY.md, A49 `_work/**` left uncommitted.
- Per-package assumptions A02-1..15, A03-1..12, A04-1..16, A05-1..13, A06-1..15, A07-1..15, A08-1..13, A09-1..14, A10-1..15, A11-1..15, A12-1..12, A13-1..12, A14-1..19, A16-1..20 are in `BUILD-STATUS/wp-xx.md` (verbatim, binding for later agents; read your dependencies' files). The ones later waves most need: A02-4 customerId = auth user id; A04-1/A09-2/A11-14/A16-6 modules reach the registry and each other through `configureX({...})` bindings set by the app at boot; A04-10 cart HTTP contract (`POST /api/cart/lines`); A06-2 `configurePricing({ gstRates, variantsOf })`; A07-2 reservation `reference`; A07-9 `setNotificationsProvider`; A10-5 message categories; A12-5 test orders carry `test: true`; A13-2 nursery origin for distances; A14-2 legacy drafts are 125 not 128; A16-4 lead dedupe on phone hash + source + `context.ref`.
- A50 (2026-10-20, gate): `reviews` lists `orders` as `optional`, not `dependsOn` (plan said hard): the module already degrades (`purchases` port null means no verified-buyer flag) and orders ships in Wave 2; otherwise `modules:sync` refused the Wave 1 config.
- A51 (2026-10-20, gate): `xlsx` is declared in `@tooling/scripts`; `seed/districts.ts` imports it statically (`XLSX.read(readFileSync(file), { type: 'buffer' })`; the ESM build has no fs binding, so `readFile` is not used). WP-14's own `seed/lib/xlsx.ts` reader stays for now (swapping it could change seed bytes; Wave 5 audit item).
- A52 (2026-10-20, gate): `cacheFor(tags, life?)` and `expireTags(tags)` live in `@ecomkit/core/cache-tags` (superset of the catalog, seo and cms copies, which are deleted); `@ecomkit/catalog/server` still re-exports them.
- A53 (2026-10-20, gate): `hashContact(value)` in `@ecomkit/core/http` is the one phone/email hash (purpose `contact-hash`, 22 chars base64url, null for an unparseable phone). customers re-exports it; discounts' `hashPhone` wraps it (its old purpose string `phone-hash` is gone; no stored data existed).
- A54 (2026-10-20, gate): core `setSettings` keeps only the keys present in the patch after `schema.partial().parse()` (zod 4 fills defaults for absent keys, which reset every other defaulted field; found by WP-10). Regression test in `packages/core/test/db.test.ts`. Notifications' `updateSettings` workaround can be simplified later.
- A55 (2026-10-20, gate): core `getViewer`, `requirePermission` and `requireOwner` call `next/server` `connection()` (tolerated outside Next) before reading the provider, so no page that checks the viewer is ever prerendered. Without this the `minimal` build prerendered `/admin/collections` and baked a `ForbiddenError`. Module-level `connection()` calls (auth A02-13, media A03-11, admin-shell) are now redundant but harmless.
- A56 (2026-10-20, gate): `clientIp` and `isSameOrigin` come from core everywhere: analytics (`clientIp` export removed from `@ecomkit/analytics/server`), enquiries, places suggest/pincode routes, media upload (fail closed; tests send `sec-fetch-site: same-origin`). No `x-forwarded-for` fallback remains outside core.
- A57 (2026-10-20, gate): `apps/shop/proxy.ts` sets the request header `x-pathname` (admin-shell layout gate, seo 404 log). The proxy-level 404 for anonymous `/admin/*` (A08-3) and `redirectFor` 301s before render (A09-5) stay with WP-28.
- A58 (2026-10-20, gate): both apps use `images.loader = 'custom'` with `apps/<app>/image-loader.ts` re-exporting `mediaLoader` from `@ecomkit/media/domain` (WP-03 R1): pre-generated AVIF/WebP derivatives, no on-demand optimiser.
- A59 (2026-10-20, gate): `.gitignore` adds `storage/` (default `MEDIA_ROOT`) and `data/raw/pincodes/` (23 MB raw download).
- A60 (2026-10-20, gate): the `freshDatabase` test timeout is 60 s: `CREATE DATABASE ... TEMPLATE` waits for the other packages' sessions on the template during the parallel workspace run (it timed out at 5 s once).
- A61 (2026-10-20, gate): the 16 seed scripts keep type-only relative imports of core contracts and places domain under `// @boundaries-ignore`: `@tooling/scripts` cannot depend on `@ecomkit/core` (core depends on it for the db helpers; a cycle breaks turbo).
- A62 (2026-10-20, gate): `apps/minimal` enables `auth, media, catalog, pricing, inventory, customers, seo` (the Wave 1 part of its target set) and builds; it still has no admin layout, drizzle config or proxy (WP-30).
- A63 (2026-10-20, gate): `next build` of either app needs `DATABASE_URL`, `SITE_URL`, `INTERNAL_SECRET` and `SETTINGS_MASTER_KEY` (Next sets `NODE_ENV=production`, core `loadEnv` validates the production set during prerender via the seo runtime; catalog, cms and places `generateStaticParams` read the database, each falling back to a `_none`/`__no-page` placeholder when the table is empty or the query fails). The gate builds with throwaway values and `DATABASE_URL=postgres://localhost:5433/ecomkit_gate_w1` (migrated, empty). The deploy build runs with the production `.env` (A6), so nothing changes there.
- A64 (2026-10-20, gate): `packages/inventory/src/server/seed.ts` marks its seed-file read with `/*turbopackIgnore: true*/`: Turbopack otherwise traces the whole repository into the standalone output (two build warnings).
- A65 (2026-10-20, gate): the `support` role masking, per-contact caps and CSRF rules from the automated security review are now CONVENTIONS section 15 (binding for Wave 2+).
- A67 (2026-10-20, gate): `@ecomkit/auth` `AccountLayout` wraps `children` in a Suspense boundary (it already did so for the nav): every `/account/*` page reads the signed-in customer at its root and cache components refuse that in a prerender; the shell owns the boundary the way admin-shell's layout does for `/admin/*`. Without it the customers pages (`/account/land`, `/account/addresses`) failed both builds.
- A68 (2026-10-20, gate): `apps/minimal` gained two host files WP-30 would otherwise write: `app/(admin)/layout.tsx` (noindex, `data-surface="admin"`, Suspense around children, since the proof store has no admin-shell) and `app/(shop)/account/layout.tsx` (copy of the shop's). Both are hand-written and kept by `modules:sync`.
- A69 (2026-10-20, gate): admin pages never read the clock in a default parameter (`now = new Date()` runs before any request-time await and cache components flag it as an unstable prerender value: `/admin/discounts` failed the build). discounts `DiscountsListPage` reads `now` after `requirePermission`; the five monitoring pages call their `dynamicRequest()` first. Tests still inject `now`.
- A66 (2026-10-20, gate): search keeps its own `loadSearchSource` (joins price, stock, models and tags that catalog's `facetSource()` cannot see); the duplicated catalog-column-to-facet mapping is a Wave 5 audit item, not a blocker (F1-4 below).

## Cross-package requests (from -> to, what, status)
Wave 0 requests still open are repeated here; agent files hold the full text.

| From | To | What | Status |
|---|---|---|---|
| WP-00a | WP-23 + WP-28 | `cspSources()` readable by proxy.ts without a per-request DB query (today: env `CSP_VENDOR_SOURCES`) | open |
| WP-00a, WP-00b, WP-02, WP-04, WP-06, WP-07, WP-09, WP-11, WP-16 | WP-28 | Boot wiring in `instrumentation.ts` `register()` and `worker.ts`: `export { onRequestError } from '@ecomkit/core/observability'`, `loadEnv()`, `setAuthProvider(() => registry.service('auth'))`, `configureAuth({ notifications, appName })`, `configureCatalog({ registry, images, resolveMediaIds, jsonLd, metadata, addRedirect, listingAside, messages })`, `configurePricing({ gstRates: gstRatesFor, variantsOf })`, inventory `setNotificationsProvider(() => registry.service('notifications'))`, `configureSeo({ site, registry, robotsDisallow, llms, ogCard, ogColors, images, entitySeo, notFoundLinks, messages })`, `configureCms({ images, resolveMediaIds, metadata, jsonLd, onMissing: resolveMissing, addRedirect })`, `configureMonitoring({ registry })`, `configureEnquiries({ contacts, files })`, `configureReviews({ purchases, images, products })`, beacon-ingest `createBeaconIngest({ hasConsent })`; `installJobSchema(DATABASE_OWNER_URL)` at deploy | open (Wave 3) |
| WP-01, WP-12 | WP-28 | `(shop)/layout.tsx`: `<ToastRegion>`, header `Sheet side="left"`, `StickyBar`, `<AnalyticsScript />`, `data-track-section`/`data-track-product` attributes; copy from `messages.shell` | open |
| WP-02, WP-08 | WP-28 | pass auth's `SignOutForm` as `account` to `<AdminLayout>`; proxy pre-check returning a real 404 for anonymous `/admin/*` except `/admin/login` (A08-3) | open |
| WP-04 | orchestrator | consider core `setRegistry()/getRegistry()` and `ServiceMap` keys `media`, `seo` so modules stop taking per-module bindings | open (decide before Wave 3; the `configureX` pattern is consistent across Wave 1 and works) |
| WP-04, WP-06, WP-07, WP-16 | WP-04 catalog | export `gstRatesFor(productIds)`, `variantsOf(productId)`, `variantRefsBySku(skus)`, `entitySeo('product', id)`, `products.label(productId)`; expire `price:<id>` / `stock:<id>` / `reviews:<id>` tags (pricing, inventory and reviews already emit on the product id) | open: catalog exports exist for `facetSource`; the four named helpers are not exported yet, Wave 2 agents use their `configureX` ports with the catalog server API; WP-28 wires them |
| WP-04 | WP-14 | `data/seed/collections.json` with the plan slugs (`fruiting-trees`, `timber-trees`, `other-plants`, `inputs`; children `desi`, `exotic`, `forest-fruit`, `spices`, `plantation`, `native-medicinal`, `biomass-support`) and a `native-saplings` tag on native rows; `importSeed()` to accept the A14-6 extra keys, nullable fields on `woo_legacy` drafts, FAQs from `faqs.json`, `media.images[].src` against `data/media/masters/`, `redirects.json` pending rows (A14-15) | open: F1-1 below |
| WP-05 | WP-04 / WP-28 | mount `FacetSidebar` on `/plants` and collection pages via `listingAside`; swap `SearchHitCard` for the catalog card; `fit` extra facet from `registry.service('places')`; settings `guidedHref=/plan`, `assistanceUrl` | open |
| WP-05, WP-16, WP-01 | WP-31 | include `apps/shop/e2e/wp-01.spec.ts`, `wp-05.spec.ts`, `wp-16.spec.ts` in the Playwright config | open |
| WP-06 | WP-17, WP-19 | `priceLines`/`priceSnapshot` for line prices, `applicablePromos(cart)` + `applyCoupon(code, cart, { subject })`, both into `core.computeTotals`; `redeem({ orderId, phone, customerId, discounts }, { tx })` inside place-order; catch `RedemptionError` | info for Wave 2 |
| WP-07 | WP-19, WP-27 | `reserve(lines, { ttlSec, reference, tx })`, `commit(reservationId, { tx })`, `release`, `adjust({ reason: 'cancel' })`; `setFromErp(items, { tx? })` per page with `updatedAt`, `missing` for mapping, drift from `onHand` vs `erpOnHand` | info for Wave 2 |
| WP-07 | WP-16 | consent / lead API so notify-me stores `consent_id` and creates a `notify_me` lead | open (contract change; customers exports `recordConsent`, `upsertLead`; wire through a port in WP-28) |
| WP-08 | orchestrator (contracts) | add `adminSearch?: AdminSearchProvider[]` and `settingsUrls?: SettingsUrl[]` to `ModuleManifest` (validated structurally today) | open |
| WP-09 | WP-00b / orchestrator | move the path normalisation rule (lowercase outside `%XX`, case-exempt prefixes, trailing slash) into core and import it from `proxy.ts` and seo `normalisePath` | open (Wave 5 audit) |
| WP-09 | WP-08 | shared `staffPageOrNotFound(permission)`; seo and cms carry a 6-line copy each | open (Wave 5 audit; admin-shell's `requireAdmin` has different semantics) |
| WP-09 | WP-24 | model videos via `videosFor({ modelSlug })` from `@ecomkit/cms/server` (check `registry.has('cms')`) | info |
| WP-10 | WP-00b | consider `hashPersonal(value, purpose)` in core | done as `hashContact` (A53); notifications keeps its own 32-char address key (different purpose) |
| WP-10, WP-16 | WP-10 | subscribe to `enquiry.created` and send `enquiry.received_admin` / `enquiry.received_customer`; templates `alert.critical`, `alert.digest`, `test.send` take `text, title, body, severity, count, status, url` and bypass quiet hours and opt-out; `healthChecks` with ids `notifications.*` | open |
| WP-11 | WP-08, WP-12, WP-20, WP-19, WP-16, WP-27, WP-03 | `AlertBell` in the top bar when `registry.has('monitoring')`; `healthChecks` entries from analytics (vitals, sessions), payments (critical anomalies), orders/enquiries staleness, erp-sync pull age, media cache writable | open |
| WP-12 | WP-19, WP-29 | `track('purchase', { value, test })` on confirmation; GA4 commerce events; reports with `group: 'sales' | 'products' | 'customers'` | info |
| WP-13 | WP-04 / WP-28 | `registerPlantSource(...)` from `@ecomkit/places/server` at boot; `places.districtsFor(plantClimate)` for PDP "Grows well in" | open |
| WP-13 | WP-14 | consume `data/media/sourcing-log.json` so the 69 photo-less live plants pick up the sourced photos | open: F1-1 |
| WP-14 | WP-09 | cms block types used by `cms.json` (`hero, product_rail, plant_calculator, compost_calculator, why_choose_us, video_rail, testimonials, trust_marquee, farm_development_teaser, page_hero, process_steps, feature_list, enquiry_cta, text, team, contact`); cms skips unknown types with a note | open: F1-2 |
| WP-14 | WP-28 | checkout policy note copy belongs in `apps/shop/messages/en.ts` | info |
| WP-16 | WP-02 | call `ensureProfile({ userId, phone, email, name })` on sign-up (idempotent, emits `customer.created`); auth already emits `customer.created` from its user-create hook (A02-5), so WP-28 wires one subscriber instead | open |
| WP-16 | WP-03 | private store `{ putPrivate, read }` and public `{ putImage, ref }` ports for enquiry uploads and review photos | open: media has `uploadImage()`, private assets and signed URLs; WP-28 adapts them to the ports |
| WP-16 | WP-19 | `recordOrder({ userId, amountPaise, at }, { tx })` on paid; `verifiedOrderId(customerId, productId)` for `configureReviews` | info for Wave 2 |
| WP-12 | gate | allowlist `packages/analytics/src/domain/sources.ts` in the forbidden-name scan | done |
| WP-00b, WP-03, WP-10 | Shyam (env) | `.env.example` must list: `INTERNAL_SECRET` (32+ chars), `INTERNAL_BASE_URL`, `SETTINGS_MASTER_KEY='1:<base64 32 bytes>'`, `SETTINGS_MASTER_KEY_PREVIOUS`, `DATABASE_URL`, `DATABASE_OWNER_URL`, `ENABLE_MOCKS`, `SITE_URL`, `NEXT_PUBLIC_SITE_URL`, `MEDIA_ROOT=/absolute/path/storage/media` (web, worker and `seed:load` share it), `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET` (agency OAuth client from the vault; redirect URI `<SITE_URL>/api/auth/gmail/callback`), `GIT_SHA`, `CSP_VENDOR_SOURCES`. `.env*` is permission-blocked for agents and the gate | open (F0-1) |

## Open fixes
- F0-1 (`.env.example`): add the env names above with safe placeholder values (single-quoted). Owner: Shyam or WP-28.
- F1-1 (`tooling/scripts/seed/**`, `data/seed/**`): ship `collections.json` (A04-4 slugs), tag native rows `native-saplings`, merge `sourcing-log.json` photos into product records (69 live plants still `image_needed`), then confirm `importSeed()` accepts the A14-6 keys and the `woo_legacy` nullable fields (catalog side may need small changes; coordinate through WP-28). Owner: WP-28 (data step) with catalog.
- F1-2 (`packages/cms/src/domain`, `data/seed/cms.json`): reconcile the block type list between `cms.json` and the cms block schemas; unknown types are skipped today, so the seeded home page would render without those sections. Owner: WP-28.
- F1-3 (`packages/search/src/server/source.ts`, `packages/catalog/src/server/queries.ts` `facetSource`): one mapping from catalog columns to facet values. Owner: WP-34 (Wave 5 audit); not blocking.
- F1-4 (`tooling/scripts/seed/lib/xlsx.ts`): replace the hand-rolled XLSX reader with the now-declared `xlsx` package only if the seed output stays byte-identical. Owner: WP-34.
- F1-5 (`packages/seo/src/admin/pages.tsx`, `packages/cms/src/admin/pages.tsx`): 6-line `staffOrNotFound` copies; fold into admin-shell's `requireAdmin` or a core helper. Owner: WP-34.
- F1-6 (search): no retention job for `search_query_log` yet; add a 180-day purge (monitoring/jobs wiring). Owner: WP-28 or WP-05 follow-up.

## Known failures / flaky tests
None on the merged tree. `pnpm modules:sync --config prod --check` exits 1 against the committed dev tree by design. Tests print `revalidate skipped` warnings (no web process) by design. The `freshDatabase` test is slow under the full parallel run (now 60 s timeout, A60).

## Client questions (link docs/CLIENT-QUESTIONS.md; count)
`docs/CLIENT-QUESTIONS.md` (generated by `pnpm seed:build`): 12 sections, 42 items (prices, 125 legacy drafts, Agarwood, sizes, models, soil, FAQ answers, data fixes, GST/HSN, photos, content and claims, delivery areas). 227 of 292 seed records carry `needs_review`.

## Resume checklist
1. read this file; 2. `git status` and last commit; 3. `pnpm i --frozen-lockfile && pnpm db:fresh shop` then `DATABASE_URL=<printed url> pnpm -F shop exec drizzle-kit migrate` (seed:load lands with WP-28's wiring); 4. `pnpm turbo run typecheck lint test`, `DATABASE_URL=<url> pnpm turbo run build`, `pnpm modules:sync --check`, `pnpm turbo boundaries`; 5. continue the "Next action".

## Lessons from Wave 1 (injected into later agents)
1. Gate a package with `pnpm turbo run typecheck lint test --filter=@ecomkit/<mod>`; `pnpm -F <pkg> typecheck lint test` hands `lint test` to tsc.
2. A manifest `dependsOn` must name only modules that exist in the same or an earlier wave; a port that may be null is `optional`.
3. Never reach into `node_modules/.pnpm` or another package's store copy for a dependency you did not declare; write the cross-package request and use a local stub until the gate adds it.
4. `next build` needs `DATABASE_URL`; every `generateStaticParams` returns a placeholder param when its table is empty or the query fails (cache components refuse an empty list).
5. Any page or layout that reads the viewer must be request-time; core's `getViewer`/`requirePermission`/`requireOwner` now call `connection()` for you, so do not add module copies.
6. Use core's `clientIp`, `isSameOrigin`, `hashContact`, `hashIp`, `cacheFor`, `expireTags`; a local helper with the same job is removed at the gate.
7. Seed-time or job-time file reads inside a module that a manifest thunk can reach must carry `/*turbopackIgnore: true*/` or Turbopack traces the whole repo into the standalone output.
8. `schema.partial().parse()` in zod 4 fills defaults for absent keys; filter the result back to the keys you were given.
9. `--dry-run`/`--list` flags need a byte-identical before/after test; a test timeout on a real database operation under the parallel run is not a unit-test bug, raise the timeout with a comment.
10. Workspace tooling (`@tooling/scripts`) cannot depend on `@ecomkit/core` (cycle); type-only relative imports carry `// @boundaries-ignore <reason>` directly above the import line.
11. Cache components: a page that reads request-time data (viewer, cookies, headers, the clock) renders inside a Suspense boundary (admin-shell's layout and auth's `AccountLayout` provide one for `/admin/*` and `/account/*`; a module page elsewhere brings its own) and reads `new Date()` only after a request-time await (`requirePermission`, `getViewer`, `connection()`), never in a default parameter. Run `next build` on your module's routes inside the app before reporting done; `typecheck lint test` does not catch prerender errors.

## Session limit log (when paused, when resumed, what was mid-flight)
- 2026-10-20 ~04:20 IST: wave 0 gate committed; nothing mid-flight.
- 2026-10-20 ~06:30 IST: wave 1 gate committed; nothing mid-flight.
