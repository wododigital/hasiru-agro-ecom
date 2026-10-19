# BUILD STATUS  (updated 2026-10-20T04:20+0530)
Current wave: 0 (done, gate round 1 green)   Next action: start Wave 1 (WP-02 to WP-14, WP-16) in parallel; each agent runs `pnpm db:fresh wp-xx`, pushes `core,<mod>` schemas with `drizzle-kit push`, and gates with `pnpm turbo run typecheck lint test --filter=@ecomkit/<mod>`. After the wave: enable the merged modules in `apps/shop/modules.config.ts` (and the generic ones in `apps/minimal/modules.config.ts`), `pnpm modules:sync` + `--app minimal`, `pnpm -F shop exec drizzle-kit generate --name wave1_<...>`, full gate, merge `BUILD-STATUS/*.md`, commit `wave 1: <packages>`.

Only the orchestrator edits this file; per-agent detail stays in `BUILD-STATUS/wp-xx.md`.

## Wave table
| WP | Package | Model | Agent/session | Status (todo, running, blocked, done, failed) | Tests (unit/e2e) | Last commit | Notes |
|---|---|---|---|---|---|---|---|
| WP-00a | Workspace, tooling, contracts, conventions | opus | wave-0 agent | done | 50 unit (core 21, eslint 10, scripts 6, shop 14) / 0 e2e | wave 0 | BUILD-STATUS/wp-00a.md; gate verified `pnpm i --frozen-lockfile`, `modules:sync --check` (shop + minimal), `turbo boundaries`, `next build` shop + minimal, `audit --prod` 0 high/critical |
| WP-00b | Core implementations | opus | wave-0 agent | done | 75 unit (8 files, real Postgres 17) / 0 e2e | wave 0 | BUILD-STATUS/wp-00b.md; every acceptance item in the row has a test (money, computeTotals F2, sequence 50 concurrent, settings seal/unseal/tamper, HMAC, rate limit, upsert guard, emit-in-tx, fingerprint, safeFetch SSRF) |
| WP-01 | UI + tokens + shell | opus | wave-0 agent | done | 26 unit / `apps/shop/e2e/wp-01.spec.ts` written, runs once WP-31's Playwright config exists | wave 0 | BUILD-STATUS/wp-01.md; gate: no hex outside tokens.css (test), AA contrast test on 3 palettes, `/admin/dev/ui` builds; axe run reported by the agent on a dev server (not re-run by the gate) |
| WP-02 | auth | opus | | todo | | | |
| WP-03 | media | opus | | todo | | | |
| WP-04 | catalog | opus | | todo | | | |
| WP-05 | search + facets | opus | | todo | | | |
| WP-06 | pricing + discounts | opus | | todo | | | |
| WP-07 | inventory | opus | | todo | | | |
| WP-08 | admin-shell | opus | | todo | | | |
| WP-09 | seo + cms | opus | | todo | | | |
| WP-10 | notifications | opus | | todo | | | |
| WP-11 | monitoring | opus | | todo | | | |
| WP-12 | analytics | opus | | todo | | | |
| WP-13 | places + data assets | sonnet | | todo | | | |
| WP-14 | data pipeline | opus | | todo | | | |
| WP-16 | customers + enquiries + reviews | opus | | todo | | | |
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
| WP-28 | apps/shop assembly + integration gate | opus | | todo | | | |
| WP-29 | admin dashboard + reports + keys checklist | opus | | todo | | | |
| WP-30 | apps/minimal proof + recipe | sonnet | | todo | | | |
| WP-31 | E2E flow (a) + CTA crawler | opus | | todo | | | |
| WP-32 | E2E flows (b)(c) + admin + webhooks + sync | opus | | todo | | | |
| WP-33 | Lighthouse + budgets + security + structural visual | opus | | todo | | | |
| WP-34 | Redundancy audit + docs + status | read | | todo | | | |

## Wave 0 gate (round 1, 2026-10-20) - what the orchestrator ran on the merged tree
| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | clean (lockfile re-resolved once by the gate after dropping the unused `vaul` dependency from `@ecomkit/ui`) |
| `pnpm modules:sync` (shop) and `--app minimal` with `['core', 'ui']` | 4 files each: `app/(admin)/admin/dev/ui/page.tsx`, `app/api/internal/revalidate/route.ts`, `src/generated/{registry,schema}.ts`; `--check` 0 out of date for both |
| `pnpm -F shop exec drizzle-kit generate` | `apps/shop/drizzle/0000_wave0_core.sql` (8 core tables, 4 enums) + hand-written `0001_core_rate_limit_unlogged.sql` |
| `pnpm turbo run typecheck lint test build` | 116/116 tasks successful (39 packages; 2 Next builds) |
| `pnpm turbo boundaries` | 183 files, no issues |
| `pnpm audit --prod` | 0 high, 0 critical, 1 moderate (esbuild dev-server advisory via better-auth > drizzle-kit peer; dev tooling only) |
| Review greps | no em dashes in packages/apps/docs copy; no hex outside `tokens.css`/`theme.css`; no deep `@ecomkit/*/src` imports; forbidden names absent (only "trail" as the English word in a Breadcrumbs comment); no "phase"/"v1"/"v2" in copy |

Gate fixes applied directly (small): `tooling/scripts/modules-sync.ts` `--list` was writing files (the prod `--list` overwrote the dev registry); it is read-only now with a CLI regression test. `packages/ui/src/admin/StoriesPage.tsx` sample rows carried Hasiru claims and an `HA-` order prefix in a brand-neutral package; replaced with generic sample text. `agentRules: false` added to both `next.config.ts` (WP-01 request). `vaul` removed from `@ecomkit/ui` (declared, never imported). CONVENTIONS section 3 gate command and section 8 `@source` glob corrected.

## Assumptions (numbered, dated; A1.. from BUILD-PLAN plus new ones)
- A1 to A28: BUILD-PLAN.md section 0 (2026-10-20).
- A29 (2026-10-20, WP-00a): Node 22.22 on the build Mac (`engines >=22.12`) instead of Node 24; pg-boss 12 and vitest 5 accept it.
- A30 (2026-10-20, WP-00a): local Postgres 17 listens on 5433 (5432 is Postgres 15); db helpers pick the first 17+ server, `DATABASE_ADMIN_URL` overrides.
- A31 (2026-10-20, WP-00a): `pnpm` (Homebrew 10.x) self-switches to the pinned 12.9.1; `corepack pnpm` is broken for pnpm 12 and is not used.
- A32 (2026-10-20, WP-00a): every plan pin verified on npm and at least 7 days old; xlsx moved to the official SheetJS 0.20.3 tarball (0.18.5 has two high advisories); open versions chosen and listed in docs/CONVENTIONS.md section 2.
- A33 (2026-10-20, WP-00a): `react/jsx-no-literals` runs with `ignoreProps: true` plus a visible-attribute selector (the plan's `ignoreProps: false` bans every className).
- A34 (2026-10-20, WP-00a): `partialPrefetching` is top-level in Next 16.4; `skipTrailingSlashRedirect` lets proxy.ts own the single 301.
- A35 (2026-10-20, WP-00a): cross-module services go through `manifest.provides` + `registry.service(key)` (null when the module is off); added `reviews` contract for `fakeReviews`.
- A36 (2026-10-20, WP-00a): route modules are `src/routes/*.tsx` (one extension in the export map); mock handlers `src/mocks/*.ts`.
- A37 (2026-10-20, WP-00a): seed JSON keeps integer rupees as in the research spec; importers convert to paise once (data/seed/SCHEMA.md).
- A38 (2026-10-20, WP-00a): canonical host comes from env `SITE_URL` (proxy cannot read DB settings per request); the admin General settings show it read-only.
- A39 (2026-10-20, WP-00a): fonts (DM Serif Display, Outfit) load in `apps/shop/app/layout.tsx` via next/font as CSS variables; `theme.css` maps them to `--font-display`/`--font-body`. `apps/shop/postcss.config.mjs` and `vitest.config.ts` exist although no row lists them.
- A40 (2026-10-20, WP-00b): core areas do not import `server-only` (worker and scripts run them under plain Node); events use one `core.event` queue fanned out to `<moduleId>.on.<event>` queues; pg-boss schema auto-installs outside production, production runs `installJobSchema(DATABASE_OWNER_URL)` at deploy.
- A41 (2026-10-20, WP-00b): env names `INTERNAL_SECRET` (one root secret, per-purpose derived keys), `INTERNAL_BASE_URL`, `SETTINGS_MASTER_KEY[_PREVIOUS]` as `<version>:<base64 32 bytes>`, `DATABASE_OWNER_URL`, `NEXT_PUBLIC_SITE_URL`, `ENABLE_MOCKS`.
- A42 (2026-10-20, WP-00b): `orderNumber(tx, { prefix })` takes the store prefix as an argument (core stays brand-neutral; orders settings supply `HA`); `invoiceNumber` defaults to `INV`; `gstSplit(taxPaise, { interState })`, odd paisa to SGST; stacking best-of compares the coupon with the sum of non-stackable automatic promos.
- A43 (2026-10-20, WP-00b): `getSettings` is a plain DB read (decrypted secrets are tainted and cannot pass the cache serializer); `safeFetch` is https/443 only with connect-time address checks and a buffered 10 MB response; retention: error events 30 d, integration log 90 d, rate-limit rows 1 d after the window, all in daily `core.prune` 03:30 IST.
- A44 (2026-10-20, WP-01): `--color-muted` darkened to `#6e5a42` (the plan's `#8B7355` fails AA on cream); added `--color-primary-hover`, `--color-primary-strong`, `--color-ring`, `--color-overlay`; Tailwind's default palette is disabled so only semantic colours exist as utilities.
- A45 (2026-10-20, WP-01): Select, Checkbox, Segmented and DateRange are native inputs; Sheet is the radix Dialog with a `side`; DataTable paginates on the server via URL `page`; the stories page is `notFound()` in production unless `ENABLE_MOCKS=1`.
- A46 (2026-10-20, WP-01): `@source '../../../packages/*/src/**/*.{ts,tsx}'` is the working glob (the bare directory form matched nothing).
- A47 (2026-10-20, gate): `ui` is enabled in both `apps/shop` and `apps/minimal` (the stories page is dev/test only, so it costs the proof store nothing). `apps/minimal` has no `drizzle.config.ts` yet; WP-30 adds it, and `drizzle-kit generate` runs for `apps/shop` only until then.
- A48 (2026-10-20, gate): `apps/shop/drizzle/0001_core_rate_limit_unlogged.sql` is hand-written (Drizzle cannot express UNLOGGED). The audit-log `REVOKE UPDATE, DELETE, TRUNCATE ... FROM <app_role>` needs the production role name and goes into `docs/DEPLOY.md` (WP-28), not a migration.
- A49 (2026-10-20, gate): `_work/**` (research-run scripts and JSON) and the pre-existing deletion of `wc-product-export-16-10-2026-1792136471168.csv` were left out of the wave 0 commit; neither is wave 0 output. WP-14 reads `_work/*.json` from the working tree.

## Cross-package requests (from -> to, what, status)
| From | To | What | Status |
|---|---|---|---|
| WP-00a | WP-00b | core manifest schema + revalidate route, `startWorker`, `Paise` re-export, `createTestDb` via `@tooling/scripts/db`, `onRequestError` adapter | done (WP-00b shipped all five) |
| WP-00a | WP-01 | globals.css replacement, font mapping, admin palette, ui exports | done |
| WP-00a | WP-11 | hand-written `/api/health/live` and `/api/health/ready` under `apps/shop/app/api/health/` | open (Wave 1) |
| WP-00a | WP-23 + WP-28 | `cspSources()` readable by proxy.ts without a per-request DB query; WP-28 wires it (today: env `CSP_VENDOR_SOURCES`) | open |
| WP-00a, WP-00b | WP-28 | instrumentation.ts: `export { onRequestError } from '@ecomkit/core/observability'`, `loadEnv()` in `register()`, `setAuthProvider(() => registry.service('auth'))`; header/footer in `(shop)/layout.tsx`; deploy runs `installJobSchema(DATABASE_OWNER_URL)` before the worker | open |
| WP-00b | orchestrator | re-sync both apps; `drizzle-kit generate`; append UNLOGGED alter | done (0000 + 0001 migrations) |
| WP-00b | orchestrator | audit-log REVOKE grant | moved to docs/DEPLOY.md (WP-28), see A48 |
| WP-00b | orchestrator | `.env.example` must list `INTERNAL_SECRET`, `INTERNAL_BASE_URL`, `SETTINGS_MASTER_KEY`, `SETTINGS_MASTER_KEY_PREVIOUS`, `DATABASE_OWNER_URL`, `ENABLE_MOCKS`, `NEXT_PUBLIC_SITE_URL` | open: `.env*` files are permission-blocked for agents and the gate alike; Shyam adds the lines (or a Wave 1 agent with access to the file). Fix F0-1 below |
| WP-00b | all module packages | tests use `createTestDb('<wp-id>-<file>', { schemas: ['core', '<mod>'] })`; emit with `{ tx }` inside the write transaction; `defineSettings` for settings; `integrationCall` + `safeFetch` for every outbound call | info |
| WP-01 | orchestrator | enable `ui`; `agentRules: false`; CONVENTIONS `@source` fix | done |
| WP-01 | WP-28 | mount `<ToastRegion>` once in `(shop)/layout.tsx`; header drawer = `Sheet side="left"`; mobile cart bar = `StickyBar`; copy from `messages.shell` | open |
| WP-01 | WP-31 | include `apps/shop/e2e/wp-01.spec.ts` in the Playwright config (dev/test build, `ENABLE_MOCKS=1`, staff session for `/admin`) | open |

## Open fixes
- F0-1 (`.env.example`): add the WP-00b env names listed above with safe placeholder values (`SETTINGS_MASTER_KEY='1:<base64 32 bytes>'`, single-quoted). Owner: Shyam or WP-28 (whoever can edit `.env*`).

## Known failures / flaky tests
None on the merged tree. `pnpm modules:sync --config prod --check` exits 1 against the committed dev tree by design (registry `mocks` flag); `--config prod --list` is the read-only prod plan.

## Client questions (link docs/CLIENT-QUESTIONS.md; count)
Not started (WP-14).

## Resume checklist
1. read this file; 2. `git status` and last commit; 3. `pnpm i --frozen-lockfile && pnpm db:fresh shop` (seed:load has nothing to load until WP-14); 4. `pnpm turbo run typecheck lint test build` and `pnpm modules:sync --check`; 5. continue the "Next action".

## Session limit log (when paused, when resumed, what was mid-flight)
- 2026-10-20 ~04:20 IST: wave 0 gate committed; nothing mid-flight.
