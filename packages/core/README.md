# @ecomkit/core

Shared kernel every module builds on. Nothing in it knows about any one store (prefixes, keys and copy come from the caller or settings). BUILD-PLAN.md section 2.3 is the spec; this file is the reference for what exists. Never re-implement anything listed here in another package.

| Area | Export | Owner |
|---|---|---|
| Contracts (interfaces + frozen catalogues) | `@ecomkit/core/contracts` (also `@ecomkit/core`) | WP-00a |
| Manifest system | `@ecomkit/core/manifest` | WP-00a (core's own manifest: WP-00b) |
| Testing fakes | `@ecomkit/core/testing/fakes` | WP-00a |
| Everything below | `@ecomkit/core/<area>` | WP-00b |

Client-safe areas (no Node built-ins, fine in a client component): `money`, `totals`, `contracts`. Everything else is server only (it imports `pg`, `node:crypto` or `node:https`). Core areas deliberately do not import `server-only`, because the worker and scripts run them under plain Node, where that package throws.

## Areas

### money
`Paise` (re-exported from contracts), `asPaise(int)` (brands, throws on fractions), `paise(rupees)`, `formatINR(paise, { compact? })` -> `Rs 1,23,456`, `Rs 99.50`, compact `Rs 12.3L`; `roundToRs(paise, step)`, `splitGstInclusive(paise, ratePct)` -> `{ taxablePaise, taxPaise }` with tax = amount x r / (100 + r), `gstSplit(taxPaise, { interState })` -> CGST/SGST halves (odd paisa to SGST) or IGST, `sum(iterable)`, `pct(paise, percent)`.

### totals
`computeTotals(input: TotalsInput): TotalsBreakdown`, the one totals pipeline (cart preview, checkout quote, order snapshot). Pure. Order: bulk tier unit price -> automatic promos -> coupon -> packing -> transport -> GST (inclusive, per line rate; charges at `chargesGstRatePct`). F2 definitions: subtotal = list x qty, tierSavings = (list - tier) x qty, compare-at never enters totals. Stacking (A8): one coupon; a coupon never stacks with a non-stackable automatic promo, best-of decides and the loser is listed in `rejectedDiscounts`. Allocations are capped at what is left on the line. CGST/SGST is split per rate bucket, as the invoice prints it.

### sequence / ids
`nextInSequence(name, tx)`: gapless counter in `core_sequence` (one upsert that holds the row lock until the caller's transaction ends; a rollback returns the number). `invoiceNumber(tx, { at?, prefix? })` -> `INV-2026-27-00001`, one sequence per Indian financial year (IST). `financialYear(date)`.
`newId()` (UUIDv7, monotonic within a process), `orderNumber(tx, { prefix, at? })` -> `<prefix>-YYMM-NNNNN` (the prefix is store config), `slugify()`, `SLUG_RE`, `normalisePhone()` -> `+91XXXXXXXXXX` or null.

### db
`db` (lazy Drizzle over one `pg` Pool on `DATABASE_URL`, the app role), `getDb()`, `getPool()`, `getDbUrl()`, `configureDb(url)`, `closeDb()`, `withTx(fn)`, types `Db`, `Tx`, `DbOrTx`. `upsertRequireUpdate(dbOrTx, table, values, { target, set })` refuses an empty update set; `excluded(column)` for multi-row upserts. `pageAll(fetchPage, 1000)` async-iterates pages (offset paging; keyset if a table passes ~100k rows). No relational query schema is bound: use the SQL-like builder.

### env
`env` (lazy, zod-validated `process.env`), `loadEnv(source?)` (call at boot; throws listing every bad key), `publicEnv` (`NEXT_PUBLIC_*`), `serverEnvSchema`. Keys: `NODE_ENV`, `DATABASE_URL`, `DATABASE_OWNER_URL`, `DATABASE_POOL_MAX` (connections per process, default 10; set 2 for `next build`), `SITE_URL`, `INTERNAL_BASE_URL` (default `http://127.0.0.1:3000`), `INTERNAL_SECRET` (32+ chars), `SETTINGS_MASTER_KEY`, `SETTINGS_MASTER_KEY_PREVIOUS` (`<version>:<base64 32 bytes>`), `ENABLE_MOCKS`, `GIT_SHA`, `NEXT_PUBLIC_SITE_URL`. Production requires `DATABASE_URL`, `SITE_URL`, `INTERNAL_SECRET`, `SETTINGS_MASTER_KEY` and refuses `ENABLE_MOCKS=1`.

### auth-context
`setAuthProvider(() => registry.service('auth'))` once at app boot. `getViewer()` (React `cache`, once per request; guest when no provider), `requirePermission(perm)` -> `StaffViewer` or `ForbiddenError` (403), `requireOwner(customerId)` -> `CustomerViewer` or `NotFoundError` (404), `can(viewer, perm)` for UI decisions. With the auth module disabled every check fails closed.

### events
`emit(event, payload, { tx? })`: one job on queue `core.event`; with `tx` it is written in the caller's transaction (outbox: no commit, no event). Unknown names throw. The worker fans each event out to one job per subscriber on `<moduleId>.on.<event>` (deterministic job id, so a retried fan-out never double-delivers), each with the standard retry policy and its own dead-letter queue. Payloads carry ids; subscribers read fresh state.

### jobs
`defineJob(lazyHandler, options?)`, `enqueue(name, data, { tx?, startAfter?, singletonKey?, priority? })`, `startWorker(registry, { name?, heartbeatSeconds?, pollingIntervalSeconds? })` -> `{ stop() }` (creates every enabled module's queues, works them, registers cron schedules in `Asia/Kolkata` by default and removes stale ones, routes events, writes `core_job_heartbeat` every 30 s). Defaults per queue: retry 5, 30 s, exponential backoff capped at 1 h, then `<name>.dead`. `installJobSchema(ownerUrl)` installs or upgrades the pg-boss schema with the owner role (deploy step; dev and test install it automatically, production does not because the app role has no DDL). `getBoss()`, `stopBoss()`, `ensureQueue()` for advanced use.

### settings
`defineSettings(moduleId, zodObject)` -> `SettingsDef` (put `def.schema` in the manifest `settings.schema`). Fields marked `.meta({ secret: true })` (strings only) are sealed with AES-256-GCM, random IV, AAD `module:key`, key version stored per row; the previous key still decrypts after rotation. `getSettings(def)` (server only; decrypted secrets are tainted in React server builds), `getSettingsForAdmin(def)` (secrets as `{ configured, masked }`, never plaintext), `setSettings(def, patch, { actorId })` (partial, validated; for secrets an empty string keeps, `null` clears; one audit row with secrets reported only as `replaced`/`cleared`; invalidates `settings:<module>`), `maskSecret()` (`••••1234`), `fieldMeta(field)` (meta through optional/default wrappers, for the admin form renderer).

### audit
`audit({ actorId, actorType, action, entity, entityId, before?, after?, ipHash? }, { tx? })` append-only; `listAudit({ entity?, entityId?, before?, limit? })`; `hashIp(ip)`.

### rate-limit
`rateLimit('<routeId>:<subject>', { limit, windowSec, now? })` -> `{ ok, count, remaining, resetAt }`: fixed window, one atomic upsert on `core_rate_limit`. `pruneRateLimits()`.

### http
`verifyHmacSha256(raw, signature, secret)` (hex, `sha256=` hex or base64; timing-safe), `signHmacSha256(raw, secret)`, `signInternal(raw, purpose)` / `verifyInternal(...)` (keys derived per purpose from `INTERNAL_SECRET` via `derivedSecret(purpose)`), `timingSafeEqual(a, b)`, `readRawBody(req, maxBytes)` (`PayloadTooLargeError` 413), `safeFetch(url, init, { allowHosts?, timeoutMs?, maxBytes?, maxRedirects? })` -> `Response` (https on 443 only, no URL credentials, host allowlist with `*.domain`, every resolved address must be public and is checked at connect time so DNS rebinding cannot slip past, redirects re-checked, 10 s timeout, 10 MB cap; throws `SsrfError`), `isPublicAddress(ip)`, `integrationCall(provider, op, fn, { ref? })` -> `{ status: 'ok', value } | { status: 'skipped_not_configured' } | { status: 'failed', error }` (never throws; logs `core_integration_log`; emits `integration.failed`; throw `NotConfiguredError` from `fn` for the skipped case).

### observability
`createLogger(scope)` (JSON lines), `captureError(err, { route, method, url, requestId, viewerRole, release, level })` -> issue id (never throws; query strings dropped), `fingerprint(err, route)` (error name + top frame without line numbers or build hashes + route), `captureRequestError` / `onRequestError` (Next `instrumentation.ts` hook), `withSpan(name, fn, { slowMs })`, `listErrorIssues()`, `setIssueStatus()`, `pruneObservability()` (error events after 30 days, integration log after 90).

### cache-tags
`tags.catalog | nav | home | promoActive | product(id) | price(id) | stock(id) | category(slug) | cms(slug) | settings(mod) | model(slug) | reviews(id) | district(slug)`, `TAG_RE`. `invalidateTags(tags)` works anywhere: `revalidateTag(tag, { expire: 0 })` inside Next, else a signed POST to the web process (`revalidateFromWorker`). Server actions that need read-your-own-writes should call Next's `updateTag` themselves.

### validation
`zodAction(schema, handler, { permission? })` -> `(FormData | object) => { ok: true, data } | { ok: false, fieldErrors, formError? }` (`forbidden`, `not_found`, `invalid`; other errors propagate). `formDataToObject()` (repeated keys become arrays; a single value stays a string, so use `z.preprocess` or `z.union` for one-or-many fields). `safeHtml(html)` (headings, lists, tables incl. empty cells, links with the author's `rel` kept and `noopener noreferrer` added for new tabs, https/http images; no scripts, handlers or `javascript:`). `formGuards.issue()` / `formGuards.check(values)` (honeypot field `website`, signed time token `_ft`: under 2 s or over 24 h rejected).

### testing
`createTestDb(name, { schemas = ['core'] })` -> `{ url, db, pool, close() }`: fresh `ecomkit_<name>` from the template, schemas pushed with drizzle-kit, shared `db` pointed at it. One name per test file. `seedMinimal(db)`, `TEST_NOW` (2026-10-20 10:00 IST), `fixedClock()`, `queuedJobs(db, name?)` (outbox reader), and the fakes.

## Tables (`src/schema.ts`)
`core_settings`, `core_audit_log`, `core_rate_limit`, `core_error_issue`, `core_error_event`, `core_integration_log`, `core_job_heartbeat`, `core_sequence`; enums `core_actor_type`, `core_error_level`, `core_issue_status`, `core_integration_status`. pg-boss keeps its own `pgboss` schema.

Migration notes (Drizzle cannot express these; add to the generated migration): `ALTER TABLE core_rate_limit SET UNLOGGED;` and, for the app role, `REVOKE UPDATE, DELETE, TRUNCATE ON core_audit_log FROM <app_role>;`.

## Routes
`POST /api/internal/revalidate` (`routes/revalidate`): loopback only (refused when proxied), HMAC with the derived `revalidate` key, timestamp within 5 minutes, tags must match `TAG_RE`. `/api/health/*` are not core's (monitoring / the app).

## Jobs and events
Job `core.prune`, daily 03:30 IST. Emits `integration.failed`. Consumes nothing.

## Settings
None of its own.

## Disabling
Core cannot be disabled; every app config lists it.

## Tests
`pnpm -F @ecomkit/core test` (needs Postgres 17, see docs/CONVENTIONS.md): money, totals fixtures, ids, HMAC, SSRF guard, fingerprinting, settings crypto and DB round trip incl. tamper, form guards, safeHtml, env; sequence (50 concurrent, rollback gap), upsert guard, rate limiter window and concurrency, emit-in-transaction outbox, error grouping, integration log, audit; a worker end to end (event routing, job retry, dead-letter queue, schedules, heartbeat); the revalidate route and the worker-to-web fallback; zodAction with the auth provider.
