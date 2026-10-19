# WP-00b Core implementations (status: done, awaiting gate commit)   updated 2026-10-20T03:32+0530

Worked directly in the main tree as briefed. Nothing committed or pushed. Only `packages/core/**` touched (plus this file).

## Shipped
- `packages/core/src/schema.ts`: `core_settings, core_audit_log, core_rate_limit, core_error_issue, core_error_event, core_integration_log, core_job_heartbeat, core_sequence` + 4 enums.
- Areas (each `src/<area>/index.ts`, matching the existing package.json exports): `money`, `totals` (`computeTotals`), `sequence` (+ `invoiceNumber`, `financialYear`), `ids` (UUIDv7 `newId`, `orderNumber`, `slugify`, `SLUG_RE`, `normalisePhone`), `db` (`db`, `withTx`, `upsertRequireUpdate`, `excluded`, `pageAll`, `configureDb`), `env`, `auth-context`, `events` (`emit` with tx outbox, worker fan-out), `jobs` (`defineJob`, `enqueue`, `startWorker`, `installJobSchema`), `settings` (AES-256-GCM, rotation, masked admin view, audit), `audit`, `rate-limit`, `http` (HMAC, timing-safe, `readRawBody`, `safeFetch` SSRF guard, `integrationCall`), `observability` (`captureError`, `fingerprint`, `onRequestError`/`captureRequestError`, `withSpan`, logger, issue list/status, pruning), `cache-tags` (`tags`, `invalidateTags`, `revalidateFromWorker`), `validation` (`zodAction`, `safeHtml`, `formGuards`), `testing` (`createTestDb`, `seedMinimal`, `TEST_NOW`, `fixedClock`, `queuedJobs`, re-exports fakes).
- `src/routes/revalidate.ts` (`POST /api/internal/revalidate`), `src/jobs/prune.ts`.
- `src/manifest/core.ts` (handed over by WP-00a): `schema`, the revalidate route, job `core.prune` + daily schedule 03:30 IST.
- `test/manifest.test.ts` (WP-00a's): two expectations updated for the new core route/job (consequence of the requested manifest change).
- `packages/core/README.md` rewritten as the full API reference.

## Tests (run 2026-10-20, Postgres 17 on :5433)
| Command | Result |
|---|---|
| `pnpm -F @ecomkit/core typecheck` | pass (exit 0) |
| `pnpm -F @ecomkit/core lint` | pass (exit 0) |
| `pnpm -F @ecomkit/core test` | 8 files, 75 passed, 0 failed (~4.5 s) |
| `pnpm turbo run typecheck` (all packages + apps) | 37/37 successful |
| `pnpm -F @tooling/scripts test` | 3 passed, 2 failed: "shop dev tree is in sync", "minimal app is in sync". Expected drift: core now has a route and a schema; fixed by the orchestrator's `pnpm modules:sync` (shop + `--app minimal`) |

Acceptance coverage: money (paise, formatINR, GST 0/5/18 inclusive, rounding) in `money-totals.test.ts`; `computeTotals` fixture (tier + stackable automatic promo + coupon + packing + transport + GST intra and inter state, F2 definitions, best-of stacking, line cap); `core_sequence` 50 concurrent consecutive + rollback leaves no gap; settings encrypt/decrypt/tamper (pure and through the DB) + key rotation; HMAC (hex, `sha256=`, base64) + timing-safe; rate limiter window (fixed clock) + 20 concurrent hits; upsert-requires-update; emit inside tx enqueues exactly one job, none on rollback; observability fingerprinting (+ DB grouping, reopen); `safeFetch` SSRF guard (scheme, port, credentials, private literals incl. metadata IP and IPv6, allowlist, hostname resolving to loopback). Extra: worker end to end (event routed once, job retried, dead-letter queue, schedules, heartbeat), revalidate route (signed, forged, stale, proxied, bad tags) and the worker-to-web fallback, zodAction + auth provider.

Throwaway DBs: `ecomkit_wp_00b` (db:fresh), tests create and drop `ecomkit_wp_00b_db` and `ecomkit_wp_00b_worker`.

## Assumptions
- A00b-1 (2026-10-20): core areas do not import `server-only` (the worker and scripts run them under plain Node, where it throws); server-only-ness comes from their Node imports.
- A00b-2: events use one queue `core.event`; the worker fans out to `<moduleId>.on.<event>` queues with deterministic job ids. Every subscriber has its own retries and dead-letter queue.
- A00b-3: pg-boss schema is auto-installed in dev/test (`NODE_ENV !== 'production'`); production expects `installJobSchema(DATABASE_OWNER_URL)` as a deploy step (app role has no DDL).
- A00b-4: env names: `INTERNAL_SECRET` (one root secret; per-purpose keys derived for revalidate HMAC, form time token, IP hash), `INTERNAL_BASE_URL`, `SETTINGS_MASTER_KEY` / `SETTINGS_MASTER_KEY_PREVIOUS` as `<version>:<base64 32 bytes>` (version defaults to 1), `DATABASE_OWNER_URL`, `NEXT_PUBLIC_SITE_URL`.
- A00b-5: `orderNumber` takes the prefix as a required argument (store config, e.g. `HA` from orders settings), so core stays brand-neutral. `invoiceNumber` defaults to `INV`.
- A00b-6: `gstSplit(taxPaise, { interState })` signature (plan wrote `gstSplit({interState})`); odd paisa goes to SGST; CGST/SGST split per rate bucket.
- A00b-7: stacking best-of compares the coupon against the sum of non-stackable automatic promos; tie keeps the promos.
- A00b-8: `getSettings` is a plain DB read (no `'use cache'`): decrypted secrets are tainted, and tainted values cannot pass through the cache serializer. Pages that cache settings-derived data tag it `settings:<mod>`; `setSettings` invalidates that tag.
- A00b-9: `safeFetch` allows only port 443 and checks resolved addresses at connect time (custom `lookup`); returns a buffered `Response` (10 MB cap). Not streaming.
- A00b-10: retention: error events 30 days (plan), integration log 90 days (my default), rate-limit rows a day after their window; all in daily `core.prune`.
- A00b-11: `invalidateTags` expires with `{ expire: 0 }` (immediate) both in Next and via the worker endpoint.
- A00b-12: `maskSecret` shows the last 4 only for secrets longer than 8 characters (short ones show none).
- A00b-13: the revalidate endpoint treats any `x-forwarded-for` / `x-real-ip` header as proxied and 404s; the worker calls it on `127.0.0.1` directly.
- A00b-14: `defineEvent` and a runtime `schedule()` were not built: the event catalogue is frozen in contracts and schedules come from manifests.

## Cross-package requests
- -> orchestrator: run `pnpm modules:sync` and `pnpm modules:sync --app minimal` after merging (new `app/api/internal/revalidate/route.ts` stub and `src/generated/schema.ts` now exporting `@ecomkit/core/schema`); then `drizzle-kit generate` picks up the core tables. Status: open.
- -> orchestrator (migration): append `ALTER TABLE core_rate_limit SET UNLOGGED;` and the audit grant (`REVOKE UPDATE, DELETE, TRUNCATE ON core_audit_log FROM <app_role>`) to the generated migration; Drizzle cannot express either. Status: open.
- -> WP-00a / orchestrator: `.env.example` should list `INTERNAL_SECRET`, `INTERNAL_BASE_URL`, `SETTINGS_MASTER_KEY`, `SETTINGS_MASTER_KEY_PREVIOUS`, `DATABASE_OWNER_URL`, `ENABLE_MOCKS`, `NEXT_PUBLIC_SITE_URL` (I could not read `.env.example`; it is permission-blocked in this session). Status: open.
- -> WP-28: `apps/shop/instrumentation.ts`: `export { onRequestError } from '@ecomkit/core/observability'` and call `loadEnv()` in `register()`; bind auth at boot with `setAuthProvider(() => registry.service('auth'))` (from `@ecomkit/core/auth-context`); deploy runs `installJobSchema(DATABASE_OWNER_URL)` before starting the worker. `worker.ts` can import `startWorker` statically now. Status: open.
- -> all module packages: use `createTestDb('<wp-id>-<file>', { schemas: ['core', '<mod>'] })` in tests (pushes schemas itself); emit with `{ tx }` inside the write transaction; `defineSettings` for settings; `integrationCall` + `safeFetch` for every outbound call. Status: info.

## Known failures / flaky tests
- `@tooling/scripts` sync tests fail until the orchestrator re-syncs (see above); by design, not flaky.
- The worker test waits on real polling (0.5 s interval, retry delay 1 s); it takes about 3 s and has 15 s timeouts.

## Incomplete / next steps
- Existing queues are not updated when a module changes its retry options (pg-boss `createQueue` is idempotent); marked with a `ponytail:` note in `src/jobs/boss.ts`.
- No secret re-encryption job for key rotation (old rows keep decrypting with `SETTINGS_MASTER_KEY_PREVIOUS`); add when a rotation is actually planned.
- The revalidate route stub was not exercised inside a real `next build` (the stub is generated by the orchestrator's sync); its handler is unit-tested.
