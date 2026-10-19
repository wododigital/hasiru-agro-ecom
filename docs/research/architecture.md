# Architecture research: Hasiru Agro store on the approved stack

Date: 2026-10-20. Author: architecture research agent. Inputs: HANDOFF.md, docs/REQUIREMENTS-ADDENDUM.md, docs/research/{feature-inventory,cro-ux,internal-patterns}.md, the **official Next.js 16.4.2 docs shipped inside the `next` npm tarball** (`dist/docs/**`, read directly, so every Next.js claim below is from the current docs, not blog posts), Better Auth docs (better-auth.com), pg-boss 12.38 type definitions, PhonePe and Meta webhook docs, hasiru-ops source (read-only).

Behaviour only. No code or names are taken from other WODO projects. Package scope used below is a placeholder (`@ecom/*`); the planner may rename it.

---

## 0. Version pins (exact, at least 14 days old on 2026-10-20)

Rule: exact versions in every `package.json` (`save-exact=true`), lockfile committed, and pnpm `minimumReleaseAge` set so a fresh install never pulls a version younger than 7 days (supply-chain buffer). Versions below were checked on npm today.

| Package | Pin | Released | Note |
|---|---|---|---|
| node | 24 LTS | | pg-boss 12 needs Node >= 22.12 |
| pnpm | 12.9.1 | 2026-10-03 | pnpm 11+ renamed `onlyBuiltDependencies` to `allowBuilds` (sharp must be allowed to build or it silently has no binary) |
| next | 16.4.0 | 2026-10-06 | 16.4.2 is newest (2026-10-15); bump after 2026-10-29. App Shell for unlisted params needs >= 16.3 |
| react / react-dom | 19.3.0 | 2026-09-09 | |
| typescript | 5.9.3 | | Do **not** take 7.0.x (native compiler; Next build and Drizzle/Better Auth type tooling not validated against it) |
| drizzle-orm / drizzle-kit | 0.45.3 / 0.31.11 | 2026-09-21 | Stay on 0.45 stable, not the 1.0 RC |
| better-auth | 1.7.7 | 2026-09-30 | Peer: drizzle-orm ^0.45.2, next ^16 |
| pg | 8.23.x | | One driver for Drizzle (`drizzle-orm/node-postgres`) and pg-boss (pg-boss depends on `pg`) |
| pg-boss | 12.37.0 | 2026-10-05 | |
| turbo | 2.11.7 | 2026-10-02 | |
| sharp | 0.35.5 | 2026-09-27 | |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | 2026-07-16 | |
| zod | 4.6.5 | 2026-09-13 | |
| @playwright/test | 1.63.0 | 2026-09-04 | |
| @next/playwright | 16.3.8 | 2026-09-30 | `instant()` helper for navigation tests |
| vitest | 5.0.3 | 2026-09-30 | |
| @lhci/cli | 0.15.1 | | |
| three | 0.186.1 | 2026-09-24 | Prototype used 0.128 from a CDN; build bundles it as a lazy chunk |

---

## 1. Next.js 16 performance for an SEO-critical store

### 1.1 Rendering model: Cache Components + Partial Prefetching

`next.config.ts`:
```ts
cacheComponents: true,      // replaces experimental.ppr; caching is opt-in via 'use cache'
partialPrefetching: true,   // <Link> prefetches the App Shell; prefetch={true} per link for full data
reactCompiler: true,        // stable; removes manual memo work, helps INP on the cart/calculator islands
images: { formats: ['image/avif','image/webp'], qualities: [60, 75], minimumCacheTTL: 2678400, maximumDiskCacheSize: 3_000_000_000 },
deploymentId: process.env.GIT_SHA,  // version-skew protection across deploys
```

Facts from the 16.4 docs that drive the design:
- With `cacheComponents`, **every page is dynamic unless data is cached**. Anything inside `'use cache'` (with `cacheLife` + `cacheTag`) becomes part of the prerendered static shell. Request-time APIs (`cookies()`, `headers()`, `searchParams` reads, uncached DB) must sit inside `<Suspense>`; they stream into the shell.
- `generateStaticParams` + cacheComponents = the new ISR. Listed params are fully static at build; unlisted params get the route's App Shell instantly (since 16.3) and are upgraded in the background after the first visit.
- `revalidateTag(tag, 'max')` = stale-while-revalidate (one visitor sees old content, next gets new). `revalidateTag(tag, { expire: 0 })` = next request blocks for fresh data. `updateTag(tag)` = immediate expiry, **Server Actions only** (read-your-own-writes). Single-argument `revalidateTag(tag)` is deprecated.
- Revalidation is a **per-process in-memory tag state** with the filesystem cache on a single `next start` instance. A `revalidateTag` called in another process (our pg-boss worker) does nothing to the web process. On multiple instances a custom `cacheHandlers` with shared tag state is needed.

Decisions:
1. **Product pages (PDP):** `generateStaticParams` returns **all** active products (catalogue is ~200 to 1,000 SKUs; build cost is trivial and every PDP is fully static HTML for crawlers). Product query is `'use cache'` + `cacheLife('max')` + `cacheTag('product:'+id, 'catalog')`.
2. **Price and stock** are part of the same cached product read (so they are in the static HTML and in `Product` JSON-LD `offers`), tagged `price:<id>` and `stock:<id>`. On change: `revalidateTag('stock:'+id, { expire: 0 })` (next visitor gets the fresh number, no stale-once window). Cart, checkout and order placement always re-read stock and price from the DB uncached, so the page can never cause an oversell.
3. **Category / listing pages:** static per category (`generateStaticParams` over categories), whole category list server-rendered (crawlable), filters applied **client-side** over the already-rendered list (cro-ux.md 2.3: instant filtering for < 500 SKUs). URL state via `history.replaceState`; filter combinations canonicalise to the category URL and multi-facet states are `noindex`.
4. **Home, CMS pages, planting-model pages:** `'use cache'` with tags `cms:<slug>`, `nav`, `settings:<module>`, `home`.
5. **Per-visitor bits** (cart count, account menu, recently viewed, OTP-unlocked recommendations): small client islands or `<Suspense>` holes reading the cart cookie. Never inside a cached scope (an identity cookie on a shared-cache response is a P0 bug class).
6. **Checkout, account, admin:** fully dynamic (`await connection()` at the top), no caching, `Cache-Control: private, no-store` (Next sets this automatically for dynamic responses).
7. **Admin writes** call `updateTag` (admin sees the change on the next render). **Worker/ERP writes** (inventory pull, price import, feed jobs) call an internal route handler on the web process, `POST /api/internal/revalidate` with an HMAC header, bound to `127.0.0.1` via nginx `deny all` + secret, which calls `revalidateTag`. This is the only correct path on a separate-worker setup.
8. **Run one web process** (PM2 fork mode, `instances: 1`). Cluster mode would split the in-memory tag state and make revalidation silently partial. Scale vertically first; if a second instance is ever needed, add a Postgres-backed `cacheHandlers` (tag timestamps table + `refreshTags()`), not before. `ponytail:` single instance; multi-instance needs a shared cache handler.
9. Use `<Link prefetch>` (full prefetch) only on high-intent links: product cards in view, "Help me choose" CTA, cart, checkout. Default links get the shared App Shell only.
10. Use `@next/playwright` `instant()` in E2E to lock in that PDP, category, cart and model pages render their key content from the static shell on both page load and client navigation (section 5).

Tag naming (one constant module in core so nobody typos a tag):
`catalog`, `product:<id>`, `price:<id>`, `stock:<id>`, `category:<slug>`, `cms:<slug>`, `nav`, `home`, `settings:<moduleId>`, `model:<slug>`, `reviews:<productId>`, `promo:active`.

### 1.2 Server / client component boundaries

- Default to Server Components. Client islands only where the user types or taps: qty stepper + add-to-cart button, cart drawer, filter bar, calculators, wizard steps, OTP form, diagram hover, 3D viewer, AI chat.
- Islands receive **serialisable props only** (ids, numbers, small arrays). Never pass a whole product list into a client component when a server-rendered list + a tiny client filter controller works (the controller toggles `hidden` on server-rendered cards by data attributes: zero list re-render, best INP).
- Pure domain logic (pricing tiers, GST, truck fill, plant calculator, model scaling, input dosage) lives in framework-free `domain/` modules that run on **both** sides: client for instant feedback, server as the authority at cart/checkout. One implementation, unit tested once.
- `import 'server-only'` at the top of every DB/secret module (DAL pattern). Use React `taint` (experimental `taint: true`) on settings objects holding decrypted secrets so they can never cross to a client component.

### 1.3 Images: sharp at upload + next/image at request

- **Upload pipeline (worker job, sharp):** sniff real type from bytes (sharp metadata, not the extension or MIME header), reject anything not JPEG/PNG/WebP/AVIF/HEIC, auto-rotate, strip EXIF/GPS, cap long edge at 2400 px, store a WebP q85 master under `/var/lib/<app>/media/<random-id>.webp`, compute width/height, dominant colour and a 16 px base64 `blurDataURL`, write all to the media row. Re-encoding destroys polyglot payloads.
- **Delivery:** `next/image` with a `loaderFile`-free default optimizer serving from local paths (`images.localPatterns` restricted to `/media/**`), `formats: ['image/avif','image/webp']` (AVIF ~20% smaller, ~50% slower first encode; each format cached separately), `qualities` allowlist (required in 16), `minimumCacheTTL` 31 days, `maximumDiskCacheSize` 3 GB. **`remotePatterns` empty**: old WordPress product images are downloaded once by the catalog import job into our media store, never hotlinked (removes an SSRF surface and a third-party dependency on the LCP path).
- **Warm the cache:** after an image is processed, the worker requests the common widths (`deviceSizes` used by product cards and PDP) in AVIF and WebP through the local optimizer so the first real visitor never pays the AVIF encode.
- **LCP image:** in Next 16 `priority` is deprecated; use `preload` on the single LCP image (home hero, PDP main image) or `loading="eager"` + `fetchPriority="high"`. Every image has width/height or an aspect-ratio box; `sizes` set correctly on cards (`(max-width: 600px) 50vw, 200px`).
- **nginx must forward `Accept`** (it does by default with `proxy_pass`; do not strip it) or AVIF negotiation fails.
- **Image cache dir** `.next/cache/images` must live on a persistent path shared across releases (symlink), or every deploy re-encodes everything.
- sharp on glibc: set `MALLOC_ARENA_MAX=2` (or preload jemalloc) for both web and worker processes to stop RSS creep; worker runs sharp with `sharp.concurrency(1)`.
- Upgrade path (only if VPS CPU becomes the bottleneck): pre-generate fixed widths at upload and let nginx serve them with `Accept`-based `map` + `try_files`.

### 1.4 Fonts

`next/font/google` self-hosts at build (no Google request at runtime, no layout shift thanks to automatic fallback metric adjustment):
```ts
const display = DM_Serif_Display({ weight: '400', style: ['normal'], subsets: ['latin'], display: 'swap', variable: '--font-display' })
const body = Outfit({ subsets: ['latin'], display: 'swap', variable: '--font-body' }) // variable font, all weights in one file
```
Only latin subsets. Kannada (later) gets Noto Sans Kannada loaded with `preload: false` only on Kannada routes. Fonts budget <= 100 KB.

### 1.5 Code splitting and heavy features without hurting UX

- Route-level splitting is automatic. Keep storefront and admin in **separate route groups with separate root layouts** (`app/(shop)/layout.tsx`, `app/(admin)/layout.tsx`) so admin providers, shadcn table/chart code and CSS never ship to shoppers.
- **three.js 3D view:** its own route (`/models/[model]/3d`, as the prototype's `/3d.html` was), so the ~150 KB gzip three chunk loads only there. The "View in 3D" link warms the chunk on intent (`pointerenter` / `focus` / `touchstart` call `import('./viewer')` and `router.prefetch`). The 3D page renders a same-size skeleton with the step preloader, checks `navigator.hardwareConcurrency`/`deviceMemory` and `prefers-reduced-motion`, and offers the 2D plan as the default on weak devices. GLB models: meshopt/Draco + WebP textures (prototype mango GLB went 2.7 MB to 355 KB), `Cache-Control: immutable` with content-hashed names.
- **M/X/O plan diagram:** recommend **server-rendered SVG** generated from the model pattern (Commercial, Food Forest, Miyawaki up to 361 points is tiny SVG): zero JS on first paint, no CLS, crawlable, scales on any screen; hover/tap tooltip via a ~2 KB client island. Client decision #4 said "auto-generate on a canvas"; an SVG generated from the same pattern data meets the behaviour (auto-generated, legend, counts, tooltips). **Flag for the planner**: keep canvas only if the client insists; then render it in a client component `dynamic(..., { ssr: false })` inside a fixed-size box with a skeleton.
- **Calculators, wizard, AI chat:** client islands; AI chat panel loaded on first open (`dynamic` import on click, warmed on hover/focus).
- `next/dynamic` with `ssr: false` is only allowed inside Client Components (16.4 docs).
- Below-the-fold rails: plain server HTML with native `loading="lazy"` images; no JS carousel library (CSS scroll-snap + 1 KB arrow buttons).

### 1.6 Marketing tags (GA4, Meta Pixel, Google Ads)

- **Partytown is out**: `next/script` `strategy="worker"` is experimental and does not work with the App Router (16.4 docs, explicit warning).
- Load tags with `next/script` `strategy="lazyOnload"` (idle) and only after consent; GA4 via `@next/third-parties` `GoogleAnalytics` (pin to the 16.x release) or the same lazy pattern.
- **Conversion events from the server**: purchase, add-to-cart, lead (OTP unlock) are sent server-side from pg-boss jobs via Meta Conversions API and GA4 Measurement Protocol with a shared `event_id` for browser/server dedup. More accurate (ad blockers, ITP) and zero main-thread cost; the browser pixel becomes optional enrichment.
- Admin-managed tag list feeds the CSP allowlist at response time (only enabled vendors' hosts appear in `script-src`/`connect-src`).

### 1.7 Core Web Vitals targets and bundle budgets

| Metric | Google "good" (p75 field) | Our target |
|---|---|---|
| LCP | <= 2.5 s | <= 2.0 s mobile (Moto G Power / slow 4G lab) |
| INP | <= 200 ms | <= 150 ms |
| CLS | <= 0.1 | <= 0.05 |
| TTFB | <= 0.8 s | <= 0.3 s on static-shell routes from the VPS |

Budgets enforced by Lighthouse CI `resource-summary` (transfer size, gzip):
- JS per storefront page: home <= 170 KB, category <= 180 KB, PDP <= 170 KB, cart <= 190 KB, checkout <= 220 KB, recommendations <= 200 KB. 3D route excluded (separate budget <= 450 KB).
- Fonts <= 100 KB; LCP image <= 120 KB at mobile width; total page weight home <= 900 KB.
- Lighthouse mobile performance >= 90, SEO = 100, accessibility >= 95, best practices >= 95 on home, category, PDP, model page.
- `pnpm next analyze` (Turbopack bundle analyzer, 16.1+) for investigations. `optimizePackageImports` already covers `lucide-react`.
- Field data: `useReportWebVitals` posts to our own analytics module (beacon), admin shows p75 LCP/INP/CLS per template.

### 1.8 SEO mechanics (stack side)

- `app/robots.ts` and `app/sitemap.ts` dynamic, host from settings; **no static `public/robots.txt`** (it silently wins). Sitemap lists only 200, indexable, canonical URLs (products in stock and out of stock both listed; drafts not). Explicit AI crawler policy.
- `generateMetadata` per route with canonical, OG image (static per product from media, no runtime OG rendering needed), `noindex` only via an env/launch flag that is asserted off in the production smoke test.
- JSON-LD rendered server-side in the cached component: `Product` + `Offer` (price, `priceCurrency: INR`, `availability`, `priceValidUntil`), `hasMerchantReturnPolicy` = `MerchantReturnNotPermitted` (client policy: no returns), `shippingDetails` (delivery zones), `AggregateRating` only when real reviews exist, `BreadcrumbList`, `Organization` + `LocalBusiness`/`GardenStore` for the nursery, `FAQPage` where FAQs are real. Serialise with a JSON escaper that replaces `<` (no raw `JSON.stringify` inside `<script>`).
- 404 log + redirect manager; slug change auto-creates a 301 (module `seo`).

---

## 2. Monorepo of reusable, pick-and-choose modules

### 2.1 Tooling

- **pnpm workspaces + Turborepo.** `apps/shop` (Hasiru), `apps/minimal` (proof app: core + catalog + cart + checkout + payments), `apps/worker` (pg-boss process; or a `worker` entry inside `apps/shop`, see 6.2), `packages/*`.
- **Internal packages are source-only TypeScript** (`exports` point at `.ts`/`.tsx`, no build step). Next 16 docs: Turbopack transpiles workspace packages automatically, so `transpilePackages` is not needed (harmless if listed). The worker runs TS through `tsx` or a tiny `tsup` build in `apps/worker` only.
- Turborepo tasks: `typecheck`, `lint`, `test` (Vitest), `build`, `e2e`, `lhci`, with caching on inputs. `turbo boundaries` (Turborepo 2.4+) to enforce that a package imports only its declared dependencies.
- ESLint `no-restricted-imports` (or `turbo boundaries` tags) blocks deep imports: `@ecom/<mod>/src/**` is forbidden from outside; only the `exports` entrypoints are public.
- Tailwind v4 gotcha: the app's CSS must declare `@source "../../packages/*/src";` (path relative to the CSS file) or classes used only inside packages are purged.

### 2.2 Package anatomy (every module the same shape)

```
packages/<mod>/
  package.json        exports: "./manifest", "./schema", "./domain", "./server", "./ui", "./admin", "./routes/*"
  src/manifest.ts     defineModule({...})
  src/schema.ts       Drizzle tables, all prefixed "<mod>_" (e.g. catalog_product)
  src/domain/*        pure TS: types, zod schemas, calculations. No React, no Next, no DB.
  src/server/*        'server-only': queries ('use cache' + tags), server actions, route-handler factories, job handlers, event subscribers
  src/ui/*            React components (server by default, 'use client' islands marked); styled with semantic tokens only
  src/admin/*         admin pages and forms (server components + client forms), registered via manifest
  src/routes/*        page modules the host re-exports (default export + generateMetadata + generateStaticParams)
  test/*              Vitest for domain/ and server/ (server tests against a throwaway Postgres DB per worker)
```

Manifest contract (in `@ecom/core`):
```ts
defineModule({
  id: 'catalog',
  dependsOn: ['core', 'media'],            // hard deps; build fails if missing
  optional: ['reviews', 'inventory'],      // soft; feature degrades when absent
  schema: () => import('./schema'),        // for drizzle-kit and runtime
  routes: [{ path: '/plants/[slug]', module: './routes/product-page' }, ...],
  admin: { nav: [{ label: 'Products', href: '/admin/products', icon: 'package', permission: 'catalog:read' }], pages: [...] },
  settings: z.object({...}),               // fields; .meta({ secret: true }) marks encrypted fields
  permissions: ['catalog:read', 'catalog:write'],
  jobs: { 'catalog.import': { handler, queue: { policy: 'singleton', retryLimit: 3 } } },
  schedules: [{ name: 'catalog.feed-rebuild', cron: '0 */6 * * *', tz: 'Asia/Kolkata' }],
  emits: ['product.updated', 'stock.changed'],
  on: { 'order.placed': handler },         // event subscriptions
  cacheTags: ['catalog', 'product:*'],
})
```

### 2.3 How a package contributes routes, admin pages, schema, migrations

App Router is filesystem-based; a package cannot add routes at runtime, and a catch-all dispatcher would kill per-route static generation and code splitting. So:

1. **One config file** `apps/shop/modules.config.ts` lists enabled modules.
2. **`pnpm modules:sync`** (a small script in core) reads the enabled manifests and **generates committed stub files**:
   - `app/(shop)/plants/[slug]/page.tsx` containing `export { default, generateMetadata, generateStaticParams } from '@ecom/catalog/routes/product-page'` (route segment config literals, if any, are written into the stub because Next requires them statically).
   - `app/(admin)/admin/products/page.tsx` likewise.
   - `src/generated/registry.ts`: admin nav, settings registry, permission list, job + schedule list, event subscription map, all built from enabled manifests only.
   - `drizzle.config.ts` `schema: [...]` array of enabled modules' `schema.ts` paths.
   Hasiru can still override any route by writing its own page file (the sync script never overwrites a file without its generated header).
   CI runs `modules:sync --check` (fails on diff) so the stubs never drift.
3. **Migrations are per app, not per package.** drizzle-kit diffs the union of enabled schemas against the app's snapshot and writes SQL into `apps/shop/drizzle/`. Enabling a module later = sync + `drizzle-kit generate` = one new migration. Per-package migration folders would need cross-package ordering and separate journals; avoid. `apps/minimal` has its own migrations folder from its own smaller schema set.
4. Better Auth tables are generated once with `pnpm dlx auth@<pinned> generate` into `packages/auth/src/schema.ts` and then flow through drizzle-kit like any module. pg-boss owns its own `pgboss` schema (created by `boss.start()` with `migrate: true` during the deploy migration step).

### 2.4 Theming: brand-neutral packages

- Packages use **semantic tokens only**: `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-text`, `--color-muted`, `--color-primary`, `--color-primary-fg`, `--color-accent`, `--color-success/warning/danger`, `--color-border`, `--radius-sm/md/lg`, `--font-display`, `--font-body`, `--shadow-card`, plus three role colours for planting models (`--color-role-main/host/biomass`).
- `@ecom/ui` (shadcn/ui-derived primitives) maps them in Tailwind v4 `@theme inline { --color-primary: var(--color-primary); ... }` so packages write `bg-primary`, never hex.
- `apps/shop/src/theme.css` sets Hasiru values (forest #1B4332 as primary, gold #FDC717 accent, cream #FAF6E9 bg, radius 18/12/24, DM Serif Display / Outfit). Admin uses the same tokens with a neutral admin palette override under the admin root layout.
- Copy strings that packages render come from props or a module `messages` object the host can override (needed for Kannada later and to keep packages brand-neutral; "Rs" formatting lives in `core/money`).

### 2.5 `@ecom/core` (shared, so nothing is duplicated)

| Area | What it provides |
|---|---|
| `money` | Integer paise everywhere (`bigint`-safe integer columns), `formatINR` (en-IN grouping, "Rs"), rounding helpers, GST split by rate (0/5/12/18) with HSN code per line, banker-free half-up rounding at line level. No floats for money, ever. |
| `db` | One `pg` Pool + Drizzle instance, `withTx`, idempotent upsert helpers that require named update columns (an empty update set is a plain INSERT that throws on retry), test DB factory. |
| `env` | zod-validated env at boot (fails fast), server/client split. |
| `auth-context` | `getViewer()` (session, roles, permissions) cached per request with React `cache()`; `requirePermission()` for actions and route handlers. Packages depend on this interface, not on Better Auth directly. |
| `events` | Typed event catalogue (`defineEvent<'order.placed', { orderId }>`). `emit()` inside a DB transaction enqueues a pg-boss job **in the same transaction** (pg-boss 12 `send(..., { db })` accepts a transaction-bound executor), giving a transactional outbox: no lost or phantom events. Subscribers from enabled manifests only; absent module = no subscriber = clean degrade. |
| `jobs` | pg-boss wrapper: queue registry from manifests, `createQueue` before `schedule` (required in v12), standard retry policy (`retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600`), dead-letter queue per integration, `singletonKey` for de-duplication, heartbeat row for health. |
| `settings` | Registry of per-module zod schemas; `settings` table (module, key, value jsonb, encrypted flag, key version, updated_by, updated_at). Secrets AES-256-GCM (section 3.5). Typed `getSettings('payments')` cached with tag `settings:payments`. |
| `audit` | `audit(actor, action, entity, before, after)` append-only (section 3.7). |
| `rate-limit` | Postgres fixed-window limiter (section 3.2), also plugged into Better Auth `rateLimit.customStorage.consume`. |
| `http` | `verifyHmac`, `timingSafeEqual` wrappers, raw-body helper, outbound `fetch` with timeout + host allowlist (SSRF guard), structured integration call logger (ok / failed / skipped-not-configured at one choke point). |
| `observability` | `instrumentation.ts` `onRequestError` capture, error fingerprinting, `error_event` table, dev alert with fallback channel (see internal-patterns.md section 1). |
| `cache-tags` | Tag constants + `revalidateFromWorker()` client for the internal revalidate endpoint. |
| `manifest` | `defineModule`, dependency resolution, `modules:sync` script. |

### 2.6 Proposed module list

Generic (reusable in any store):

| Package | Owns | Depends / optional |
|---|---|---|
| `core` | section 2.5 | none |
| `ui` | shadcn-based primitives, tokens, skeletons, toasts, qty stepper, drawer, rails | core |
| `auth` | Better Auth instance, customer OTP (phone via WhatsApp/SMS adapter, email), staff login + 2FA, roles/permissions (`createAccessControl`), session helpers, account pages | core; optional notifications (OTP delivery falls back to mock/log) |
| `admin-shell` | Shopify-style shell: sidebar from registry, top bar, global search, dashboard widget slots, settings page renderer (forms auto-built from zod settings schemas with secret-field handling), audit viewer, staff/roles screens | core, auth, ui |
| `media` | uploads, sharp pipeline job, media library, image warm-up | core |
| `catalog` | products, variants (pot size/age), categories + sub-filters, attributes (exposure, temperature, spacing, size class, propagation, bearing, yield, Kannada name), PDP + category routes, product JSON-LD, admin CRUD + CSV/XLSX import | core, media; optional pricing, inventory, reviews |
| `pricing` | price lists, **per-product bulk tiers** (normal price below threshold, bulk price at/above; threshold per product), offline/nursery price (admin only), price history, tier-unlock hint data | core, catalog |
| `search` | Postgres FTS (`tsvector` generated column, `simple` config for Kannada) + `pg_trgm` for typos, suggest endpoint, facet definitions consumed by listing UI, search analytics (zero-result queries) | core, catalog |
| `inventory` | stock levels per location, reservations at checkout (conditional `UPDATE ... SET qty = qty - $n WHERE qty >= $n`), stock movements ledger, low-stock alerts, emits `stock.changed` | core, catalog |
| `cart` | DB cart keyed by httpOnly random cookie id (guest) merged on login; line types (product, package line with origin metadata), server recomputation of every total; cart drawer + page UI; extension points for "cart blocks" (e.g. truck meter, package block) | core, catalog, pricing; optional inventory, discounts, shipping |
| `checkout` | address book, delivery choice, order review, totals pipeline (subtotal, tier savings, auto promos, packing, shipping, GST, total), idempotent place-order (idempotency key), policy acknowledgement | core, cart, auth; optional payments, shipping, discounts |
| `payments` | provider adapter interface (`createPayment`, `verifyWebhook`, `fetchStatus`, `refund`), PhonePe adapter, mock adapter (local test page), COD/bank-transfer adapter, payment attempts table, reconciliation job | core, checkout |
| `orders` | order + lines snapshot (prices frozen), status machine, invoices (GST invoice PDF), customer order pages (IDOR-safe), admin order list/detail/fulfilment, emits `order.placed/paid/shipped/delivered/cancelled` | core, checkout |
| `customers` | customer profiles, segments, addresses, consent flags, admin customer screens, lead records (OTP-unlocked recommendations count as leads) | core, auth |
| `discounts` | automatic promos (e.g. % off a category in a date window), codes, per-customer limits, atomic redemption counting, stacking rules | core, catalog; consumed by checkout |
| `shipping` | shipping methods as adapters: pickup, scheduled local delivery (slot calendar, weekly day), distance-based outstation (district distance x vehicle rate); **vehicle catalogue + capacity selection** (smallest vehicle that fits by weight, fill %) as generic "load-based shipping"; packing fee rules | core; consumed by checkout |
| `reviews` | product reviews with verified-buyer flag, moderation queue, aggregate rating cache (tag `reviews:<id>`), photo reviews via media | core, catalog, orders |
| `notifications` | channel adapters (email via Gmail API OAuth, WhatsApp Cloud API, mock/log), template registry (per event, per channel, admin editable), send log with status webhooks, quiet hours, opt-out | core |
| `flows` | event-driven automations: order confirmations, dispatch updates, abandoned cart (cart idle N hours with known contact, stop on order), review requests, back-in-stock | core, notifications, events; each flow declares the events it needs and is disabled when a source module is absent |
| `analytics` | first-party beacon (`sendBeacon`, batched, `ON CONFLICT DO NOTHING` on client event id), sessions, page views, funnels, journey replay-lite, web-vitals p75, admin dashboards | core |
| `monitoring` | health endpoints (`/api/health/live`, `/api/health/ready`), system health screen, integration health cards, job queue view with retry, error list by fingerprint, staleness signals ("last order N hours ago") | core |
| `marketing` | consent banner, tag manager (admin-managed vendor list feeding CSP), server-side conversions (Meta CAPI, GA4 MP), UTM/click-id attribution stored on the order | core; optional orders |
| `feeds` | Google Merchant Center product feed (scheduled XML/Content API), Meta catalog feed/sync, diff-based updates on `product.updated`/`stock.changed` | core, catalog, pricing, inventory |
| `seo` | metadata helpers, JSON-LD builders, sitemap/robots, 404 log, redirects (auto 301 on slug change), canonical rules | core |
| `cms` | content pages, blocks (hero, rails, FAQ, video, trust band), navigation menus, policy pages, blog/guides, media embeds | core, media |
| `ai-assistant` | rules-first assistant: deterministic recommendation/answer engine produces facts; Claude API only narrates or answers from those facts + catalogue context; streaming route handler, per-user/IP rate limit, token budget cap, answer cache, transcript log, admin prompt/model settings (model id chosen at build time via the claude-api reference, stored in settings) | core, catalog; optional planting |
| `erp-sync` | generic ERP connector: outbound order push, inbound inventory pull, mapping tables (our SKU to ERP item), sync log, retry/dead-letter, adapter interface; adapters: `mock`, `hasiru-ops` (in the Hasiru app or as a separate package) | core, orders, inventory |

Hasiru-specific (separate packages, never inside generic ones):

| Package | Owns |
|---|---|
| `planting` | planting models (Commercial, Food Forest, Miyawaki, Boundary), M/X/O role patterns per 36 x 36 ft block, model-to-plant assignments with per-model spacing (the "-" means excluded rule), scaling to land size (acre / sq ft), SVG plan renderer, 3D viewer route (three.js), "Help me choose" wizard, OTP-gated recommendation unlock, "add package to cart" (cart package lines) |
| `farm-calculators` | plant calculator (43,560 / (L x W), triangular x1.155, optional replacement buffer), compost/input calculator (dosage per role and age, pack rounding), recommended inputs block |
| `truck-meter` | cart block that renders the load meter on top of `shipping` vehicle capacity (generic "load-based shipping" stays in `shipping`; the farmer-facing meter copy and visuals live here) |
| `places` | Karnataka/South India district + taluk geo data (644 districts from the client file), place search with suggestions, distance from the nursery, agro-climate fields used by the wizard |
| `hasiru-ops-adapter` | the `erp-sync` adapter for hasiru-ops (see 2.7) |

Note: earlier docs use "ai-advisor"; I named it `ai-assistant` only to avoid any name overlap with the separate WODO AI Advisor prototype. Planner's call.

### 2.7 hasiru-ops integration facts (read-only study)

- hasiru-ops is Next 16.3 + Supabase (Postgres + Auth + Storage). The only external API today is `POST /api/leads/intake` (shared-secret header, create-only, writes `leads`). There is **no orders or inventory API**.
- Since we must not modify hasiru-ops, the adapter supports two transports behind one interface, chosen in admin settings: (a) **`ops-api`**: HMAC-signed HTTPS endpoints that hasiru-ops would expose later (preferred; documented as a spec for the client's team); (b) **`supabase-rest`**: PostgREST with a key entered in admin (encrypted at rest), reading the inventory table and inserting orders. A service-role key bypasses RLS, so the setting screen warns and the adapter restricts itself to an allowlist of tables and columns. Build and test fully against the `mock` adapter; leads from the OTP unlock can already go to `/api/leads/intake`.
- Inventory in: scheduled pull every 5 to 15 min (singleton queue) + manual "sync now"; changed SKUs trigger `stock:<id>` revalidation via the internal endpoint. Orders out: on `order.paid` (and COD confirmed), idempotent push keyed by our order number; settled failure alerts after retries.

---

## 3. Security hardening

### 3.1 Headers and CSP

The 16.4 docs are explicit: **nonce-based CSP forces every page to render dynamically and is incompatible with PPR / static shells**. That would throw away the storefront's static performance. So split:

- **Storefront (static shell routes):** CSP set from `next.config.ts` `headers()` (or proxy) **without nonces**: `default-src 'self'; script-src 'self' 'unsafe-inline' <enabled tag vendors>; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: <vendor pixels>; font-src 'self'; connect-src 'self' <vendors>; frame-src <video host, PhonePe if iframe>; object-src 'none'; base-uri 'self'; form-action 'self' <PhonePe host>; frame-ancestors 'none'; upgrade-insecure-requests`. XSS defence rests on React escaping, no `dangerouslySetInnerHTML` except escaped JSON-LD and sanitised CMS HTML (sanitiser allowlist), and no user-controlled URLs in `href` without scheme validation. Experimental SRI (`experimental.sri`) is an option to drop `'unsafe-inline'` for scripts while staying static; test it in a spike before relying on it (experimental, and Next emits inline RSC payload scripts).
- **Admin, account, checkout (already dynamic):** strict nonce CSP generated in `proxy.ts` (Next 16 renamed `middleware.ts` to `proxy.ts`; nonce from `crypto.getRandomValues` + base64 via Web APIs, works in any runtime), `'strict-dynamic'`, no `'unsafe-inline'` for scripts. Proxy matcher limited to `/admin`, `/account`, `/checkout`, excluding `_next/static`, `_next/image`, prefetches.
- Everywhere: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(self)` (geolocation for "use my location"), `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`, `poweredByHeader: false`. Verify **on the wire** in the deploy smoke test, not only in code.

### 3.2 Rate limiting (per-route keys)

- Postgres `UNLOGGED` table `rate_limit(key text primary key, window_start timestamptz, count int)`; one atomic statement `INSERT ... ON CONFLICT (key) DO UPDATE SET count = CASE WHEN window expired THEN 1 ELSE count + 1 END ... RETURNING count, window_start`. Key = `<routeId>:<identifier>` **always prefixed with the route id** (an unprefixed IP-only key let a beacon route eat a form's limit in a past project).
- Limits (defaults, admin-tunable): OTP send per phone 3 / 15 min and 10 / day, per IP 10 / 15 min; OTP verify per phone 5 / 15 min (plus Better Auth `allowedAttempts: 3` per code); staff login 5 / 15 min per IP + account; 2FA verify per Better Auth lockout; AI assistant 20 / hour per visitor, 100 / day per IP; search suggest 60 / min per IP; place-order 10 / hour per customer; analytics beacon 120 / min per visitor id (never shares a key with forms); webhooks not rate limited (signature-gated instead).
- Better Auth: `rateLimit.customStorage.consume` delegates to the same limiter so auth and app limits share one store; `advanced.ipAddress.ipAddressHeaders: ['x-real-ip']` with nginx setting `X-Real-IP $remote_addr` (do not trust a client-supplied `X-Forwarded-For` chain).
- nginx `limit_req` as a coarse outer layer on `/api/` and auth paths (burst-tolerant), so floods never reach Node.

### 3.3 CSRF and server actions

- Server Actions are POST-only and Next compares `Origin` with `Host`/`X-Forwarded-Host`; nginx must pass `Host $host` and `X-Forwarded-Host $host` or legit actions fail (or someone "fixes" it with a wide `allowedOrigins`). Keep `serverActions.allowedOrigins` empty.
- Every server action is a public endpoint: **zod-parse the input, check `requirePermission()` / ownership inside the action**, return typed results. Never rely on the UI hiding a button.
- Session cookies `HttpOnly; Secure; SameSite=Lax` (Better Auth defaults); route handlers that mutate state (non-action POSTs) check `Origin` too via a core helper. Webhook routes are exempt but signature-verified.
- Set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (stable across builds) so in-flight forms survive a deploy.

### 3.4 Webhook verification

- Read **raw body** (`await req.text()`) before parsing; verify; then `JSON.parse`. Constant-time compare (`crypto.timingSafeEqual` on equal-length buffers).
- **PhonePe (Standard Checkout v2):** `Authorization` header = SHA-256 of `username:password` configured in the PhonePe dashboard; compute and compare. Use root `payload.state` and `event` (`checkout.order.completed` / `checkout.order.failed`); tolerant parsing. **Never mark an order paid from the redirect URL or the webhook alone**: on either signal, call the Order Status API server-to-server and trust only that. Hex vs base64 encoding of the hash is unconfirmed in docs: verify against a UAT callback; the mock adapter mirrors whichever is confirmed.
- **WhatsApp Cloud API:** GET handshake echoes `hub.challenge` when `hub.verify_token` matches; POSTs verified with `X-Hub-Signature-256: sha256=<HMAC-SHA256(raw body, app secret)>`.
- **Google / Meta catalog:** outbound only (no inbound webhooks needed initially).
- Dedupe table `webhook_event(provider, event_id unique, received_at, status)`; reject timestamps outside a 5 min window where the provider sends one; process asynchronously via pg-boss and return 200 fast.

### 3.5 Secrets entered in admin (API keys)

- AES-256-GCM via Node `crypto`, 12-byte random IV per value, auth tag stored, AAD = `module:key` (a ciphertext copied to another field fails to decrypt). Stored as `v<keyVersion>:<iv>:<tag>:<ciphertext>` base64.
- Master key `APP_ENCRYPTION_KEY` (32 bytes base64) only in the server env (never in the DB, never in the repo); `APP_ENCRYPTION_KEY_PREVIOUS` supported for rotation with a re-encrypt job.
- Admin UI never receives a secret back: shows "set, ends in ...a1b2, updated by X on date", with Replace / Clear actions. Writes audited (without values). Integration "Test connection" buttons run server-side.
- Decrypted settings objects are `taint`ed and only read inside `server-only` modules.

### 3.6 RBAC

- Better Auth admin plugin with custom `createAccessControl` statements generated from module manifests (`catalog: ['read','write','import']`, `orders: ['read','fulfil','refund']`, `settings: ['read','write','secrets']`, ...). Roles: `owner`, `manager`, `catalog_editor`, `fulfilment`, `support`, `customer` (default). `adminRoles` = staff roles.
- Admin root layout: no session -> login; customer role -> 404 (do not reveal admin exists); staff without 2FA enabled -> forced 2FA enrolment; session older than 12 h -> re-login (admin freshness enforced in the layout since Better Auth session length is global). Each admin page and every server action checks its own permission (direct URL by a non-permitted role is blocked server-side, not just hidden in nav). Integration/secret screens require `settings:secrets` (owner only by default).

### 3.7 Audit log

`audit_log(id, at, actor_id, actor_role, action, entity_type, entity_id, before jsonb, after jsonb, ip, user_agent, request_id)`; append-only enforced in Postgres: the app role has `INSERT, SELECT` only (no `UPDATE/DELETE`); retention job runs as the owner role. Logged: every admin write, role changes, settings changes (secret values redacted), refunds, price/stock manual edits, impersonation, logins and 2FA events (from Better Auth hooks).

### 3.8 Validation, SSRF, uploads

- zod at every boundary: server actions, route handlers, webhook payloads (tolerant `.passthrough()` for provider payloads, strict for ours), env, settings, CSV/XLSX import rows, job payloads, URL search params.
- **SSRF:** outbound HTTP only through `core/http` with a per-adapter host allowlist (`api.phonepe.com`, `graph.facebook.com`, `gmail.googleapis.com`, `oauth2.googleapis.com`, `merchantapi.googleapis.com`/`shoppingcontent.googleapis.com`, `api.anthropic.com`, the configured ERP host). Any admin-entered URL (ERP base URL, outbound webhooks) must be `https`, resolve to a public IP (reject private, loopback, link-local, metadata ranges, checked after DNS resolution), no redirects followed to other hosts. `next/image` `remotePatterns` empty, `dangerouslyAllowLocalIP` false.
- **Uploads:** size caps (images 10 MB, CSV/XLSX 5 MB), type from magic bytes, images re-encoded by sharp, SVG uploads refused, random server-side file names outside any web-served directory, served only through the image optimizer or a signed route. Spreadsheet imports parsed in the worker with row limits and formula-injection escaping on CSV exports (`=`, `+`, `-`, `@` prefixed with `'`).

### 3.9 OWASP items specific to e-commerce

- **Price/discount tampering:** client sends only `productId`, `variantId`, `qty`, `packageId`; server recomputes every price, tier, promo, packing, shipping, GST, total from the DB at cart render, at checkout and again inside the place-order transaction.
- **Inventory races:** reserve stock with a conditional decrement inside the order transaction; reservations expire (job) if payment is not confirmed in N minutes.
- **Coupon abuse:** per-code and per-customer limits enforced by a unique `(promo_id, customer_id, order_id)` redemption row + counter check in the same transaction.
- **IDOR:** order/account queries always scoped by the session's customer id; guest order status by a signed, expiring token link (WhatsApp/email), never by sequential order number.
- **Account enumeration and OTP bombing:** identical responses whether a phone/email exists; per-phone and per-IP send limits (each WhatsApp OTP costs money); `disableSignUp` off for customers (OTP is sign-up) but staff accounts invitation-only.
- **Payment integrity:** amount sent to PhonePe is from the order row; webhook and status amounts compared with the order total before marking paid; idempotent `order.paid` transition.
- **Bot abuse:** honeypot + timing check on public forms; Cloudflare Turnstile adapter available if abuse appears (not enabled by default).
- **Dependencies:** exact pins, `minimumReleaseAge`, `allowBuilds` allowlist (sharp, esbuild only), `pnpm audit --prod` in CI (fail on high), Renovate/Dependabot optional later.
- **Logs:** no PII or secrets in logs; phone numbers masked; request ids for correlation.

---

## 4. Auth and jobs

### 4.1 Better Auth configuration

- Adapter: `drizzleAdapter(db, { provider: 'pg' })` (Better Auth 1.7 exposes it as `better-auth/adapters/drizzle` and as `@better-auth/drizzle-adapter`; use one). Enable `advanced.database.joins: true` with Drizzle relations.
- **Customers:** `phoneNumber` plugin with `sendOTP` routed to the notifications module: **WhatsApp authentication template** (Meta Cloud API) as primary channel, SMS adapter as an optional fallback (India SMS needs DLT registration; not in the approved integrations, so mock only), mock/log channel in dev and tests (fixed code only when `MOCK_OTP=1`, never in production builds). `signUpOnVerification` with `getTempEmail: phone => \`${phone}@phone.invalid\`` (the `.invalid` TLD can never receive mail). `otpLength: 6`, `expiresIn: 300`, `allowedAttempts: 3`. Do not `await` the send inside `sendOTP` (timing attacks); enqueue a high-priority pg-boss job instead.
- `emailOTP` plugin for customers who prefer email (`sendVerificationOTP` -> Gmail adapter job), with `storeOTP: 'hashed'`.
- **OTP-gated recommendations (wizard):** the unlock is a phone OTP sign-in/sign-up; the recommendation snapshot is attached to the new session's customer and a lead row is written (and pushed to hasiru-ops leads intake when that adapter is on).
- **Checkout:** requires a verified phone (OTP doubles as login); no passwords for customers.
- **Staff:** email + password (`emailAndPassword`, invitation-only, `disableSignUp: true` path for staff), `twoFactor` plugin with TOTP + backup codes, enforced as described in 3.6 (2FA gating applies on `/sign-in/email` by default, which is the staff path). Account lockout on repeated 2FA failures is built in (429 `ACCOUNT_TEMPORARILY_LOCKED`).
- `admin` plugin with custom access control (3.6). Impersonation allowed for `owner` only, audited.
- Rate limiting via `customStorage.consume` (3.2); built-in stricter defaults for `/sign-in/email` and `/two-factor/*` stay.
- Schema: `pnpm dlx auth@<pinned> generate` -> `packages/auth/src/schema.ts` -> drizzle-kit generate. Never hand-edit generated migration metadata.

### 4.2 pg-boss 12

- Separate `pgboss` schema in the same database. Worker process: `new PgBoss({ db pool settings, schema: 'pgboss', migrate: true, supervise: true, schedule: true })`; web process may also construct a boss instance with `supervise: false, schedule: false` only to `send` jobs (or use `send(..., { db })` through the outbox).
- v12 requires `createQueue(name, options)` before `schedule()` or `send()`. Queue policies available: `standard`, `short`, `singleton`, `stately`, `exclusive`, `key_strict_fifo`. Use `singleton` for sync jobs (one active ERP pull at a time), `stately` for feed rebuilds, `key_strict_fifo` with `singletonKey = orderId` for per-order notification sequences.
- `schedule(name, cron, data, { tz: 'Asia/Kolkata', key })`; schedules registered from manifests at worker boot (idempotent upsert).
- Retries: `retryLimit`, `retryDelay`, `retryBackoff: true`, `retryDelayMax`; `deadLetter` queue per integration; alert only on dead-letter (settled failure), never on the first error.
- Jobs: OTP send, email/WhatsApp sends, abandoned-cart scans (every 15 min), reservation expiry (every 5 min), payment reconciliation (every 10 min for pending payments older than 15 min), ERP inventory pull, ERP order push, Merchant/Meta feed rebuild, image processing + warm-up, analytics rollups (hourly), backups check, error digest, sitemap ping (if used).
- Heartbeat: worker writes `job_heartbeat` every 30 s; `/api/health/ready` and the admin dashboard go red if older than 2 min.

### 4.3 Drizzle migrations workflow

1. Change a module's `schema.ts`.
2. `pnpm --filter shop db:generate` (drizzle-kit generate, named migration). Review SQL in the PR; never `drizzle-kit push` against shared or production databases.
3. Local/CI: `db:migrate` applies via drizzle-orm's migrator (`migrate()` from `drizzle-orm/node-postgres/migrator`) in a script, using a **migration role** that owns the schema; the app runtime role has DML only.
4. Deploy order: **migrate first, then switch code** (expand/contract: add columns nullable or with defaults, backfill in a job, enforce NOT NULL in a later release). Prefer nullable columns over NOT NULL when a validation rule can produce nulls.
5. Seeds: idempotent seed scripts (upserts with named update columns) for categories, roles, settings defaults, sample logistics numbers marked "sample".
6. Each test worker gets its own throwaway database (created from a template DB that already has migrations applied) so parallel agents and tests never share state.

---

## 5. Testing

- **Vitest (unit):** every `domain/` function (tier pricing at threshold boundaries, GST per HSN, truck fill and vehicle choice, plant calculator incl. triangular factor and buffer, model scaling to acres/sq ft, input dosage rounding, promo stacking, money rounding), settings encryption round trip + tamper detection, webhook signature helpers (valid, invalid, wrong length), rate limiter windows. Server tests hit a real Postgres (template DB clone per worker), not mocks.
- **Playwright E2E** against a production build (`next build && next start`) with seeded DB and all integrations on `mock` adapters. Projects: mobile (375 x 812, touch) and desktop (1440). Flows:
  1. Home two-path hero -> shop; -> wizard.
  2. Shop tabs + Desi/Exotic filter, qty stepper crossing the bulk threshold changes the price live, add to cart.
  3. Wizard: place search suggestions, acre/sq ft toggle, purpose, generate -> blurred preview -> phone OTP (mock) -> unlocked recommendations; change purpose reorders models; diagram renders with legend/counts; qty edits; inputs recalculation; add package to cart.
  4. 3D route loads, skeleton then canvas, walk control present; 2D plan toggle.
  5. Calculators (floating and inline): plant calculator autofill from a plant's spacing; compost calculator recommended pack add.
  6. Cart: package block vs additional items, inputs suggestions, truck meter fill % and vehicle change at capacity boundaries, delivery options (pickup / Bengaluru slot / outstation district), totals lines, policy note.
  7. Checkout: OTP login, address, delivery, PhonePe mock success, mock failure, mock pending then reconciliation job, order confirmation page, order in account, notifications in the mock outbox.
  8. Webhook replay (same event twice -> one state change), forged signature -> 401, amount mismatch -> not paid.
  9. Admin: staff login + TOTP, forced 2FA enrolment, product create/edit -> storefront reflects it (cache tag invalidation), stock edit -> PDP availability updates, settings secret set/replace (value never returned), role-gated pages return 404/403 for wrong roles, audit rows written.
  10. ERP sync mock: inventory pull changes stock and revalidates; order push idempotent.
  11. AI assistant: rules answer with Claude mocked; rate limit message.
  12. `instant()` checks (`@next/playwright`) for PDP, category, model page on page load and client navigation.
  13. JS-disabled run for enquiry/contact forms (progressive enhancement).
- **CTA registry + crawler:** every interactive CTA carries `data-cta="<stable-id>"`. A Playwright crawler starts at `/` and the sitemap, visits every internal URL (cap ~500), asserts status 200 (or intended 301), no console errors, no failed requests (including `/_next/static/*` chunks), every `<a href>` resolves, every `data-cta` found is listed in a coverage manifest that the flow tests mark as exercised; unexercised CTA ids fail the build. Also asserts one `<h1>`, canonical present, JSON-LD parses.
- **Lighthouse CI:** `@lhci/cli` against the local production build, 3 runs per URL, mobile preset, assertions from 1.7 (`categories:performance >= 0.9`, `largest-contentful-paint <= 2000`, `cumulative-layout-shift <= 0.05`, `total-blocking-time <= 200`, `resource-summary:script:size` budgets). Desktop run as a secondary check.
- **Minimal store proof:** `apps/minimal` (core + catalog + cart + checkout + payments, no Hasiru modules) builds and passes its own smoke E2E (browse, add, checkout with mock payment) in CI, proving the pick-and-choose contract.
- Visual check: screenshots at 375/768/1440 of key pages compared with the approved prototype (manual review gate plus pixel diff on stable sections only; carousels and marquees masked).

---

## 6. Self-hosting on the Hostinger CloudPanel VPS

### 6.1 Server layout

- CloudPanel "Node.js site" for `shop.hasiruagro.com` (CloudPanel creates the site user, nginx vhost reverse-proxying to the app port, and Let's Encrypt). Choose the Node 24 runtime. Look up the VPS host, SSH user and paths in the vault before touching it; never guess.
- **Postgres 17** is not managed by CloudPanel (it ships MySQL/MariaDB): install from the PostgreSQL PGDG apt repository (Ubuntu 24.04's default package is 16). `listen_addresses = 'localhost'`, `password_encryption = scram-sha-256`, `pg_hba.conf` local + 127.0.0.1/::1 only, UFW keeps 5432 closed. Roles: `shop_owner` (owns schemas, runs migrations, retention jobs), `shop_app` (DML only; `INSERT, SELECT` on `audit_log`). Tune for VPS RAM (shared_buffers ~25%, effective_cache_size ~60%, work_mem modest, `max_connections` 50; app pool size 10, worker pool 5).
- Directories: `/home/<site-user>/releases/<git-sha>/`, `current -> releases/<sha>`, `shared/` holding `.env` (600 perms), `media/` (originals), `next-cache/images` (symlinked into each release's `.next/cache/images`), `logs/`.

### 6.2 Processes (PM2 under the site user, or systemd units)

- `shop-web`: `next start -p <port>` (or `output: 'standalone'` server with `outputFileTracingRoot` at the monorepo root; then copy `public/` and `.next/static/` next to it). **Fork mode, 1 instance** (see 1.1 #8). `kill_timeout` 20 s so `after()` callbacks and in-flight requests drain on SIGTERM. Env `NODE_ENV=production`, `MALLOC_ARENA_MAX=2`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `GIT_SHA`.
- `shop-worker`: pg-boss worker (schedules, integrations, sharp). Separate process so image processing and feed builds never block page rendering. It revalidates the web cache via the internal endpoint.
- PM2 `pm2 save` + `pm2 startup` (systemd hook) so both come back after reboot; or native systemd units with `Restart=always`. Log rotation via `pm2-logrotate` or journald limits.
- Deploy script (local build or on-server build, decided by VPS RAM: `next build` for this size needs ~2 to 3 GB; if the VPS is small, build locally/CI for linux-x64 and rsync the standalone output): upload release -> install prod deps (`pnpm install --frozen-lockfile --prod`) -> **run migrations** -> switch `current` symlink -> `pm2 reload shop-web shop-worker` -> smoke test (curl `/api/health/ready`, a PDP, a `/_next/static` chunk, a real OTP-mock login and order on staging) -> keep last 5 releases for rollback. Use explicit quoted arrays for any rsync/exclude flags (zsh does not word-split variables).

### 6.3 nginx (CloudPanel vhost edits)

- `proxy_set_header Host $host; X-Forwarded-Host $host; X-Forwarded-Proto $scheme; X-Real-IP $remote_addr; X-Forwarded-For $proxy_add_x_forwarded_for;` (server actions and auth IPs depend on these). Forward `Accept` (AVIF).
- Streaming: `proxy_buffering off` for the app location (or rely on Next's `X-Accel-Buffering: no` header set in `next.config` headers); without it, PPR static shell + streamed holes arrive together and TTFB suffers.
- Serve `/_next/static/` directly from `current/.next/static/` with `expires 1y; add_header Cache-Control "public, immutable"`. **Check the CloudPanel template for a regex location that serves `.js/.css` from htdocs**: if present it will 404 `/_next/static/*.js` while pages return 200 (forms and cart silently dead). Remove or order it below the `/_next/static/` block, then verify a chunk URL returns 200.
- `client_max_body_size 12m` (uploads), `gzip on` + brotli if the module is available, HTTP/2 (CloudPanel default), `limit_req_zone` for `/api/` and auth paths, `location /api/internal/ { allow 127.0.0.1; deny all; }`.
- Optional later: Cloudflare in front (DNS proxy) for static asset caching and DDoS shielding; HTML stays origin-served because of cookies and tag revalidation.

### 6.4 Backups and recovery

- Nightly `pg_dump -Fc` as `shop_owner` to `shared/backups/` (14 daily + 8 weekly + 6 monthly), encrypted (`age` public key; private key in the vault, not on the server), copied offsite (rclone to Google Drive or object storage). `media/` originals synced offsite nightly (incremental). The image optimizer cache is disposable (no backup).
- Monthly restore drill into a scratch database with a row-count check; the worker writes "last backup at" so the admin health screen shows backup staleness.
- `.env` and the encryption master key backed up in the vault only (losing `APP_ENCRYPTION_KEY` makes stored API keys unrecoverable; they would need re-entry).

---

## 7. Decisions / flags for the planner

1. Storefront CSP without nonces (static shell); strict nonce CSP only on admin/account/checkout. Nonces everywhere would disable PPR (documented incompatibility).
2. One web process (fork mode) + one worker process; worker revalidates via a localhost-only internal endpoint. No PM2 cluster mode.
3. All PDPs prerendered via `generateStaticParams`; price/stock in the cached read with `{ expire: 0 }` revalidation; checkout re-reads uncached.
4. Category filtering client-side over server-rendered lists (fits < 500 SKUs).
5. Plan diagram as server-rendered SVG instead of canvas (behaviour identical; better LCP, CLS, a11y). Needs the planner's OK because client decision #4 says canvas.
6. Images: sharp normalises at upload; next/image AVIF+WebP at request with persistent cache + worker warm-up; WP images imported, not hotlinked.
7. Modules contribute routes via a `modules:sync` codegen of thin re-export stubs (committed, CI-checked); migrations generated per app from the union of enabled schemas.
8. Transactional outbox via pg-boss `send(..., { db: tx })`.
9. Customer OTP over WhatsApp authentication template (SMS adapter mock-only unless the client buys DLT SMS); email OTP alternative; staff email+password+TOTP.
10. hasiru-ops has no orders/inventory API today; adapter offers `ops-api` (spec for their team) and `supabase-rest` transports; build against `mock`.
11. Partytown not usable in App Router; marketing tags lazy + consent; conversions server-side (Meta CAPI, GA4 MP).
12. Pins: next 16.4.0, react 19.3.0, TS 5.9.3 (not 7), drizzle 0.45.3, better-auth 1.7.7, pg-boss 12.37.0, Node 24.

## Sources

- Next.js 16.4.2 docs bundled in the npm package (`next/dist/docs/01-app/...`): guides `incremental-static-regeneration-cache-components.md`, `how-revalidation-works.md`, `content-security-policy.md`, `self-hosting.md`, `data-security.md`, `lazy-loading.md`, `instant-navigation.md`, `package-bundling.md`; API `revalidateTag.md`, `updateTag.md`, `image.md`, `script.md`, config `serverActions.md`, `transpilePackages.md`, `partialPrefetching.md`, `reactCompiler.md`. Online mirror: https://nextjs.org/docs/app/guides/content-security-policy
- Better Auth: https://www.better-auth.com/docs/plugins/phone-number, https://www.better-auth.com/docs/plugins/email-otp, https://www.better-auth.com/docs/plugins/2fa, https://www.better-auth.com/docs/plugins/admin, https://www.better-auth.com/docs/concepts/rate-limit, https://www.better-auth.com/docs/adapters/drizzle
- pg-boss 12.38 type definitions (`dist/types.d.ts`, `dist/index.d.ts`) and README: https://github.com/timgit/pg-boss
- PhonePe webhooks: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
- WhatsApp webhook signatures: https://hookdeck.com/webhooks/skills/whatsapp-webhooks , https://webhookrelay.com/blog/whatsapp-cloud-api-webhooks
- CloudPanel Node.js sites: https://www.cloudpanel.io/tutorial/cloudpanel-node-js , https://support.hostinger.com/en/articles/9553137-how-to-set-up-a-node-js-application-using-cloudpanel
- npm registry (versions and publish dates, queried 2026-10-20).
- hasiru-ops source (read-only): `app/api/leads/intake/route.ts`, `docs/deployment/HOSTING-HANDOVER.md`, `package.json`.
