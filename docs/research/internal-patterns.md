# Internal patterns study: what WODO already solved, and what the Hasiru Agro store must meet or beat

Date: 2026-10-20. Scope: behaviour only. **No code, class names, table names, route names or file names from these projects are to be copied.** Every "requirement" below is restated as a behaviour for our stack (Next.js 16 App Router + React 19 + TS, Postgres 17 + Drizzle, Better Auth, pg-boss, sharp, pnpm monorepo with brand-neutral `packages/*` and a Hasiru-specific `apps/shop`).

Sources studied: vibez-estates (New Site) wiki + bootstrap, wodo-cms/cms-core wiki + LESSONS + dashboard widget, mg-lumeo wiki, hasiru-farms-projects wiki (Trail, analytics, Marketing Tags, dev notifications, logs), wodo-modules/journey-tracker/trail.html (Trail spec), wodo plugin rules (`~/.claude/plugins/marketplaces/wodo`: 44 rules + ADMIN-STANDARD.md), shopify/Theme-Dev/SEO-STRUCTURED-DATA.md, client-email-delivery skill, intlink (Next 16 + Drizzle + VPS), hasiru-ops (Next 16 + Supabase, CLAUDE.md gotchas), all relevant `feedback_*` memory notes.

---

## 1. Error logging, developer notification, health checks

### What exists (behaviour)
- **vibez-estates**: framework health route (`/up`-style liveness only, no dependency checks); global 404 logger feeding an admin SEO screen where admins turn logged 404s into DB-backed 301/302 redirects; redirects evaluated before routing; redirects auto-created on slug change; security-headers middleware on every web response; attribution capture middleware (UTM / click IDs into session so leads carry source). Exception handler is empty (no developer alert on 500s).
- **vibez Zoho pipeline**: every outcome audited as an event row (ok / failed / skipped / attachment-failed). Failure alert fires only on *settled* failure (after all retries with backoff 60s, 300s) so transient blips do not page. The alert email is **not queued and is wrapped in try/catch**: it reports a broken pipeline so it must not ride on that pipeline. The "skipped because not connected" record is written at the single choke point all callers pass through, because a not-connected integration previously dropped leads with no log, no row, no alert. Admin integration panel shows per-integration health: connected state, synced count, skipped count, last success, last failure + its error text verbatim.
- **hasiru-farms-projects**: developer notification email on any integration failure (lead email, SMS OTP, OAuth), sent to a configured dev address, **with a fallback transport when the email integration itself is the broken one**. Settings has a Logs tab: parses the tail of the app log, strips stack traces, buckets lines into categories (SMS/OTP, Email, OAuth, DB/Validation) with count badges and colour coding. Lessons: (a) success paths must log too ("OTP sent", "notification email sent"), otherwise a working flow and a dead one look identical; (b) the category bucketing relied on substring matching of message text, so renaming a message silently dropped it into "other"; (c) a capped log viewer (last 100 entries) was drowned by duplicate-key spam from a non-idempotent beacon insert, which looked like "missing logs".
- **cms-core**: "Needs attention" dashboard widget: every stat is a local count (never an external API call from the dashboard), each stat links to the exact filtered list it counted, each stat is permission-gated like the screen it links to, and the widget catches its own errors so a fresh install with missing tables does not take the admin down. Every outbound integration call fails open.
- **ADMIN-STANDARD (wodo plugin)**: the dashboard must lead with a **staleness/form-health signal** ("last enquiry N days ago", amber past 7 days). Origin: a client form captured zero leads for months behind a 404ing JS asset while every page returned 200 and dashboards showed healthy counts of old records.
- **mg-lumeo / deploy lesson**: after every deploy, complete a real login and a real public form submit; status codes do not prove health.

### Requirements for our build (meet or beat)
1. **Structured server error capture** in a reusable `packages/observability` (or similar): every unhandled server error (route handler, server action, RSC render, pg-boss job) recorded to a Postgres `error_events` table with fingerprint (error class + top frame + route), count, first/last seen, request id, user role (never PII), release/commit sha. Next.js `instrumentation.ts` `onRequestError` hook is the capture point for RSC/route errors; `app/**/error.tsx` and `global-error.tsx` boundaries on every route group (shop, account, checkout, admin).
2. **Developer notification**: email (via the Gmail package) + optional WhatsApp to a configured dev contact on (a) first occurrence of a new fingerprint, (b) spike threshold, (c) any settled integration failure (payment webhook, ops sync, Merchant/Meta feed, WhatsApp send, email send). Rate-limited/digested per fingerprint (no alert storms). **Alert path must not depend on the failing integration**: if Gmail is broken, fall back to a second channel (WhatsApp Cloud API or a plain HTTPS webhook) and always write the DB row first; the row is the durable record.
3. **Settled-failure semantics**: pg-boss retries with backoff; alert only after final retry fails. Record ok / failed / skipped (not configured) for every integration call at one choke point per integration.
4. **Log success, not only failure** for money and customer paths: order placed, payment captured/verified, OTP sent/verified, notification sent, ops sync pushed, inventory pulled. Use a typed event/category enum, never substring-matching on message text.
5. **Health endpoints**: `/api/health/live` (process up, no deps) and `/api/health/ready` (DB ping, pg-boss heartbeat age, last successful ops inventory pull age, disk for uploads) returning JSON, unauthenticated but no secrets/PII; detailed version behind admin auth. Cron/job liveness: pg-boss scheduler writes a heartbeat; stale heartbeat (>2 min) shows red on the admin dashboard.
6. **Admin "System health" screen** (operator-only, framework-gated): per-integration cards (state, last success, last failure + error verbatim, counts), error list grouped by fingerprint with resolve/mute, job queue depth + failed jobs with retry button, and a log viewer filterable by category. Admin dashboard leads with business-staleness signals: "last order N hours/days ago", "last payment captured", "last ops inventory sync", each amber/red past a threshold, each linking to the filtered list.
7. **404 log + redirects manager**: log 404s (path, referrer, count, last seen), let admins create 301/302 from a 404 row; auto-create a 301 when a product/category slug changes. Do not log hits that are already handled by a redirect as 404s (mg-lumeo noted that as cosmetic noise).
8. **Dedup/idempotency proven**: every ingest (beacons, webhooks, sync) uses unique keys + `ON CONFLICT DO NOTHING` (or a real upsert that names update columns). Prove by sending the identical payload twice: one row, empty error log.

---

## 2. SEO, security and performance checklists

### 2a. wodo plugin rules (all 44, condensed; SEO/security/perf/caching/forms/admin/email/deploy)
Severity in brackets. Stack-neutral restatement for Next.js.

**SEO**
- [ ] WD-SEO-001 [P1] No static `public/robots.txt` alongside `app/robots.ts`; static file wins silently. Robots must be dynamic: env-aware, has `Sitemap:` line, explicit AI-crawler policy (GPTBot, ClaudeBot, PerplexityBot, Applebot-Extended, Google-Extended).
- [ ] WD-SEO-002 [P2] `/sitemap.xml` is 200, well-formed XML, referenced from robots, every `<loc>` absolute, on canonical host + https, no query strings, and every listed URL is itself 200, non-redirecting, indexable. Host from config, never hardcoded. Drop 404/redirect/noindex URLs from the sitemap.
- [ ] WD-SEO-003 [P0] Site-wide noindex never reaches production; noindex only via a genuine env/launch flag; probe live `/` for `meta robots noindex` and `X-Robots-Tag`.

**Security**
- [ ] WD-SEC-001 [P1] CSP (or frame-ancestors), X-Frame-Options, X-Content-Type-Options: nosniff, Referrer-Policy present **on the wire** (not only in code). CSP allowlist derived from admin-managed marketing tags at response time.
- [ ] WD-SEC-002 [P0] No secret in any tracked file (connection strings, base64 keys, `user:pass@host` URLs included).
- [ ] WD-SEC-003 [P1] Admin routes gated by role/permission, not merely authenticated.
- [ ] WD-SEC-004 [P1] Every write validated by a schema (zod) with real authorization of the caller (no "authorize always true").
- [ ] WD-SEC-005 [P1] Sensitive uploads (payment proofs, invoices, IDs) on private storage served via signed/short-lived URLs; only marketing media public.
- [ ] WD-SEC-006 [P1] Login: throttling, session regeneration on login, `is_active`/disabled check with generic message.
- [ ] WD-CACHE-001 [P0] Never serve a response carrying an identity Set-Cookie from a shared cache. Any route that sets session/visitor cookies must be `private, no-store`; tracker ingest endpoints excluded from caching.
- [ ] WD-ADMIN-008 [P0] Integration/API-secret screens hard-gated server-side (direct URL by non-operator is blocked, not just hidden nav).
- [ ] WD-OAUTH-001 [P0] Google OAuth consent screen Published to Production (Testing mode refresh tokens expire in 7 days); reconnect after publishing; one real test email.
- [ ] WD-ENV-001 [P0] `.env.example` values containing `#`, `$`, spaces, `(` single-quoted; pure KEY=VALUE lines only.

**Performance / frontend**
- [ ] WD-FE-004 [P2] LCP image eager + `priority`/`fetchPriority="high"`, explicit width/height or sized parent/aspect-ratio, box reserved (no CLS).
- [ ] WD-FE-003 [P1] IntersectionObserver threshold gates never used for "how much is visible" on tall sections (see Trail).
- [ ] WD-FE-001 [P2] `backdrop-filter` dies under a transformed/filtered ancestor; avoid that nesting on sticky headers/cart drawers.
- (WD-FE-002 Alpine+Livewire, WD-DEPLOY-003 Livewire assets, WD-FILA-* Filament, WD-DEPLOY-005 storage dirs: Laravel-only, not applicable. Their lesson generalises: **an app-served JS chunk that 404s behind nginx kills forms while pages still return 200** ; verify `/_next/static/*` is served and a real form submit works after deploy.)

**Forms / leads / orders**
- [ ] WD-FORMS-001 [P0] Public lead/enquiry forms work with JS disabled (progressive enhancement: real `<form action={serverAction}>` with server validation and a success page). Applies to bulk-quote / farm-development enquiry / contact; checkout may need JS for PhonePe but must fail visibly, never silently.
- [ ] WD-FORMS-002 [P0] Notifications dispatched explicitly in the handler, never from an ORM/DB lifecycle hook (seeds/imports would mail customers).
- [ ] WD-FORMS-003 [P1] Honeypot + time-trap + throttle on public forms; store only hashed IP (HMAC with app secret).
- [ ] WD-FORMS-004 [P1] Lead/customer PII (email, phone) encrypted at rest with a blind-index HMAC column for exact search; masked in admin for roles without an unmask permission. (Decide scope for customers vs orders: orders need address for fulfilment; at least leads and any exported data.)
- [ ] WD-DEPLOY-004 [P0] No http:// in any form action or base URL env; http→https 301 turns POST into bodyless GET and silently loses submissions.

**Email**
- [ ] WD-EMAIL-001 [P0] Gmail API over OAuth, never raw SMTP.
- [ ] WD-EMAIL-002 [P0] Brand name, contact details, notify-to address from DB settings at send time; no hardcoded literals; no seeded defaults that ship unedited.
- [ ] WD-EMAIL-003 [P1] Per-site mailbox connection (client's own Google account and refresh token), not a shared agency mailbox.

**Admin (ADMIN-STANDARD 15 + WD-ADMIN rules)**
- [ ] Nav ordered as a narrative: Orders/Leads first, then catalogue/content, then structure, then setup (WD-ADMIN-009).
- [ ] Dashboard leads with staleness/health signal (WD-ADMIN-001 P0).
- [ ] Every tile that looks like a link is a link to the exact filtered view, URL-bound filters (WD-ADMIN-002).
- [ ] Widgets individually permission-gated (WD-ADMIN-003 P1).
- [ ] Every list: search + at least one filter (WD-ADMIN-004); lead/order lists CSV export + one bulk action (WD-ADMIN-005).
- [ ] Audit/change-history screen, operator-only (WD-ADMIN-006).
- [ ] No raw column names, snake_case keys or enum values shown to client roles; human labels everywhere (WD-ADMIN-007).
- [ ] SEO fields with live SERP preview or character counters.
- [ ] Media library flags missing alt text as a filterable state.
- [ ] One schema-driven global settings screen, tabbed like the public site.
- [ ] Destructive/structural actions withheld from non-operator roles; delete = confirm, prefer archive.
- [ ] Every integration settings card carries setup instructions: exact console, exact button, and any value to give the vendor (redirect URI, webhook URL) shown copyable.

### 2b. Theme-Dev SEO-STRUCTURED-DATA.md checklist, adapted (we own what Shopify gives for free)
We must build what Shopify auto-handles: canonical tags, sitemap index, robots, 301 manager, HTTPS.
- [ ] Unique `<title>` per template with brand; meta description per entity with fallback template.
- [ ] Self-referencing canonical on every indexable page, host-pinned to the configured origin (www/non-www and http/https folded), filter/sort/pagination params canonicalise to the clean URL (or are noindex,follow), off-domain override allowed.
- [ ] OG (title, description, image, url, type=product/website) + Twitter card; per-product OG image (generated with sharp or a dynamic OG route).
- [ ] JSON-LD: Organization (with `sameAs`, logo, contact), WebSite + SearchAction, BreadcrumbList on all navigable pages, Product with `offers` (price, priceCurrency INR, availability, `priceValidUntil`, itemCondition, seller), `brand`, sku, image, aggregateRating only if real reviews exist; `AggregateOffer`/quantity price spec for bulk tiers; CollectionPage/ItemList on category pages; FAQPage on FAQ content; Article/BlogPosting on guides; HowTo on planting guides; VideoObject on model videos; LocalBusiness/GardenStore for the nursery (NAP, geo, hours). **Encode JSON-LD escaping `<` (`<`)**; editor text containing `</script>` otherwise breaks out (stored XSS, vibez lesson).
- [ ] One H1 per page; semantic landmarks; descriptive alt from data (botanical + common name).
- [ ] Responsive `srcset`/`sizes`, lazy below fold, eager + fetchpriority on LCP, width/height always.
- [ ] Preload critical font (self-host DM Serif Display + Outfit via `next/font`, no Google Fonts runtime request), preconnect only to origins actually used.
- [ ] Pagination: crawlable `<a href>` links (not JS-only "load more"), each page self-canonical.
- [ ] Noindex low-value: internal search results, cart, checkout, account, filtered combos beyond one facet.
- [ ] AEO/GEO: content server-rendered (prices, names, descriptions, specs in HTML, not client-only); product info in visible accordions not JS modals; question-style H2s with 40-75 word self-contained answers on plant care/guide pages; consistent brand entity name everywhere; `llms.txt` with store description, categories, key content, policies, contact; AI crawlers allowed.
- [ ] Hreflang `en-IN` / `kn-IN` when the Kannada toggle ships (separate URLs, not a client-side toggle, or Kannada content is invisible to search).
- [ ] Validate with Rich Results Test / schema.org validator in the test plan.

---

## 3. Trail (first-party journey tracker) + 9-tab analytics + Marketing Tags

### Trail behaviour to reimplement (our own names, our own code)
- **Two parts, one seam**: a tiny zero-dependency browser collector (~5 KB gz) and a server ingest endpoint; contract = one POST of a JSON array of events.
- **No DOM replay.** Structured events only. Closed vocabulary of ~6 event types: page view (with per-section attention map folded into its props on final flush), scroll milestone (25/50/75/100 once each), click (element chain, nearest section, CTA type, masked label, coords as % viewport), field (focus/blur/abandon: field name, dwell, ended non-empty; **never the value**), exit (engaged ms, max scroll, exit section), custom (e.g. `add_to_cart`, `checkout_step`, `wizard_step`, `calculator_used`). Unknown names dropped server-side.
- **Identity is server-issued**: HttpOnly, SameSite=Lax first-party cookie set in the ingest response (survives Safari ITP 7-day cap on script storage). Collector never reads/writes identity.
- **Sessions derived server-side** from cookie + 30-min inactivity; client never asserts a session id.
- **Attention algorithm**: IO with `threshold: 0` only answers *which* sections are on screen; a 1 Hz tick measures coverage via `getBoundingClientRect` divided by `min(element height, viewport height)`; a second counts as engaged only if coverage >= 50%, tab visible, and human input in last 5 s; also tracks "visible" seconds. Read completion = engaged / (words / 250 wpm). Skip `display:none` sections; use `entry.time` not `Date.now()`.
- **Scroll depth**: `(scrollY + innerHeight) / scrollHeight`, recompute height every sample.
- **Flush ladder**: localStorage write-through ring buffer, flush on `visibilitychange→hidden`, `pagehide`, every 15 s, and at batch size; `sendBeacon` with `text/plain` body (avoids CORS preflight), check its return and fall back to `fetch(..., {keepalive:true})`; batches < 16 KB (64 KiB shared keepalive pool). **Never** listen to `unload` (kills bfcache). `pageshow` with `persisted` logs bfcache restores.
- **SPA navigation**: Next.js App Router does client navigation, so the collector needs a debounced history/route-change hook (Trail spec explicitly calls this out for Next builds); emit exit for the old page and view for the new one.
- **Two timestamps** per event (client + server received); order by server time. Client UUID event id; ingest is idempotent (`ON CONFLICT (event_id) DO NOTHING`). Hasiru-farms shipped a non-idempotent insert and flooded the log on every beacon retry.
- **Ingest hardening**: excluded from CSRF (stateless beacon) but rate-limited per IP with its **own limiter key** (must not share a counter with checkout/lead forms), batch count and byte caps before parsing, never response-cached (cached Set-Cookie would hand one visitor's identity to all). **Endpoint path configurable and not a blocklisted word** (`/track`, `/collect`, `/analytics` are on EasyPrivacy).
- **Privacy**: strip email/phone patterns from labels in the browser before sending; `data-*-ignore` opt-out subtree; consent-aware (aggregate-only mode, no identity cookie, until consent if a banner is used). India DPDP points the same way.
- **Semantic layer**: `data-` attributes declare business meaning (`product` + id) on cards/PDP; collector attaches it to events inside the subtree. Every CTA carries a stable label attribute (`"<context>: <action> (<placement>)"`) or it merges with all buttons of the same text.
- **Bots**: classify by UA (search bots, AI crawlers, link previews, headless) into session flags; AI-assistant referrer/UTM detection (ChatGPT, Perplexity, Gemini, Claude, Copilot...) as a source. Hasiru-farms removed a "no interaction in 30 min = bot" heuristic because it flagged real browsers; prefer UA + zero-interaction-session exclusion in reports only. Test orders/leads (name/email matches test|dummy|demo...) flagged, excluded from KPIs, and their session marked so marketing conversion tags do not fire on the thank-you page.
- **Storage**: bigint identity PK (not UUID PK), UUID as 16-byte unique (Postgres `uuid` type is 16 bytes already), enum event name, path lookup id, JSONB props, indexes (session, received), (name, received), (visitor, received). Nightly rollup to a sessions table kept forever; raw events pruned at 90 days; partition by month when large (Postgres native partitioning makes prune a DROP). ~69 MB/month at 10K visitors.
- **Join is the point**: sessions link to orders/leads so reports answer "what did buyers read/do first" and "which products are viewed but never added".
- Cache-bust the collector script on change (hasiru-farms nginx cached it ~10 years); in Next, serve it from `/_next/static` or hashed filename.

### 9-tab analytics (hasiru-farms) to adapt for e-commerce
Global date range + previous-period deltas on every KPI (when previous = 0, show "new" rather than a misleading +100%):
1. Overview: visitors, sessions, avg engaged, orders/leads, conversion rate, revenue, trend chart, top sources, channel table.
2. Sections: engaged seconds per section, drop-off section, sections preceding conversion.
3. Form friction: per-field progression, dwell, start/complete/abandon (checkout, wizard, OTP, bulk quote).
4. Devices: split by viewport class, engagement by device.
5. Campaigns: source/medium/campaign table, paid vs organic.
6. Clicks & CTAs: CTA ranking by label, type split (form / WhatsApp / call / add-to-cart / other), clicks per section.
7. Content: section attention converting vs non-converting.
8. Funnel: view → scroll 50% → key section → form/cart start → submitted/paid. E-com version: PLP → PDP → add to cart → cart → checkout start → payment → paid.
9. Returning: new vs returning, return-gap histogram, conversion by visit number.
Plus AI & Bots tab (bot names, AI-referral sessions). Known traps: JSON values extracted in SQL must be unwrapped (Postgres `->>` returns text, good; avoid `->`), add expression/generated-column indexes when analytics queries pass ~500 ms. Never call external APIs (GA4/GSC) on dashboard load; sync them in jobs.

### Marketing Tags admin (behaviour)
- Admin CRUD of head / body-start / body-end script snippets (GTM, Google Ads, Meta Pixel, etc.), each scoped to site-wide or specific pages/page types (e.g. "thank-you / order-confirmed only").
- The **CSP allowlist is derived from the enabled tag rows at response time** through the same resolver that renders the tags, so markup and header can never disagree; no developer edits a host list.
- Every public page must render through the layout that injects tags (hasiru-farms lost tags on static HTML served directly by nginx). Conversion pages must be real routes so page-scoped tags fire.
- Custom events (admin-defined) push to `dataLayer`; **purchase/lead conversions fire server-confirmed** (after the order is paid / lead saved), never on optimistic or spam-rejected paths; test orders fire no conversion tags.
- Changing a GTM container is a data edit, not a deploy; warn in the UI that triggers must be rebuilt in the new container.
- For performance: load tag scripts after interaction/idle where the vendor allows (`next/script` `afterInteractive`/`lazyOnload`), never blocking render; server-side events (Meta CAPI, GA4 Measurement Protocol) for purchase reduce client JS.
- Gate: operator/admin permission, audit-logged.

---

## 4. Gmail API OAuth email

Behaviour to implement in a reusable email package:
- Send via Gmail API `users.messages.send` with `gmail.send` scope; refresh-token → access-token exchange on demand, cache access token until expiry; raw RFC 5322 message (multipart text + HTML, proper UTF-8 subject encoding, attachments for invoices).
- **Agency OAuth client id/secret in env** (shared across sites, rotation = one edit); **per-site refresh token encrypted in DB**, minted by an admin **Connect Gmail** button running the consent flow (not pasted). Redirect URI shown copyable on the settings card; must be registered in the GCP OAuth client or `redirect_uri_mismatch`. Consent screen must be Published (Testing tokens die in 7 days). Partial-scope grant handled: report "not configured, missing scope X".
- Per-site mailbox (client's own Google account), never an agency shared mailbox.
- Settings card: connected account, last send ok, last failure verbatim, **Send test email** button, disconnect. Default mailer to a log/dev sink until connected (a fresh install must not crash because Gmail is unconnected).
- Sender, reply-to, notify-to, CC, brand name, contact details all from DB settings. Staff notification + customer confirmation are separate messages; reply-to = public support address.
- Send through pg-boss jobs with retry/backoff; but developer alerts about email failure use a different channel. Verify end-to-end with a real message to a real inbox before calling it done. Template URLs from configured origin, dates in Asia/Kolkata.
- Debug order for "no email": was send attempted (job row / log) → parsed credentials correct → token exchange 200 → actual mailbox incl. spam and correct recipient.

---

## 5. Next.js 16 conventions and gotchas (from hasiru-ops and intlink)

- **Next 16 is breaking**: `middleware.ts` renamed `proxy.ts`; `params`, `searchParams`, `cookies()`, `headers()` are async. Before writing code read `node_modules/next/dist/docs/` for the installed version; `next dev` re-adds an AGENTS.md rules block (commit it to keep the tree clean).
- `proxy.ts` auth is optimistic only; real enforcement in every server action/route handler (`requireRole()` guards) **and** at the DB layer. Destructive/bulk/export actions admin-only both hidden in UI and rejected server-side.
- **Never run `next build` while `next dev` runs** (shared `.next`). In a monorepo give each app its own dist dir/port.
- `allowedDevOrigins` must include `localhost`, `127.0.0.1` (and LAN IP): otherwise HMR is blocked, the page never hydrates, and forms fall back to native GET (login "just reloads").
- Server action body limit default 1 MB: raise `serverActions.bodySizeLimit` only where uploads go through actions; prefer route handlers + direct streaming for images.
- **Mutation latency is a correctness requirement** (Shyam's standing rule): `revalidatePath/Tag` in a server action already returns the fresh RSC payload; do **not** add `router.refresh()` (double render). Never put `setOpen(false)` in the same transition as a refresh. Inputs bound to server props need local optimistic state (`useOptimistic`). One transition per row, not per list. Every `<form action>` uses a shared submit button with `useFormStatus` pending + double-submit guard (duplicate orders/payments otherwise). `error.tsx` boundaries everywhere server actions can throw.
- **Paginated lists need a stable tiebreaker** (`ORDER BY created_at, id`) or bulk-imported rows shuffle between pages.
- Views: Postgres views run as owner unless `security_invoker`; a `SELECT *` view freezes columns at creation (drop + recreate after adding columns). New enum values cannot be used in the same transaction that adds them.
- Migrations additive, numbered, tracked; never edit an applied one. **Do not use `drizzle-kit push` against production** (it decides its own changes on a live DB); generate SQL migrations, review, apply with a migrate script, back up first, verify rows untouched after.
- Phone normalisation in one helper used at every capture and match point (Indian last-10 digits, `91` prefix for WhatsApp); mismatches recreate duplicate-customer bugs.
- Rate limiting in hasiru-ops is in-memory per process (fine for one PM2 process; our build should use Postgres-backed or per-process with documented ceiling). Shared-secret endpoints: constant-time compare, separate limiter for bad-secret attempts, identical 401 bodies (no enumeration), never log the secret.
- Tokens for API/MCP: show raw once, store sha256 only.
- **Deploy on the Hostinger CloudPanel VPS (intlink precedent)**: PM2 per site user (not root), `pm2 restart --update-env`; PM2 `script` must point at `node_modules/next/dist/bin/next` (and `tsx/dist/cli.mjs` for workers), not `.bin` shell wrappers; restart web **and** worker on every deploy (worker keeps old code otherwise); `/tmp` not writable by site user (logs to `~`); pnpm 10 (Mac) vs 11 (server): keep both `onlyBuiltDependencies` and `allowBuilds` for `sharp`, `esbuild`, `@tailwindcss/oxide` in `pnpm-workspace.yaml` or sharp silently never builds; pnpm 11 `minimumReleaseAge` can fail installs (use `--config.minimumReleaseAge=0` for the install only, call binaries directly at runtime). Env values with `(`, `#`, `$`, spaces single-quoted; prefer letting Next/drizzle read `.env` rather than shell-sourcing.
- **Build verification**: check exit code of `next build` (it prints "Compiled successfully" then fails type check); only restart if OK; curl the live URL for 200 and curl new static assets asserting size (file modes from tar can be 640 → nginx 403). Generated, gitignored artefacts must be regenerated on server. A 302 to login hides a 500 on admin pages: test authenticated render.
- Cloudflare (if used) caches 404s for 4 h: change asset URLs (hashed) rather than reusing names.
- `trustProxy`-equivalent: behind nginx, read `x-forwarded-proto/host` so generated URLs and Secure cookies are https (Better Auth `baseURL` + `trustedOrigins` set from env).
- Rsync deploys: zsh does not word-split `$VAR` flags; never chain a `--delete` real run after its dry run; back up remote dir first (this wiped live ops.hasiruagro.com env once).
- hasiru-ops's Supabase project caps every data query at **1000 rows**; any read for sync must paginate (`range` loops) and use a stable order.

---

## 6. WhatsApp: existing code

- **No WhatsApp Cloud API (graph.facebook.com) code exists anywhere in the workspace.** Only `wa.me` deep links (hasiru-ops phone helpers: last-10-digits storage, `91` prefix), static-site floating buttons, and cms-core's "Omnly WhatsApp" integration (third-party BSP, not Meta direct). So the Meta WhatsApp Cloud API package is greenfield: templates (approved, with variable mapping), webhook verify token + `X-Hub-Signature-256` HMAC verification, message status callbacks (sent/delivered/read/failed) stored, 24-hour service window rule, opt-in record per customer, idempotent webhook handling, test mode against mocks.
- Precedent from SMS OTP (vibez/hasiru-farms) applies directly to WhatsApp templates: the operator drops messages whose text does not match the approved template exactly, and the provider accepts them anyway; **pin template names/params with a test**; OTP on + mock/log driver in production = every visitor sees an OTP prompt nobody can complete (kill switch + health warning required); blackout/category issues are a provider-side config, surface delivery reports in admin.

---

## 7. hasiru-ops facts relevant to the sync package (read-only reference)

- Next.js 16 + Supabase (Postgres + Auth + RLS). Only one public API route: a **create-only lead intake** protected by a shared-secret header with rate limiting. There is **no order or inventory API**.
- Inventory lives in tables for locations, stock batches, stock movements; stock and order writes go through **atomic SQL functions** (order + stock transaction, reverse on cancel, stock allocation). Orders double as invoices (auto invoice number, generated balance column, status derived not stored).
- Implication: "orders out + inventory in" without modifying hasiru-ops means either (a) reading inventory via Supabase REST/Postgres with a dedicated read-only credential, paginating past the 1000-row cap, and (b) pushing orders through an existing path (lead intake only today) or a new endpoint the hasiru-ops team adds. Writing straight into its order tables would bypass its atomic functions and RLS invariants. **This needs a decision/approval** (see summary). Our side should be an adapter interface with a mock implementation plus an outbox table (order sync status, attempts, last error) so nothing is lost while the far side is unavailable.

---

## 8. Memory feedback notes turned into do / don't for this build

| Note | Do | Don't |
|---|---|---|
| deploy_verify_exit_code | Gate restart on `next build` exit code; curl live URL + new assets (assert bytes); render an authed admin page as a smoke test | Trust "Compiled successfully" or a 302 on /admin |
| cloudpanel_laravel_deploy | After deploy do a real login + real checkout/enquiry submit; set forwarded-proto trust; confirm `/_next/static` served by nginx | Infer health from status-code sweeps |
| multi_server_deploys / remote_actions_permission | Read vault + deploy notes for host/path/user; ask before any SSH/deploy/external mutation | Guess SSH paths or docroots |
| intlink_deploy_traps | Both pnpm keys for sharp; PM2 → `next/dist/bin/next`; per-user PM2 with `--update-env`; restart web + worker; logs to home | Shell-source `.env` with unquoted `(#$ ` values; use `/tmp` |
| zsh_var_word_split | Inline rsync excludes; read dry-run first; back up before `--delete` | Chain dry-run and real run in one command |
| migrations_before_code | Ship schema migration (additive, nullable/defaulted) before code that writes new columns; rehearse on a copy | Deploy code that writes columns that do not exist yet |
| nullable_over_not_null | Every optional form field maps to a nullable column or a coded default; test "required filled, optional cleared"; run tests against Postgres, not SQLite | Let `""`→null hit a NOT NULL column |
| laravel_upsert_empty_update (generalised) | `ON CONFLICT DO NOTHING` for dedup; prove idempotency by double-POST | Assume a comment claiming idempotency is true |
| laravel_throttle_shared_key (generalised) | Separate rate-limit keys per route (beacon vs checkout vs OTP vs login); test "N beacon hits, then checkout still works" | One IP counter shared across routes; optimistic success UI that hides a 429 |
| laravel_utc_datetime_local (generalised) | Store `timestamptz`; treat admin-entered datetimes as Asia/Kolkata explicitly; display in IST; promo/sale windows tested with "starts today" | Parse `datetime-local` strings as UTC; compare a naive date to `now()` |
| scheduled_publish_responsecache | When content/price/promo goes live by time, revalidate the affected tags at that moment via a pg-boss scheduled job; job heartbeat doubles as cron liveness | Rely on admin saves as the only cache invalidation; blanket periodic full revalidation |
| slug_column_accepts_paths | Validate slugs `^[a-z0-9]+(?:-[a-z0-9]+)*$` server-side for products/categories/pages; auto-301 on change; sitemap only lists resolvable URLs | Accept a path or slash in a slug |
| richtext_purifier_traps | Sanitise rich text on save with an allowlist that keeps h2-h6, tables, `rel` (nofollow/sponsored/ugc); add `loading="lazy"` at render; round-trip real markup in a test; JSON-LD escape `<` | Give the editor a "source" mode before the save path sanitises; trust reading the allowlist |
| wysiwyg_session_expiry | Long admin edits: session keepalive while tab visible (capped), autosave drafts locally; clear error message on expired session with content preserved | Let a long product-description edit die on save |
| intersection_observer_tall_sections | IO threshold 0 for which; rect-based coverage vs min(element, viewport) for how much | `intersectionRatio >= 0.5` gates on long sections |
| hasiru_ops_interactivity | Optimistic UI on cart qty, wishlist, admin status changes; no redundant refresh; pending states | Controls that snap back during a round trip |
| verify_agent_reports / swarm_shared_db | Each swarm agent uses its own throwaway Postgres database/schema; orchestrator verifies counts itself; ban destructive DB commands in briefs | Shared dev DB across agents; trusting "tests pass" reports |
| client_code_handover / 1dot style | No AI-tool mentions in code/comments/README (grep claude, anthropic, copilot, cursor, swarm, opus, sonnet); instructions in a separate handover doc | Internal process words in shipped comments |
| deploy_runner_token_leak / runner_token_copy | Any one-off setup endpoint refuses with bare "Forbidden", is removed after use; secrets never in error bodies | Echo a token in a 403; leave setup routes live |
| gmail_api_email / wodo_cms_gmail_env | See section 4 | SMTP; per-site copies of the agency OAuth client |
| zoho_field_types (generalised to integrations) | Type every pushed value from the target's field metadata (ops sync, Merchant Center, Meta catalog); "send test" button per integration | Assume booleans/strings map; trust a silent 200 |
| intlink_engine_traps | Normalise URLs once (scheme, www, trailing slash) for canonical, sitemap, feeds, internal links; hash extracted text not raw HTML for change detection | Let two URL spellings create two identities |
| shopify_seoinput_wipe (generalised) | Partial updates to SEO fields merge; external feed updates (Merchant/Meta) send full objects; diff after batch | Full-replace APIs fed partial objects |
| pixel_port_extraction / pixel_port_verification / ld_build_from_mockup | The approved prototype is the design source of truth; screenshot-diff key screens at 375/768/1440 (diff baseline against itself first for animated noise); preserve font `format()` | Redesign while porting; trust "CSS identical" |
| content_doc_only / site copy rules | Only client-provided words; no em dashes; no "phase"/"v1"/"v2" in copy | Invent CTAs, sections or claims |
| ig_datacenter_ip_block | Expect some vendor APIs to treat VPS IPs differently; test from server and Mac when a vendor call fails | Rotate credentials before ruling out IP blocks |

---

## 9. Explicit "do not copy" list
Names seen in these projects that must not appear in the new codebase: Trail / trail.js / trail_events / trail_sessions / TrailController, IntegrationFailure, LogNotFound, HandleRedirects, CaptureAttribution, MarketingScript / marketing_scripts, ContentHealthOverview, ZohoCrmService, hfBeacon, tr_v cookie, `/api/t`, any Vibez/Ashraya/Hasiru Farms identifiers, cms-core namespaces. Pick fresh, brand-neutral package and table names.
