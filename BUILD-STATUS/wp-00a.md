# WP-00a Workspace, tooling, contracts, conventions (status: done, awaiting gate commit)   updated 2026-10-20T03:15+0530

Worked directly in the main tree on `ecom-build` as briefed (no worktree). Nothing committed or pushed.

## Shipped
- Root: `package.json` (packageManager pnpm@12.9.1, engines node >=22.12, scripts db:fresh, modules:sync, seed:build, seed:load, cta-coverage, turbo tasks), `pnpm-workspace.yaml` (full `catalog:`, saveExact, minimumReleaseAge 7d, engineStrict, allowBuilds + onlyBuiltDependencies), `.npmrc`, `.gitignore` additions, `turbo.json`, `eslint.config.js`, `pnpm-lock.yaml` (from the one install), `.env.example`.
- `tooling/tsconfig` (base, nextjs presets); `tooling/eslint` (flat config: copy rule, visible-attribute rule, package boundaries, domain purity, Next rules; fixture tests); `tooling/scripts`: `db.ts` + `db-fresh.ts` (template DB `ecomkit_template` with pg_trgm, refuses non-`ecomkit_*`), `modules-sync.ts` (write / `--check` / `--list` / `--config`, never overwrites hand-written files, prunes stale generated files), `drizzle.config.ts` (push package schemas to a throwaway DB), `seed/run.ts` (build steps shell + seed hooks loader), `cta-coverage.ts` skeleton.
- `packages/core`: `package.json` (all area exports), `src/contracts/**` (every contract in plan section 12 plus `reviews`, `services`, `jobs`), `src/manifest/**` (defineModule, defineAppConfig, resolveModules, createRegistry, planFiles, routeFilePath, core manifest), `src/testing/fakes/**` (6 fakes), `src/index.ts`, README, tests.
- All 34 `@ecomkit/*` packages scaffolded: `package.json` (exports, scripts, hard deps as `workspace:*`, `catalog:` deps, react/next as peers), `tsconfig.json`, `src/index.ts`, README stub naming the owner.
- `apps/shop`: package.json (depends on every module so one install links all), next.config.ts, tsconfig.json, postcss.config.mjs, vitest.config.ts, proxy.ts (+ test), instrumentation.ts, modules.config.ts + dev/test/prod, drizzle.config.ts, worker.ts, app/layout.tsx (fonts), app/(shop)/layout.tsx, app/(admin)/layout.tsx, app/globals.css stub, src/generated/ (synced, core only).
- `apps/minimal` skeleton (package.json with the 13 proof modules, configs, layout, generated registry).
- Docs: `docs/CONVENTIONS.md`, `docs/PROTOTYPE-PARITY.md` (57 rows, C1 to C6 incl. C4a, empty Playwright column), `data/seed/SCHEMA.md`, `BUILD-STATUS.md` (initial), `BUILD-STATUS/README.md` (template).

## Tests (run 2026-10-20, all exit 0)
| Command | Result |
|---|---|
| `pnpm install` / `pnpm install --frozen-lockfile` | clean, lockfile passes the 7-day supply-chain policy; sharp binary loads (0.35.5) |
| `npm view` for every plan section 1 pin | all exist, all >= 7 days old; `@next/playwright@16.4.0` exists and matches next |
| `pnpm turbo run typecheck lint test` | 114/114 tasks successful (39 packages) |
| `pnpm -F @ecomkit/core test` | 21 passed (resolve, codegen incl. mock gating, registry, fakes vs contracts with expectTypeOf, catalogues, role matrix) |
| `pnpm -F @tooling/eslint test` | 10 passed (literal string in fixture component fails; attribute text fails; messages pass; admin exempt; deep and relative cross-package imports fail; domain purity) |
| `pnpm -F @tooling/scripts test` | 5 passed (db:fresh from template on PG 17 with pg_trgm, twice; sync check shop/minimal; prod plan has no `_mock`) |
| `pnpm -F shop test` | 14 passed (canonical 301: host, http, trailing slash, uppercase, one hop, exemptions, forwarded headers, CSP) |
| `pnpm db:fresh x` | created `ecomkit_x` from template (then dropped) |
| `pnpm modules:sync --check` | 2 planned, 0 out of date (core only) |
| `pnpm -F shop build`, `pnpm -F minimal build` | exit 0 (Next 16.4.0 Turbopack, Cache Components, Partial Prefetching) |
| `pnpm turbo boundaries` | no issues |
| `pnpm audit --prod` | 0 high, 0 critical, 1 moderate (esbuild via better-auth's drizzle-kit peer) |

My throwaway DB: `ecomkit_wp_00a` on localhost:5433.

## Assumptions
- A00a-1: Node 22.22 (engines >=22.12) instead of Node 24 (environment given).
- A00a-2: Postgres 17 is on port 5433 here (5432 is 15); helpers auto-select the 17+ server.
- A00a-3: plain `pnpm` self-switches to 12.9.1; `corepack pnpm` fails with pnpm 12's new layout (corepack 0.34).
- A00a-4: `xlsx` taken from the official SheetJS 0.20.3 tarball instead of npm 0.18.5 (two high advisories would break the DoD audit).
- A00a-5: `react/jsx-no-literals` uses `ignoreProps: true` plus a selector for visible attributes; the plan's `ignoreProps: false` flags every className.
- A00a-6: `partialPrefetching` is top-level in Next 16.4; added `skipTrailingSlashRedirect` so proxy owns the single 301.
- A00a-7: canonical host/scheme come from env `SITE_URL` (proxy does no DB reads); case is never changed under `/_next /api /media /r /order /feeds /og`.
- A00a-8: cross-module optional access via `manifest.provides` + `registry.service(key)`; added a `reviews` contract (needed by `fakeReviews`) and a `services` map (`auth, pricing, inventory, reviews, places, shipping, notifications`).
- A00a-9: route modules are always `src/routes/*.tsx`; mock handlers `src/mocks/*.ts`.
- A00a-10: generated registry is a thin `createRegistry([...manifests], { mocks })`; the committed tree is the dev config; prod builds sync with `--config prod` first.
- A00a-11: seed JSON keeps integer rupees and natural keys (no ids); importers convert and upsert (data/seed/SCHEMA.md).
- A00a-12: default role matrix as in CONVENTIONS section 10 (manager = all but secrets and staff; support gets customer write, enquiries and review moderation).
- A00a-13: `FitLevel` is `good | ok | not_recommended` (plan); research's `ok_with_irrigation` is `ok` with a reason key.
- A00a-14: fonts (DM Serif Display, Outfit via next/font) are loaded in the root layout I own and exposed as CSS variables for WP-01's theme.css.
- A00a-15: created `apps/shop/postcss.config.mjs` and `apps/shop/vitest.config.ts` (not listed in any row; needed for Tailwind and to keep Playwright specs out of vitest).
- A00a-16: `tooling/playwright/**` and `tooling/lhci/**` were left for WP-31 and WP-33 (nothing needed them in Wave 0).
- A00a-17: `turbo.json` sets `agentGuidance: false` and the `AGENTS.md` turbo wrote at the root was deleted (no tool-guidance files in the client repo).

## Cross-package requests
- -> WP-00b: (1) add `schema: () => import('../schema')` and the `/api/internal/revalidate` route to `packages/core/src/manifest/core.ts` (WP-00a hands over that file); (2) `@ecomkit/core/jobs` must export `startWorker(registry) -> Promise<{ stop() }>` (apps/shop/worker.ts imports it); (3) `money` re-exports `Paise` from contracts, do not redefine; (4) `createTestDb` should call `freshDatabase` from `@tooling/scripts/db` (already a devDependency of core); (5) provide an `onRequestError` adapter in `observability` for apps/shop/instrumentation.ts. Status: open.
- -> WP-01: replace the `apps/shop/app/globals.css` stub (tokens, theme import, `@source "../../../packages/*/src"`); map `--font-display`/`--font-body` to `--font-dm-serif-display`/`--font-outfit` in theme.css; neutral admin palette under `[data-surface="admin"]`; extend `@ecomkit/ui` exports as needed. Status: open.
- -> WP-11: `/api/health/live` and `/api/health/ready` are hand-written under `apps/shop/app/api/health/` (core's manifest does not declare them). Status: open.
- -> WP-23 + WP-28: storefront CSP vendor sources currently come from env `CSP_VENDOR_SOURCES` in proxy.ts; marketing should expose `cspSources()` in a form proxy can read without a per-request DB query (e.g. cached settings), and WP-28 wires it. Status: open.
- -> WP-28: wire instrumentation.ts to the core observability adapter; header/footer in `(shop)/layout.tsx`. Status: open.
- -> orchestrator: commit `pnpm-lock.yaml` with this wave; enable modules in `apps/*/modules.config.ts` as they merge, then `pnpm modules:sync` (shop) and `--app minimal`; the pre-existing deletion of `wc-product-export-16-10-2026-1792136471168.csv` in `git status` is not from WP-00a. Status: open.

## Known failures / flaky tests
None. `pnpm modules:sync --config prod --check` exits 1 against the committed (dev) tree by design (registry `mocks` flag); use `--list` for the prod plan.

## Incomplete / next steps
- `worker.ts` cannot start until WP-00b ships `core/jobs`.
- Seed build steps are empty shells until WP-13 and WP-14 add `tooling/scripts/seed/<step>.ts`.
- `cta-coverage` is a skeleton; the click fixture that writes `apps/shop/e2e/.cta-hits.json` is WP-31's.
