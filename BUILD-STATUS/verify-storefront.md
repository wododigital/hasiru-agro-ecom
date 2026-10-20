# Verify: storefront (2026-10-20 07:14-07:30 IST)

Setup: `pnpm db:fresh verify-storefront` + migrate + `jobs:install` OK; `seed:load` was too slow under swarm CPU load (media hook still deriving images after 6 min, then SIGTERMed), so the run used `ecomkit_verify_storefront2` = `CREATE DATABASE ... TEMPLATE ecomkit_wp_28` (282 products, 221 media). Server: the shared 07:12 `apps/shop/.next` build, `next start --port 3201` with `DATABASE_URL`, `SITE_URL`, `SETTINGS_MASTER_KEY`, `MEDIA_ROOT=<repo>/storage/media`, `ENABLE_MOCKS=1 ALLOW_MOCKS_IN_PROD=1`, `INTERNAL_SECRET`. Smoke: `node tooling/smoke.mjs --base=http://localhost:3201 --only=routes`.

No code was changed: every failure found is outside this agent's edit scope or is run config. Details per row below.

## Smoke runs
| Run | Env | Result |
|---|---|---|
| 1 | no SITE_URL / SETTINGS_MASTER_KEY / MEDIA_ROOT, empty catalog | 135 pass, 7 fail, 28 skip (500 on /robots.txt, /sitemap.xml, /llms.txt, /og/*, /api/webhooks/whatsapp: "invalid environment: SITE_URL, SETTINGS_MASTER_KEY required in production"; media 404s) |
| 2 | + SITE_URL, SETTINGS_MASTER_KEY | 140 pass, 2 fail (media 404: MEDIA_ROOT unset, `next start` cwd is apps/shop, files are in `<repo>/storage/media`) |
| 3 | + MEDIA_ROOT, seeded DB (wp_28 copy) | 137 pass, 12 fail, 27 skip (table below) |

## Pass/fail table (run 3 + manual probes with DB slugs)
| Check | Result | Notes |
|---|---|---|
| `/`, `/plants`, `/plants?page=2`, `/plants?fit=1`, `/plants/fruiting?sort=price` | PASS 200 | listing + filters render with seeded data |
| `/plants/[collection]` (`/plants/fruiting`, `/plants/other`), `/plants/[collection]/[sub]` (`/plants/fruiting/desi`) | PASS 200 | manual probe |
| PDP `/plant/amla`, `/plant/anjeer-fig`, `/plant/agarwood`; `/input/neem-cake` | PASS 200 | manual probe |
| `/plan` (wizard), `/models/boundary`, `/models/boundary/3d`, `/plants/for/boundary` | PASS 200 | |
| `/calculators/plants`, `/calculators/compost`, `/api/calculators/plants` | PASS 200 | |
| `/build-farm-with-us` (services enquiry) | PASS 200 | server log: "Route /build-farm-with-us: Next.js encountered the unstable value `Date.now()` while prerendering" (warning, page still 200) |
| `/search`, `/search?q=mango`, `/api/search/suggest`, `/facets.json` | PASS 200 | |
| `/guides`, `/videos`, `/inputs`, `/grow-in/adilabad` | PASS 200 | no published `cms_post` in the seed, so `/guides/[slug]` unverified |
| `/cart`, `/checkout`, `/pay/return`, `/account/login`, `/account`, `/account/orders` | PASS 200 | |
| `/robots.txt`, `/llms.txt`, `/sitemap.xml` | PASS 200 once SITE_URL + SETTINGS_MASTER_KEY set | 500 without them (deploy env must set both; `next start` warns standalone output should use `node .next/standalone/server.js`) |
| API GET probes (`/api/*` 4xx/405 as designed) | PASS | |
| `/account/addresses`, `/account/land`, `/account/profile`, `/account/reviews` (anonymous) | FAIL | 200 with a render error in the Suspense boundary: `@ecomkit/customers` `currentCustomer()` throws core `NotFoundError` for an anonymous viewer. Owner: customers (outside scope). Fix: in the customers route pages, redirect anonymous viewers to `/account/login?next=...` (as `/account/orders` does) or `notFound()` before the Suspense boundary. |
| `sitemap.xml lists URLs` | FAIL (smoke SKIP) | sitemap index is empty with 282 products: no `configureSeo({ registry, ... })` call anywhere in apps/shop (boot wiring, WP-28), so `seoRuntime().registry` is null and `sitemapFiles()` has no sources. Consequence: smoke skips every dynamic storefront route (no samples); covered manually above. Owner: apps/shop boot (outside scope). |
| Footer links `/farm-development`, `/why-choose-us`, and `/about`, `/contact` | FAIL 404 | pages are `published` in the DB but 404 at runtime. Likely cause: the shared build ran against an unseeded DB (A63) and `getPage` is `'use cache'` (`cacheFor` tags) so build-time nulls persist; `/about` and `/contact` are PARTIALLY_STATIC in the prerender manifest. Needs a rebuild against a seeded DB (or `expireTags` on seed load) to confirm; not code in this scope. |
| Footer links `/policies/{delivery,privacy,terms,cancellation-and-refund,damage-and-replacement}` | FAIL 404 | seeded as `draft` (client legal text pending) but the footer menu links them. Either publish placeholder policies or have the footer skip menu items whose cms page is not published (cms/shell owner). |
| Footer menu link `/plants/fruiting-trees` | FAIL 404 | menu seed uses `fruiting-trees`, catalog collection slug is `fruiting` (also `data/seed/redirects.json` targets `/plants/fruiting-trees/{desi,exotic}`, which 404). Fix in seed data (WP-14 / cms seed): use `/plants/fruiting` and `/plants/fruiting/desi|exotic`. |
| Unknown slugs on dynamic storefront routes (`/plant/x`, `/grow-in/x`, `/guides/x`, `/models/x`, ...) | PASS (soft 404) | 200 + `noindex` + not-found body (notFound() after the shell streams). Real 404 status would need the lookup before any Suspense boundary; SEO polish only. |
| `/media/...` from admin media page | PASS with MEDIA_ROOT | MEDIA_ROOT must be an absolute path shared by web, worker and seed (documented in media storage.ts). |
| `/api/health/ready` | SKIP | worker not running |

## Unfinished / for the orchestrator
1. Boot wiring: call `configureSeo` (and other `configureX`) in apps/shop so the sitemap, llms.txt and smoke sampling work.
2. customers account pages: anonymous handling (above).
3. Rebuild shop against a seeded DB, then re-check `/about`, `/contact`, `/why-choose-us`, `/farm-development`.
4. Seed data: `fruiting-trees` slug in the footer menu and redirects; draft policy pages linked from the footer.
5. `seed:load` media hook is very slow under load (sharp derivatives); fresh DBs for verification are faster cloned from a seeded DB via `CREATE DATABASE ... TEMPLATE`.
