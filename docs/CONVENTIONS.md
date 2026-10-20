# CONVENTIONS (binding for every work package)

Written in Wave 0 (WP-00a). Frozen like the contracts: a change needs an orchestrator decision recorded in `BUILD-STATUS.md`. Where this file and `BUILD-PLAN.md` differ, this file records the Wave 0 decision; `docs/REQUIREMENTS-ADDENDUM.md` still wins over both.

## 1. Environment (this Mac)

| Item | Value | Note |
|---|---|---|
| Node | 22.22 (`engines.node >=22.12`) | Plan said Node 24; the build Mac runs 22.22, which pg-boss 12 and vitest 5 accept. Use Node 24 on the VPS if available. |
| pnpm | 12.9.1 pinned in `packageManager` | `corepack pnpm` is broken for pnpm 12 (corepack 0.34 looks for `bin/pnpm.cjs`). Plain `pnpm` (Homebrew pnpm 10) switches itself to 12.9.1 from the pin, so just run `pnpm`. |
| Postgres | **17 on `localhost:5433`** | `localhost:5432` on this Mac is Postgres 15. The db helpers probe 5432 then 5433 and take the first server >= 17; set `DATABASE_ADMIN_URL` to override. Never use the 15 server. |
| Docker | none | |

Install settings live in `pnpm-workspace.yaml`: `saveExact`, `minimumReleaseAge: 10080` (7 days, strict), `engineStrict`, and both `allowBuilds` (pnpm 11+) and `onlyBuiltDependencies` (pnpm 10) for `sharp`, `esbuild`, `@tailwindcss/oxide`.

## 2. Dependency catalog (verified 2026-10-20)

Every third-party version lives once in the `catalog:` of `pnpm-workspace.yaml`; packages declare `"catalog:"`. Agents never add, remove or bump a dependency and never edit `pnpm-lock.yaml`: write a cross-package request instead. Every workspace package is already declared and linked, so later waves never install.

All plan section 1 pins were checked with `npm view <pkg>@<ver> version` and their publish dates: **all exist and all are at least 7 days old.** One change, for security not age: `xlsx` (below). `pnpm audit --prod` after install: 0 high, 0 critical, 1 moderate (esbuild dev-server advisory via better-auth's drizzle-kit peer; dev tooling only). `@next/playwright` 16.4.0 exists and matches `next` 16.4.0, so `instant()` checks stay.

| Package | Pin | Published |
|---|---|---|
| next / @next/playwright / @next/eslint-plugin-next | 16.4.0 | 2026-10-06 (16.4.2 exists; bump after 2026-10-29 per plan) |
| react / react-dom / @types/react / @types/react-dom | 19.3.0 | 2026-09-09 |
| typescript | 5.9.3 | 2025-09-30 (not 7.x, per plan) |
| turbo | 2.11.7 | 2026-10-02 |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | 2026-07-16 |
| zod | 4.6.5 | 2026-09-13 |
| drizzle-orm / drizzle-kit | 0.45.3 / 0.31.11 | 2026-09-21 |
| pg / @types/pg | 8.23.1 / 8.23.1 | 2026-09-30 |
| pg-boss | 12.37.0 | 2026-10-05 |
| better-auth | 1.7.7 | 2026-09-30 |
| sharp | 0.35.5 | 2026-09-27 |
| three / @types/three | 0.186.1 / 0.186.0 | 2026-09-24 |
| @playwright/test | 1.63.0 | 2026-09-04 |
| vitest | 5.0.3 | 2026-09-30 |
| @lhci/cli | 0.15.1 | 2025-06-25 |
| xlsx | **changed:** official SheetJS tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | npm stops at 0.18.5 (2022-03-24), which `pnpm audit --prod` flags with two high advisories (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9). 0.20.3 fixes both, same API. |

Versions the plan left open, chosen now (newest stable at least 7 days old; at least 14 days where the plan asked):

| Package | Pin | Why |
|---|---|---|
| @anthropic-ai/sdk | 0.131.0 | newest at least 14 days old (plan rule) |
| @react-pdf/renderer | 4.9.0 | newest at least 14 days old (plan rule) |
| babel-plugin-react-compiler | 1.0.0 | required by `reactCompiler: true` |
| eslint / @eslint/js | 9.39.5 | eslint 10 is out, but eslint-plugin-react 7.37.5 peers only `^9.7` |
| typescript-eslint | 8.71.1 | 8.71.2 was under 7 days at install time |
| eslint-plugin-react / eslint-plugin-react-hooks / globals | 7.37.5 / 7.1.1 / 17.13.0 | |
| tsx | 4.23.15 | scripts and the worker |
| vite | 8.3.4 | vitest 5 peer (not optional) |
| happy-dom, @testing-library/react, @testing-library/dom | 21.0.1, 16.3.3, 10.4.2 | component tests in `ui` |
| @axe-core/playwright | 4.13.0 | axe checks |
| radix-ui, class-variance-authority, clsx, tailwind-merge, lucide-react, sonner, vaul, tw-animate-css | 1.8.0, 0.7.1, 2.1.1, 3.7.0, 1.55.0, 2.0.8, 1.1.2, 1.4.0 | shadcn/ui primitives vendored into `packages/ui` |
| sanitize-html / @types/sanitize-html | 2.18.0 / 2.16.2 | `core.safeHtml()` |
| server-only | 0.0.1 | |
| @types/node | 22.20.5 | matches Node 22 |

Not added (use what exists): `uuid` (write UUIDv7 in `core/ids`), `dotenv` (`process.loadEnvFile`), date libraries (`Intl` + `Asia/Kolkata`), chart libraries (SVG in `ui`), carousel libraries (CSS scroll-snap), a date-picker (`<input type="date">`).

Next config deviation: `partialPrefetching` is a top-level option in Next 16.4, not `experimental.partialPrefetching`. `skipTrailingSlashRedirect: true` is set so `proxy.ts` issues the single canonical 301.

## 3. Commands

| Command | What |
|---|---|
| `pnpm install` | orchestrator only (lockfile) |
| `pnpm db:fresh <wp-id>` | drop + recreate `ecomkit_<wp_id>` from template `ecomkit_template` (has `pg_trgm`); prints `DATABASE_URL`. `--refresh-template` rebuilds the template. Only `ecomkit_*` databases are ever dropped. |
| `DATABASE_URL=… ECOMKIT_SCHEMA=core,catalog pnpm -F @tooling/scripts exec drizzle-kit push --config drizzle.config.ts` | push package schemas to your throwaway DB (refuses non-`ecomkit_*` URLs). Never `drizzle-kit generate`. |
| `pnpm modules:sync [--app shop\|minimal] [--config dev\|test\|prod] [--check] [--list]` | orchestrator only; codegen from `apps/<app>/modules.config.<config>.ts` |
| `pnpm turbo run typecheck lint test --filter=@ecomkit/<mod>` | your package's gate (`pnpm -F <pkg> typecheck lint test` does NOT work: pnpm hands `lint test` to tsc as file paths) |
| `pnpm seed:build`, `pnpm seed:load [--app shop]` | data pipeline steps, then module seed hooks |
| `pnpm cta-coverage [--strict]` | `data-cta` ids in source vs `apps/shop/e2e/.cta-hits.json` |
| `pnpm turbo boundaries` | undeclared and out-of-package imports |

## 4. Layout, ownership, package anatomy

- Layout and ownership: BUILD-PLAN section 2 and section 12. Touch only your row's paths. Shared files you need changed go in your status file under "Cross-package requests".
- Every module is `packages/<id>`, name `@ecomkit/<id>`, workspace-private, source-only TypeScript (no build step). Its `package.json` exports, already written:

| Export | File | Rule |
|---|---|---|
| `.` | `src/index.ts` | re-exports only; prefer the specific exports |
| `./manifest` | `src/manifest.ts` | `export default defineModule({...})` |
| `./schema` | `src/schema.ts` | Drizzle tables, every table `<id>_` prefixed (hyphens become underscores: `erp_`, `farmcalc_`, `ai_` as listed in plan section 3) |
| `./domain` | `src/domain/index.ts` | pure TS, no React/Next/DB (ESLint enforced) |
| `./server` | `src/server/index.ts` | starts with `import 'server-only'` |
| `./ui` | `src/ui/index.ts` | server components by default; client islands `*Island.tsx` |
| `./admin` | `src/admin/index.ts` | admin pages and forms |
| `./routes/*` | `src/routes/*.tsx` | **always `.tsx`**, pages and route handlers alike (the export map has one extension) |
| `./mocks/*` | `src/mocks/*.ts` | mock route handlers (listed in `mockRoutes`) |
| `./messages` | `src/messages.ts` | default copy |

  `@ecomkit/core` exports one entry per area: `contracts, manifest, testing, testing/fakes, money, totals, sequence, db, env, auth-context, events, jobs, settings, audit, rate-limit, http, observability, cache-tags, ids, validation, schema, routes/*` (each `src/<area>/index.ts`; `routes/*` are `.ts`). `@ecomkit/ui` exports `.` and `./tokens.css` (WP-01 may add exports).
- Import other modules only through these exports. `@ecomkit/<x>/src/**` and relative hops into another package are ESLint errors; `turbo boundaries` rejects undeclared packages.
- Hard dependencies are already declared as `workspace:*`. Optional modules are never imported: use `registry.has(id)`, `registry.service(key)` or an extension point.
- `react`, `react-dom`, `next` are peer + dev dependencies of packages (one Next instance in the app; verified a single `next@16.4.0` in the store).
- README per package: responsibility, public API, tables, routes, settings, events (emitted/consumed), jobs, extension points, how to disable.

## 5. Module manifest rules (contract: `packages/core/src/contracts/manifest.ts`)

- Keep `src/manifest.ts` light: constants, zod and `Lazy` thunks only (`() => import('./server/x').then((m) => m.handler)`). Codegen and the worker load every manifest.
- `routes[]`: `{ path, module: 'routes/<file>', kind: 'page'|'route', exports: [...], segmentConfig? }`. Pages under `/admin` go to `app/(admin)`, other pages to `app/(shop)`, handlers to `app/<path>/route.ts`. A page must export `default`; a handler only HTTP methods. Segment config values are written into the stub as literals.
- `mockRoutes[]`: handlers under `/api/_mock/<provider>/…`, generated only for `mocks: true` configs (dev, test). Handlers also return 404 unless `ENABLE_MOCKS=1`.
- `admin.pages[]`: under `/admin`, never `/admin/settings/*` (admin-shell renders settings from `settings`).
- `admin.nav[].order` = band + 0..99. Bands: Home 0, Orders 100, Products 200, Customers 300, Marketing 400, Content 500, Analytics 600, Enquiries 700, Health 800, Settings 900. `icon` is a lucide name in kebab-case.
- `settings: { schema: z.object(...), actions?, customPanel? }`. `.meta({ secret: true })` = encrypted, `.meta({ group, help, placeholder })` drive the form.
- `jobs` are named `<id>.<name>`; `schedules[].job` must name one of the module's own jobs; `tz` defaults to `Asia/Kolkata`.
- `provides: { <service>: Lazy<impl> }` for the cross-module services (`auth, pricing, inventory, reviews, places, shipping, notifications`); one provider per key.
- `on: { 'order.paid': Lazy<handler> }` subscribes to catalogue events; `emits` lists what you emit.
- Extension points: `productFormTabs, cartBlocks, pdpSections, productCardChips (batched resolve), checkoutSections, dashboardWidgets, reports, healthChecks, sitemapSources, seedHooks`.
- Runtime access: `import { registry } from '<app>/src/generated/registry'` in the app; packages receive what they need from the app or from `registry` passed in. `registry.list('<point>')` returns items sorted by `order`, each tagged with `moduleId`.
- Generated files start with `// generated by modules:sync, do not edit`; a file without that header is never overwritten (hand-written override). `modules:sync --check` fails on drift. The committed tree is the **dev** config, so CI runs `--check` with the default (dev) config; production builds run `pnpm modules:sync --config prod` first (no `_mock` stubs, registry `mocks: false`). `--config prod --check` against the committed tree therefore reports the registry (and any mock stubs) as out of date by design; `--config prod --list` prints the prod plan.

## 6. Naming

| Thing | Convention | Example |
|---|---|---|
| Module id | kebab-case, matches the folder | `farm-calculators` |
| Table | `<mod>_<entity>` snake_case singular | `catalog_product` |
| Drizzle const | camelCase of the table | `catalogProduct` |
| Columns | snake_case; money `*_paise integer`; time `*_at timestamptz`; flags `is_*` | `price_paise`, `created_at` |
| Primary keys | `id uuid` UUIDv7 from `core.ids.newId()` | |
| Job | `<mod>.<verb-noun>` | `catalog.rebuild-facets` |
| Event | catalogue only (contracts/events.ts) | `order.paid` |
| Cache tag | core constants only | `product:<id>` |
| Rate-limit key | `<routeId>:<subject>` | `otp-send:+9198…` |
| Message key | nested object in `messages.ts` | `messages.card.addToCart` |
| `data-cta` | `<area>-<action>` kebab, unique per page | `hero-shop-plants` |
| Test database | `ecomkit_<wp_id>` | `ecomkit_wp_04` |
| Env var | SCREAMING_SNAKE, documented in `.env.example` | `SITE_URL` |

## 7. Copy, messages, formatting

- Storefront strings live in `messages.ts` objects (module defaults) and `apps/shop/messages/en.ts` (host overrides). Components take a `messages` prop or read the host object; Kannada later adds `messages/kn.ts`.
- ESLint on `packages/*/src/ui/**`, `packages/*/src/routes/**`, `apps/*/app/**` (admin exempt): `react/jsx-no-literals` with `noStrings: true` and **`ignoreProps: true`**, plus a selector that rejects literal text in `alt, title, placeholder, aria-label, aria-description, aria-placeholder, aria-roledescription, aria-valuetext, label`. Deviation from the plan's `ignoreProps: false`: with `false` the rule rejects every attribute string (`className`, `href`, `lang`), which would ban Tailwind classes. Punctuation-only text (`·`, `/`, `×`, `+`, `-`, `|`, `:`, `%`, `→`) is allowed.
- No em dashes anywhere in copy or seed text; no "phase", "v1", "v2" in user-facing copy; no AI-tool names in shipped code or comments.
- Money: integer paise; display `Rs 1,23,456` via `core.money.formatINR` (en-IN grouping). Never format money elsewhere.
- Dates: `timestamptz`; admin-entered datetimes are `Asia/Kolkata`; display in IST.
- Phones: `core.ids.normalisePhone()` (E.164 +91) at every capture and match point.

## 8. Design tokens and theming

Semantic tokens only (`packages/ui/src/tokens.css`, WP-01): `--color-bg, --color-surface, --color-surface-2, --color-text, --color-muted, --color-primary, --color-primary-fg, --color-accent, --color-accent-fg, --color-success, --color-warning, --color-danger, --color-border, --color-role-main, --color-role-host, --color-role-biomass, --radius-sm/md/lg, --font-display, --font-body, --shadow-card`. No hex outside `tokens.css` and `apps/shop/theme.css`.

- Fonts are loaded in `apps/shop/app/layout.tsx` with `next/font/google` (latin, swap) as CSS variables `--font-dm-serif-display` and `--font-outfit` on `<html>`; `theme.css` maps `--font-display: var(--font-dm-serif-display)` and `--font-body: var(--font-outfit)`.
- The admin root layout wraps children in `<div data-surface="admin">`; WP-01 defines the neutral admin palette under `[data-surface="admin"]`.
- `apps/shop/app/globals.css` is a stub from WP-00a (`@import 'tailwindcss'`); WP-01 owns and replaces it (tokens, theme, `@source '../../../packages/*/src/**/*.{ts,tsx}'`; the bare directory form matches nothing).

## 9. Testing

- Vitest per package (`test/**/*.test.ts`), real Postgres for server code: `pnpm db:fresh wp-xx`, then push your schema (section 3). `@tooling/scripts/db` exports `freshDatabase(name)`, `dropDatabase(name)`, `databaseName(name)`, `TEMPLATE_DB`; `@ecomkit/core` already depends on it for `createTestDb`.
- Fakes in `@ecomkit/core/testing/fakes` implement the frozen contracts: `fakePricing`, `fakeInventory`, `fakeFit`, `fakeReviews`, `fakeShippingQuote`, `fakeNotificationChannel`. Use them until the real module lands; never fork your own.
- Apps: unit tests in `apps/<app>/test/*.test.ts` (vitest config limits to that folder); Playwright specs in `apps/shop/e2e/*.spec.ts`, one file per work package.
- Tests use a fixed clock for anything time-based and IST dates.
- Every CTA carries `data-cta="<id>"` (coverage scan).

## 10. Frozen catalogues

Source of truth is code in `packages/core/src/contracts/`; this table mirrors it.

1. **Notification template keys** (`TEMPLATE_KEYS`, notifications.ts): `otp.login`, `otp.unlock`, `order.confirmed`, `order.packed`, `order.dispatched`, `order.delivered`, `order.payment_failed`, `order.replacement_created`, `slot.reminder`, `cart.reminder_1`, `cart.reminder_2`, `cart.reminder_3`, `review.request`, `stock.back_in_stock`, `lead.follow_up`, `enquiry.received_admin`, `enquiry.received_customer`, `alert.critical`, `alert.digest`, `staff.invite`, `test.send`.
2. **Permissions** (`PERMISSIONS`, auth.ts) and the default role matrix (`ROLE_PERMISSIONS`):

| Permission | owner | manager | catalog_editor | fulfilment | support |
|---|---|---|---|---|---|
| orders.read | x | x | | x | x |
| orders.write | x | x | | x | |
| orders.refund | x | x | | | |
| orders.dispatch | x | x | | x | |
| products.read | x | x | x | x | x |
| products.write | x | x | x | | |
| inventory.read | x | x | x | x | x |
| inventory.write | x | x | x | x | |
| pricing.write | x | x | x | | |
| media.write | x | x | x | | |
| content.write | x | x | x | | |
| reviews.moderate | x | x | x | | x |
| customers.read | x | x | | x | x |
| customers.write | x | x | | | x |
| customers.export | x | x | | | |
| enquiries.read | x | x | | x | x |
| enquiries.write | x | x | | | x |
| marketing.write | x | x | | | |
| analytics.read | x | x | | | |
| health.read | x | x | | | |
| jobs.retry | x | x | | | |
| settings.read | x | x | | | |
| settings.write | x | x | | | |
| settings.secrets | x | | | | |
| staff.manage | x | | | | |
| audit.read | x | x | | | |

   `support` sees personal data masked (plan section 8).
3. **Admin nav bands**: section 5 above (`NAV_BANDS`).
4. **Events** (`EVENT_NAMES` + `EventPayloads`, events.ts): the 34 names in BUILD-PLAN section 12; payloads carry ids, subscribers read fresh state.
5. **Beacon events** (`TRACK_EVENTS`, analytics.ts).
6. **Module ids** (`MODULE_IDS`, common.ts).

## 11. Contracts (TypeScript, `packages/core/src/contracts/`, import from `@ecomkit/core/contracts`)

| Contract | File | Main types |
|---|---|---|
| manifest | manifest.ts | `ModuleManifest`, `RouteDef`, `AdminNavItem`, `ModuleSettings`, `AppConfig`, `NAV_BANDS` |
| services | services.ts | `ServiceMap` (`registry.service(key)`) |
| events | events.ts | `EventPayloads`, `EventName`, `EventHandler`, `Emit`, `EVENT_NAMES` |
| jobs | jobs.ts | `JobDef`, `JobHandler`, `JobContext`, `JobOptions`, `ScheduleDef` |
| totals | totals.ts | `TotalsInput`, `TotalsBreakdown`, `ComputeTotals` (F2 definitions in comments) |
| cart-block, pdp-section, card-chip, checkout-section, product-form-tab, settings-action, dashboard-widget, report, health-check, sitemap-source, seed-hook | extensions.ts | one section each |
| auth-context | auth.ts | `Viewer`, `AuthContext`, `PERMISSIONS`, `ROLE_PERMISSIONS` |
| payment-provider | payments.ts | `PaymentProvider`, `PaymentState` |
| shipping-method | shipping.ts | `ShippingQuoter`, `ShippingMethodQuote`, `VehicleChoice` |
| inventory-ops | inventory.ts | `InventoryOps`, `StockInfo`, `Availability` |
| notification-channel | notifications.ts | `NotificationChannel`, `NotificationSender`, `TEMPLATE_KEYS` |
| erp-adapter | erp.ts | `ErpAdapter`, `ErpOrderPayload`, `ErpLeadPayload` |
| places | places.ts | `DistrictRef`, `ClimateFit`, `PlacesReader` |
| planting | planting.ts | `PlanLayout`, `Role` |
| seo | seo.ts | `MetadataInput`, `JsonLdBuilders` |
| search | search.ts | `FacetIndex`, `FacetSourceRow` |
| analytics | analytics.ts | `TrackEvent`, `TRACK_EVENTS` |
| pricing | pricing.ts | `PriceQuote`, `PricingReader` |
| media | media.ts | `ImageRef` |
| reviews (added for the fakes) | reviews.ts | `ReviewAggregate`, `ReviewsReader`, `RATING_MIN_REVIEWS` |
| money type | common.ts | `Paise` (brand), `Lazy`, `Logger`, `DateRange` |

`Paise` is defined in contracts; `core/money` re-exports it with the helpers.

## 12. Request pipeline (`apps/shop/proxy.ts`)

- One 301 to the canonical URL: host and scheme from `SITE_URL` (skipped when unset, i.e. local dev), trailing slash stripped (not on `/`), path lowercased outside percent-escapes. Case is never changed under `/_next/ /api/ /media/ /r/ /order/ /feeds/ /og/` (tokens and files). Tokens in other paths must be lowercase.
- Behind nginx it trusts `x-forwarded-proto` and `x-forwarded-host`.
- `x-locale` request header: `kn-IN` for `/kn…`, else `en-IN` (prefix reserved, not routed).
- CSP: nonce + `strict-dynamic` on `/admin /account /checkout /pay` (nonce in `x-nonce`); static CSP with `'unsafe-inline'` elsewhere (A25). Marketing vendor sources come from `CSP_VENDOR_SOURCES` until the marketing module supplies them.
- Security headers on every response: nosniff, referrer policy, permissions policy, `X-Frame-Options: DENY`, HSTS when the canonical scheme is https.

## 13. Forbidden names

Never in code, tables, files, comments or copy (from `docs/research/internal-patterns.md` section 9): `Trail`, `trail.js`, `trail_events`, `trail_sessions`, `TrailController`, `IntegrationFailure`, `LogNotFound`, `HandleRedirects`, `CaptureAttribution`, `MarketingScript`, `marketing_scripts`, `ContentHealthOverview`, `ZohoCrmService`, `hfBeacon`, `tr_v` (cookie), `/api/t`, any Vibez / Ashraya / Hasiru Farms identifiers, `cms-core` namespaces. Also no AI-tool or process names (`claude`, `anthropic`, `copilot`, Cursor the editor, `swarm`, `opus`, `sonnet`) in shipped code or comments (a pagination `cursor` is fine), except the assistant module's provider adapter and its settings where the vendor SDK must be named.

## 14. Status files and git

- Write `BUILD-STATUS/wp-xx.md` from the template in `BUILD-STATUS/README.md`. Never edit `BUILD-STATUS.md`, `modules.config*.ts`, `src/generated/*` or `pnpm-lock.yaml`.
- Tool-written agent files stay out of the repo: `turbo.json` sets `agentGuidance: false`; if `next dev` writes an `AGENTS.md`, delete it rather than commit it (client handover rule).
- Commit only if your brief says so; in the current run the orchestrator's gate commits. Never push.

## 15. Security rules for route handlers and identity keys (added by the Wave 1 gate, 2026-10-20)

1. **Client IP**: `clientIp(req)` from `@ecomkit/core/http` (trusts only nginx `X-Real-IP`; `{ headers: await headers() }` in server components). Never read `X-Forwarded-For`: its first entry is client-controlled and spoofing it bypasses rate limits. Production nginx sets `proxy_set_header X-Real-IP $remote_addr;`.
2. **Contact hashes fail closed**: `hashContact(value)` from `@ecomkit/core/http` is the one phone/email hash (E.164 or lowercased email, HMAC under `INTERNAL_SECRET`, purpose `contact-hash`). It returns null for an unparseable phone; never hash a raw string as a fallback, and treat null as "no identity" wherever a limit applies.
3. **Unverified contacts** (notify-me, enquiries, newsletter): cap pending items per contact; an anonymous request must never enrol a third party into repeated messages.
4. **CSRF on route handlers**: server actions get Next's Origin check, route handlers do not. Every cookie-authenticated, state-changing handler (POST/PUT/PATCH/DELETE under `app/api` that reads the session) starts with `if (!isSameOrigin(req)) return 403` from `@ecomkit/core/http`, checks the viewer before reading the body, and caps the body with `readRawBody(req, max)` (counts real bytes; never trust Content-Length alone).
5. **Outbound HTTP**: `safeFetch` only (https, public addresses, allowlisted hosts); it strips headers on cross-origin redirects and never forwards a body across them.
6. **Cache helpers**: `cacheFor(tags, life?)` and `expireTags(tags)` live in `@ecomkit/core/cache-tags`; no module keeps its own copy.
