# @ecomkit/analytics

First-party analytics and journey tracking: a small browser collector, an idempotent ingest endpoint, sessions derived on the server, monthly-partitioned raw events kept 90 days, nightly rollups kept for good, and the Analytics admin page. No third party, no DOM recording.

## Public API

| Export | What |
|---|---|
| `./manifest` | module manifest (`id: 'analytics'`, depends on `core`, `ui`; optional `customers`, `orders`) |
| `./schema` | `analyticsVisitor`, `analyticsSession`, `analyticsEvent`, `analyticsDailyRollup`, `analyticsWebVital` |
| `./domain` | pure helpers: `parseBatch`, `cleanPath`, `scrubProps`, `botName`, `deviceOf`, `channelOf`, `startsNewSession`, partition maths, `funnelCounts`, `vitalRating`, `BEACON_JS` |
| `./server` | `ingest(body, ctx)`, `createBeaconIngest(options)`, `report(name, range)` and one function per report, `rollupDay`, `computeDayMetrics`, `ensurePartitions`, job handlers, `onConsentChanged` |
| `./ui` | `<AnalyticsScript />` (put once in the storefront layout), `track(name, props)` for client code |
| `./admin` | `AnalyticsPage({ searchParams, reports })`, `ANALYTICS_TABS` |
| `./routes/*` | `beacon-script` (GET /b.js), `beacon-ingest` (POST /api/beacon-ingest), `admin-analytics` (/admin/analytics) |

## Collector (`/b.js`, about 2.3 KB gzipped)

Events are the frozen `TRACK_EVENTS` (GA4 names). Batches flush at 20 events, every 10 s, on `visibilitychange` to hidden and on `pagehide`, with `sendBeacon` (text/plain) and a `fetch` keepalive fallback; `unload` is never used so bfcache keeps working. It emits `page_view` on load, on client route changes (history hook, pathname only) and on bfcache restore; `scroll_depth`, `cta_click` (`[data-cta]`), `rage_click`, `dead_click`, `attention` (`[data-track-section]`, `[data-track-product]`), `web_vital` (LCP, CLS, INP, TTFB) and `js_error`. Paths keep only `utm_*`, `gclid`, `fbclid`; prop keys naming personal data are dropped and emails or phone numbers in values are masked (again on the server).

Client code records commerce events with `track()`. Props the reports read: `search { q, results }`, `filter_apply { facet, value, results }`, `add_to_cart { item_id, qty, value }`, `purchase { value (paise), test }`, `wizard_step { step }`, `calculator_used { calculator }`. A purchase from a test order must carry `test: true`.

## Ingest (`/api/beacon-ingest`)

- Never cached (`no-store`); cross-site posts refused (`Sec-Fetch-Site`); body capped at 16 KB before parsing; rate limit `beacon-ingest:<ipHash>` (300 batches per minute per IP by default, its own key).
- Identity: HttpOnly `ek_vid` cookie (13 months, SameSite=Lax, Secure on https) set by the response; the table stores only its HMAC.
- Idempotent per client event id: duplicates within 7 days are skipped, and batches of one visitor are serialised with an advisory lock, so retries and concurrent tabs never double-insert.
- Sessions: new after 30 idle minutes, at IST midnight, or on a new campaign. Channel from paid ids, UTM, AI assistant hosts, search, social, referral, direct.
- Bots (by user agent, incl. AI crawlers and headless browsers) and test sessions (staff viewers, or any `test: true` event) are stored but excluded from every report except Bots.
- A signed-in customer is linked to the visitor only when `hasConsent({ customerId, purpose: 'analytics_identity' })` returns true. Without a lookup nothing is linked. `consent.changed` with a revoked `analytics_identity` unlinks the customer's visitors.

### Wiring consent in the host

```ts
// apps/<app>/app/api/beacon-ingest/route.ts
import { createBeaconIngest } from '@ecomkit/analytics/server';
import { hasConsent } from '@ecomkit/customers/server';
export const POST = createBeaconIngest({ hasConsent });
```

## Tables

`analytics_visitor`, `analytics_session` (with `channel`, `bot_name`), `analytics_event` (range-partitioned monthly on `server_ts`, key `(id, server_ts)`, unique `(client_event_id, server_ts)`), `analytics_daily_rollup (day, metric, dimension, value)`, `analytics_web_vital`.

**Migration note:** Drizzle cannot declare partitions. `sql/partitions.sql` must run after the migration that creates the tables (as a `drizzle-kit generate --custom` migration). It is idempotent: it converts the empty plain `analytics_event` into the partitioned parent and creates the current and next two months plus a DEFAULT partition. On a throwaway database: `drizzle-kit push` first, then run the file. Re-running `push` on a database that already has partitions makes drizzle-kit prompt (it sees the partitions as unknown tables); use a fresh database instead.

## Jobs

| Job | Schedule (IST) | What |
|---|---|---|
| `analytics.create-partition` | 02:00 on the 25th | creates month+2 (moving any DEFAULT rows into it), drops month partitions past 90 days, prunes old DEFAULT rows |
| `analytics.rollup-daily` | 01:30 daily | rolls up yesterday and the day before; `{ day }` backfills one day; prunes web vitals past 90 days |

Event subscriptions: `consent.changed`. Emits nothing.

## Reports and admin

`report(name, range)` with `name` in `overview, funnel, traffic, journeys, search, wizard, attention, bots, vitals` and an IST `{ from, to }` range. Overview reads rollups for past days and computes today (and any day not rolled up) live. `/admin/analytics` shows the tabs Overview, Funnel, Sales, Products, Traffic, Customers, Journeys (with a per-session timeline), Search and filters, Wizard, Attention, Bots, Vitals; tab and range live in the URL. Sales, Products and Customers render the `reports` extension items of group `sales`, `products`, `customers` from other modules; the host page passes `registry.list('reports')`. Permission: `analytics.read`.

## How to disable

Remove `analytics` from the app's module list and run `modules:sync`. Remove `<AnalyticsScript />` from the layout; `track()` calls then queue into an array nobody reads, so callers need no change. The hand-written app files (`app/b.js/route.ts`, `app/api/beacon-ingest/route.ts`, `app/(admin)/admin/analytics/page.tsx`) are deleted with it.
