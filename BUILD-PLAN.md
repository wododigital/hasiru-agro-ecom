# Hasiru Agro e-commerce: BUILD PLAN

Status: executable. Written 2026-10-20 by the lead architect for a swarm of 20-30 coding agents running with no human input until a finished, tested local build.
Read order for every agent: this file (sections 0, 2, 12 and your own work package), then `docs/CONVENTIONS.md` (written in Wave 0), then only the research file your package cites. `docs/REQUIREMENTS-ADDENDUM.md` wins over this file where they conflict.

Hard rules for every agent:
- Do not open, copy or paraphrase code from any other WODO project. `hasiru-ops` is read-only reference for the sync contract only. Names in `docs/research/internal-patterns.md` section 9 must not appear anywhere.
- Site copy: no em dashes, no "phase", "v1", "v2". Use "Rs" with en-IN grouping. Shipped code never mentions AI tools.
- Money is integer paise. Dates are `timestamptz`; admin-entered dates are IST (`Asia/Kolkata`).
- Touch only the files and directories your work package owns. Need a change elsewhere? Write it as a request in your own status file `BUILD-STATUS/wp-xx.md` under "Cross-package requests" and continue with a local adapter.
- Every package ships with its tests green on a throwaway Postgres database named after the package (`pnpm db:fresh <wp-id>`). Never share a dev database between agents.
- One git worktree per work package: the orchestrator runs `git worktree add .worktrees/wp-xx -b wp/xx ecom-build` before spawning the agent; the agent works and commits only inside that worktree on its own `wp/xx` branch. The orchestrator merges `wp/*` into `ecom-build` at the end of each wave (`using-git-worktrees` skill). Nothing is pushed. `.worktrees/` is gitignored.
- Agents never add, remove or bump a dependency. Every third-party package is pinned in the root `pnpm-workspace.yaml` `catalog:` in Wave 0 and packages reference `"catalog:"`. A missing dependency is a cross-package request to the orchestrator, who adds it between waves. `pnpm-lock.yaml` is therefore only ever written by the orchestrator.
- Agents never run `drizzle-kit generate`. Packages ship `src/schema.ts` only; an agent applies its schema to its throwaway DB with `drizzle-kit push`. The orchestrator runs `drizzle-kit generate` once per wave on `ecom-build` so `apps/*/drizzle/` has one linear journal.
- Agents never write `BUILD-STATUS.md`, `apps/shop/modules.config.ts`, `src/generated/*` or `pnpm-lock.yaml`. Each agent writes `BUILD-STATUS/wp-xx.md` (status, tests, assumptions, cross-package requests); the orchestrator merges these into `BUILD-STATUS.md` and regenerates `src/generated/*` with `modules:sync` after each merge.

---

## 0. Decisions made for the autonomous run (defaults, recorded here and in BUILD-STATUS.md "Assumptions")

| # | Question | Decision | Why |
|---|---|---|---|
| A1 | Package scope | `@ecomkit/*` (workspace-private, never published) | Neutral; no overlap with any WODO or npm name in use |
| A2 | Plan diagram | Server-rendered SVG with a small client island for tap/keyboard tooltips. Auto-generated from the model pattern exactly as the canvas was | Same behaviour, better LCP/CLS/accessibility, no canvas re-draw on hydration. Client decision #4 was about the prototype. Recorded as an open point for Shyam |
| A3 | Assistant module name | `ai-assistant` | Avoids the separate WODO AI Advisor name |
| A4 | hasiru-ops transport | Build `mock` (default) and `pg` (direct Postgres connection with a read-only `ecom_sync` role that the client's team creates on their Supabase project; inventory in only), plus the `ops-api` HMAC spec for orders out (documented, outbox holds orders until it exists). There is no "read-only Supabase key": the anon key is RLS-gated with no policy for an external reader and the service-role key is full access, so a REST transport would need a change inside hasiru-ops. Wizard and enquiry leads go to the existing `POST /api/leads/intake` | Nothing in hasiru-ops is modified; nothing is lost; the only ask of the client's team is a DB role (not code) or the endpoint |
| A5 | SMS | Mock adapter only; WhatsApp authentication template is the OTP channel; email OTP as fallback | India SMS needs DLT registration |
| A6 | Build location | Build locally, deploy a release folder with rsync (dry run first) | VPS RAM unknown; `next build` needs 2 to 3 GB |
| A7 | GST display | Prices stored and shown GST-inclusive. Invoice derives tax component: tax = price x r / (100 + r). Rate editable per product and per tax class. Plants 0%, packed compost/vermicompost/biochar 5%, bio-pesticide 18% with a `needs_ca_confirmation` flag | Indian B2C norm; fixes prototype issue F1/F4 |
| A8 | Promo stacking | Order of application: bulk tier gives the unit price; automatic promos apply to that unit price; one coupon code max per order; a coupon never stacks with an automatic promo unless the promo is flagged `stackable`; best-of when not stackable | Fixes F3; simple to explain on the receipt |
| A9 | Delivery zone | Zone rule, not a km cut: Bengaluru Urban + Bengaluru Rural = local slot delivery; served districts (Karnataka, TN, Kerala, AP, Telangana, Goa) = outstation; all else = enquiry only. Admin edits the zone lists | Fixes F5 |
| A10 | Plant calculator rounding | Base count `Math.round(sqft / (L x W) x (tri ? 1.155 : 1))`, buffer `Math.ceil(n x 1.03)` | Matches SRS acceptance cases 9x9 = 538, 10x10 = 436 |
| A11 | Compost pack add | Adds to existing input quantities; never replaces | Fixes F10 |
| A12 | M/X/O default roles | Per model: size L fruit or timber = M, size M = X, size S and biomass tag = O; admin-editable per plant per model | Client has not sent roles |
| A13 | Reviews | No seeded reviews. Card shows a rating only with 3 or more approved reviews, else "New" chip. Trust band "Rated 4.8" is an admin-entered claim, hidden until entered | No fabricated records |
| A14 | COD | Off by default. Admin modes: `online_only`, `partial_advance` (default 30% online, balance on delivery), `pay_at_nursery` for pickup | CRO research |
| A15 | Kannada | Not shipped. Every storefront string lives in a `messages` object, routes are designed for a `/kn` prefix with `en-IN`/`kn-IN` hreflang. Kannada names shown on cards and PDP now | hreflang-ready without building i18n |
| A16 | Media masters | Copied from `images/` backup into `data/media/masters/` and committed (about 45 MB). Derivatives are generated, not committed | Build is reproducible from the repo alone |
| A17 | Native sapling product line | Separate products, "Common (Scientific)" names, slug suffix `-native-sapling`, `subcategory = native_medicinal` or as mapped | Client instruction |
| A18 | Legacy Woo-only products (128) | Imported as hidden drafts, `data_source = woo_legacy`, noindex, 301 created only on publish | Keeps old SEO equity available without shipping unreviewed products |
| A19 | Agarwood | Added from Woo data, flagged for client | Present in client Plant list and FAQs |
| A20 | Claude model | `claude-haiku-5-5`, effort low, streaming; switchable to `claude-sonnet-5-5` in admin. Mock in dev and tests | Cost; rules engine does the deciding |
| A21 | Pincode data | India Post pincode directory imported into `places_pincode` if the open dataset downloads; else pincode field accepts any 6 digits and district is chosen from the typeahead | Dataset availability unverified |
| A22 | Testing database | Postgres 17 local via Homebrew or Docker; template DB cloned per package and per Playwright worker | Real Postgres, no mocks for SQL |
| A23 | Wizard unlock mode | Admin setting `planting.unlock_mode = otp | soft`, default `soft`: name + phone creates the lead (flagged `phone_verified = false`) and unlocks the plan without a code; `otp` requires the WhatsApp authentication template or email OTP. Soft-unlocked visitors are not signed in | WhatsApp auth templates need business verification and an approved template; email OTP is useless for most farmers. Launch must not depend on either |
| A24 | Product feeds | Scheduled file feeds only (`/feeds/google.xml`, `/feeds/meta.csv`, token in the URL) fetched by Merchant Center and Meta catalog on their schedule. Merchant API push and `items_batch` deltas are a documented later toggle, not built | Removes two mock servers and two auth flows; scheduled fetch is what both platforms recommend for under 10k items |
| A25 | Storefront CSP | `script-src 'self' 'unsafe-inline' <vendors>` on static storefront routes; nonce CSP on admin, account, checkout, pay | Next inline `__next_f.push` hydration scripts cannot carry a nonce on prerendered pages; hashes change every build. Trade-off recorded for Shyam |
| A26 | Inventory source of truth | `inventory_level.source = manual` wins until an admin clears the override; ERP pulls write only rows with `source in (erp, seed)`; the drift report shows both numbers | Otherwise the 10 min pull silently undoes admin corrections |
| A27 | Pending payment lifetime | Reservation TTL = PhonePe attempt expiry = 15 min (setting). A sweep job every minute cancels expired `pending_payment` orders, releases stock, emits `order.payment_failed`. A late COMPLETED webhook on a cancelled order raises the critical alert and opens a refund task | Ties stock holds and payment attempts to one clock |
| A28 | Consent record | `customers_consent` is the only consent store (purposes `order_updates`, `marketing`, `analytics_identity`); marketing and analytics read it through the customers public API | One DPDP export, one revocation path |

---

## 1. Stack

| Choice | Pin | One-line rationale |
|---|---|---|
| Node | 24 LTS | pg-boss 12 needs >= 22.12; 24 is current LTS |
| pnpm | 12.9.1 | Workspaces; `save-exact=true`, `minimumReleaseAge=7d`, `allowBuilds=[sharp, esbuild]` (pnpm 11+ name; keep `onlyBuiltDependencies` too for the Mac on pnpm 10); every third-party version below lives once in `pnpm-workspace.yaml` `catalog:` and packages depend on `"catalog:"` |
| Turborepo | 2.11.7 | Task graph + cache; `turbo boundaries` blocks deep imports |
| TypeScript | 5.9.3 | Not 7.x (native compiler unvalidated with Next/Drizzle/Better Auth tooling) |
| Next.js | 16.4.0 (bump to 16.4.2 after 2026-10-29) | App Router, `cacheComponents`, `partialPrefetching`, `reactCompiler`, `proxy.ts` |
| React / React DOM | 19.3.0 | Required by Next 16 |
| Tailwind CSS | 4.3.3 + `@tailwindcss/postcss` 4.3.3 | Tokens via `@theme inline`; `@source` for packages |
| shadcn/ui | generated into `packages/ui` at Wave 0 (CLI latest at that date, components vendored) | Primitives without a runtime dependency |
| zod | 4.6.5 | Validation everywhere, settings schemas, structured output |
| Postgres | 17 | Single datastore for data, jobs, rate limits, analytics |
| drizzle-orm / drizzle-kit | 0.45.3 / 0.31.11 | Typed SQL; `push` only on agents' throwaway DBs; `generate` run once per wave by the orchestrator; migrations are what runs in prod. Partition DDL for `analytics_event` is a hand-written SQL migration (Drizzle does not manage partitions) |
| pg | 8.23.x | One driver for Drizzle and pg-boss |
| pg-boss | 12.37.0 | Jobs, schedules, singleton queues, dead-letter, `send(..., { db: tx })` outbox |
| better-auth | 1.7.7 | phoneNumber + emailOTP + twoFactor + admin plugins |
| sharp | 0.35.5 | Upload normalisation, AVIF/WebP derivatives, blur placeholders |
| three | 0.186.1 | 3D viewer, lazy chunk on its own route |
| @playwright/test / @next/playwright | 1.63.0 / same version as `next` (16.4.0) | E2E, `instant()` navigation checks. WP-00a verifies the matching `@next/playwright` release exists on the registry; if the minor does not match, `instant()` checks are dropped and the pin removed rather than mixing minors |
| vitest | 5.0.3 | Unit + server tests against real Postgres |
| @lhci/cli | 0.15.1 | Lighthouse budgets |
| @anthropic-ai/sdk | latest at least 14 days old on the Wave 2 start date | Claude narration with `output_config` and `zodOutputFormat` |
| PDF | `@react-pdf/renderer` latest at least 14 days old | GST invoices rendered server-side in the worker |
| XLSX parse | `xlsx` (SheetJS) 0.18.5 or Python `openpyxl` in the seed scripts | Seed pipeline only |

Not used: Partytown (incompatible with App Router), any CSS-in-JS runtime, Redis (Postgres does queues, rate limits and sessions), external search service (under 500 SKUs), PhonePe Node SDK (singleton-based; a 5-call typed fetch client replaces it).

Next config (apps/shop/next.config.ts): `cacheComponents: true`, `experimental.partialPrefetching: true`, `reactCompiler: true`, `deploymentId: process.env.GIT_SHA`, `images: { formats: ['image/avif','image/webp'], qualities: [50, 75], minimumCacheTTL: 2678400, remotePatterns: [] }`, `allowedDevOrigins: ['localhost','127.0.0.1']`, `output: 'standalone'`, `experimental.serverActions.bodySizeLimit: '1mb'`, `serverExternalPackages: ['sharp','pg','pg-boss']`.

---

## 2. Repo layout, module system, anti-redundancy conventions

Repo root `/Users/shyam/Desktop/Claude Dev Projects/hasiru-agro-ecom`. Existing files stay untouched (`HANDOFF.md`, prototype, `_work/`, `site/`, `docs/research/`, xlsx, images backup). New tree:

```
apps/
  shop/                      Hasiru Agro store (the product)
    app/(shop)/...           storefront routes (generated stubs + hand-written home)
    app/(admin)/admin/...    admin routes (generated stubs)
    app/api/...              route handlers (generated stubs + mocks under api/_mock in dev only)
    proxy.ts                 Next 16 request proxy (canonical host/scheme/slash/case 301s, CSP nonce for admin/account/checkout/pay, locale prefix reserve)
    instrumentation.ts       onRequestError -> core/observability
    modules.config.ts        enabled module list + `mocks: true|false` (orchestrator-owned)
    theme.css                Hasiru tokens
    messages/en.ts           all storefront strings (Kannada later: messages/kn.ts)
    src/generated/           registry.ts, drizzle schema list, mock route stubs (codegen, committed, orchestrator-owned)
    drizzle/                 migrations for this app (generated once per wave by the orchestrator)
    e2e/                     Playwright specs (one file per work package + wave 4 files)
    worker.ts                pg-boss worker entry (same code, second PM2 process)
  minimal/                   proof store: core + ui + auth + media + catalog + pricing + inventory + cart + checkout + payments + orders + customers + seo
packages/
  core/ ui/ auth/ admin-shell/ media/ catalog/ pricing/ search/ inventory/ cart/ checkout/
  payments/ orders/ customers/ discounts/ shipping/ reviews/ notifications/ flows/ analytics/
  monitoring/ marketing/ feeds/ seo/ cms/ ai-assistant/ erp-sync/ enquiries/
  planting/ planting-3d/ farm-calculators/ truck-meter/ places/ hasiru-ops-adapter/
tooling/
  tsconfig/ eslint/ playwright/ lhci/ scripts/ (db-fresh, modules-sync, seed, cta-coverage)
.worktrees/                  one git worktree per running work package (gitignored)
BUILD-STATUS/                wp-xx.md per agent (merged into BUILD-STATUS.md by the orchestrator)
data/
  seed/                      normalized JSON produced by the data pipeline (committed)
  media/masters/             product + site image masters (committed) + media-manifest.json (source, licence, credit)
  raw/                       symlinks or notes only; raw inputs stay where they are
docs/
  CONVENTIONS.md             Wave 0 output, binding for all agents (naming, template keys, permission strings, forbidden names)
  PROTOTYPE-PARITY.md        Wave 0 output: checklist of prototype behaviours (feature inventory C1 to C6 item ids), each later ticked with a Playwright step id
  hasiru-ops-sync-spec.md    Wave 2 output (ops-api contract + read-only role request for the client's team)
  ADMIN-KEYS-CHECKLIST.md    what Shyam/client must enter, per integration
  NEW-STORE-RECIPE.md        how to assemble a store from modules
  research/                  existing
BUILD-PLAN.md  BUILD-STATUS.md
```

### 2.1 Package anatomy (identical in every package)

```
packages/<mod>/
  package.json     name @ecomkit/<mod>; exports: ./manifest ./schema ./domain ./server ./ui ./admin ./routes/* ./messages
  src/manifest.ts  defineModule({...})
  src/schema.ts    Drizzle tables, every table prefixed <mod>_
  src/domain/      pure TS (types, zod, calculations). No React, no Next, no DB
  src/server/      'server-only' queries ('use cache' + tags), server actions, route-handler factories, jobs, event subscribers
  src/ui/          React components (server by default; 'use client' islands small and named *Island.tsx)
  src/admin/       admin pages + forms
  src/routes/      page modules re-exported by generated stubs (default, generateMetadata, generateStaticParams)
  src/messages.ts  default copy strings (host overrides)
  test/            vitest (domain + server against Postgres)
  README.md        responsibility, public API, tables, routes, settings, events, how to disable
```

Manifest contract (`@ecomkit/core/manifest`): `id`, `dependsOn`, `optional`, `schema`, `routes[]` (`{ path, module, segmentConfig? }`), `mockRoutes[]` (same shape, emitted only when the app config has `mocks: true`), `admin.nav[]` (`{ label, href, icon, order: number }`; `order` is an integer from the band table in CONVENTIONS: Home 0, Orders 100, Products 200, Customers 300, Marketing 400, Content 500, Analytics 600, Enquiries 700, Health 800, Settings 900; modules add within their band), `admin.pages[]`, `settings` (zod; `.meta({ secret: true })` marks encrypted fields; `.meta({ group, help, placeholder })` drive the form; `settings.actions[]` = `{ id, label, kind: 'server-action' | 'oauth-redirect' | 'test-connection', run }` rendered as buttons on that module's settings page; `settings.customPanel?` = a server component rendered under the generated form), `productFormTabs[]` (`{ id, label, order, component }` injected into the catalog product form), `permissions[]`, `jobs{}`, `schedules[]`, `emits[]`, `on{}`, `cacheTags[]`, `cartBlocks?`, `dashboardWidgets?`, `reports?`, `healthChecks?`, `sitemapSources?`, `seedHooks?`. No module ever writes files under `apps/*/app/(admin)/admin/settings/`; settings pages are rendered by admin-shell from this manifest.

### 2.2 modules:sync codegen

`pnpm modules:sync` (tooling/scripts) reads `apps/<app>/modules.config.ts`, validates dependencies, and writes: route stubs (`export { default, generateMetadata, generateStaticParams } from '@ecomkit/catalog/routes/product-page'` plus literal segment config), `src/generated/registry.ts` (nav sorted by `order`, settings registry incl. actions and custom panels, product form tabs, permissions, jobs, schedules, event subscribers, cart blocks, dashboard widgets, reports, health checks, sitemap sources), and the drizzle `schema[]` list. Mock route stubs (`app/api/_mock/**`) are written only when `modules.config.ts` has `mocks: true` (the dev and test configs); the production config has `mocks: false`, so the stubs never exist in a production build. `ENABLE_MOCKS=1` is checked inside the handlers as belt and braces. Generated files carry a header `// generated by modules:sync, do not edit`; a hand-written file without the header is never overwritten. `--check` fails CI on drift. Only the orchestrator runs it.

### 2.3 What lives in `@ecomkit/core` and may never be re-implemented elsewhere

| Area | Public API (exact names) |
|---|---|
| money | `Paise` branded int, `paise(rupees)`, `formatINR(paise, {compact?})`, `roundToRs(paise, 5)`, `splitGstInclusive(paise, ratePct)`, `gstSplit({interState})` -> CGST/SGST or IGST, `sum()`, `pct()` |
| totals | `TotalsBreakdown` type and pure `computeTotals(input)`: the single totals pipeline used by cart preview, checkout quote and order snapshot. Order of application: bulk tier gives the unit price -> automatic promo -> coupon -> packing -> transport -> GST (inclusive split per line rate, inter/intra state). Pinned definitions (prototype fix F2): `subtotal_paise = online list price x qty`, `tier_savings_paise = (list price - tier price) x qty`, compare-at is shown on cards only and never enters totals. Input is plain data (lines with list/tier unit price, qty, gst rate, weight; promo and coupon amounts from discounts; packing and transport from shipping); no DB access |
| sequence | `core_sequence(name, value)`; `nextInSequence(name, tx)` does `SELECT ... FOR UPDATE` + increment inside the caller's transaction. Used for `orderNumber()` and GST invoice numbers (`INV-YYYY-YY-NNNNN`, one sequence per financial year), which must be gapless and strictly sequential. Tested with 50 concurrent issuances producing 50 distinct consecutive values |
| db | `db` (Drizzle on one `pg` Pool), `withTx(fn)`, `upsertRequireUpdate()`, `pageAll(query, 1000)`, `createTestDb(name)`; app role vs owner role connection strings |
| env | `env` zod-validated at boot; `NEXT_PUBLIC_*` split |
| auth-context | `getViewer()` (React `cache()` per request), `requirePermission(perm)`, `requireOwner(entity.customerId)`; interface only, implemented by `@ecomkit/auth` |
| events | `defineEvent`, `emit(event, payload, { tx })` -> pg-boss job in the same transaction, `on(event, handler)` wired from registry; event catalogue types |
| jobs | `defineJob`, `enqueue`, `schedule`, standard retry (5, 30s, backoff, max 1h), dead-letter per queue, `heartbeat` row, `JobContext.log` |
| settings | `defineSettings(moduleId, zodSchema)`, `getSettings(moduleId)` (tag `settings:<mod>`), `setSettings()` (encrypts `.meta({secret})` fields with AES-256-GCM, key version, AAD `mod:key`), `maskSecret()` shows last 4 only, `experimental_taintUniqueValue` on decrypted secrets |
| audit | `audit({ actorId, action, entity, entityId, before, after })` append-only |
| rate-limit | `rateLimit(key, { limit, windowSec })` Postgres UNLOGGED atomic upsert; keys always `<routeId>:<subject>` |
| http | `verifyHmacSha256(raw, sig, secret)`, `timingSafeEqual`, `readRawBody(req)`, `safeFetch(url, init, { allowHosts, timeoutMs })` (SSRF guard: https only, public IP), `integrationCall(provider, op, fn)` logs ok / failed / skipped_not_configured into `core_integration_log` |
| observability | `captureError(err, ctx)`, fingerprinting (`name + top frame + route`), `core_error_event` + `core_error_issue`, `onRequestError` adapter, `withSpan(name, fn)` timing |
| cache-tags | constants: `catalog`, `product:<id>`, `price:<id>`, `stock:<id>`, `category:<slug>`, `cms:<slug>`, `nav`, `home`, `settings:<mod>`, `model:<slug>`, `reviews:<id>`, `promo:active`, `district:<slug>`; `revalidateFromWorker(tags)` posts to `/api/internal/revalidate` (HMAC, localhost only) |
| ids | `newId()` (UUIDv7), `orderNumber(tx)` (`HA-YYMM-NNNNN`, NNNNN from `core_sequence`), `slugify()`, slug regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, `normalisePhone()` (E.164 +91) |
| validation | `zodAction(schema, handler)` wrapper for server actions (parses, checks permission, returns `{ ok, data } | { ok:false, fieldErrors }`), `safeHtml()` sanitiser (keeps headings, tables, `rel`), `formGuards` (honeypot, time trap) |
| manifest | `defineModule`, resolver, `modules:sync` |
| testing | `createTestDb`, `seedMinimal()`, fixed clock, `mockOutbox` reader; `@ecomkit/core/testing/fakes`: `fakePricing` (list + one tier), `fakeInventory` (in stock / out / preorder), `fakeFit` (good / ok / not_recommended by district slug), `fakeReviews` (0 or 5 approved), `fakeShippingQuote`, `fakeNotificationChannel` (log adapter that records sends), each implementing the frozen contract so Wave 1 pages and Wave 2 cart tests run against real contracts before the real modules exist |

`@ecomkit/ui` owns all primitives (Button, Input, Select, Sheet/Drawer, Dialog, Tabs, Toast, Skeleton, Badge, Chip, QtyStepper with +10/+50 and type-in, Rail with desktop arrows and scroll-snap, Table, DataTable with URL-bound filters, EmptyState, Stat, Sparkline, FormField, SecretField, DateRange, Breadcrumbs, Price, Rating, ImageWithFallback, Marquee, StickyBar). No package defines a button, modal, stepper or price formatter of its own.

Design tokens (semantic only, `packages/ui/src/tokens.css`): `--color-bg, --color-surface, --color-surface-2, --color-text, --color-muted, --color-primary, --color-primary-fg, --color-accent, --color-accent-fg, --color-success, --color-warning, --color-danger, --color-border, --color-role-main, --color-role-host, --color-role-biomass, --radius-sm/md/lg, --font-display, --font-body, --shadow-card`. `apps/shop/theme.css` sets forest `#1B4332` primary, forest-light `#2D6A4F`, forest-dark `#0F2B1F`, gold `#FDC717` accent, cream `#FAF6E9` bg, cream-dark `#F0EAD6` surface-2, earth `#8B7355` muted, text `#2C2C2C`, radius 12/18/24, DM Serif Display / Outfit via `next/font` (latin subset, self-hosted). Admin root layout overrides to a neutral palette.

### 2.4 Anti-redundancy rules (checked in Wave 5 audit)

1. One implementation per concern: money, phone normalisation, slugs, pagination, rate limits, HMAC, fetch, settings, audit, errors, events, jobs, image rendering (`ui/ImageWithFallback` over `next/image`), toasts, forms.
2. Cross-module data only through the other module's `server` public API or events; never import `@ecomkit/<x>/src/**`; never query another module's tables directly (ESLint rule + `turbo boundaries` tags).
3. Pure calculations live in `domain/` once and are imported by both server and client (tier pricing, GST, truck fill, plant calculator, model scaling, dosage, promo rules, delivery pricing, climate fit).
4. Optional dependencies degrade: `optional: ['reviews']` -> `registry.has('reviews')` guard; a missing module renders nothing, never a broken slot.
5. Extension points instead of forks: `cartBlocks` (truck meter, package block), `dashboardWidgets`, `reports`, `healthChecks`, `sitemapSources`, `pdpSections`, `productCardChips`, `checkoutSections`, `productFormTabs` (pricing, inventory, media, SEO tabs injected into the catalog product form), `settings.actions` and `settings.customPanel` (Connect Gmail, Test connection, Sync now), `seedHooks`.
6. All copy from `messages.ts`; no literal storefront strings in components. Mechanism: ESLint `react/jsx-no-literals` (with `noStrings: true`, `ignoreProps: false`) on `packages/*/src/ui`, `packages/*/src/routes` and `apps/shop/app`; admin UI is exempt.
7. One admin DataTable; one settings form renderer; one list filter pattern (URL searchParams).

### 2.5 Module list (responsibility, public API, tables, routes, dependencies)

Generic modules:

| Module | Responsibility | Public server API (main) | Tables (prefix) | Storefront routes | Admin pages | dependsOn / optional |
|---|---|---|---|---|---|---|
| core | section 2.3 | as above | `core_settings, core_audit_log, core_rate_limit, core_error_event, core_error_issue, core_integration_log, core_job_heartbeat, core_sequence` | `/api/internal/revalidate`, `/api/health/live`, `/api/health/ready` | none | none |
| ui | primitives, tokens, skeletons | components | none | none | none | core |
| auth | Better Auth instance, customer phone/email OTP, staff login + TOTP, roles/permissions, account layout | `auth`, `getViewer()` impl, `requireStaff()`, `sendOtp()`, `verifyOtp()` | `auth_user, auth_session, auth_account, auth_verification, auth_two_factor, auth_passkey?, auth_role_permission` | `/account`, `/account/login`, `/api/auth/[...all]`, `/admin/login` | Staff, Roles, Sessions | core; optional notifications |
| admin-shell | Shopify-style shell, nav from registry, global search, settings renderer, audit viewer, dashboard frame | `AdminLayout`, `SettingsPage(moduleId)`, `renderDashboard()` | none | none | `/admin` dashboard, `/admin/settings/*`, `/admin/audit` | core, auth, ui |
| media | uploads, sharp pipeline, library, licence/credit fields, warm-up job | `uploadImage()`, `getImage(id)`, `imageProps(id, sizes)`, `mediaSrc()` | `media_asset, media_derivative, media_usage` | `/media/[...path]` static via nginx or route handler | Media library | core |
| catalog | products, variants, collections, subcategories, tags (`kind = trait | use | filter`, the only extensible facet mechanism; no EAV), FAQs, PDP + collection routes, product JSON-LD, admin CRUD with the product form that hosts `productFormTabs`, XLSX/CSV import/export, data gaps view, availability states | `getProduct(slug)`, `listProducts(filter)`, `getCollection(slug)`, `productCard(id)`, `upsertProduct()`, `importSeed()`, `facetSource()` (rows for the search facet index) | `catalog_product, catalog_variant, catalog_collection, catalog_product_collection, catalog_faq, catalog_product_media, catalog_tag, catalog_product_tag, catalog_related` | `/plants`, `/plants/[collection]`, `/plants/[collection]/[sub]`, `/plant/[slug]`, `/inputs`, `/input/[slug]`, `/plants/[trait]` curated (`/plants/for/[model]` belongs to planting) | Products, Inputs, Collections, Tags, FAQs, Data gaps, Import/Export | core, media; optional pricing, inventory, reviews, search, places |
| pricing | price, compare-at, bulk tiers (n tiers), offline price, tier hints; price changes recorded by `core.audit` (no separate history table); Pricing tab via `productFormTabs` | `getPrice(productId, qty)`, `tierFor(productId, qty)`, `priceSnapshot()` | `pricing_price, pricing_tier` | none | Pricing tab on product (injected) | core, catalog |
| search | trgm `ILIKE` over name, Kannada name, scientific name and `search_aliases` (synonyms live in `catalog_product.search_aliases`), static facet index JSON built from `catalog.facetSource()`, client-side filtering and suggest over that index, zero-result log, filter UI | `search(q)`, `suggest(q)`, `buildFacetIndex()`, `FacetSidebar`, `FilterSheet`, `AppliedChips` | `search_query_log` | `/search`, `/api/search/suggest`, `/facets.json` (generated static) | Search insights | core, catalog; optional places |
| inventory | stock per location, reservations tied to payment attempt expiry, movements ledger, availability derivation, low-stock threshold per variant, manual override wins over ERP (A26), back-in-stock subscriptions | `getStock(variantId)`, `reserve(lines, ttl)`, `commit(reservationId)`, `release()`, `adjust()`, `setFromErp()`, `clearOverride()` | `inventory_level, inventory_reservation, inventory_movement, inventory_subscription` | `/api/notify-me` | Inventory; Inventory tab on product (injected) | core, catalog |
| cart | DB cart keyed by httpOnly cookie, lines (product / package) with `weightKg`, merge on login, totals preview via `core.computeTotals`, cart blocks | `getCart()`, `addLine()`, `setQty()`, `removeLine()`, `replacePackage()`, `cartTotals()` | `cart_cart, cart_line` | `/cart`, cart drawer | none (abandoned checkouts live in flows) | core, catalog, pricing; optional inventory, discounts, shipping |
| checkout | one-page checkout, address, delivery choice, quote via `core.computeTotals`, contact autosave for abandoned-cart messaging, idempotent place-order, policy ack | `placeOrder(idemKey)`, `quote(cart, address, method)`, `saveContact()` | `checkout_session` | `/checkout`, `/checkout/[orderId]/pay`, `/order/[token]` | none | core, cart, auth, customers; optional payments, shipping, discounts, inventory |
| payments | provider adapters: phonepe (v2 OAuth), mock, cod_partial, bank_transfer; attempts; webhooks; reconciliation; refunds | `createPayment()`, `handleWebhook()`, `fetchStatus()`, `refund()`, `applyPaymentState()` | `payments_attempt, payments_webhook_event, payments_refund` | `/api/webhooks/phonepe`, `/pay/return`, `/api/_mock/phonepe/*` (dev) | Payments list, Settings: Payments | core, checkout, orders |
| orders | order + line snapshots, status machine, timeline, gapless numbering via `core_sequence`, GST invoice PDF, customer order pages, admin orders, dispatch planner, manual orders, replacement orders (zero-value linked order for damage claims, `source = replacement`, `parent_order_id`) | `getOrder()`, `listOrders()`, `transition()`, `invoicePdf()`, `ordersForSlot()`, `createReplacement()` | `orders_order, orders_line, orders_event, orders_invoice, orders_fulfilment` | `/account/orders`, `/account/orders/[id]`, `/account/orders/[id]/invoice.pdf` | Orders, Order detail, Dispatch planner, Manual order | core, customers; optional payments, shipping, inventory, notifications |
| customers | profiles, addresses, the single consent store (A28), four computed segments (first order, bulk buyer, by district, wizard lead not converted; SQL views, no stored definitions), leads (the one lead entity: wizard, notify-me, enquiry, chat all create `customers_lead`, and only `lead.created` pushes to ops), GSTIN, land profiles | `getCustomer()`, `upsertLead()`, `recordConsent()`, `hasConsent(subject, purpose)`, `segments()` | `customers_profile, customers_address, customers_consent, customers_lead, customers_land_profile` | `/account/addresses`, `/account/profile`, `/account/land` | Customers, Leads, Segments, Consent | core, auth |
| discounts | automatic promos, coupon codes, eligibility, usage limits, atomic redemptions, stacking rules | `applicablePromos(cart)`, `applyCoupon(code)`, `redeem(orderId)` | `discounts_rule, discounts_code, discounts_redemption` | none | Discounts | core, catalog |
| shipping | methods: pickup, local slot (weekly), outstation (zone + distance x vehicle rate), vehicles + capacity selection, packing fee rules, slot calendar, delivery date promise | `quoteMethods(cart, address)`, `pickVehicle(weightKg)`, `nextSlots(n)`, `packingFee(lines)` | `shipping_method, shipping_zone, shipping_vehicle, shipping_slot, shipping_slot_booking, shipping_packing_rule, shipping_distance_override` | `/api/delivery-check` | Settings: Delivery (zones, vehicles, rates, slots, packing) | core; optional places |
| reviews | reviews with photos, verified buyer, moderation, aggregate cache | `aggregate(productId)`, `listApproved()`, `submitReview()` | `reviews_review, reviews_media, reviews_aggregate` | `/plant/[slug]#reviews`, `/account/reviews` | Reviews | core, catalog, orders, media |
| notifications | channel adapters: gmail (OAuth), whatsapp (Cloud + Marketing Messages routing), sms_mock, log; template registry per event/channel; send log; status webhooks; quiet hours; opt-out; dev outbox | `send(templateKey, to, vars, { channel })`, `renderTemplate()`, `OutboxReader` | `notifications_template, notifications_message, notifications_webhook_event, notifications_optout, notifications_whatsapp_template` | `/api/webhooks/whatsapp`, `/api/auth/gmail/callback`, `/admin/dev/outbox` (dev), `/api/_mock/meta/*`, `/api/_mock/gmail/*` | Settings: Email, WhatsApp; Templates; Message log | core |
| flows | fixed automation flows configured per flow (enable, delays, channel, template, quiet hours, cap, optional single-use discount code), runs, abandoned cart, order updates, slot reminder, review request, back-in-stock, wizard lead follow-up. Steps are data (`flows_step`) seeded per flow; there is no visual builder and no discount escalation | `startFlow()`, `advance()`, flow runner job | `flows_flow, flows_step, flows_run, flows_run_step` | `/r/[restoreToken]` (cart restore) | Marketing > Automations (one settings form per flow + run list), Abandoned checkouts (`/admin/abandoned-checkouts`) | core, notifications, customers (consent); optional cart, orders, discounts, shipping |
| analytics | beacon script, ingest, sessions, events, rollups, funnels, paths, attention, filter insights, web vitals, bots, attribution | `track()` client, `ingest()`, `report(name, range)` | `analytics_visitor, analytics_session, analytics_event (monthly partitions), analytics_daily_rollup, analytics_web_vital` | `/api/beacon-ingest` (not /track or /collect), `/b.js` | Analytics (tabs) | core |
| monitoring | health endpoints, system health screen, integration cards, job queue + retry, error issues, alert routing + dedup, uptime/SSL/disk checks (results in `monitoring_check_result`), 404 log view | `registerHealthCheck()`, `alert()`, `ackIssue()` | `monitoring_alert, monitoring_alert_rule, monitoring_check_result` | `/api/health/*` (core), `/api/monitoring/vitals` | Health, Alerts, Jobs, Errors, 404s | core; optional notifications |
| marketing | consent banner (writes `customers_consent` through the customers API), tag manager (vendors feed CSP), GA4 (gtag + MP), Meta Pixel + CAPI, Google Ads conversion, UTM/click-id capture on the order, server-side conversions, test-order exclusion | `conversion(event, order)`, `TagScripts`, `ConsentBanner`, `cspSources()` | `marketing_tag, marketing_conversion_event, marketing_attribution` | `/api/consent`, `/api/_mock/ga4/*`, `/api/_mock/meta-capi/*` | Marketing > Pixels & tags | core, customers; optional orders |
| feeds | Google Merchant Center XML feed and Meta catalog CSV feed as token-protected scheduled files (A24), feed validation report, change hash per item | `buildGoogleFeed()`, `buildMetaFeed()`, `validateFeed()` | `feeds_item_state, feeds_run` | `/feeds/google.xml`, `/feeds/meta.csv` (token-protected) | Marketing > Product feeds | core, catalog, pricing, inventory, media |
| seo | metadata builders, JSON-LD builders (Organization, WebSite, LocalBusiness, Product/Offer/AggregateRating, BreadcrumbList, FAQPage, CollectionPage, Article, VideoObject), sitemap index, robots, llms.txt, 404 log, redirects, canonical rules, OG image route | `buildMetadata()`, `jsonLd.*`, `canonical()`, `addRedirect()`, `logNotFound()` | `seo_redirect, seo_not_found, seo_page_meta` | `/sitemap.xml`, `/sitemap/[name].xml`, `/robots.txt`, `/llms.txt`, `/og/[...slug]`, `not-found.tsx` hook | SEO > Redirects, 404s, Page meta | core |
| cms | pages, blocks (hero, rail, FAQ, video, trust band, testimonial, counters, gallery, rich text, CTA), menus, policy pages (seeded `draft` + `noindex`, excluded from sitemap until published), blog/guides, testimonials, videos (the one video table; optional `product_id` / `model_slug` links a video to a PDP or model page), team | `getPage(slug)`, `getMenu(key)`, `renderBlocks()`, `videosFor({ productId | modelSlug })` | `cms_page, cms_block, cms_menu, cms_menu_item, cms_testimonial, cms_video, cms_post, cms_portfolio_item, cms_client, cms_counter, cms_trust_claim` | `/[...slug]` catch-all for pages, `/policies/[slug]`, `/guides`, `/guides/[slug]`, `/about`, `/contact`, `/videos` | Content > Pages, Menus, Policies, Testimonials, Videos, Guides, Portfolio, Clients, Trust band | core, media |
| ai-assistant | rules-first assistant: intent parser, catalogue facts, recommendation narration, chat UI with product chips, streaming, caching, rate limit, transcript log | `answer(question, ctx)`, `narrate(recommendation)`, `AssistantDrawer` | `ai_conversation, ai_message, ai_narration_cache` | `/api/assistant/stream`, `/api/_mock/claude/*` | Settings: Assistant; Transcripts | core, catalog; optional planting, places, pricing |
| erp-sync | adapter interface, outbox for orders, inventory pull, SKU mapping, sync log, dead-letter alerts | `pushOrder()`, `pullInventory()`, `mapSku()` | `erp_outbox, erp_item_map, erp_sync_run` | none | Settings: ERP sync; Sync log; Mapping | core, orders, inventory |
| enquiries | generic enquiry pipeline (forms with uploads, statuses, assignee, remarks, SLA staleness), feeds lead intake | `createEnquiry()`, `transition()` | `enquiries_enquiry, enquiries_attachment, enquiries_note` | `/api/enquiry` (works without JS) | Enquiries | core, media; optional notifications, customers |

Hasiru-specific modules:

| Module | Responsibility | Tables | Routes | Depends |
|---|---|---|---|---|
| planting | models (Commercial, Food Forest, Miyawaki, Boundary), per-model plant membership, spacing, M/X/O roles, 36x36 patterns, scaling (area models by `sqft / 1296` blocks; Boundary by `boundary_ft / spacing_ft`), SVG plan, wizard (3 steps), blurred preview + unlock (`otp` or `soft` per A23; creates lead, signs in only on OTP), recommendations page, package-to-cart, companions ("grows well with"), model videos (from cms), saved land profiles reuse, curated "plants for model" listing | `planting_model, planting_model_plant, planting_pattern, planting_plan, planting_plan_line` | `/plan`, `/plan/results/[planId]`, `/models/[model]`, `/plants/for/[model]`, `/api/plan/generate`, `/api/plan/unlock` | core, catalog, pricing, cart, customers, auth, places, farm-calculators; optional ai-assistant, inventory, cms |
| planting-3d | 3D / 2D viewer of a `PlanLayout`: lazy three chunk, procedural trees, GLB mango, basin rings, person, labels, tap identify, walk mode, sun slider, 2D canopy plan, reduced-motion default | none | `/models/[model]/3d` | core, planting (`PlanLayout` contract) |
| farm-calculators | plant calculator (modal + inline), compost/input calculator, dosage rules by role and age, seed calculation, pack rounding | `farmcalc_dosage_rule` | `/calculators/plants`, `/calculators/compost` (also modal) | core, catalog, pricing, cart |
| truck-meter | cart block + checkout summary block over shipping vehicle capacity: fill % from the `weightKg` on cart-block lines, "add about K kg", vehicle change | none | none | core, cart, shipping |
| places | 644 districts (canonical names, aliases, state, geo HQ lat/lng, distance to nursery, soil tags, climate ranges, native crops), pincode directory, typeahead, district pages data, climate-fit rules. Nursery location, hours and GSTIN live in General settings, not a table | `places_state, places_district, places_district_alias, places_pincode` | `/api/places/suggest`, `/grow-in/[district]` | core; optional catalog |
| hasiru-ops-adapter | erp-sync adapter: `mock`, `pg` (read-only Postgres role, inventory in), `ops-api` (orders out), lead intake client | none (uses erp_* tables) | none | erp-sync, customers (leads) |

Hasiru-only storefront pages (apps/shop, hand-written, use cms blocks): home, farm development (`/farm-development`, `/farm-development/[service]`), `/our-work`, `/our-clients`, `/build-farm-with-us`, `/why-choose-us`.

---

## 3. Data model (Drizzle, Postgres 17)

Conventions: `id uuid pk default uuidv7()` (core helper), `created_at/updated_at timestamptz default now()`, soft delete only where stated (`deleted_at`), money columns `integer` paise named `*_paise`, enums as Postgres enums prefixed by module, every FK indexed, every list table has `(created_at desc, id desc)` tiebreak index, JSONB only for provenance, attribute bags and event payloads. All tables below are owned by the module in their prefix.

### core
- `core_settings(module text, key text, value jsonb, is_secret bool, key_version int, updated_by uuid, updated_at)` pk `(module, key)`.
- `core_audit_log(id, actor_id uuid null, actor_type enum staff|customer|system, action text, entity text, entity_id text, before jsonb, after jsonb, ip_hash text, created_at)` idx `(entity, entity_id)`, `(actor_id, created_at)`; app role has INSERT+SELECT only.
- `core_rate_limit(key text pk, count int, window_start timestamptz)` UNLOGGED.
- `core_error_issue(id, fingerprint text unique, title, level enum error|warning, first_seen, last_seen, count int, status enum open|resolved|ignored, release text)`.
- `core_error_event(id bigserial, issue_id fk, message, stack, route, method, url, request_id, viewer_role, release, created_at)` idx `(issue_id, created_at desc)`; pruned after 30 days.
- `core_integration_log(id bigserial, provider text, op text, status enum ok|failed|skipped_not_configured, duration_ms int, http_status int null, error text null, ref text null, created_at)` idx `(provider, created_at desc)`.
- `core_job_heartbeat(worker text pk, last_seen timestamptz, queues jsonb)`.
- `core_sequence(name text pk, value bigint not null default 0)`; rows `order`, `invoice:<FY>`; read with `SELECT ... FOR UPDATE` inside the caller's transaction. Emitted events are not mirrored in a table: pg-boss's archive plus `core_audit_log` are the trail.

### auth (Better Auth generated + extras)
- `auth_user(id, name, email unique, email_verified, phone_number unique, phone_number_verified, role text, banned bool, ban_reason, two_factor_enabled, image, created_at, updated_at)`.
- `auth_session(id, user_id fk, token unique, expires_at, ip_address, user_agent, impersonated_by, created_at)` idx `(user_id)`.
- `auth_account(id, user_id fk, provider_id, account_id, password hash, access/refresh tokens, expires)`.
- `auth_verification(id, identifier, value, expires_at)` idx `(identifier)`.
- `auth_two_factor(id, user_id fk, secret, backup_codes)`.
- `auth_role_permission(role text, permission text)` pk both; roles `owner, manager, catalog_editor, fulfilment, support, customer`.

### media
- `media_asset(id, kind enum image|video|document, storage_key text unique, original_name, mime, width, height, bytes, sha256 unique, blur_data_url text, alt text, caption, source enum upload|woo_import|site_import|stock|wikimedia, licence text null, author text null, source_url text null, credit_required bool, status enum ready|processing|failed, created_by, created_at)`.
- `media_derivative(asset_id fk, format enum avif|webp|jpeg, width int, storage_key, bytes)` pk `(asset_id, format, width)`.
- `media_usage(asset_id fk, entity text, entity_id text)` pk all three.

### catalog
- `catalog_collection(id, slug unique, name, name_kn, kind enum plant|input, parent_id null, position int, description_html, seo_title, seo_description, hero_media_id null, is_indexable bool default true, intro_html)`.
- `catalog_product(id, sku text unique, legacy_sku text null, legacy_woo_id int null, erp_item_id text null, kind enum plant|input, slug unique, name text, name_kn text null, scientific_name text null, base_name, variety, collection_id fk, subcategory text, size_class enum L|M|S, canopy enum, propagation enum, nitrogen_fixer bool, drought_tolerance enum low|moderate|high, water_need enum, exposure enum, temp_min, temp_opt, temp_max numeric, humidity_min/opt/max numeric, rainfall_min, rainfall_max int, soil_tags text[], mature_height_min_ft, mature_height_max_ft numeric, bearing_years_min, bearing_years_max numeric, timber_rotation_years numeric, yield_text text, harvest_season text, spacing_ft jsonb {food_forest:[L,W]|null, miyawaki, commercial, boundary:number|null}, compost_kg jsonb {at_planting, y0_2, y3_6, y7_plus}, input_type text null (compost|seeds|biochar|liquid|bio_pesticide), pack_size text null, dosage_rules jsonb null, short_description, description_html, care_html, status enum draft|active|archived, availability_override enum null (available|out_of_stock|temporarily_unavailable|coming_soon|hidden), is_featured, is_best_seller, weight_kg numeric, packing_fee_paise int, hsn text, gst_rate numeric, tax_class text, bag_size, height_at_dispatch_ft, seo_title, seo_description, focus_keyword, noindex bool, og_media_id null, data_source jsonb (per group), needs_review bool, review_notes text[], image_needed bool, search_aliases text[], published_at, created_at, updated_at, deleted_at)`. Indexes: `(collection_id, status)`, `(status, is_best_seller)`, GIN on `search_aliases`, `(kind, status)`.
- `catalog_variant(id, product_id fk, label text, is_default bool, sku_suffix, height_ft, bag_size, weight_kg, position)` unique `(product_id, label)`; exactly one default per product (partial unique index).
- `catalog_product_collection(product_id, collection_id)` for secondary memberships.
- `catalog_tag(id, slug unique, name, name_kn, kind enum trait|use|filter, show_on_card bool, position)`; `catalog_product_tag(product_id, tag_id)`. Fixed columns plus tags cover every facet in cro-ux 2.1; there is no attribute EAV.
- `catalog_faq(id, product_id fk null (null = general), question, answer_html, status enum answered|ai_draft|client_only|published, position, source)`.
- `catalog_product_media(product_id, media_id, role enum main|gallery|fruit|plant|as_delivered|video_poster, position)` pk `(product_id, media_id)`.
- `catalog_related(product_id, related_id, relation enum companion|alternative|input_for)`. Product videos live in `cms_video` (optional `product_id`).

### pricing
- `pricing_price(variant_id pk fk, price_paise int, compare_at_paise int null, offline_price_paise int null, cost_paise int null, currency char(3) default 'INR', updated_at)`.
- `pricing_tier(id, variant_id fk, min_qty int, unit_price_paise int)` unique `(variant_id, min_qty)`; the first tier is `min_qty = bulk_min_qty`. Price changes are recorded by `core.audit` with before/after; no history table.

### search
- No document table. `/search` runs trgm `ILIKE` over `catalog_product.name`, `name_kn`, `scientific_name` and `search_aliases` (trgm GIN indexes on those columns are created by the search module's migration). Under 500 SKUs, suggest and filtering run client-side over `/facets.json`.
- `search_query_log(id bigserial, q text, results int, filters jsonb, session_id, created_at)` idx `(results, created_at)`.

### inventory
- `inventory_level(variant_id pk, on_hand int, reserved int, ready_in_days int null, low_stock_threshold int null, source enum manual|erp|seed, erp_updated_at, updated_at)` check `on_hand >= 0`, `reserved >= 0`. `setFromErp()` updates only rows with `source in (erp, seed)`; a manual override sets `source = manual` and holds until `clearOverride()`.
- `inventory_reservation(id, variant_id, qty, cart_id null, order_id null, expires_at, status enum held|committed|released)` idx `(status, expires_at)`.
- `inventory_movement(id bigserial, variant_id, delta int, reason enum order|cancel|adjust|erp_sync|seed, ref text, actor_id, created_at)`.
- `inventory_subscription(id, variant_id, phone text null, email text null, consent_id, notified_at null)` unique `(variant_id, coalesce(phone,''), coalesce(email,''))`.

### cart
- `cart_cart(id, cookie_token_hash text unique, customer_id null, status enum active|converted|abandoned|merged, currency, coupon_code null, delivery_method_snapshot jsonb null, last_activity_at, converted_order_id null, land_sqft numeric null, plan_id null, created_at, updated_at)` idx `(customer_id)`, `(status, last_activity_at)`.
- `cart_line(id, cart_id fk, variant_id fk, qty int check > 0, kind enum product|package, origin jsonb null {planId, model, role, recommendedQty}, added_at)` unique `(cart_id, variant_id, kind)`.

### customers
- `customers_profile(user_id pk fk, display_name, phone_e164, phone_hash, email, email_hash, customer_type enum farmer|business|individual, gstin text null, legal_name null, notes, tags text[], first_order_at, last_order_at, orders_count, lifetime_paise, source, created_at)` idx `(phone_hash)`, `(email_hash)`.
- `customers_address(id, user_id fk, label, name, phone, line1, line2, landmark, village_town, pincode, district_id fk places null, district_text, state, lat, lng, is_default, created_at)`.
- `customers_consent(id, user_id null, phone_hash, email_hash, purpose enum order_updates|marketing|analytics_identity, status enum granted|revoked, text_shown text, source, ip_hash, user_agent, created_at)` idx `(phone_hash, purpose)`.
- `customers_lead(id, user_id null, name, phone_e164, phone_hash, phone_verified bool default false, source enum wizard|notify_me|enquiry|chat|exit_intent, context jsonb (land, district, purpose, planId, enquiryId), status enum new|contacted|converted|closed, assigned_to null, erp_pushed_at null, created_at)` idx `(status, created_at)`. The only lead entity; `lead.created` is the only event that pushes to ops.
- Segments are four SQL views (`customers_v_segment_first_order`, `_bulk_buyer`, `_by_district`, `_wizard_lead_no_order`), no stored definitions table.
- `customers_consent` is the only consent store in the system (A28); marketing and analytics call `hasConsent()`.
- `customers_land_profile(id, user_id fk, label, sqft numeric, district_id, purpose enum, plan_id null, created_at)`.

### discounts
- `discounts_rule(id, name, kind enum automatic|code, status, starts_at, ends_at, value_type enum percent|fixed, value int, applies_to enum order|collection|products|tags, target_ids text[], min_qty, min_subtotal_paise, customer_eligibility enum all|segment|first_order, segment_id null, usage_limit_total int null, usage_limit_per_customer int null, stackable bool default false, priority int, description_public text)` idx `(status, starts_at, ends_at)`.
- `discounts_code(id, rule_id fk, code text unique (upper), single_use_phone_hash text null, expires_at null)`.
- `discounts_redemption(id, rule_id, code_id null, order_id, customer_id null, phone_hash, amount_paise, created_at)` unique `(order_id, rule_id)`.

### shipping
- `shipping_zone(id, slug unique, name, kind enum local|outstation|enquiry, district_ids uuid[] (or state codes), position)`.
- `shipping_method(id, zone_id fk, kind enum pickup|local_slot|outstation_distance|flat, name, is_active, rules jsonb)`.
- `shipping_vehicle(id, name, capacity_kg int, local_flat_paise int, per_km_paise int, position, is_active)`.
- `shipping_slot(id, weekday int, cutoff_hours int, capacity_kg int null, is_active)`; `shipping_slot_booking(id, slot_date date, order_id, weight_kg)` idx `(slot_date)`.
- `shipping_packing_rule(id, scope enum order|product|size_class|qty_band, match jsonb, fee_paise int, position)`.
- `shipping_distance_override(district_id pk, km numeric, note)`.

### checkout
- `checkout_session(id, cart_id fk unique, customer_id null, contact jsonb, address_id null, address_draft jsonb, method_id, slot_date null, quote jsonb (frozen totals), idempotency_key text unique, order_id null, step, expires_at, created_at, updated_at)`.

### orders
- `orders_order(id, number text unique, customer_id null, guest_token_hash text null, status enum pending_payment|paid|confirmed|packed|dispatched|delivered|cancelled|refunded|partially_refunded, payment_status enum unpaid|partially_paid|paid|refunded|failed, contact jsonb, shipping_address jsonb, billing jsonb (gstin, legal_name), delivery jsonb {method, slotDate, vehicle, km, zone}, subtotal_paise, tier_savings_paise, promo_paise, coupon_paise, packing_paise, shipping_paise, tax_paise, total_paise, paid_paise, balance_due_paise, weight_kg, is_test bool, source enum web|manual|wizard|replacement, parent_order_id uuid null fk orders_order, plan_id null, attribution jsonb, notes, erp_order_ref null, placed_at, created_at, updated_at)` idx `(status, placed_at desc)`, `(customer_id, placed_at desc)`, `(payment_status)`, `(is_test)`, `(parent_order_id)`. `number` comes from `core_sequence`. A replacement order has `total_paise = 0`, `payment_status = paid`, starts at `confirmed` and flows through packed/dispatched/delivered like any order.
- `orders_line(id, order_id fk, variant_id, product_snapshot jsonb (name, sku, hsn, gst_rate, size_class, weight), qty, unit_price_paise, tier_applied bool, line_discount_paise, line_tax_paise, line_total_paise, kind, origin jsonb)` idx `(order_id)`, `(variant_id)`.
- `orders_event(id bigserial, order_id, type, data jsonb, actor_id null, created_at)`.
- `orders_invoice(id, order_id fk, number text unique (`INV-YYYY-YY-NNNNN`), kind enum b2c|b2b, place_of_supply text, is_inter_state bool, cgst_paise, sgst_paise, igst_paise, pdf_media_id, issued_at)`.
- `orders_fulfilment(id, order_id, status, dispatched_at, delivered_at, vehicle, driver_note, tracking_text)`.

### payments
- `payments_attempt(id, order_id fk, attempt_no int, provider enum phonepe|mock|cod_partial|bank_transfer, merchant_order_id text unique (`<number>-<attempt>`), provider_order_id, amount_paise, state enum pending|completed|failed|expired, redirect_url, raw_create jsonb, raw_status jsonb, expires_at, created_at, updated_at)` unique `(order_id, attempt_no)`.
- `payments_webhook_event(id, provider, event text, dedupe_key text unique, payload jsonb, signature_ok bool, processed_at null, error null, received_at)`.
- `payments_refund(id, order_id, attempt_id, merchant_refund_id unique, amount_paise, state, reason, raw jsonb, created_at)`.

### reviews
- `reviews_review(id, product_id, customer_id null, order_id null, rating int 1..5, title, body, district_text, is_verified_buyer bool, status enum pending|approved|rejected, admin_reply, created_at)` idx `(product_id, status)`.
- `reviews_media(review_id, media_id)`.
- `reviews_aggregate(product_id pk, count int, avg numeric)` refreshed on approval; never denormalised onto `catalog_product`.

### notifications
- `notifications_template(key text, channel enum email|whatsapp|sms, locale text default 'en', subject, body, meta_template_name text null, category enum utility|marketing|authentication, variables text[], version int, updated_by)` pk `(key, channel, locale)`.
- `notifications_whatsapp_template(name pk, category, language, status enum draft|pending|approved|rejected, components jsonb, meta_id, last_synced_at)`.
- `notifications_message(id, channel, template_key, to_hash, to_masked, provider_message_id, status enum queued|sent|delivered|read|failed|skipped, error_code, error, pricing jsonb, order_id null, flow_run_id null, is_test, queued_at, sent_at, updated_at)` idx `(status, queued_at)`, `(provider_message_id)`.
- `notifications_webhook_event(id, provider, dedupe_key unique (wamid+status), payload jsonb, processed_at)`.
- `notifications_optout(phone_hash pk, channel, reason, created_at)`.

### flows
- `flows_flow(id, key text unique, name, trigger enum cart_abandoned|order_placed|order_paid|order_dispatched|order_delivered|slot_reminder|back_in_stock|wizard_lead_no_order|review_request, status enum active|paused, settings jsonb (delays, channel, template keys, quiet hours, max per 7 days, discount_rule_id null), version)`. Each flow's settings are a zod schema rendered as one form; steps are seeded from the settings, not edited visually.
- `flows_step(id, flow_id, position, kind enum send_email|send_whatsapp|wait|stop_if, config jsonb)`.
- `flows_run(id, flow_id, subject_type, subject_id, phone_hash, started_at, status enum running|completed|stopped|failed, stop_reason, next_step_at)` unique `(flow_id, subject_type, subject_id)` where running; idx `(status, next_step_at)`.
- `flows_run_step(id, run_id, step_id, executed_at, result jsonb)`.

### analytics
- `analytics_visitor(id, cookie_hash unique, first_seen, last_seen, customer_id null, is_bot bool)`.
- `analytics_session(id, visitor_id, started_at, last_event_at, landing_path, referrer_host, utm jsonb, device enum, is_bot, is_test, country)` idx `(started_at)`.
- `analytics_event(id bigserial, client_event_id uuid, session_id, visitor_id, name text, path, props jsonb, client_ts, server_ts)` `PARTITION BY RANGE (server_ts)`, monthly partitions `analytics_event_YYYY_MM`; unique `(client_event_id, server_ts)` (partition key must be in the unique index); idx `(session_id, server_ts)`, `(name, server_ts)`; raw retained 90 days. Drizzle declares the parent table only; the partition DDL (parent + current and next two months + a `DEFAULT` partition) is a hand-written SQL migration in `packages/analytics/sql/`, and the job `analytics.create-partition` runs on the 25th of every month to create month+2 and drop partitions older than 90 days.
- `analytics_daily_rollup(day date, metric text, dimension text, value numeric)` pk `(day, metric, dimension)`.
- `analytics_web_vital(id bigserial, path, metric enum LCP|INP|CLS|TTFB, value numeric, device, created_at)`.

### monitoring
- `monitoring_alert_rule(id, key unique, severity enum critical|high|low, channels text[], dedupe_minutes int, repeat_minutes int null, is_active)`.
- `monitoring_alert(id, rule_key, fingerprint, title, body, severity, status enum open|acked|resolved, first_at, last_at, count, acked_by, acked_at, notified_at, next_repeat_at)` unique `(rule_key, fingerprint)` where status != resolved.
- `monitoring_check_result(id bigserial, check text, ok bool, latency_ms, detail jsonb, created_at)` idx `(check, created_at desc)`.

### marketing
- `marketing_tag(id, vendor enum ga4|meta_pixel|google_ads|custom, placement enum head|body_end, scope enum all|paths, paths text[], snippet text, csp_sources text[], requires_consent bool, is_active)`.
- Consent is not stored here; the banner writes `customers_consent` (purpose `analytics_identity` or `marketing`, keyed by visitor cookie hash until a phone or email is known).
- `marketing_conversion_event(id, event_id uuid unique, name, order_id null, destination enum ga4|meta, status, response jsonb, created_at)`.
- `marketing_attribution(order_id pk, first_touch jsonb, last_touch jsonb, gclid, fbclid, fbp, fbc)`.

### feeds
- `feeds_item_state(destination enum google|meta, variant_id, hash text, last_pushed_at, last_error)` pk `(destination, variant_id)`.
- `feeds_run(id, destination, kind enum full|delta, items int, errors int, started_at, finished_at, log jsonb)`.

### seo
- `seo_redirect(id, from_path unique, to_path, status_code int default 301, source enum manual|slug_change|legacy_import|not_found_fix, hits int, last_hit_at)`.
- `seo_not_found(path pk, hits int, first_at, last_at, referrers text[], fixed_redirect_id null)`.
- `seo_page_meta(path pk, title, description, noindex bool, canonical, og_media_id)` (manual overrides for hand-written pages).

### cms
- `cms_page(id, slug unique, title, title_kn, status, seo_title, seo_description, noindex, template enum default|landing|policy|service, published_at)`; `cms_block(id, page_id, position, type, data jsonb)`; `cms_menu(key pk)`, `cms_menu_item(id, menu_key, parent_id, label, href, position, is_external)`; `cms_testimonial(id, name, location, photo_media_id, body, rating, project_type, status, position)`; `cms_video(id, title, url, kind enum youtube|whatsapp|file, poster_media_id, category, product_id uuid null, model_slug text null, position, status)` idx `(product_id)`, `(model_slug)`; `cms_post(id, slug unique, title, excerpt, body_html, cover_media_id, author, published_at, status, seo_*)`; `cms_portfolio_item(id, slug, title, location, land_size_acres, scope, before_media_id, after_media_id, gallery media[], body_html, status)`; `cms_client(id, name, project_type, location, acreage, work_done, logo_media_id, status)`; `cms_counter(key pk, label, value int, verified bool)`; `cms_trust_claim(key pk, label, value, show bool)`.

### ai-assistant
- `ai_conversation(id, visitor_id null, customer_id null, mode, started_at)`; `ai_message(id, conversation_id, role, content, product_ids uuid[], facts jsonb, model, tokens_in, tokens_out, latency_ms, created_at)`; `ai_narration_cache(hash pk, model, output jsonb, created_at, hits)`.

### erp-sync
- `erp_outbox(id, kind enum order|lead, ref_id, payload jsonb, status enum pending|sent|failed|dead, attempts int, last_error, next_attempt_at, sent_at)` idx `(status, next_attempt_at)`.
- `erp_item_map(variant_id pk, erp_item_id text unique, erp_name, mapped_by enum auto|manual, confidence numeric)`.
- `erp_sync_run(id, direction enum inventory_in|orders_out, transport, started_at, finished_at, items, changed, errors, log jsonb)`.

### enquiries
- `enquiries_enquiry(id, kind enum farm_development|bulk_quote|general|contact, name, phone_e164, phone_hash, email, customer_type, acres numeric, location_text, district_id null, timeline, requirement text, status enum new|contacted|site_assessment|design|quotation|project|closed_won|closed_lost, assigned_to, source_path, utm jsonb, lead_id null, ip_hash, created_at, updated_at)` idx `(status, created_at desc)`.
- `enquiries_attachment(id, enquiry_id, media_id)`; `enquiries_note(id, enquiry_id, author_id, body, created_at)`.

### planting / farm-calculators / places
- `planting_model(id, slug unique (commercial|food_forest|miyawaki|boundary), name, name_kn, description_html, block_ft int default 36, col_spacing_ft numeric, row_spacing_ft numeric, pattern jsonb (rows: string[] cycling, or {random: {M,X,O}} for Miyawaki, or {line: true} for boundary), legend jsonb {M,X,O labels}, video_id null, position, is_active)`.
- `planting_model_plant(model_id, product_id, role enum M|X|O, spacing_ft jsonb [L,W] or number, position, is_default_pick bool)` pk `(model_id, product_id)`.
- `planting_plan(id, visitor_id, customer_id null, lead_id null, district_id, sqft numeric, boundary_ft numeric null, purpose model slug, inputs_included bool, unlock_mode enum otp|soft null, unlocked_at null, selections jsonb {model: {productId: qty}}, climate_fit jsonb, created_at)`. Area models scale by `sqft / 1296` blocks; Boundary scales by `boundary_ft / spacing_ft` (when `boundary_ft` is null the wizard estimates `4 x sqrt(sqft)` and labels it "estimated").
- `farmcalc_dosage_rule(id, input_product_id fk, role enum M|X|O|any, age_band enum at_planting|y0_2|y3_6|y7_plus, kg_per_plant numeric, pack_kg numeric)`.
- `places_state(code pk, name, gst_code char(2))`; `places_district(id, state_code fk, slug unique, name, aliases text[], hq_lat, hq_lng, distance_km_from_nursery numeric, soil_text, soil_tags text[], temp_min, temp_max, humidity_min, humidity_max, rainfall_mm, native_crops text[], page_enabled bool, page_intro_html)`; `places_pincode(pincode char(6), office_name, district_id, state_code)` idx `(pincode)`. Nursery name, address, lat/lng, phone, hours, GSTIN and Google place id are General settings (`core_settings`), not a table.

---

## 4. Storefront IA, SEO spec, performance

### 4.1 Routes

| Route | Template | Index | Render |
|---|---|---|---|
| `/` | Home: two-path hero, best-seller rail, inline plant calculator, inputs rail, compost calculator, "Why choose us" tiles, DIY video rail, testimonials, trust marquee, farm-dev teaser, lower links | yes | static (`'use cache'`, tags home, catalog, cms:home) |
| `/plants` | All plants listing with facets; tabs Timber / Fruiting / Other with counts | yes | static list + client facets |
| `/plants/timber-trees`, `/plants/fruiting-trees`, `/plants/other-plants` | Collection | yes | static |
| `/plants/fruiting-trees/desi`, `/exotic`, `/forest-fruit`; `/plants/other-plants/spices`, `/plantation`, `/native-medicinal`, `/biomass-support` | Sub-collection | yes | static |
| `/plants/for/food-forest`, `/miyawaki`, `/commercial-farming`, `/boundary` | Curated by model (route owned by `planting`, reads `planting_model_plant`; stub dir `(shop)/plants/for/` is WP-24's in Wave 2) | yes | static |
| `/plants/drought-tolerant`, `/plants/nitrogen-fixing`, `/plants/native-saplings` | Curated trait | yes | static |
| `/grow-in/[district]` | District page (6+ fitting plants, admin enabled); sibling of `/plants` so `places` owns its own route dir | yes (Karnataka first) | static per enabled district |
| `/plants?...` any query (facets, sort, page>1) | same list | `noindex,follow`, canonical to clean path | client state in URL, fixed param order `f,sort,page` |
| `/plant/[slug]` | PDP | yes (unless draft/noindex) | prerendered via generateStaticParams; price and stock in cached read with tags |
| `/inputs`, `/input/[slug]` | Inputs list, input PDP | yes | static |
| `/search?q=` | Search results | noindex | dynamic |
| `/plan` | Wizard (3 steps) | yes (landing copy) | static shell, client island |
| `/plan/results/[planId]` | Recommendations (blurred until unlocked) | noindex | dynamic |
| `/models/[model]` | Model explainer page (what it is, pattern, sample plants, video, CTA to wizard) | yes | static |
| `/models/[model]/3d` | 3D / 2D viewer | noindex | client-heavy route, lazy three |
| `/calculators/plants`, `/calculators/compost` | Standalone calculators (same islands as modals) | yes | static |
| `/cart`, `/checkout`, `/checkout/[orderId]/pay`, `/pay/return`, `/order/[token]` | Cart, checkout, pay, return, guest confirmation | noindex | dynamic |
| `/account/*` | Login, profile, orders, order detail + invoice, addresses, land profiles, reviews | noindex | dynamic |
| `/farm-development`, `/farm-development/[service]` (site-assessment, design, water-management, earthwork, planting) | Services | yes | static (cms blocks) |
| `/our-work`, `/our-work/[slug]`, `/our-clients`, `/why-choose-us`, `/about`, `/contact`, `/videos`, `/guides`, `/guides/[slug]` | Content | yes | static |
| `/build-farm-with-us` | Enquiry form (works without JS) | yes | static + POST route |
| `/policies/[slug]` (delivery, damage-and-replacement, cancellation-and-refund, privacy, terms) | Policy | yes | static |
| `/sitemap.xml`, `/sitemap/[products|collections|pages|districts|guides].xml`, `/robots.txt`, `/llms.txt`, `/og/[...slug]` | SEO | - | dynamic routes, never static files in `public/` |
| `/r/[token]` | Cart restore from flow message | noindex | dynamic |

Reserved for Kannada: `/kn/<same paths>`; `proxy.ts` already parses the prefix and sets a `locale` header; metadata emits `alternates.languages` only when `kn` is enabled.

### 4.2 SEO spec per template

- Canonical host enforcement (implemented, not only declared): `apps/shop/proxy.ts` issues a 301 to the canonical URL when the request host is not the canonical host (`www.` or bare, whichever settings pin), the scheme is `http`, the path has a trailing slash (except `/`), or the path contains uppercase characters; nginx does the host and scheme hop too, the proxy is the guarantee. Tested in WP-33 (four cases, each exactly one 301 to the canonical URL, no chains).
- Global: `metadataBase` = canonical host from settings; one `<h1>`; `alternates.canonical` always absolute, pinned host, no trailing slash, query stripped except on paginated listing (`?page=n` keeps canonical to itself with `rel=prev/next` links in body); OG + Twitter cards; per-product OG image from `/og/plant/[slug]` (name, Kannada name, price, photo); `robots` from the dynamic route only with `Sitemap:` line and explicit `Allow` for GPTBot, ClaudeBot, PerplexityBot, Google-Extended; `Disallow: /cart /checkout /account /admin /api /search /plan/results /r/`.
- JSON-LD escaped (`</script` -> `<\/script`), one `@graph` per page: `Organization` (logo, sameAs, contactPoint) + `WebSite` (SearchAction) on every page; `LocalBusiness` (GardenStore) with address, geo, openingHours on home, contact, about; `BreadcrumbList` on every non-home page.
- PDP: `Product` (name, image[], description, sku, brand Hasiru Agro, additionalProperty for size class, bearing, spacing), `Offer` (INR, price, priceValidUntil, availability from availability state, `hasMerchantReturnPolicy` returns not permitted, `shippingDetails` zones), second `UnitPriceSpecification` with `eligibleQuantity.minValue = bulk_min_qty`, `AggregateRating` only when 3+ approved reviews, `Review` list (max 5), `FAQPage` only when answers are rendered on the page, `VideoObject` when a video exists.
- Collection and curated pages: `CollectionPage` + `ItemList` of first 24 products; intro copy block rendered server-side; faceted query URLs `noindex,follow` + canonical to the clean path; sort never indexed; empty curated pages 404.
- District pages: `CollectionPage` + `Place`; indexed only when `page_enabled` and 6+ fitting plants; intro generated from district data (soil, rainfall, temperature, native crops) and editable in admin.
- Guides: `Article`; videos page: `VideoObject` list; policies: `WebPage`.
- Sitemaps: index + per-type files, only URLs returning 200 and indexable, `lastmod` from `updated_at`, hreflang entries when kn is enabled.
- Redirects: legacy Woo URLs (`/product/<old-slug>`, category URLs) imported into `seo_redirect` for published products; automatic 301 on slug change; 404 log with one-click redirect in admin.
- `llms.txt`: site summary, collections, policies, how to buy in bulk, contact.

### 4.3 Performance budgets and techniques

Targets (mobile, Lighthouse CI, 3 runs, median): performance >= 90, SEO = 100, accessibility >= 95; LCP <= 2.0 s, INP <= 150 ms, CLS <= 0.05, TTFB <= 0.3 s on static routes, TBT <= 200 ms. JS gzip budgets: home <= 170 KB, PDP <= 170 KB, collection <= 180 KB, checkout <= 220 KB, 3D route <= 450 KB, admin excluded from budgets but lazy by section.

| Heavy feature | Technique |
|---|---|
| Product lists and facets | Server renders first 24 cards; `/facets.json` (bitset index, 20 to 40 KB gz) fetched on first facet interaction; filtering in a `startTransition`; price slider debounced 150 ms; counts recomputed client-side; results page 2+ via `?page=` server-rendered for crawlers and `fetch` for humans |
| Images | sharp masters WebP; `next/image` AVIF/WebP at 160/320/480/640/800 for products and 480 to 1920 for site images; blur placeholder; fixed width/height; single `preload` on the LCP image per page; worker warms sizes after upload; persistent `.next/cache/images` symlinked in `shared/` on the VPS; `MALLOC_ARENA_MAX=2` |
| Fonts | `next/font` self-hosted, latin only, `display: swap`, two families |
| Rails / carousels | CSS scroll-snap, no JS carousel library; desktop arrows as a tiny island |
| Wizard | client island loads with the `/plan` route (small); place suggestions from `/api/places/suggest` (edge-cached 1 h); plan generation server action |
| Plan diagram | server SVG; tooltip island (2 KB); legend text alternative for screen readers |
| 3D | separate route; `three` in its own chunk; preloaded on hover/focus/touchstart of the "View in 3D" button; step preloader skeleton; 2D plan default when `prefers-reduced-motion` or `navigator.deviceMemory < 4` |
| Cart | server-rendered page; drawer island; totals from server action; optimistic qty |
| Checkout | one page, three sections; no third-party scripts until pay click; PhonePe redirect |
| Assistant | drawer island loaded on first open; streaming via `ReadableStream`; markdown-lite renderer (no library) |
| Marketing tags | injected after consent, `afterInteractive`, from admin vendor list; CSP built from the same list; conversions server-side |
| Analytics beacon | `/b.js` < 3 KB, `sendBeacon` batches every 15 s / on `visibilitychange` / `pagehide` |
| Caching | `cacheComponents`; all catalog reads `'use cache'` with `cacheLife('days')` and tags; admin edits `updateTag`; worker revalidates via internal endpoint; checkout and stock-critical reads uncached |
| Admin | route-level code splitting by section; DataTable virtualised over 200 rows; charts via a lightweight SVG `Sparkline`/`BarChart` in ui, no chart library |

---

## 5. Feature inventory with acceptance criteria (grouped by user flow)

Every feature below carries a stable `data-cta` id convention `"<context>: <action> (<placement>)"` on its CTAs, is covered by a Vitest unit (domain logic) or a Playwright step (UI), and is listed in the CTA coverage manifest.

### 5.0 Shared shell

| Feature | Acceptance criteria |
|---|---|
| Header | Logo, nav (Plants, Help me choose, Farm development, Inputs, Guides), Ask AI button, cart count = total quantity, account icon. Mobile under 760 px: hamburger opens a drawer with the same links, focus trapped, Esc closes. |
| Sticky mobile cart bar | Appears when cart has lines and route is not cart/checkout; shows qty + total + "View cart". |
| Toast | One toast region, ARIA live, dismiss on action. |
| QtyStepper | Add becomes stepper; type-in field; +10 / +50 chips when qty >= 10; jumps by 10 once qty >= 100; never below 0; Enter commits. |
| Product card | Shows image (fallback leaf), max 2 badges in priority Out of stock > Bulk unlocked > Fits your district > Bestseller > New > Save Rs X; collection line with Desi/Exotic; name + Kannada name; chips: size class, climate fit (green/amber only when district known), yield or bearing time; effective price with struck compare-at; bulk line "Rs X each from N plants" turning accent when cart qty for that product crosses N; rating stars when 3+ reviews else "New"; stock status with real count under threshold; Notify me when out of stock; Add/stepper. Card text is the same slots on every surface. |
| Price formatting | `formatINR` en-IN grouping, "Rs 2,499"; never floats. |
| Footer | Menus from cms, policies, nursery address + hours (LocalBusiness), trust badges, WhatsApp link, consent settings link. |
| Consent banner | Accept / Reject; identity-linked analytics and pixels only after accept; record stored; preference reopenable from footer. |
| 404 page | Logged, suggests search and collections, 200-sitemap excluded. |
| Error boundaries | `error.tsx` on every segment that runs a server action; `global-error.tsx` reports to observability. |

### 5.1 Flow (a): buyers who know what they want

| Feature | Acceptance criteria |
|---|---|
| Home two-path hero | "I know what I want" -> `/plants`; "Help me choose" -> `/plan`. Copy from messages; counts ("190+ plants") computed from active products. |
| Best-seller rail | Active, in stock, `is_best_seller` first, then featured, 12 max; desktop arrows; scroll-snap. |
| Inputs rail | Active inputs with type chip and availability. |
| Collection tabs | Timber / Fruiting / Other with live counts; sub-filters Desi/Exotic/Forest fruit and Spices/Plantation/Native/Biomass as path segments. A visible "Help me choose" CTA (`data-cta="plants: help me choose (toolbar)"`) sits in the listing toolbar on `/plants` and every collection page and links to `/plan` (covers SRS D9 without a popup). |
| Facets | Set from cro-ux 2.1: Fits my district (district picker), model, in stock (default on), price (slider + inputs + presets), size class, rainfall bucket, temperature tolerance, drought tolerant, propagation, nitrogen fixer, exposure, bearing time, yield. Facet auto-hidden when < 2 values or > 60% unknown. OR within, AND across; counts recomputed; zero-count options disabled not hidden. Desktop sticky sidebar; mobile sticky Filter / Sort bar opening a sheet with live "Show N plants". Applied chips + Clear all. Quick chip rail. Back restores filters and scroll. |
| Zero results | Chips to drop each filter with resulting counts; closest matches; WhatsApp agronomist CTA; wizard CTA; combination logged. |
| Search | Typeahead from `/api/search/suggest` after 2 chars (English, Kannada, scientific, aliases); results page; zero-result queries logged. |
| In-stock toggle | Default on; URL param; counts update. |
| Bulk pricing live | Card and PDP price drops when qty crosses the product's tier; same product across package and extra lines is summed for the tier; cart shows tier savings line. |
| PDP | Gallery (main, as-delivered, fruit, video slot); names (EN, KN, scientific); bulk tier table (n tiers) with nudge "Add 8 more to unlock Rs 320, save Rs 6,450"; qty + land mini-calculator (acres -> qty from spacing); Add to cart, Buy now, Ask on WhatsApp (prefilled); district fit panel (rules decide, Claude narrates when enabled); delivery check by pincode showing dates ("Saturday 24 Oct" for local, "5 to 7 days" window as dates for outstation), pickup option; trust row; visible no-return policy; key facts table with units; "Grows well with" from model roles; inputs dosage mini-calculator; care guide; FAQ (published only); reviews with photos, district, verified badge; sticky mobile bar; recently viewed (localStorage). Image credit shown when licence requires. |
| Climate fit on cards and PDP | Rules: temperature range within +-2 C of district range, rainfall band overlap, soft humidity, native crop boost. Output good / ok_with_irrigation / not_recommended. Cards never show red (chip hidden for not_recommended); PDP shows all three with explanation. District from selected or saved location or address. |
| Yield and bearing on cards | Chip shows "Fruits in 3 to 4 yrs" or yield when data exists; hidden when unknown. |
| Notify me | Phone or email + consent; subscription row; back-in-stock flow sends once. |
| Reviews | Submit from account after delivery (verified) or from PDP (unverified, moderated); photos via media; aggregate refresh on approval; JSON-LD updated. No Q&A. |
| Damage replacement | Policy is no cancellation, damage replaced. Admin action "Create replacement" on a delivered order picks lines and quantities and creates a zero-value linked order (`source = replacement`, `parent_order_id`) that enters dispatch planning and sends the normal order messages; the parent timeline shows the link. Refunds remain for payment anomalies only. |
| Cart | Recommended package zone (pale surface-2) above Additional items; per-line bulk nudge "bulk at 100 (37 more)"; Journey-1 "Recommended inputs for your plants" when plants present and no inputs; qty edits optimistic; remove; coupon field; truck meter block; delivery method chooser with dates and costs; summary lines: subtotal (list), tier savings, automatic promo (named), coupon, packing, transport, GST (inputs only, shown as included), total; "No cancellation or return" note; "Proceed to pay Rs X". "Rs X away" bar for small local orders toward the next vehicle break-even is a copy of the truck meter, not a second component. |
| Checkout | One page: Contact (phone first with reason, guest default, optional OTP to save, marketing consent checkbox with the exact consent text version), Address (pincode first autofills district/state when the directory exists, landmark, optional farm pin), Delivery and payment (methods with dates; PhonePe; COD mode per settings; UPI preselected on mobile). Contact fields autosave to `checkout_session.contact` on blur (server action, debounced) before place-order so an abandoned checkout has someone to message; the consent checkbox writes `customers_consent` only on place-order or on explicit tick. Pay button shows amount. Field-level errors. Totals from `core.computeTotals` recomputed server-side; stock reserved on place-order with TTL = payment attempt expiry (A27); failures keep the form filled. |
| Payment | PhonePe v2 redirect; attempt expiry 15 min (setting) shared with the stock reservation; return page calls status API server-side; webhook verified + stored + job-processed; poll schedule; sweep job every minute cancels expired `pending_payment` orders, releases stock, emits `order.payment_failed`; a COMPLETED after FAILED or after cancellation raises the critical alert, does not auto-flip, and creates a refund task in admin; amount compared to order total; refunds from admin. Mock provider with Success / Fail / Pending / Abandon in dev. |
| Order confirmation | `/order/[token]` for guests, account page for customers; shows lines, delivery date, pickup instructions, invoice link when paid; WhatsApp + email confirmation sent from `order.paid`. |
| Account | OTP login (WhatsApp auth template or email), orders list with status timeline, invoice PDF download, addresses, saved land profiles, reviews, consent preferences, logout. All queries scoped to the viewer. |
| GST invoice | B2C or B2B (GSTIN, legal name); CGST/SGST when `place_of_supply` state = Karnataka else IGST; HSN per line; inclusive tax derived; PDF generated in worker, stored in media (private, signed link). |
| Exit intent | Desktop only, once per session, offers to send the cart on WhatsApp (consent) rather than a discount; never hijacks back on mobile. |

### 5.2 Flow (b): discoverers (wizard, models, 3D, assistant, companions)

| Feature | Acceptance criteria |
|---|---|
| Wizard step 1 location | Suggestions after 2 chars, max 6, show state and km from nursery, keyboard navigation, "Use my location" (reverse-geocode to nearest district HQ by distance, no external API), district stored. |
| Wizard step 2 land | Acre / sq ft toggle with live conversion (1 acre = 43,560 sq ft), min 0.1 acre, boundary length in ft (optional; stored as `boundary_ft`; when empty the Boundary model uses `4 x sqrt(sqft)` and labels the count "estimated from a square plot"). |
| Wizard step 3 purpose | Cards Commercial / Food Forest / Miyawaki / Boundary with one-line descriptions; 4-dot progress; "Generate my plan". |
| Generation | Server action creates `planting_plan` with all models computed (not only the chosen one): per model the plant set from `planting_model_plant` filtered by district climate fit (good or ok); area models: role quantities `round(blockCount x sqft / 1296)` split evenly within role; Boundary: `round(boundary_ft / spacing_ft)` along a single line (test fixture: 1 acre square, 835 ft boundary, 10 ft spacing -> 84 plants); inputs computed. Location changes the plant set (fixes F11). |
| Blurred preview + unlock | Results render blurred with the summary chips visible; form name + phone (+91). Mode `soft` (default, A23): submit creates the lead (`phone_verified = false`), unlocks the plan for this visitor cookie, no sign-in. Mode `otp`: OTP via notifications (mock shows code in dev outbox); 6 digits, 300 s, 3 attempts, per-phone and per-IP limits; verify -> lead created verified, user signed in, plan unlocked. Both modes emit `lead.created` (pushed to hasiru-ops intake when configured); generic error copy. |
| Recommendations page | "Purpose" dropdown reorders and opens that model; summary chips (district, land, fit); each model as expand/collapse section with: SVG plan diagram, legend with per-block counts (edges half-open), plant sections Timber / Fruiting / Other as horizontal cards with role pill, recommended qty (editable, "recommended N" when edited), price with tier state, "View more varieties" (adds alternates of the same role) and "Details" (opens PDP in sheet); inputs block with Include toggle and per-input qty following plant edits until hand-edited; model video; "Add package to cart" (replaces the previous package, requires unlock, Miyawaki lines weight 0.8); "Browse all plants" link; "Build it for me" CTA to the enquiry form prefilled. |
| Plan diagram | SVG 36 x 36 ft block, 6 ft grid, axis labels, M/X/O dots coloured by role tokens, species cycling within role, Miyawaki seeded random mix (seed = planId) so the drawing is stable; tooltip on hover, tap and focus; `<title>`/`<desc>` plus a visually hidden text list of plants per role for screen readers. Commercial = 18 per block with the client's pattern `M O X O X O M` (6 ft along row, 12 ft between rows; row spacing editable in admin). |
| 3D / 2D | Route `/models/[model]/3d?plan=`; lazy three chunk; step preloader; Commercial 13x3, Food Forest 7x7, Miyawaki 7x7 at 0.45x; procedural trees; basin rings toggle; 5.5 ft person; spacing labels; tap to identify; walk mode (thumbstick + WASD); sun slider; 2D plan toggle with canopy circles (mango 5.2 ft, guava 3.4, timber 3.3, shrub 2.3, banana 3.5); respects reduced motion; mango GLB from `_work/assets/mango.glb` copied to media. |
| Plant calculator | Modal (floating button on Home and Shop) and inline on Home and `/calculators/plants`; pick plant autofills spacing; area acre / sq ft converting on toggle; L x W default 18 x 18; square / triangular; 3% buffer toggle; result uses A10 rounding; shows price with tier; "Add N to cart". Test: 9x9 -> 538, 10x10 -> 436 per acre. |
| Compost calculator | Mode "Plants in my cart" or "Enter my own" by size class; vermicompost 2L + 1M + 0.5S kg, biochar 1L + 0.5M + 0.25S kg (rules from `farmcalc_dosage_rule`, client compost kg at planting used when present); packs ceil(/25) and ceil(/10); "Add recommended pack" adds (A11). |
| Recommended inputs | vermicompost ceil(sum q x dose[role][0] / 25), biochar ceil(sum q x dose[role][1] / 10), neem cake ceil(0.25 x plants / 25), Jeevamrutha max(1, ceil(acres x 4)), green-manure seed kg = acres x rate from settings (D39). |
| Companions ("Grows well with") | From model role membership, spacing compatibility, nitrogen fixer flag and canopy; PDP section and assistant facts; Claude narrates only. |
| Ask AI | Drawer with mode pill (Shop / Plan / Farm), 6 suggested chips, streaming answers with markdown-lite, `[[productId]]` tokens become "+ cart" chips with a card rail; rules engine resolves intents (bulk, delivery, category, desi/exotic, under Rs N, shade, N-year bearing, district fit, companions) to facts; Claude only narrates facts with a validator dropping unknown product ids, counts and prices; no em dashes; last 8 turns; per-session rate limit; template fallback on error/refusal; transcripts logged; model and effort in admin. |
| Saved land profiles | After unlock, logged-in users see "Save this land" (label); account lists profiles; "Regenerate" creates a new plan with current catalogue. |
| WhatsApp share | Share button on results and videos builds a `wa.me` text with a short link to the plan (unlocked plans only). |

### 5.3 Flow (c): farm services enquiries

| Feature | Acceptance criteria |
|---|---|
| Farm development page | "From Barren Land to Living Farm": 5 services (Site Assessment, Design, Water and Rainwater Management, Land Preparation and Earthwork, Planting) with the real site images; process steps; incubation band; CTA to Build Farm With Us. Service sub-pages from cms blocks. |
| Our Work | Portfolio grid with location, land size, scope, before/after images, detail page. |
| Our Clients | List with name, project type, location, acreage, work done. |
| Results counters | Acres, farms, clients, projects, plants planted; shown only when `verified` in admin. |
| Why Choose Us | Home tiles + page: Plant Authenticity, Domain Expertise, Proven Results, Delivery to Farm. |
| About, Contact | About (chemical free, certified permaculture designer, vision, mission, team); Contact with map link, hours, WhatsApp, phone, enquiry form. |
| Build Farm With Us | Form: name, mobile, Business/Farmer, acres (min 1), location (district typeahead + free text), timeline, requirement, optional photos and documents (private storage), notes; honeypot + time trap + per-route rate limit; works without JS (POST + redirect); creates enquiry, notifies admin (email + WhatsApp when configured), confirmation to customer; UTM captured. |
| Bridges | "Build it for me" on wizard results and on carts over a configurable total; large-order quote request on PDP bulk table ("Need 500+?"). |
| Admin pipeline | Statuses new -> contacted -> site_assessment -> design -> quotation -> project -> closed_won/lost; assignee; remarks; attachments; staleness tile on dashboard ("last enquiry N days ago", amber after 7). |

### 5.4 Standard e-com and CRO additions (cross-flow)

Discount codes with eligibility and limits; automatic promos with date windows and public description; coupon never stacks unless flagged; back-in-stock; abandoned cart flow (1 h reminder without discount, 24 h objections, 72 h capped single-use incentive tied to phone; quiet hours 9 to 11 and 18:30 to 21:00 IST; stop on purchase, reply or unsubscribe; max 3 messages, one sequence per 7 days). Abandoned-cart messages are MARKETING category under Meta rules: `cart.abandoned` is actionable only when the cart has a customer or a `checkout_session.contact` with recorded marketing consent, and WhatsApp sends go through the Marketing Messages path; a cart without consent produces a run with `stop_reason = no_consent` and zero messages (Vitest). Order update messages (confirmed, packed, dispatched with slot or ETA, delivered); slot reminder the day before the Saturday slot (utility, scheduled job emits `slot.reminder` per order in the slot); review request 7 days after delivery; wizard lead follow-up at 48 h when no order; policy pages (published ones) with footer links and checkout link; recently viewed; Buy now; delivery check; trust rows; low-stock counts; Notify me; test-order flag excluded from analytics and conversions. Not built: wishlist or price-drop alerts, product Q&A, UTM builder.

---

## 6. Admin IA (Shopify-like)

Shell: left sidebar from registry sorted by `admin.nav[].order` (band table in CONVENTIONS), top bar with global search (orders, products, customers, enquiries), notification bell (alerts), staff menu. Every list: URL-bound search + filters + saved views, CSV export, bulk actions, row tiebreak on id. Human labels only. Every tile links to its filtered list.

| Section | Pages | Contents |
|---|---|---|
| Home | `/admin` | Staleness tiles (last order, last payment, last ops sync, last enquiry; amber after thresholds); 4 default KPIs over 30 days with sparklines and change vs previous (net sales, orders, AOV, conversion), plus sessions and returning rate; task cards: orders to confirm, pending payments, Saturday truck fill %, low stock, abandoned checkouts, failed messages, health status, data gaps count; Live view (sessions last 30 min). KPIs per staff member in local preference. |
| Orders | Orders, Order detail, Dispatch planner, Abandoned checkouts (`/admin/abandoned-checkouts`, owned by flows), Manual order | Saved views (Unfulfilled, Pending payment, Today's slot, Outstation, Replacements); timeline; status transitions with guards; refund; Create replacement (zero-value linked order); invoice PDF; resend messages; notes; test flag; dispatch planner groups orders by slot date and vehicle with weight totals; manual order creates order + payment link. No Drafts view (no draft status exists). |
| Products | Plants, Inputs, Collections, Tags, Inventory, Media, Reviews, FAQs, Data gaps, Import/Export | Product form (owned by catalog) tabs: Details, Plant data (climate, spacing per model, roles, compost), Content (descriptions, care, FAQs), Variants, Provenance (data_source, needs_review, notes), plus injected `productFormTabs`: Pricing (pricing: price, compare-at, tiers, offline), Inventory (inventory: mirror from ops, override with "manual wins" badge and Clear override, low-stock threshold, availability state), Media (media: library pick, roles, alt, credit), SEO (seo: preview, counters). Availability states: Available, Out of stock, Temporarily unavailable, Coming soon, Hidden. Data gaps view lists `needs_review`, `image_needed`, missing fields, client questions. Import accepts the client xlsx layout and Woo CSV; export matches. Videos are managed under Content and linked to a product from there. |
| Customers | Customers, Leads, Segments, Consent | Profile with orders, land profiles, consents; leads with status, source and verified flag; four computed segments (first order, bulk buyer, by district, wizard lead not converted) as filtered customer lists with CSV; consent export for DPDP. |
| Marketing | Automations, Pixels and tags, Product feeds, Discounts | Automations: one card per fixed flow (abandoned cart, order updates, slot reminder, review request, back-in-stock, wizard lead follow-up) opening a settings form (enable, delays, channel per step, template key, quiet hours, cap per 7 days, optional discount code rule for the 72 h step), run list with stop reasons, test run to a staff number. No visual builder. Pixels: vendor cards with ids, consent requirement, CSP preview. Feeds: last run, items, errors, validation report, copyable token-protected feed URLs for Merchant Center and Meta scheduled fetch; push mode shown as "scheduled fetch" (API push is a documented later toggle). |
| Content | Pages, Blocks, Menus, Policies, Testimonials, Videos, Guides, Portfolio, Clients, Counters, Trust band, District pages | Block editor (ordered blocks with typed forms); policy pages; district page enable list with fit counts and intro editor. |
| Analytics | Overview, Funnel, Sales, Products, Traffic, Customers, Journeys, Search and filters, Wizard, Attention, Bots, Vitals | Date range + comparison + CSV; funnel product list -> product -> cart -> checkout -> payment started -> paid split by device and source; search zero results; filter combinations; wizard funnel; bulk-tier share; inventory drift vs ops; GST by HSN; journeys as event timelines per session with rage/dead clicks; attention vs add-to-cart. |
| Enquiries | Enquiries, Enquiry detail | Pipeline board + list; assignee; notes; attachments; convert to lead/customer. |
| Health | Overview, Alerts, Errors, Jobs, Integrations, 404s and redirects, Message log | Section 7. |
| Settings | General (store, canonical host, nursery name/address/geo/hours/GSTIN/place id, GST, invoice numbering), Payments (provider, mode mock/sandbox/live, COD mode, attempt expiry, keys), Delivery (zones, methods, vehicles, rates, slots, cutoffs, packing rules, distance overrides), Taxes (classes, HSN), Email (Gmail connect, sender, test send), WhatsApp (ids, token, templates, test send, kill switch for OTP), Planting (unlock mode otp/soft), Assistant (model, effort, limits, mode), Analytics and consent, Pixels, Feeds (Google, Meta ids, feed tokens), ERP sync (transport, keys, interval, mapping), Staff and roles (invite, 2FA status, sessions), Audit log, Developer alerts (channels, dev WhatsApp number, fallback webhook) | Every settings page is rendered by admin-shell from the module manifest: generated form from the zod schema, `settings.actions[]` buttons (Connect Gmail OAuth redirect, Test connection, Test send, Sync now, Resolve mapping) and an optional `settings.customPanel` (delivery zone editor, ERP mapping table, template list). No module owns a route under `admin/settings/`. Each integration card: mode, masked secrets (last 4), Test connection, last status, copyable webhook/redirect URLs, setup steps. |

Roles and permissions: owner (all), manager (all but staff/secrets), catalog_editor (products, content, media, reviews), fulfilment (orders, dispatch, inventory read), support (customers, enquiries, orders read, messages), customer (storefront only; `/admin` returns 404). Staff must enrol TOTP on first login; re-login after 12 h; every page and action checks its own permission.

---

## 7. Monitoring and developer alerting

| Detected | How | Severity |
|---|---|---|
| Server error (new fingerprint) | `onRequestError` + error boundaries -> `core_error_issue` upsert; new issue -> alert; spike (count > 20 in 10 min) -> alert | high (critical when route is checkout, pay, webhook) |
| Client JS error, rage click, dead click | beacon events `js_error`, `rage_click`, `dead_click`; rollup; alert when js_error fingerprint new on checkout | low |
| Integration failure settled | `integrationCall` failed after job retries exhausted (dead-letter) | high |
| Payment anomalies | webhook signature failure (>= 3 in 10 min), paid-but-unconfirmed older than 15 min, COMPLETED after FAILED, amount mismatch, missing webhook 10 min after attempt | critical |
| Messaging failures | WhatsApp/email failed rate > 20% in 1 h, Gmail refresh failure, template rejected, OTP kill switch on while login enabled | high |
| Jobs | dead-letter arrivals, backlog > 500, heartbeat older than 2 min, schedule missed by > 2 periods | high (heartbeat critical) |
| ERP sync | last successful inventory pull older than 3 x interval; order outbox items pending > 1 h | high |
| Uptime | external checker (UptimeRobot-style free monitor configured by Shyam) hitting `/api/health/ready`; internal self-check of `/api/health/live` from the worker | critical |
| Readiness | `/api/health/ready` checks DB round-trip, heartbeat age, last inventory pull age, disk free > 10%, image cache writable | critical when fails |
| SSL and domain | daily job: cert expiry < 14 days, domain expiry via RDAP < 30 days, DNS A/MX/SPF/DMARC present | high |
| Database and backups | nightly backup job success row, size growth, bloat (pg_stat), connection usage | high |
| Broken images, 404s | nightly 404 top list from `seo_not_found` (the Wave 4 crawler covers link rot before release; no runtime crawl job) | low |
| Web Vitals regressions | beacon p75 LCP/INP/CLS per route per day; alert when p75 degrades 25% week over week | low |
| Staleness | no order 72 h, no enquiry 7 days, no session 1 h in daytime | low (dashboard amber) |

Alert routing: rule table with per-rule severity, channels and dedupe. Fingerprinted alerts group into one issue with counts; re-alert only after resolve. Critical: immediate WhatsApp (dev number) + email, repeat every 30 min until acked. High: first occurrence immediately, then hourly digest. Low: daily digest at 09:00 IST. Dedupe windows 30 min transient, 6 to 24 h persistent. Per-channel limit 20 per hour. "Resolved" notice when an issue clears. The alert row is written first; delivery uses notifications when healthy, else the fallback channel: a plain HTTPS webhook URL (admin setting) and an in-admin bell. Alerts never depend only on the integration they report on. Health screen: per-integration cards (mode, last ok, error rate, latency), errors by fingerprint with resolve/ignore, failed jobs with retry, log viewer with typed categories, 404s with one-click redirect, uptime history.

---

## 8. Security spec

- Headers (verified on live responses by the test wave): HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self), camera=(), microphone=()`, `X-Frame-Options: DENY`. Storefront CSP static (A25): `default-src 'self'; script-src 'self' 'unsafe-inline' <vendors from marketing_tag>; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' <vendors>; frame-ancestors 'none'; object-src 'none'; form-action 'self' https://*.phonepe.com; base-uri 'self'`. `'unsafe-inline'` on script-src is required because prerendered Next pages carry inline `__next_f.push` hydration scripts that cannot be nonced; the mitigations are no `unsafe-eval`, `object-src 'none'`, `base-uri 'self'`, `safeHtml` on all rich text and no user content rendered as HTML outside it. Admin, account, checkout, pay: strict nonce CSP (`'nonce-…' 'strict-dynamic'`) set in `proxy.ts` (these routes are dynamic). CSP sources and rendered tags come from the same table. Acceptance is behavioural: zero CSP violation reports in the browser console across the full Wave 4 crawler run and the three E2E flows, not "header present".
- Canonical redirects: `proxy.ts` 301s non-canonical host, `http`, trailing slash and uppercase paths (section 4.2) before any other work.
- Auth: Better Auth; customers phone OTP (WhatsApp auth template) or email OTP, 6 digits, 300 s, 3 attempts, hashed storage; staff email + password + TOTP + backup codes, invite-only, lockout after 5 failures for 15 min; sessions renewed on login, 12 h staff absolute lifetime, 30 days customer; disabled accounts checked on every request; admin layout 404 for non-staff; `x-real-ip` from nginx; generic OTP responses.
- Authorisation: every server action and route handler calls `requirePermission` or `requireOwner`; `proxy.ts` is a first pass only; guests access orders via signed, hashed tokens; IDOR tests for orders, invoices, addresses, plans, land profiles.
- Input: all writes through `zodAction`; slug regex; `safeHtml` on rich text on save; file uploads sniffed by bytes, re-encoded by sharp, SVG refused, random names outside the web root, private documents behind signed URLs with expiry; 1 MB server action body, 12 MB nginx `client_max_body_size` for uploads via route handler.
- Rate limits: Postgres limiter keyed `<routeId>:<ip|phone|user>`; defaults: OTP send 3/phone/10 min and 10/ip/h, OTP verify 5/10 min, login 10/ip/15 min, enquiry 5/ip/h, assistant 20/session/h, beacon 600/ip/min, search suggest 120/ip/min, webhooks 600/min per provider; nginx `limit_req` outer layer.
- Webhooks: raw body, timing-safe compare, PhonePe `Authorization` SHA-256(username:password) checked against both hex and base64 until confirmed, read `event` and `payload.state` only; WhatsApp `X-Hub-Signature-256` HMAC; dedupe table; process async via pg-boss; never mark paid from redirect or webhook alone, server status check decides.
- Secrets: AES-256-GCM, random IV, AAD `module:key`, key version; `SETTINGS_MASTER_KEY` and `SETTINGS_MASTER_KEY_PREVIOUS` in env only; never returned to UI (last 4 shown); decrypted values tainted; `.env.example` single-quotes values with `#`, `$`, spaces or `(`; no secrets in tracked files (gitleaks-style regex test in Wave 4).
- Server actions: Origin vs Host enforced (nginx forwards `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`); `allowedOrigins` empty; stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
- SSRF: `safeFetch` host allowlist per adapter; admin-entered URLs must be https and resolve to public IPs.
- E-commerce: server recomputes totals; conditional stock decrement in the order transaction; unique redemption rows; paid amount compared to total; price snapshot on lines; test orders flagged; coupon brute force limited; idempotency key on place-order.
- Data protection (DPDP readiness): consent rows with text version; personal data columns (phone, email) stored plus hash columns for search; masked for `support` role; IPs hashed; 90-day raw analytics retention; export and delete-customer admin actions; privacy policy page.
- Database: owner role for migrations, app role for runtime (no DDL, INSERT+SELECT only on audit), Postgres on localhost with scram, 5432 closed; nightly `pg_dump` encrypted with `age`, daily/weekly/monthly retention, offsite copy, monthly restore drill documented.
- Dev-only surfaces (`/api/_mock/*`, `/admin/dev/*`): their route stubs are generated by `modules:sync` only when `modules.config.ts` has `mocks: true`; the production config has `mocks: false`, so the files do not exist in the production build (Next cannot drop routes by env, so this is the mechanism). The handlers additionally return 404 unless `ENABLE_MOCKS=1`. No setup endpoints left on the server. WP-33 asserts `/api/_mock/phonepe/pay` is 404 on the production-config build.
- Dependencies: `pnpm audit --prod` reports no high or critical advisories; a gitleaks-style regex scan of tracked files finds no secrets (both in Wave 4 and in the DoD).

---

## 9. Data pipeline (seed)

Owner: WP-14 (scripts + normalised JSON) and WP-13 (districts, pincodes, image sourcing). Consumer: `catalog.importSeed()` and each module's `seedHooks`. Contract: `data/seed/SCHEMA.md` written in Wave 0 from `docs/research/product-data.md` section 12 (the normalized product record) so the catalog package and the pipeline run in parallel.

Inputs (never modified): `latest_products.xlsx` (Plant data 159 rows, Plant list 29, FAQ tabs, Dis-wise Geo 644), `_work/products.json` (Woo export parsed), `_work/catalog.json`, `_work/image-map.json`, `images/` backup, `images/*.webp` current site files, `_work/assets/mango.glb`. The matching and pricing logic from the research scratch scripts is re-implemented inside `tooling/scripts/seed/` in TypeScript (Node 24, `xlsx` for the workbook); Python is allowed only for the one-off copy of masters.

Steps (`pnpm seed:build`, idempotent, deterministic, about 10 s):
1. `normalize-plants.ts`: read Plant data; fix typos (Alphonoso, Verigated, Mahagony, Celyon, gratfed, Longon, Vetiever, Baraba -> Biriba with note); keep originals in `search_aliases`; Kannada fixes flagged (Egg fruit, Milk fruit missing; Monkey Jack word; Fig seeded; Mexican sunflower category; Melia dubia commercial spacing); map categories (section 10 of the research); size class from canopy; parse spacing strings and "-" as null; compost by age; climate ranges.
2. `match-woo.ts`: token Jaccard + variety bonus + similarity + alias map; hard rules (base species must match; propagation type must match); 65 exact, 15 sibling, 24 unmatched, 55 native never matched; Mangosteen and Rambutan two sizes become variants; Agarwood added from Woo; 128 Woo-only rows as `woo_legacy` drafts; e-book dropped. Output per row `match: { kind: exact|sibling|none, woo_sku, confidence }`.
3. `fill-gaps.ts`: price rules (exact -> Woo sale; sibling -> sibling sale; native -> max(60, round5(UAS rate x 1.5)) or L 90 / M 75 / S 60; else researched band), compare-at only for exact; bulk price round5(price x 0.72) (round1 under Rs 100); bulk_min_qty L 50 / M 100 / S 200; weights L 3 / M 2 / S 1, native 0.8, slips 0.2; packing S 5 / M 10 / L 15; HSN/GST; stock from Woo floored at 0 else preorder 30 days; exposure, water need, mature height, bearing/yield/season rules; descriptions cleaned (strip em and en dashes, `\r\n`), template short description, long description marked `ai_draft` + `needs_review` (template text, not generated by a model at seed time); FAQs grouped answered / ai_draft (unpublished) / client_only; SEO title and description rules; `data_source` per group; `needs_review` and `review_notes`.
4. `inputs.ts`: the 7 HANDOFF inputs as `placeholder` products with `input_type`, pack size, dosage rules (M 2/1, X 1/0.5, O 0.5/0.25 kg vermicompost/biochar; neem cake 0.25 kg per plant; Jeevamrutha 4 L per acre; green manure seed 10 kg per acre placeholder), HSN 3101 5% for compost class, bio-pesticide 18% with `needs_ca_confirmation`.
5. `models.ts`: four models with patterns (Commercial `M O X O X O M`, 6 ft along row, 12 ft between rows; Food Forest 6 x 6 alternating rows; Miyawaki 2 x 2 seeded random M10/X50/O40; Boundary single line), `planting_model_plant` from spacing presence, default roles (A12), legend labels Main / Host / Biomass.
6. `districts.ts` (WP-13): 644 rows -> canonical names + aliases (Mysore/Mysuru, Raicur/Raichur, Kodugu/Kodagu, Karwar/Uttara Kannada, Bijapur/Vijayapura, Tumkur/Tumakuru, Chikmagaluru/Chikkamagaluru, Chikballapur/Chikkaballapura; add Vijayanagara; AP 13 legacy kept with note), state codes with GST codes, soil text -> tags, HQ lat/lng from a bundled static table (no runtime API), distance = haversine x 1.3 overridden by HANDOFF samples, climate ranges, native crops; `page_enabled` default true for Karnataka districts with 6+ fits (computed at seed), false elsewhere. Pincode directory: download the open India Post CSV into `data/raw/pincodes/` if reachable; else write `places_pincode` empty and set `settings.places.pincode_lookup = false`.
7. `media.ts`: copy the 194 product files + 66 site files from the backup to `data/media/masters/{products,site}/` with `media-manifest.json` (file, sha256, source woo_import|site_import|stock|wikimedia, licence, author, source_url, credit_required, plants[]); dedupe by hash; SaplingMart-branded files excluded; the 8 real Hasiru field photos assigned to Amla, Avocado, Guava, Jackfruit, Coconut, Sandalwood, Papaya x2 as gallery images; `as_delivered` role for potted-sapling photos; weak matches get `review_notes: replace photo`.
8. `source-missing-images.ts` (WP-13, uses the Magnific MCP `stock_search` / `stock_download` for fruit, spice and biomass plants, and Wikimedia Commons API for the 47 native forestry species): one lead photo per missing plant where a real photo exists; licence CC-BY, CC-BY-SA or PD only; author, licence, source URL recorded; files to `data/media/masters/sourced/`; plants still missing keep `image_needed: true` and the collection placeholder; `sourcing-log.json` lists every search and result. No AI-generated images anywhere.
9. `faqs.ts`: general FAQs (36 customer-facing) as `catalog_faq` with `product_id null`, status answered where the answer is in HANDOFF or the data, else ai_draft unpublished.
10. `cms-content.ts`: home blocks, farm development pages, about, contact, testimonials from the current site (3), team (4), trust claims (UAS Dharwad incubation, Startup India, MSME, "Rated 4.8" hidden until confirmed), videos table empty. Policy pages (delivery, damage-and-replacement, cancellation-and-refund, privacy, terms) are seeded as `status = draft`, `noindex = true`, with only the SRS sentences that exist (no invented legal wording); drafts are excluded from the sitemap and the footer, checkout shows the SRS note text ("No cancellation or return; damaged plants are replaced"), and footer links appear only when the client publishes each page. Listed in `docs/CLIENT-QUESTIONS.md` and checked in the Wave 5 copy audit.
11. `legacy-redirects.ts`: Woo product and category URLs for exact matches -> new slugs (301 created at publish time; drafts hold `pending` rows).
12. `pnpm seed:load` (catalog importer + hooks): idempotent upsert by `sku`; writes `inventory_level`, `pricing_*`, `planting_*`, `places_*`, `cms_*`, media assets + derivatives via sharp (products 160 to 800 AVIF q50 / WebP q75; site 480 to 1920; blur placeholders; never upscale), `seo_redirect`. Second run changes zero rows (test).
13. Admin "Data gaps" view and `docs/CLIENT-QUESTIONS.md` generated from `needs_review` and section 11 of the research (prices to confirm, bulk thresholds, two-tier plants, legacy Woo plants, Agarwood, bag sizes and weights, M/X/O roles, soil, GST, served states, FAQ answers, policy wording, COD stance, incentive limits).

---

## 10. Mock strategy and admin keys checklist

Every integration has `mode: mock | sandbox | live` in settings, encrypted secrets, a Test connection action (`settings.actions`), last status, copyable webhook URL, `*_webhook_event` dedupe tables and `core_integration_log` rows. Mocks are route handlers exported from each package's `src/mocks/` and listed in the manifest's `mockRoutes[]`; `modules:sync` writes their stubs under `apps/shop/app/api/_mock/<provider>/` only for configs with `mocks: true`, so the real HTTP clients run end to end in dev and test and the routes do not exist in production. Adapters are selected by settings, never by `if (process.env.NODE_ENV)` inside business code.

| Provider | Mock behaviour | Admin keys (collect from client / WODO) |
|---|---|---|
| PhonePe PG v2 | token endpoint with 60 s expiry (tests refresh), pay returns a mock pay page with Success / Fail / Pending / Abandon buttons that fires correctly signed webhooks (`checkout.order.completed|failed`, refund events), status endpoint honours the chosen outcome, 429 toggle, reused merchantOrderId -> BAD_REQUEST | Merchant ID, client_id, client_secret, client_version (UAT + prod), webhook username + password, registered domain |
| WhatsApp Cloud + Marketing Messages | `/messages` and `/marketing_messages` accept named params, return wamid, emit signed status webhooks sent/delivered/read/failed with pricing; failure toggles 131049 and 130429; template create auto-approves after 2 s; dev inbox page to send inbound text (STOP handling) | WABA ID, Phone Number ID, App ID, App Secret, System User token, verify token (generated), INR billing confirmed, Marketing Messages terms accepted |
| Meta CAPI | `/events` validates hashing (em, ph SHA-256; no hashing of ip/ua/fbp/fbc) and `event_id` presence. Meta catalog is fed by the scheduled CSV feed (A24): no `items_batch` mock; the feed validator checks Meta's required columns instead | Pixel ID, CAPI access token, domain verification, Catalog ID (entered on the Meta side with our feed URL) |
| GA4 MP + Google Ads | `/mp/collect` validates 25-event cap and `transaction_id`; Ads conversion recorded. Merchant Center is fed by the scheduled XML feed (A24): no Merchant API mock; the feed validator checks `identifier_exists`, price incl. GST, shipping and image size | GA4 Measurement ID + API secret, Ads conversion ID + label, Merchant Center ID (feed URL registered on the Google side) |
| Gmail API | `/messages/send` parses the MIME into the dev Outbox page; 401 and 429 toggles; OAuth callback mock issues a refresh token | WODO agency OAuth client ID + secret (env), per-site mailbox connected via the Connect Gmail button (consent screen in Production) |
| Claude API | streams the deterministic template narration for the given facts; refusal toggle; latency toggle | Anthropic API key, model choice, monthly token cap |
| hasiru-ops | mock inventory with 200 items and drift toggles; mock `ops-api` orders endpoint with HMAC verification; mock lead intake. The `pg` transport is tested against a local Postgres seeded with the hasiru-ops `items` and `stock_batches` shapes under a role that has SELECT only (test asserts an UPDATE is refused) | Transport choice; `pg` connection string for the read-only `ecom_sync` role (created by the client's team); `ops-api` base URL + shared HMAC secret; leads intake secret |
| SMS | log-only adapter | none (DLT registration later) |
| Uptime | none; external checker URL recorded | checker service of Shyam's choice pointing at `/api/health/ready` |

`docs/ADMIN-KEYS-CHECKLIST.md` (WP-29) lists each setting path in admin, who supplies it, and the Test action that proves it.

---

## 11. hasiru-ops sync design

E-com side complete; ops side documented as a change request in `docs/hasiru-ops-sync-spec.md` (WP-27). hasiru-ops is never modified.

Inventory in:
- Transport `pg`: direct Postgres connection (TLS, `pg` driver, statement timeout 10 s, `default_transaction_read_only = on` set on connect) using a read-only role `ecom_sync` that the client's team creates on their Supabase project (`GRANT SELECT ON items, stock_batches`; the exact `CREATE ROLE` script is in the spec). Reads `stock_batches` (`item_id, qty_available, status, expected_ready, location_id`) and `items` (`id, name, variety, sku, cost_rate`) with keyset paging of 1000 rows; stock = sum of `qty_available` where ready; `expected_ready` min -> `ready_in_days`. Column allowlist enforced in the adapter. This is a DB change on the client side, not a code change, so hasiru-ops stays unmodified. The Supabase anon and service-role keys are never used (anon has no read policy for us; service-role is full access).
- Transport `ops-api` (preferred later): `GET /api/ecom/inventory?since=<iso>&cursor=` returning `{ items: [{ erpItemId, sku, name, variety, available, readyInDays, costPaise, updatedAt }], nextCursor }`, HMAC-SHA256 over `timestamp + method + path + body` in `X-Signature`, `X-Timestamp` within 5 min, replay protection by nonce.
- Schedule: singleton queue every 10 min (admin editable) + "Sync now" (`settings.actions`); changed variants -> `inventory.setFromErp()` (skips `source = manual` rows, A26) -> `stock.changed` event -> revalidate `stock:<id>`; drift report (ours vs ops, with the manual-override rows highlighted) in Analytics.
- Mapping: `erp_item_map` auto by (name, variety) similarity with confidence; admin resolves below 0.8; unmapped items listed.

Orders out:
- On `order.paid` (or COD confirmed) write `erp_outbox(kind=order)` in the same transaction; worker pushes with retry/backoff; dead-letter alerts.
- `ops-api` contract: `POST /api/ecom/orders` idempotent on `ecomOrderNumber`; body `{ ecomOrderNumber, placedAt, customer: { name, phone, email, gstin? }, deliver: { method, slotDate?, district, address }, lines: [{ erpItemId, sku, name, qty, unitPaise, lineTotalPaise }], totals: { subtotalPaise, discountPaise, shippingPaise, taxPaise, totalPaise, paidPaise }, status }` -> `{ opsOrderId, invoiceNumber }` stored on `orders_order.erp_order_ref`. Status callbacks (optional): `POST <our>/api/webhooks/ops` with the same HMAC scheme for `packed|dispatched|delivered`.
- Until the client's team ships the endpoint, outbox rows stay `pending` with a dashboard tile "N orders waiting for ops sync" and a CSV export of pending orders as the manual bridge.
- Leads: one path. Wizard unlock, notify-me, chat and the farm enquiry form each create a `customers_lead` row (the enquiry keeps its `lead_id`); only the `lead.created` event writes `erp_outbox(kind=lead)`, which pushes to the existing `POST /api/leads/intake` (shared-secret header). Enquiries never push directly.

Change request to the hasiru-ops team (in the spec): the read-only `ecom_sync` Postgres role (script included; needed for inventory in), the two `ops-api` endpoints above (needed for orders out), and the HMAC secret exchange.

---

## 12. Work breakdown for the swarm

Orchestration rules:
- Fable plans, spawns, verifies. Opus 5.5 for every package marked `opus`; Sonnet 5.5 only for `sonnet` packages. One agent per package; packages in the same wave run in parallel; a wave starts when the previous wave's acceptance tests pass and the orchestrator has committed.
- Ownership is per wave: a path listed under a package is exclusive to it for that wave. Nested directories under another package's path are allowed only when listed explicitly (worktrees make sibling files in one directory merge cleanly; the hazards are shared files). Every `layout.tsx` has one named owner: `app/layout.tsx`, `(shop)/layout.tsx`, `(admin)/layout.tsx` are WP-00a; `(shop)/account/layout.tsx` is WP-02; `(admin)/admin/layout.tsx` is WP-08; `models/[model]/` has no layout (WP-24 owns `page.tsx`, WP-25 owns `3d/`); `admin/marketing/` has no layout (WP-22 owns `automations/`, WP-23 owns `tags/`, `feeds/`). No agent creates a `layout.tsx` that is not in this list. Files generated by `modules:sync` are regenerated by the orchestrator between waves, never hand-edited by agents.
- Every agent: reads sections 0, 2, 12 and its row; reads `docs/CONVENTIONS.md`; works in its own worktree `.worktrees/wp-xx`; creates its throwaway DB (`pnpm db:fresh wp-xx`) and applies schema with `drizzle-kit push`; works only in owned paths; adds no dependencies; writes `packages/<mod>/README.md`; runs `pnpm -F @ecomkit/<mod> typecheck lint test`; writes `BUILD-STATUS/wp-xx.md` (status, tests, assumptions, cross-package requests); commits on its `wp/xx` branch only.
- Orchestrator per wave: spawn worktrees -> run agents -> merge `wp/*` into `ecom-build` in dependency order -> `pnpm i` (lockfile) -> `modules:sync` -> `drizzle-kit generate` -> `pnpm typecheck lint test` on the merged tree -> merge `BUILD-STATUS/*.md` into `BUILD-STATUS.md` -> commit `wave N: <packages>` -> remove worktrees.
- Contracts (TypeScript interfaces only, in `packages/core/src/contracts/`) are written in Wave 0 and frozen: `manifest` (incl. `productFormTabs`, `settings.actions`, `settings.customPanel`, `admin.nav[].order`, `mockRoutes`), `events` (catalogue of event names and payloads listed below), `totals` (`TotalsBreakdown`, `TotalsInput`, implemented by `core.computeTotals`), `cart-block` (line type carries `weightKg`, filled by cart from `catalog_variant.weight_kg` or `origin.weightKg` when planting sets it, e.g. Miyawaki 0.8), `pdp-section`, `card-chip`, `checkout-section`, `product-form-tab`, `settings-action`, `dashboard-widget`, `report`, `health-check`, `sitemap-source`, `seed-hook`, `payment-provider`, `shipping-method`, `inventory-ops`, `notification-channel`, `erp-adapter`, `places` (`DistrictRef`, `ClimateFit`), `planting` (`PlanLayout`, `Role`), `seo` (`JsonLdBuilders`, `MetadataInput`), `search` (`FacetIndex`), `analytics` (`TrackEvent` names), `pricing` (`PriceQuote`), `media` (`ImageRef`). Changing a contract after Wave 0 requires an orchestrator decision recorded in BUILD-STATUS.
- Fixed string catalogues in `docs/CONVENTIONS.md` (Wave 0, frozen like contracts): (1) notification template keys: `otp.login`, `otp.unlock`, `order.confirmed`, `order.packed`, `order.dispatched`, `order.delivered`, `order.payment_failed`, `order.replacement_created`, `slot.reminder`, `cart.reminder_1`, `cart.reminder_2`, `cart.reminder_3`, `review.request`, `stock.back_in_stock`, `lead.follow_up`, `enquiry.received_admin`, `enquiry.received_customer`, `alert.critical`, `alert.digest`, `staff.invite`, `test.send`; (2) permission strings: `orders.read`, `orders.write`, `orders.refund`, `orders.dispatch`, `products.read`, `products.write`, `inventory.read`, `inventory.write`, `pricing.write`, `media.write`, `content.write`, `reviews.moderate`, `customers.read`, `customers.write`, `customers.export`, `enquiries.read`, `enquiries.write`, `marketing.write`, `analytics.read`, `health.read`, `jobs.retry`, `settings.read`, `settings.write`, `settings.secrets`, `staff.manage`, `audit.read`, and the role matrix mapping them to owner, manager, catalog_editor, fulfilment, support; (3) admin nav order bands (section 2.1); (4) forbidden names.
- Package count: 33 work packages (WP-00a, WP-00b, WP-01 to WP-34; WP-15 and WP-21 were merged into WP-13 and WP-16 and the ids are intentionally unused). Peak parallelism 14 agents in Wave 1, 10 in Wave 2.
- Event catalogue (names fixed): `product.updated`, `product.published`, `price.changed`, `stock.changed`, `stock.low`, `cart.updated`, `cart.abandoned`, `checkout.started`, `checkout.contact_saved`, `order.placed`, `order.paid`, `order.payment_failed`, `order.confirmed`, `order.packed`, `order.dispatched`, `order.delivered`, `order.cancelled`, `order.refunded`, `order.replacement_created`, `slot.reminder`, `customer.created`, `lead.created`, `consent.changed`, `review.submitted`, `review.approved`, `enquiry.created`, `enquiry.status_changed`, `plan.generated`, `plan.unlocked`, `message.sent`, `message.failed`, `integration.failed`, `erp.synced`, `alert.raised`.

### Wave 0: foundation (3 agents; WP-00a first, then WP-00b and WP-01 in parallel)

| ID | Package | Model | Owns | Relies on | Ships / acceptance |
|---|---|---|---|---|---|
| WP-00a | Workspace, tooling, contracts, conventions | opus | root `package.json`, `pnpm-workspace.yaml` (with the full dependency `catalog:`), `.npmrc`, `.gitignore`, `turbo.json`, `tooling/**` (db-fresh, modules-sync incl. `mocks` gating, seed runner shell, cta-coverage skeleton, eslint config with `react/jsx-no-literals` and the boundaries rule), `packages/core/{package.json,src/contracts/**,src/manifest/**,src/testing/fakes/**}`, `apps/shop/{package.json,next.config.ts,tsconfig.json,proxy.ts,instrumentation.ts,modules.config.ts,modules.config.{dev,test,prod}.ts,drizzle.config.ts,worker.ts,app/layout.tsx,app/(shop)/layout.tsx,app/(admin)/layout.tsx,src/generated/}`, `apps/minimal/` skeleton, `docs/CONVENTIONS.md` (naming, folders, messages, tokens, testing, forbidden names, contracts, template keys, permission strings, nav bands), `docs/PROTOTYPE-PARITY.md` (one row per feature-inventory item C1 to C6 with an empty "Playwright step" column), `data/seed/SCHEMA.md`, `.env.example`, `BUILD-STATUS.md` + `BUILD-STATUS/README.md` | research: architecture.md, internal-patterns.md, feature-inventory | `pnpm i` clean with every version from `catalog:`; `@next/playwright` pin verified against the registry; `pnpm db:fresh x` creates a DB from template; `modules:sync --check` passes with core only, and `--check` with the prod config produces no `_mock` stubs; all contracts compile and the fakes implement them (type test); `proxy.ts` canonical 301 rules unit-tested (host, http, trailing slash, uppercase); `next build` of the empty app succeeds; ESLint fails on a literal string in a fixture component |
| WP-00b | Core implementations | opus | `packages/core/**` except the WP-00a files | WP-00a contracts | Vitest: money (paise, formatINR, GST split 0/5/18 inclusive, rounding), `computeTotals` fixtures (tier + automatic promo + coupon + packing + transport + GST intra/inter state; F2 definitions), `core_sequence` 50 concurrent issuances consecutive, settings encrypt/decrypt/tamper, HMAC + timing-safe, rate limiter window, upsert-requires-update, event emit inside tx enqueues exactly one job, observability fingerprinting, `safeFetch` SSRF guard |
| WP-01 | UI + tokens + shell | opus | `packages/ui/**`, `apps/shop/theme.css`, `apps/shop/messages/en.ts` (skeleton with keys), `apps/shop/app/globals.css` | WP-00a CONVENTIONS and catalog (starts when those exist) | All primitives in 2.3 with stories page `/admin/dev/ui` (dev only); QtyStepper rules tested; Rail with arrows + scroll-snap; ImageWithFallback; tokens for light admin palette; fonts via next/font; axe clean on the stories page; no hex in `packages/ui` except tokens.css |

### Wave 1: foundation modules and data (14 agents in parallel)

| ID | Package | Model | Owns | Relies on | Ships / acceptance |
|---|---|---|---|---|---|
| WP-02 | auth | opus | `packages/auth/**`, `apps/shop/app/api/auth/`, `apps/shop/app/(shop)/account/layout.tsx`, `apps/shop/app/(shop)/account/login/` | core contracts auth-context, notification-channel via `fakeNotificationChannel` | Better Auth with phoneNumber + emailOTP + twoFactor + admin plugins, Drizzle adapter, `auth generate` schema committed; roles/permissions from the CONVENTIONS permission list; OTP via the `notification-channel` contract (tests use the core fake, which records sends); `getViewer` cached; staff invite flow; TOTP enrol + backup codes; lockout; tests: OTP limits, generic responses, 2FA gate, 12 h staff lifetime, role matrix against the CONVENTIONS permission strings |
| WP-03 | media | opus | `packages/media/**`, `apps/shop/app/(admin)/admin/media/` | core | upload route (bytes sniffed, SVG refused, EXIF stripped, auto-rotate), sharp derivatives + blur, library with licence/credit fields, `imageProps()` for `next/image`, warm-up job, dedupe by sha256, private documents with signed URLs; tests on type sniffing, derivative sizes, never upscale |
| WP-04 | catalog | opus | `packages/catalog/**`, `apps/shop/app/(shop)/{plants,plant,inputs,input}/` (except `plants/for/`, which is WP-24's in Wave 2), `apps/shop/app/(admin)/admin/{products,inputs,collections,tags,faqs,data-gaps,import}/` | contracts seo JsonLd, pricing PriceQuote, inventory-ops, search FacetIndex, places DistrictRef, card-chip, pdp-section, product-form-tab, seed SCHEMA; core fakes (`fakePricing`, `fakeInventory`, `fakeFit`, `fakeReviews`) for page tests | schema; `importSeed()` idempotent (second run 0 changes); PDP route with all sections in 5.1 wired to optional modules via registry and rendered in tests against the core fakes (real page tests, not contract-only); collection routes static with `generateStaticParams`; "Help me choose" toolbar CTA; product card component with chip slots; availability states; admin CRUD whose product form hosts `productFormTabs` (tested with a fixture tab), XLSX/CSV import matching the client layout, export; Data gaps view; slug change -> `seo.addRedirect`; `updateTag` on save; `facetSource()`; tests: import idempotency, availability derivation, card data, JSON-LD shape, slug 301, PDP renders with fakes in all three fit states and both stock states |
| WP-05 | search + facets | opus | `packages/search/**`, `apps/shop/app/(shop)/search/`, `apps/shop/app/api/search/`, `apps/shop/app/facets.json/route.ts` | catalog server API (read), places | trgm `ILIKE` search over name, Kannada, scientific and `search_aliases` (EN, KN, scientific, romanised aliases seeded into the product column), suggest endpoint over the facet index, static facet index with bitsets, `FacetSidebar`, `FilterSheet` (mobile, live count, apply), `AppliedChips`, quick chips, zero-result UI, URL state with fixed param order, back/forward restore; auto-hide rule; tests: facet counts, OR/AND logic, index size < 40 KB gz for 350 products, suggest p95 < 80 ms over 350 products (Vitest bench, 200 queries) |
| WP-06 | pricing + discounts | opus | `packages/pricing/**`, `packages/discounts/**`, `apps/shop/app/(admin)/admin/discounts/` | catalog read, product-form-tab contract | tier pricing (n tiers, boundary tests at min_qty-1/min_qty), cross-line summation hook, price changes audited via `core.audit`, offline price admin-only, Pricing tab exported as a `productFormTab`; promos + codes + eligibility + usage limits + atomic redemption + A8 stacking; admin discounts; tests: stacking matrix, limits, date windows in IST, code brute-force limit |
| WP-07 | inventory | opus | `packages/inventory/**`, `apps/shop/app/(admin)/admin/inventory/`, `apps/shop/app/api/notify-me/` | catalog read, product-form-tab contract | levels with `low_stock_threshold`, conditional reserve/commit/release with a TTL sweep job every minute, movements ledger, low-stock event, `setFromErp` honouring `source = manual` (A26) and `clearOverride`, availability derivation (on_hand - reserved, ready_in_days), notify-me subscriptions, Inventory tab as a `productFormTab`; tests: concurrent reservations never oversell (parallel tx test), TTL release, ledger sums equal level, ERP pull does not touch manual rows |
| WP-08 | admin-shell | opus | `packages/admin-shell/**`, `apps/shop/app/(admin)/admin/{layout.tsx,page.tsx,settings,audit,staff,roles}/` | auth (interface), registry | sidebar from registry sorted by `order`, top bar, global search hook, settings page renderer from zod (secret fields masked, `settings.actions[]` buttons incl. `oauth-redirect` kind, `settings.customPanel` slot, copyable URLs), audit viewer, staff + roles screens, dashboard frame with widget slots, DataTable usage pattern, 404 for non-staff; tests: role-gated render, settings round trip never returns secrets, an action and a custom panel from a fixture manifest render and run |
| WP-09 | seo + cms | opus | `packages/seo/**`, `packages/cms/**`, `apps/shop/app/{sitemap.xml,sitemap,robots.txt,llms.txt,og,not-found.tsx}`, `apps/shop/app/(shop)/{policies,guides,videos,about,contact,[...slug]}/`, `apps/shop/app/(admin)/admin/{seo,content}/` | contracts sitemap-source, product-form-tab | metadata builders, all JSON-LD builders with escaping, canonical rules, sitemaps from sources (drafts and noindex excluded), robots with AI crawlers, llms.txt, OG image route, 404 log + redirects + auto 301, page meta overrides, SEO tab as a `productFormTab`; cms pages/blocks/menus/policies (draft + noindex seeding)/testimonials/videos with product and model links/guides/portfolio/clients/counters/trust claims with block editor; tests: JSON-LD validates against schema shapes, escaping, sitemap only 200 + indexable + published, redirect loop guard |
| WP-10 | notifications | opus | `packages/notifications/**`, `apps/shop/app/api/webhooks/whatsapp/`, `apps/shop/app/api/auth/gmail/`, `apps/shop/app/(admin)/admin/{messages,templates,dev/outbox}/` (mock routes via `mockRoutes[]`, stubs generated) | contracts notification-channel, settings-action | Gmail adapter (OAuth connect as a `settings.actions` `oauth-redirect`, refresh, send, backoff; Test send as a `test-connection` action), WhatsApp adapter (category routing utility/auth on `/messages`, marketing on `/marketing_messages`; named params; template sync; status webhooks dedupe on wamid+status; 131049/130429 handling; STOP handling; 24 h window check), SMS mock, log adapter; template registry keyed by the CONVENTIONS template keys with versioning and exact-text tests; quiet hours; opt-out; send log; dev outbox; OTP kill switch + health warning; tests: signature verify, dedupe, routing by category, template text pins, every CONVENTIONS key has a template per enabled channel |
| WP-11 | monitoring | opus | `packages/monitoring/**`, `apps/shop/app/api/health/`, `apps/shop/app/api/monitoring/`, `apps/shop/app/(admin)/admin/health/` | core observability, notification-channel | health live/ready checks, check registry, alert rules + dedupe + repeat + digests + fallback webhook + bell, system health screen, errors by fingerprint, jobs view with retry, 404 view, integration cards, SSL/domain/DNS/disk/backup checks, uptime self-check; tests: dedupe windows, repeat until ack, fallback when notifications fail |
| WP-12 | analytics | opus | `packages/analytics/**` (incl. `sql/partitions.sql`), `apps/shop/app/b.js/route.ts`, `apps/shop/app/api/beacon-ingest/`, `apps/shop/app/(admin)/admin/analytics/` | contracts analytics TrackEvent; customers `hasConsent` (fake in tests) | beacon < 3 KB (batching, sendBeacon, visibility, bfcache, route-change hook, PII stripping, rage/dead clicks, attention, vitals), HttpOnly visitor cookie set by server, identity linking only when `hasConsent(analytics_identity)`, sessions 30 min, partitioned `analytics_event` via hand-written DDL + `analytics.create-partition` monthly job + nightly rollup + 90-day partition drop, bots and AI referrers, test-order exclusion, reports API, admin tabs (Overview, Funnel, Sales*, Products*, Traffic, Customers*, Journeys, Search and filters, Wizard, Attention, Bots, Vitals; * fed by orders in Wave 3 via `report` contract); tests: idempotent ingest, session split, rollup equals raw, partition job creates month+2 and drops month-4 |
| WP-13 | places + data assets | sonnet | `packages/places/**`, `apps/shop/app/api/places/`, `apps/shop/app/(shop)/grow-in/`, `tooling/scripts/seed/{districts,pincodes,source-missing-images}.ts`, `data/seed/districts.json`, `data/seed/pincodes.csv`, `data/media/masters/sourced/**`, `data/media/sourcing-log.json` | contracts places, SCHEMA.md; Magnific MCP + Wikimedia API | district normalisation per 9.6, aliases, haversine distances with overrides, climate-fit rules (`fit(plant, district)` tested with fixtures), suggest endpoint (edge cache), district page route at `/grow-in/[district]` + admin enable list; pincode import or graceful off; image sourcing per 9.8 with licences recorded; tests: alias resolution, fit outcomes, 6+ rule |
| WP-14 | data pipeline | opus | `tooling/scripts/seed/**` (except WP-13 files), `data/seed/{products,inputs,models,faqs,cms,redirects}.json`, `data/media/masters/{products,site}/**`, `data/media/media-manifest.json`, `docs/CLIENT-QUESTIONS.md` | SCHEMA.md, research product-data.md, image-inventory.md, `_work/*.json`, xlsx | steps 9.1 to 9.5, 9.7, 9.9 to 9.11; deterministic output (re-run -> identical JSON); self-checks (159 + 1 + 7 + 128 rows, 65/15/24/55 match counts, price never null for active, no em dashes, slugs valid and unique, every image path exists); appendix CSV of row -> match -> price for review |
| WP-16 | customers + enquiries + reviews | opus | `packages/customers/**`, `packages/enquiries/**`, `packages/reviews/**`, `apps/shop/app/(shop)/build-farm-with-us/`, `apps/shop/app/(shop)/account/{profile,addresses,land,reviews}/` (no layout; WP-02 owns `account/layout.tsx`), `apps/shop/app/api/enquiry/`, `apps/shop/app/(admin)/admin/{customers,leads,segments,consent,enquiries,reviews}/` | auth, media, catalog read, places | profiles with hashes + masking, addresses with district link, the single consent store with `hasConsent()` (A28), leads with `phone_verified`, four computed segment views, land profiles; enquiry form (no-JS POST, honeypot, time trap, uploads private, rate limit) that creates a `customers_lead` and emits only `lead.created` for ops, pipeline + notes + staleness; reviews submit/moderate/aggregate + photos (no Q&A); tests: masking by role, consent audit, no-JS submit, IDOR on addresses and reviews, enquiry creates exactly one lead and one `lead.created` |

### Wave 2: commerce and Hasiru features (10 agents in parallel)

| ID | Package | Model | Owns | Relies on | Ships / acceptance |
|---|---|---|---|---|---|
| WP-17 | cart | opus | `packages/cart/**`, `apps/shop/app/(shop)/cart/`, `apps/shop/app/api/cart/` | pricing, discounts, inventory, shipping quote contract (`fakeShippingQuote` in tests), cart-block contract, `core.computeTotals` | cookie cart, merge on login, lines product/package with `weightKg` filled from the variant or `origin.weightKg`, `replacePackage`, totals preview through `core.computeTotals` (no second pipeline), drawer + page UI with zones, bulk nudges, inputs suggestion, coupon field, delivery chooser slot, cart blocks rendering, `cart.updated`/`cart.abandoned` (idle job; payload carries `hasContact`), restore token; tests: tier across package + extra lines, merge, abandoned timing, totals equal core fixture results |
| WP-18 | shipping + truck-meter | opus | `packages/shipping/**`, `packages/truck-meter/**`, `apps/shop/app/api/delivery-check/` (Delivery settings rendered by admin-shell from the manifest + a `settings.customPanel` for zones/vehicles/slots exported from `packages/shipping/src/admin/`) | places, cart-block contract (`weightKg`) | zones (A9), methods pickup / local slot / outstation, vehicles + smallest-fit + trips, slot calendar with cutoff + capacity, packing rules (order/product/size/qty band), distance overrides, delivery date promise, `quoteMethods`, `slot.reminder` scheduled job (day before each slot, one event per order in the slot); truck meter block (fill % from `weightKg`, "Nicely packed" at >= 90%, "Add about K kg (~P%)", vehicle change) and small-order bar; tests: HANDOFF sample numbers reproduce (Ace/407/Eicher, 1,500/3,500/6,000, 22/35/48 per km, Mysuru 150 km), capacity boundaries, slot cutoff in IST, reminder job emits once per order |
| WP-19 | checkout + orders | opus | `packages/checkout/**`, `packages/orders/**`, `apps/shop/app/(shop)/{checkout,order,account/orders}/`, `apps/shop/app/(admin)/admin/orders/` | cart, shipping, discounts, inventory, payments contract, customers, notification send, `core.computeTotals`, `core_sequence` | one-page checkout per 5.1 incl. contact autosave on blur (`saveContact`, `checkout.contact_saved`) and the marketing consent checkbox, address with pincode autofill, delivery options with dates, COD modes, quote through `core.computeTotals`, idempotent place-order in one tx (reserve stock with TTL = attempt expiry, snapshot prices, redeem coupon, create order with a `core_sequence` number, emit `order.placed`), order status machine with guards, timeline, pending-payment sweep hook (cancel + release + `order.payment_failed`, called by the payments sweep), GST invoice PDF job (B2C/B2B, CGST/SGST vs IGST, gapless `core_sequence` invoice number per FY), replacement orders (`createReplacement`, admin action), customer order pages + guest token page, admin orders with saved views (incl. Replacements), dispatch planner, manual order, refund action calling payments; tests: totals equal core fixtures, idempotency key replay, oversell blocked, invoice tax maths, gapless invoice numbers under concurrency, replacement is zero-value and linked, IDOR |
| WP-20 | payments | opus | `packages/payments/**`, `apps/shop/app/api/webhooks/phonepe/`, `apps/shop/app/(shop)/pay/`, `apps/shop/app/(admin)/admin/payments/` (mock routes via `mockRoutes[]`; Payments settings rendered from the manifest with a `test-connection` action) | payment-provider contract, orders transition API | PhonePe v2 typed client (token cache by expires_at, pay, status, refund, refund status; prod identity host differs), attempts `<number>-<attempt>` with `expires_at = now + attempt_expiry_minutes` (setting, default 15; the same value the reservation uses), return handler (status API, never query params), webhook (auth hash hex or base64, `event` + `payload.state`, dedupe, job), poll schedule job, sweep job every minute (expired attempts -> orders sweep hook), 429 backoff, `applyPaymentState` idempotent with COMPLETED-after-FAILED or after-cancel alert + refund task + amount check; mock provider + pay page; COD partial + bank transfer adapters; admin list; tests: signature valid/invalid/length, replay once, state machine, amount mismatch, late COMPLETED on cancelled order creates refund task and no state flip |
| WP-22 | flows | opus | `packages/flows/**`, `apps/shop/app/(shop)/r/`, `apps/shop/app/(admin)/admin/marketing/automations/`, `apps/shop/app/(admin)/admin/abandoned-checkouts/` | notifications, cart, orders, discounts, customers `hasConsent`, shipping `slot.reminder` | flow model + runner job (wait, send, stop_if), fixed flows seeded with per-flow settings forms (abandoned cart 1 h / 24 h / 72 h with quiet hours, caps, consent and optional single-use code on the 72 h step; order updates; slot reminder; review request; back-in-stock; wizard lead follow-up), restore link, admin: one settings form per flow + run list + test run; tests: stop on purchase/reply/unsubscribe, quiet hours shift, one sequence per 7 days, abandoned cart without customer or session contact sends nothing, abandoned cart with contact but no marketing consent sends nothing (`stop_reason = no_consent`), marketing sends use the Marketing Messages path |
| WP-23 | marketing + feeds | opus | `packages/marketing/**`, `packages/feeds/**`, `apps/shop/app/api/consent/`, `apps/shop/app/feeds/`, `apps/shop/app/(admin)/admin/marketing/{tags,feeds}/` (GA4 and CAPI mock routes via `mockRoutes[]`) | orders events, customers consent API, catalog/pricing/inventory/media read | consent banner writing `customers_consent`, tag manager feeding CSP sources, GA4 gtag + MP purchase/refund, Meta Pixel + CAPI with shared event_id and hashing, Ads conversion, UTM/click-id attribution on order, test-order exclusion; Google XML feed (identifier_exists false, price incl GST, 800 px JPEG/WebP image) and Meta CSV feed as token-protected scheduled files regenerated on `product.updated`/`stock.changed`/`price.changed` (debounced) with `feeds_item_state` hashes, feed validation report; API push documented as a later toggle, not built; tests: hashing, dedup id, feed required fields for both destinations, token required, regeneration only when hashes change |
| WP-24 | planting | opus | `packages/planting/**`, `apps/shop/app/(shop)/plan/`, `apps/shop/app/(shop)/models/[model]/page.tsx`, `apps/shop/app/(shop)/plants/for/`, `apps/shop/app/api/plan/`, `apps/shop/app/(admin)/admin/planting/` (Planting settings incl. `unlock_mode` rendered from the manifest) | catalog, pricing, cart `replacePackage`, customers leads, auth OTP, places fit, farm-calculators dosage contract, planting contract `PlanLayout`, cms `videosFor` | models + membership + roles admin ("Recommendation management"), pattern engine (cycling rows, seeded random, boundary line), scaling (area by blocks, Boundary by `boundary_ft / spacing_ft`), SVG plan with legend/counts/tooltip island/a11y text, wizard 3 steps incl. `boundary_ft`, generation with climate filtering, blurred preview + unlock in `soft` and `otp` modes (A23; lead + `lead.created`; sign-in only on OTP), recommendations page per 5.2, companions, package-to-cart with `origin.weightKg` for Miyawaki, saved land profiles, WhatsApp share, model explainer pages, `/plants/for/[model]` curated listing, "Build it for me"; tests: Commercial block = 18, half-open edges, scaling 1 acre = 33.6 blocks, Boundary fixture 835 ft / 10 ft = 84, role split, location changes plant set, seeded determinism, soft unlock creates an unverified lead without a session |
| WP-25 | farm-calculators + planting-3d | opus | `packages/farm-calculators/**`, `packages/planting-3d/**`, `apps/shop/app/(shop)/calculators/`, `apps/shop/app/(shop)/models/[model]/3d/` | catalog spacing, pricing, cart add, planting `PlanLayout` | plant calculator (A10; 9x9 -> 538, 10x10 -> 436), compost calculator (A11), `farmcalc_dosage_rule` table + admin, recommended inputs engine, seed calculation; 3D route with lazy three, preloader, procedural trees, GLB mango, basin rings, person, labels, tap identify, walk (thumbstick + WASD), sun slider, 2D plan canopy circles, reduced-motion default, preload on intent; tests: calculator fixtures, dosage rounding, 3D route chunk under 450 KB gz |
| WP-26 | ai-assistant | opus | `packages/ai-assistant/**`, `apps/shop/app/api/assistant/`, `apps/shop/app/(admin)/admin/assistant/` (Claude mock via `mockRoutes[]`; Assistant settings rendered from the manifest with a `test-connection` action) | catalog, pricing, places fit, planting companions (optional), claude-api skill | intent parser + rules engine producing facts, Claude narration with `output_config.format` (zod), validator dropping unknown ids/prices, streaming route, prompt caching on system prompt, narration cache, rate limit, template fallback, drawer UI with chips + card rail, admin transcripts; tests: validator, fallback on refusal/error, rate limit, no em dashes in templates |
| WP-27 | erp-sync + hasiru-ops-adapter | opus | `packages/erp-sync/**`, `packages/hasiru-ops-adapter/**`, `apps/shop/app/api/webhooks/ops/`, `docs/hasiru-ops-sync-spec.md` (ops mock via `mockRoutes[]`; ERP settings rendered from the manifest with `test-connection` and `Sync now` actions and a mapping `customPanel`) | orders events, inventory `setFromErp`, erp-adapter contract, customers `lead.created`; hasiru-ops read-only study | outbox + runner + dead-letter alerts, inventory pull job (singleton, keyset paging, respects manual overrides), mapping with confidence + admin resolve, `mock` / `pg` (read-only role) / `ops-api` transports, lead push on `lead.created` only, status webhook receiver, drift report, spec doc with the `CREATE ROLE ecom_sync` script and the two endpoints as the change request; tests: idempotent push, paging past 1000, column allowlist, read-only role refuses UPDATE, HMAC |

### Wave 3: assembly (3 agents in parallel)

| ID | Package | Model | Owns | Relies on | Ships / acceptance |
|---|---|---|---|---|---|
| WP-28 | apps/shop assembly + integration gate | opus | `apps/shop/**` except `e2e/` (other than `e2e/gate.spec.ts`) and files owned in Waves 1 to 2 (home page, farm development pages, our work, clients, why choose us, header/footer wiring, messages/en.ts complete, cms seed content, theme polish, `/api/internal/revalidate` wiring, PM2 + nginx + deploy docs in `docs/DEPLOY.md`; `modules.config.*.ts` changes are requested from the orchestrator), `docs/PROTOTYPE-PARITY.md` (fill the Playwright step column or mark "not built, see section 14") | all modules | `pnpm seed:load` on a fresh DB then `next build` green; every route in 4.1 returns 200 with real data; home per 5.1 with real images; screenshots at 375/768/1440 of home, shop, PDP, wizard, results, cart, checkout stored in `docs/screenshots/`; ESLint literal-string rule clean; `docs/PROTOTYPE-PARITY.md` has every row either mapped to a Playwright step id or listed in section 14; integration gate `e2e/gate.spec.ts`: one Playwright happy path each for flow (a) browse -> add -> checkout -> mock pay -> order page -> ERP outbox row, flow (b) wizard -> soft unlock -> package to cart, flow (c) enquiry -> admin pipeline, run by the orchestrator against the merged tree, green before any Wave 4 agent starts |
| WP-29 | admin dashboard + reports + keys checklist | opus | `packages/admin-shell/src/dashboard/**`, `packages/analytics/src/reports/commerce/**`, `docs/ADMIN-KEYS-CHECKLIST.md`, `docs/CLIENT-QUESTIONS.md` (merge) | orders, analytics, enquiries, monitoring widgets | dashboard per section 6 with staleness tiles and task cards linking to filtered lists; Sales / Products / Customers / Funnel / Bulk-tier / GST by HSN / inventory drift reports with CSV; keys checklist; tests: KPI maths against fixture orders, excluded test orders |
| WP-30 | apps/minimal proof + recipe | sonnet | `apps/minimal/**`, `docs/NEW-STORE-RECIPE.md` | modules | minimal store (core, ui, auth, media, catalog, pricing, inventory, cart, checkout, payments mock, orders, customers, seo) with 5 generic products, neutral theme; builds; smoke E2E browse -> add -> checkout -> mock pay -> order page; recipe doc step by step |

### Wave 4: test (3 agents in parallel, then fix agents as needed)

The orchestrator builds `.next` once (`pnpm build` with the test config, `mocks: true`) and starts one `next start` on port 3100 plus one worker; the three agents run their suites against that server with separate Postgres databases selected per Playwright project via a `x-test-db` header the test config honours. No agent runs `next build` or `next dev`.

| ID | Package | Model | Owns | Ships / acceptance |
|---|---|---|---|---|
| WP-31 | E2E flow (a) + CTA crawler | opus | `apps/shop/e2e/flow-a-*.spec.ts`, `apps/shop/e2e/crawler.spec.ts`, `tooling/playwright/**` (incl. the `cta` fixture), `tooling/scripts/cta-coverage.ts` | Playwright against the shared server, mobile 375 and desktop 1440: home paths, collections + facets + search + "Help me choose" CTA, bulk price live, PDP all CTAs, notify me, cart (zones, nudges, truck meter boundaries, delivery options, totals), checkout (guest, OTP save, contact autosave, consent checkbox, address autofill, COD modes), mock pay success / fail / pending / abandon -> reconciliation and the 15 min sweep (clock advanced), confirmation, account, invoice PDF, reviews, replacement order from admin; crawler from `/` + sitemaps (cap 500): 200 or intended 301, no console errors, zero CSP violation reports, no failed requests incl. `/_next/static`, links resolve, one h1, canonical, JSON-LD parses; CTA coverage: a Playwright fixture wraps `page.click` / `locator.click` and appends the clicked element's `data-cta` (or the nearest ancestor's) to `e2e/.cta-hits.json`; `cta-coverage.ts` scans `packages/*/src` and `apps/shop/app` for `data-cta="..."` literals and fails on any id not in the hits file; 100% required |
| WP-32 | E2E flows (b)(c) + admin + webhooks + sync | opus | `apps/shop/e2e/flow-b-*.spec.ts`, `flow-c-*.spec.ts`, `admin-*.spec.ts`, `webhooks-*.spec.ts`, `assistant.spec.ts`, `nojs.spec.ts` | wizard end to end in both unlock modes (soft default; otp with the mock outbox), boundary length, purpose reorder, diagram legend counts, qty edits, inputs follow, package to cart, 3D and 2D, calculators, assistant with mock, companions, `/plants/for/[model]`, `/grow-in/[district]`; farm pages + enquiry (JS and no-JS) + admin pipeline + exactly one lead row; admin login + TOTP + forced enrolment, product edit -> storefront reflects (tag invalidation), injected product form tabs present, stock manual override survives an ERP pull, settings secret never returned, Connect Gmail action redirects to the mock, role matrix 404/403 over the CONVENTIONS permission list, audit rows, per-flow settings form + run, abandoned cart without consent sends nothing, discounts, dispatch planner, slot reminder job; webhook replay once, forged signature 401, amount mismatch not paid, late COMPLETED on cancelled order -> alert + refund task, WhatsApp status dedupe, STOP; ERP mock pull changes stock + revalidates, order push idempotent; `instant()` checks on PDP, collection, model page (only when `@next/playwright` is pinned) |
| WP-33 | Lighthouse + budgets + security + structural visual | opus | `tooling/lhci/**`, `apps/shop/e2e/security.spec.ts`, `apps/shop/e2e/visual.spec.ts`, `tooling/scripts/{bundle-budget,secret-scan}.ts` | LHCI mobile 3 runs: perf >= 90, SEO 100, a11y >= 95, LCP/CLS/TBT budgets, script size budgets per route; headers on live responses; CSP acceptance = zero CSP violation reports in the browser console across the crawler run and the three E2E flows (storefront `'unsafe-inline'` policy, nonce on admin/checkout/account/pay); canonical redirects: `www` host, `http`, trailing slash, uppercase path each give exactly one 301 to the canonical URL; `/api/_mock/*` is 404 on the production-config build; cookies not cached; rate limits return 429; IDOR probes; secret scan of tracked files; `pnpm audit --prod` no high/critical; `.env.example` quoting; no `public/robots.txt`; structural visual checks at 375/768/1440 on home, shop, PDP, wizard, results, cart, checkout: section order matches the prototype list in `docs/PROTOTYPE-PARITY.md`, every listed CTA present, no horizontal scroll (`document.scrollingElement.scrollWidth <= innerWidth`), axe colour-contrast clean, LCP image has width/height; screenshots stored for the orchestrator's review, no pixel diff against the prototype (different design); `modules:sync --check`; `turbo boundaries` clean |

Fix loop: the orchestrator reads Wave 4 failures, assigns each failing area to a fix agent (opus) that owns only the failing package paths, then reruns the failing suites. Repeat until green.

### Wave 5: audit and close (1 agent, opus)

| ID | Package | Owns | Ships / acceptance |
|---|---|---|---|
| WP-34 | Redundancy audit + docs + status | read everything; edits anywhere with orchestrator approval per file list | duplicate-implementation scan (money, phone, slug, fetch, HMAC, toasts, steppers, formatters, DataTables, settings forms) with removals; dead code and unused deps; `README.md` per package complete; `docs/CONVENTIONS.md` updated; `wiki/README.md` for the repo (stack, modules, how to run, how to deploy, how to add a module); BUILD-STATUS final with assumptions and client questions; forbidden-name grep clean; em dash grep clean in messages, cms seed and templates; final `pnpm typecheck lint test build e2e lhci` all green; orchestrator commits |

---

## 13. Definition of done and BUILD-STATUS.md format

The build is done when, on a fresh clone with Postgres 17 running:
1. `pnpm i && pnpm db:fresh shop && pnpm seed:build && pnpm seed:load && pnpm build` succeed with exit code 0 (checked, not inferred from "Compiled").
2. `pnpm test` (Vitest, all packages), `pnpm e2e` (all specs, mobile + desktop), `pnpm e2e:minimal`, `pnpm lhci`, `pnpm typecheck`, `pnpm lint`, `pnpm modules:sync --check`, `pnpm turbo boundaries`, `pnpm audit --prod` (no high or critical) and `pnpm secret-scan` (gitleaks-style regex over tracked files) are green.
3. CTA coverage: `e2e/.cta-hits.json` from the Playwright click fixture covers 100% of `data-cta` ids found by the source scan; crawler reports 0 failures and 0 CSP violations over all sitemap URLs.
4. Every integration works end to end against its mock from the admin "Test connection" and from a real flow (payment, OTP, order messages, feed generation, ERP pull and push, assistant answer).
5. Admin has every settings page in section 6 with masked secrets, test actions and setup steps; `docs/ADMIN-KEYS-CHECKLIST.md` lists what Shyam must enter.
6. Seed data: 159 client plants + Agarwood + 7 inputs active or preorder; 128 legacy drafts hidden; 644 districts; images mapped for 88 + sourced ones; `docs/CLIENT-QUESTIONS.md` and the admin Data gaps view agree.
7. Lighthouse mobile medians meet section 4.3; bundle budgets pass; structural visual checks (WP-33) pass; `docs/PROTOTYPE-PARITY.md` has no unmapped row; screenshots at 375/768/1440 reviewed by the orchestrator.
8. Security checks in WP-33 pass; no secrets in git; forbidden names absent; no em dashes or "phase"/"v1"/"v2" in shipped copy.
9. `apps/minimal` builds and passes its smoke test (pick-and-choose proof) and `docs/NEW-STORE-RECIPE.md` works when followed.
10. `wiki/README.md`, `docs/DEPLOY.md` (CloudPanel VPS: PGDG Postgres 17, roles, PM2 web fork + worker, nginx edits incl. the `.js/.css` regex location check, `/api/internal` localhost-only, releases + shared symlinks, image cache persistence, backups with age, restore drill) and BUILD-STATUS are current, and the orchestrator has committed everything on `ecom-build` (no push).

`BUILD-STATUS.md` format (kept at repo root, written only by the orchestrator, who merges the per-agent files `BUILD-STATUS/wp-xx.md` after each wave; each agent file has the same sections for its own package only):

```
# BUILD STATUS  (updated <iso timestamp IST>)
Current wave: N   Next action: <one line the orchestrator executes on resume>
## Wave table
| WP | Package | Model | Agent/session | Status (todo|running|blocked|done|failed) | Tests (unit/e2e) | Last commit | Notes |
## Assumptions (numbered, dated; A1.. from BUILD-PLAN plus new ones)
## Cross-package requests (from -> to, what, status)
## Known failures / flaky tests (spec, cause, owner)
## Client questions (link docs/CLIENT-QUESTIONS.md; count)
## Resume checklist
1. read this file; 2. `git status` and last commit; 3. `pnpm i && pnpm db:fresh shop && pnpm seed:load`; 4. rerun failing suites listed above; 5. continue the "Next action".
## Session limit log (when paused, when resumed, what was mid-flight)
```

Commit discipline: orchestrator commits after each wave with message `wave N: <packages>`; a mid-wave checkpoint commit `wip(wave N): <done packages>` is allowed when a session limit approaches so nothing is lost.

---

## 14. Open questions and assumptions

Decided defaults are in section 0 (A1 to A22). Points Shyam may want to overrule later, none blocking:
1. SVG plan diagram instead of canvas (A2).
2. Package scope `@ecomkit` and module name `ai-assistant` (A1, A3).
3. hasiru-ops transport: inventory needs a read-only `ecom_sync` Postgres role created by the client's team (a DB change, no code change); orders wait in the outbox until the ops-api endpoint exists (A4). The spec doc is the change request for the client's team.
4. COD off by default with partial-advance mode available (A14).
5. GST inclusive pricing; bio-pesticide 18% flagged for the CA (A7).
6. No fabricated reviews or ratings; "Rated 4.8" hidden until the client confirms (A13).
7. Media masters committed to git (about 45 MB) for reproducibility (A16).
8. Builds happen locally, release folders rsync to the VPS (A6).
9. Kannada deferred but routes and messages are ready (A15).
10. Price, bulk threshold, roles, bag sizes, policy wording, served states, FAQ answers and incentive limits are placeholders flagged `needs_review`; all surfaced in the admin Data gaps view and `docs/CLIENT-QUESTIONS.md`.
11. Sandbox verifications still owed before go-live (from integrations research): PhonePe webhook hash encoding, `expireAt` vs `expiryAt`, WhatsApp auth template payload on v26, Meta India catalog fields, Google product category id for plants, Gmail daily cap for the mailbox type. Each is a Test connection step in admin, with the research answers as defaults.
12. Image licences for old Woo product photos are unknown; the media library records source and the client is asked to confirm or replace.
13. Wizard unlock defaults to `soft` (A23); switch to `otp` in Settings > Planting once the WhatsApp authentication template is approved.
14. Storefront CSP carries `'unsafe-inline'` on script-src (A25); nonce CSP covers admin, account, checkout and pay.
15. Product feeds are scheduled files, not API pushes (A24).

SRS asks deliberately not built in this delivery (listed so the client sees them; each is a later change, none blocks launch):
- D10 map-based location picker: replaced by district typeahead + "Use my location" (nearest district HQ, no external API).
- D41 Kannada language toggle: strings and routes are ready (A15); the toggle and translations are not shipped.
- D9 wizard entry as a popup on the Plants page: replaced by the visible "Help me choose" toolbar CTA on `/plants` and collection pages linking to `/plan`.
- A14 full cash on delivery: `online_only` default, `partial_advance` and `pay_at_nursery` modes available; full COD is not offered.
- Product Q&A, wishlist or price-drop alerts, UTM builder, visual flow builder, Merchant API and `items_batch` push, SMS channel (DLT): cut as unrequested or premature (section 5.4, A24, A5).

---

## Review log (adversarial review of 2026-10-20, applied in this revision)

All 40 findings were applied. Two were applied with a change of placement; the reason is recorded.

| # | Decision | Where applied |
|---|---|---|
| 1 | Accepted: worktree per WP, `catalog:` pins, no agent-added deps, `BUILD-STATUS/wp-xx.md`, orchestrator-only generated files, single Wave 4 build | Hard rules, 2 tree, 12 orchestration rules, Wave 4 header |
| 2 | Accepted: schema.ts only, `push` on throwaway DBs, orchestrator `generate` per wave; partition DDL + monthly job for `analytics_event` | Hard rules, 1 drizzle row, 3 analytics, WP-12 |
| 3 | Accepted: storefront `'unsafe-inline'` (A25), nonce on dynamic routes, acceptance = zero console CSP violations | A25, 8, WP-31, WP-33 |
| 4 | Accepted: `@ecomkit/core/testing/fakes` (pricing, inventory, fit, reviews, shipping quote, notification channel) in WP-00a | 2.3 testing, WP-00a, WP-02, WP-04, WP-17 |
| 5 | Accepted: `productFormTabs` in the manifest and extension points; pricing, inventory, media, seo export tabs | 2.1, 2.4, 6 Products, WP-04/06/07/09 |
| 6 | Accepted with a placement change: `TotalsBreakdown` + `computeTotals()` live in `@ecomkit/core` (pure, Wave 0), not `checkout/domain`, because cart (WP-17) must not depend on checkout (WP-19) and both are in the same wave. F2 definitions pinned as asked | 2.3 totals, 12 contracts, WP-00b, WP-17, WP-19 |
| 7 | Accepted: template keys and permission strings fixed in CONVENTIONS | 12 string catalogues, WP-02, WP-10 |
| 8 | Accepted: `settings.actions[]` + `settings.customPanel`; settings subroutes removed from WP-18/20/26/27 | 2.1, 6 Settings, WP-08, WP-10, WP-18/20/26/27 |
| 9 | Accepted with a change: worktrees make sibling files in a nested directory merge cleanly, so the fix is explicit `layout.tsx` ownership (list in 12) plus two renames: `/grow-in/[district]` and `/admin/abandoned-checkouts`. `models/[model]/3d` stays nested with no layout file | 12 ownership rule, 4.1, WP-13, WP-22, WP-24, WP-25 |
| 10 | Accepted: `/plants/for/[model]` moves to planting; WP-24 owns the `(shop)/plants/for/` stub dir in Wave 2 (ownership is per wave) | 2.5 catalog + planting, 4.1, WP-04, WP-24 |
| 11 | Accepted: `planting-3d` module row added | 2 tree, 2.5 |
| 12 | Accepted: WP-00a (workspace, tooling, contracts, conventions, fakes, parity checklist) and WP-00b (core implementations) | Wave 0 |
| 13 | Accepted: contact autosave to `checkout_session`, consent checkbox, MARKETING category routing, no-consent test | 5.1 Checkout, 5.4, WP-19, WP-22 |
| 14 | Accepted: `unlock_mode = otp | soft`, default `soft` (A23) | A23, 5.2, 6 Settings, WP-24, WP-32 |
| 15 | Accepted: `supabase-rest` dropped; transports are `mock`, `pg` (read-only role, DB change by the client's team), `ops-api` spec | A4, 2.5, 10, 11, 14, WP-27 |
| 16 | Accepted: manual override wins (A26), `low_stock_threshold`, drift report shows both | A26, 2.5, 3 inventory, 11, WP-07, WP-32 |
| 17 | Accepted: reservation TTL = attempt expiry (15 min), sweep every minute, late COMPLETED -> alert + refund task (A27) | A27, 5.1 Payment, WP-19, WP-20 |
| 18 | Accepted: `customers_consent` only (A28); `marketing_consent` removed | A28, 2.5, 3 customers + marketing, WP-12, WP-23 |
| 19 | Accepted: EAV pair removed; tags carry `show_on_card` | 2.5 catalog, 3 catalog |
| 20 | Accepted: `catalog_video`, `pricing_history`, `core_outbox_event`, `places_nursery` removed; `checkout_address_draft` and `monitoring_uptime_ping` references deleted; `farmcalc_` prefix | 2.5, 3 |
| 21 | Accepted: per-flow settings forms; no visual builder; no `apply_discount` step or escalation | 2.5 flows, 3 flows, 6 Marketing, WP-22 |
| 22 | Accepted: file feeds only (A24); Merchant API and `items_batch` mocks removed from WP-23 | A24, 2.5 feeds, 10, WP-23 |
| 23 | Accepted: trgm `ILIKE` only; `search_document` and `search_synonym` removed; aliases in `catalog_product.search_aliases` | 2.5 search, 3 search, WP-05 |
| 24 | Accepted: Q&A, wishlist price-drop, UTM builder, dynamic segments, Orders "Drafts", weekly link crawl removed; four computed segment views | 2.5, 3, 5.1, 5.4, 6, 7, WP-16, WP-23 |
| 25 | Accepted: policies seeded `draft` + `noindex`, out of sitemap and footer; checkout shows the SRS note | 2.5 cms, 9.10, WP-09 |
| 26 | Accepted: `createReplacement()`, `source = replacement`, `parent_order_id` | 2.5 orders, 3 orders, 5.1, 6 Orders, WP-19 |
| 27 | Accepted: `slot_reminder` trigger, `slot.reminder` event, scheduled job in shipping | 3 flows, 5.4, 12 events, WP-18, WP-22 |
| 28 | Accepted: `boundary_ft` on plan and wizard step 2; `boundary_ft / spacing_ft`; fixture 835 ft / 10 ft = 84 | 3 planting, 5.2, WP-24 |
| 29 | Accepted: `proxy.ts` 301 rules for host, scheme, trailing slash, uppercase; WP-33 test | 2 tree, 4.2, 8, WP-00a, WP-33 |
| 30 | Accepted: `core_sequence` with `FOR UPDATE` for order and invoice numbers; concurrency test | 2.3 sequence, 3 core + orders, WP-00b, WP-19 |
| 31 | Accepted: `docs/PROTOTYPE-PARITY.md`, structural visual checks instead of pixel diff, suggest p95 < 80 ms over 350 products, ESLint `react/jsx-no-literals` | 2.4, 2 tree, WP-00a, WP-05, WP-28, WP-33, DoD 7 |
| 32 | Accepted: Playwright click fixture writing `e2e/.cta-hits.json`; `cta-coverage.ts` diffs against the source scan | WP-31, DoD 3 |
| 33 | Accepted: `e2e/gate.spec.ts` in WP-28, run by the orchestrator before Wave 4 | WP-28 |
| 34 | Accepted: mock stubs generated by `modules:sync` only when `mocks: true`; prod config has none; 404 guard kept; WP-33 asserts | 2.2, 8, 10, WP-00a, WP-33 |
| 35 | Accepted: enquiries create `customers_lead`; only `lead.created` pushes | 2.5 customers, 3 customers, 11, WP-16, WP-27 |
| 36 | Accepted: `@next/playwright` pinned to the `next` version; WP-00a verifies the release exists, else `instant()` checks are dropped | 1, WP-00a, WP-32 |
| 37 | Accepted: `admin.nav[].order` with bands in CONVENTIONS | 2.1, 6, 12, WP-08 |
| 38 | Accepted: `weightKg` on the cart-block line type, filled by cart or `origin.weightKg` | 12 contracts, 2.5 cart + truck-meter, WP-17, WP-24 |
| 39 | Accepted: `pnpm audit --prod` and the secret scan in DoD 2 and section 8 | 8, DoD 2, WP-33 |
| 40 | Accepted: not-built list in section 14; "Help me choose" CTA on `/plants` and collections | 14, 5.1 Collection tabs, WP-04, WP-31 |
