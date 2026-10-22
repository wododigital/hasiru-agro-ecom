# Hasiru Agro e-com: LLM wiki

Read this first, then `docs/FINAL-REPORT.md`. Last updated 2026-10-22 (paused by Shyam, resume from "Resume here").

## What this is
Plant e-commerce + farm-development services store for Hasiru Agro, target `shop.hasiruagro.com` (Hostinger CloudPanel VPS, not deployed). Built as a reusable kit: 33 brand-neutral `@ecomkit/*` packages that any store can pick and choose, plus the Hasiru app.

- Branch `ecom-build`, head **e213ee1** (local only, never pushed; repo github.com/wododigital/hasiru-agro-ecom).
- Stack: pnpm + Turborepo, Next.js 16.4 App Router (`cacheComponents`, PPR), React 19, Tailwind v4, Postgres 17 on :5433, Drizzle, pg-boss worker, Better Auth (staff password + TOTP, customer OTP), Claude API (rules first).
- Owner: Shyam (WODO). Model routing: Fable plans/verifies, Opus 5.5 builds, Sonnet only for simple code.

## Map
| Path | What |
|---|---|
| `apps/shop` | The Hasiru store. `modules.config.ts` enables modules; `src/boot.ts` binds every module port; `instrumentation.ts` + `worker.ts` call `boot()` |
| `apps/minimal` | Proof that core + catalog + cart + checkout + payments alone builds (`docs/NEW-STORE-RECIPE.md`) |
| `packages/*` | One module each (manifest: schema, routes, admin nav, settings, jobs, events). Talk via the core event bus and ports, never internals |
| `packages/admin-shell`, `packages/ui` | Shopify-style admin (sidebar sub-menus, Settings pinned bottom-left, index tables, detail pages) |
| `tooling/smoke.mjs` | HTTP smoke, `--only=routes,storefront,money,jobs,admin` |
| `tooling/csp-check.mjs` | Real Chromium, 12 pages, reports CSP violations and page errors |
| `data/seed/*.json`, `images/` | Seed data built from `latest_products.xlsx`; real photos only (no AI images) |
| `docs/FINAL-REPORT.md` | Run commands (s1), what was built (s2), check numbers (s3), **open items (s4)**, keys checklist (s7), deploy prereqs (s9) |
| `docs/REQUIREMENTS-ADDENDUM.md` | Binding requirements, incl. s9 "admin = Shopify structure" |
| `BUILD-STATUS.md`, `BUILD-STATUS/*.md` | Per work-package status and verifier tables |
| `HANDOFF.md` | Resume paragraph + the earlier prototype handoff (brand, pricing, wizard decisions) |
| `docs/ORCHESTRATOR-RUN.md` | Old workflow run ids. All finished or stopped; do not resume any |

## How it works (the non-obvious parts)
- **Ports + boot**: modules expose `configureX()` ports; `apps/shop/src/boot.ts` wires them. Port state lives on `globalThis` because Next loads instrumentation and pages as separate module copies (`src/route-registry.ts` publishes the page copy). No boot = 500 on add-to-cart.
- **Build-time gap**: `next build` workers skip `register()`, so prerendered shells have no ports (no images, default text) -> React #418 on `/` and `/plants`. Open item s4.2.
- **CSP**: storefront `script-src 'self' 'unsafe-inline'`; private layouts (`(admin)`, account, checkout, pay) `await connection()` + `instant = false` so every script gets the nonce (`'strict-dynamic'`). Zod runs `jitless`. Only `csp-check.mjs` catches regressions; the smoke does not run JS.
- **404s**: `unstable_paramMatching: { slug: 'blocking' }` on 10 routes. Recheck on the next Next bump.
- **Media**: seed images are stored as-is (`derive: 'none'`, status `ready`, Shyam's call); `/media/w/<width>/` falls back to the master. `MEDIA_ROOT` must be absolute and shared by web, worker, seed.
- **Abandoned cart**: checkout `saveContact` calls the cart `noteContact` port in the same transaction, so a guest who typed contact details is captured (`cart.contact_at`). Signed-in-only buyers are still not covered (s4.4).
- **DB pool**: `DATABASE_POOL_MAX` env (default 10); use 2 for `next build` or the build opens ~70 connections against `max_connections` 100.

## Commands
Full list in `docs/FINAL-REPORT.md` s1. Gotchas:
- Seed and worker need `NODE_OPTIONS=--conditions=react-server`.
- Worker: `cd apps/shop && NODE_ENV=production NODE_OPTIONS=--conditions=react-server pnpm exec tsx worker.ts`
- Mocks under `next start`: `ENABLE_MOCKS=1 ALLOW_MOCKS_IN_PROD=1` (local only, never on the VPS).
- `.env*` files are permission-blocked for agents. Shyam must add to `apps/shop/.env.example`: `# DATABASE_POOL_MAX=  connections per process; set 2 for next build`

## State at pause (2026-10-22)
- Gate 2 verified e213ee1 on a fresh DB: full smoke 251/0/18 (routes 169, storefront 5, money 19, jobs 17, admin 41), csp-check 12/12, typecheck + lint 76/76, tests 38/38, both apps build.
- Local store: http://localhost:3399 on DB `ecomkit_local`, plus its worker. **It runs the pre-merge build (c14131c era)**: the new home rails, filters and CSP fix are in git but not in that `.next` and not seeded into `ecomkit_local`.
- Local env for :3399 is a scratchpad file (`/private/tmp/claude-501/.../scratchpad/local/env-local.sh`, holds secrets). `/private/tmp` does not survive a reboot: if it is gone, rebuild the exports from FINAL-REPORT s1 with fresh `SETTINGS_MASTER_KEY`/`INTERNAL_SECRET` (a new master key cannot read settings sealed with the old one, so re-seed or re-enter keys).
- Owner login on `ecomkit_local`: projects@wodo.digital via `bootstrap-owner.ts` (invite link was 72 h; re-run it if expired).
- Postgres DBs kept: `ecomkit_local`, `ecomkit_template`. All test DBs, worktrees and wp branches removed.
- No agents or workflows running.

## Resume here (in order)
1. Rebuild local on e213ee1: `pnpm install`, migrate `ecomkit_local`, re-seed (or `pnpm db:fresh local` + seed), `DATABASE_POOL_MAX=2 pnpm -F shop build`, restart `next start :3399` + worker. Screenshot home / `/plants` at 1440 and 390 for Shyam.
2. Fix wave on FINAL-REPORT s4: build-time boot / #418 (s4.2), worker heartbeat retry + supervisor (s4.3), signed-in abandonment port (s4.4), half-typed phone + `hasContact` contract (s4.5), admin search providers, customers/enquiries export, manager `orders.export` grant, unknown settings path 404 (s4.6), 404 on private/token routes (s4.10), ERP order/lead payloads (s4.1).
3. Redundancy audit; input product photos (Magnific stock or open licence, never AI); Playwright E2E + Lighthouse.
4. Deploy prep (needs Shyam's approval for Postgres 17 on the VPS, nginx `X-Real-IP`, absolute `MEDIA_ROOT`); set feeds brand and order prefix `HA` in admin settings.

## Rules for this project
- Commit locally on `ecom-build`, never push; commits end `Co-Authored-By: claude-flow <ruv@ruv.net>`. Never touch live servers or hasiru-ops production.
- Site copy: no em dashes, no "phase"/"v1"/"v2". Real photos only.
- Admin must look and behave like Shopify's admin (REQUIREMENTS-ADDENDUM s9).
- No code reuse from other WODO projects. Avoid redundancy.

## Swarm lessons (cost real time here)
- `SendMessage` to a running Workflow agent spawns a duplicate. `TaskStop` the workflow first.
- Teammates never receive background-task notices: run builds/tests in the foreground (timeout up to 600000 ms); only servers in the background, polled with curl.
- One DB and one uniquely named env file per agent; agents kill only their own PIDs.
- This Mac handles about 6 agents at once; more hits load and Postgres connection limits. Keep it on AC power (`caffeinate` does not stop sleep on battery). Watch disk: `.next`/`.turbo` in worktrees and old `ecomkit_*` DBs filled it to 100% once.
