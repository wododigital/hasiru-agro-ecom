# @ecomkit/marketing

Consent banner, tag manager (GA4, Meta Pixel, Google Ads and custom tags) that feeds the storefront CSP, campaign attribution on the order, and server-side purchase and refund conversions (GA4 Measurement Protocol, Meta Conversions API) with test-order exclusion. Brand-neutral.

## Public API

`@ecomkit/marketing/server`

| Export | Who | What |
|---|---|---|
| `postConsent(req)` | route `/api/consent` | Same-origin only, 1 KB body `{ analytics, marketing }`, 30 per 10 min per IP hash. Sets the `ek_consent` cookie (`a1.m0.<epoch>`, 1 year, Lax). For a signed-in customer it appends `customers_consent` rows (through `@ecomkit/customers/server` `recordConsent`) for the purposes that changed: analytics -> `analytics_identity`, advertising -> `marketing` |
| `publicTagConfig()` | `TagScripts` | `'use cache'` + tag `settings:marketing`: public ids and active custom tags, never a secret |
| `cspSources(now?)` | `proxy.ts` | `{ script, connect, img, frame }` host lists for configured vendors and active custom tags; memoised per process for 60 s; a failed read answers empty lists |
| `listTags`, `getTag`, `saveTag(raw)`, `deleteTag(id)` | `marketing.write` | Custom tags; audited; expire `settings:marketing` and the CSP memo |
| `readAttribution(cookies, userAgent)` | checkout | Validates the client-controlled cookies (`ek_ft`, `ek_lt`, `ek_click`, `_ga`, `_fbp`, `_fbc`, `ek_consent`) into an `OrderAttribution` |
| `saveOrderAttribution(orderId, attribution, { tx })` | checkout place-order | Idempotent insert into `marketing_attribution` |
| `configureMarketing({ orders, http? })` | host boot | `orders.forConversion(orderId)` returns a `ConversionOrder` (see `domain/conversions.ts`) or null |
| `conversion('purchase' \| 'refund', orderId, { refundId?, amountPaise? })` | `order.paid` / `order.refunded` subscribers | Sends GA4 (purchase, refund) and Meta CAPI (Purchase). Skips and records test orders, missing consent and unconfigured destinations. Idempotent per `(destination, event_id)`; throws when a send failed so the event job retries only that destination |
| `purchaseTagData(orderId)` | confirmation page | Browser tag data with the shared `event_id`; null for test orders |

`@ecomkit/marketing/ui`: `TagScripts` (put once in the storefront layout: tag loader + banner), `ConsentBanner`, `PurchaseTags({ orderId })` (order confirmation page, request-time), and the islands.

`@ecomkit/marketing/client` (browser only): `marketingTrack(name, params, { eventId })` forwards a storefront event to the loaded vendor tags (GA4 recommended names; Meta standard events), `openConsentSettings()` reopens the banner (footer link).

`@ecomkit/marketing/domain`: consent cookie codec, Consent Mode signals, attribution parsing, `VENDOR_CSP` and `cspSourcesFor`, tag form schema and path matching, GA4 and CAPI payload builders plus the zod shapes the mocks validate against, Meta normalisers.

## How the pieces fit

- The tag loader sets Consent Mode defaults to denied, waits for idle, then loads GA4 (analytics consent), Google Ads and Meta Pixel (advertising consent) and the active custom tags for the path. Nothing loads before a choice. Meta gets a `PageView` per client navigation.
- Landing campaign data (utm, gclid/gbraid/wbraid, fbclid, referrer) is held in memory and written to first-party cookies only after advertising consent.
- GA4 `purchase` and `refund` are sent from the server only (one source, no double count). Meta `Purchase` is sent by the pixel on the confirmation page and by CAPI with the same `event_id` (`purchase.<orderId>`); Meta keeps one. The Ads conversion is browser-side with `transaction_id` = order number.
- CAPI user data is normalised (trimmed, lowercased, digits-only phone with country code, no punctuation) and SHA-256 hashed; fbp/fbc and the user agent are sent as they are. No raw IP is stored.

## Tables

`marketing_tag` (custom tags), `marketing_conversion_event` (unique `(destination, event_id)`, status `pending | sent | failed | skipped_test | skipped_consent | skipped_not_configured`), `marketing_attribution` (pk `order_id`: first/last touch, click ids, fbp/fbc, GA client id, consent snapshot, user agent). Consent itself lives in `customers_consent`.

## Routes

`POST /api/consent`; admin `/admin/marketing/tags` (built-in status, custom tags, recent server conversions). Mock routes (dev/test configs only, 404 unless `ENABLE_MOCKS=1`): `/api/_mock/ga4/[...path]` (MP collect and debug, validates like the debug endpoint), `/api/_mock/meta-capi/[...path]` (validates hashing, required fields, the 7-day window, groups by event_id).

## Settings (`/admin/settings/marketing`)

`consentBanner`; GA4 `ga4MeasurementId`, `ga4ApiSecret` (secret), `ga4Mode off|mock|live`; Meta `metaPixelId`, `metaCapiToken` (secret), `metaTestEventCode`, `metaGraphVersion` (v26.0), `metaMode`; Google Ads `adsConversionId`, `adsPurchaseLabel`, `adsEnhancedConversions`. An empty id switches that vendor off.

## Events

Consumes `order.paid`, `order.refunded`. Emits none itself (`recordConsent` emits `consent.changed`; `integrationCall` emits `integration.failed`).

## Disable

Remove `marketing` from the app config and drop `<TagScripts />` from the layout. The proxy then keeps its static CSP; checkout guards its `saveOrderAttribution` call with `registry.has('marketing')`.

## Tests

`test/domain.test.ts` (cookie codec, Consent Mode, CSP filtering, attribution, tag form, Meta normalisation, payload schemas), `test/server.test.ts` (real Postgres: shared event id and hashing through the mocks, dedup on retry, test-order exclusion, consent gating, retry of only the failed destination, refunds, mock rejection of unhashed data, consent route incl. `customers_consent` rows, tag permission, CSP sources and memo), `test/manifest.test.ts` (registry, generated paths, mock gating).
