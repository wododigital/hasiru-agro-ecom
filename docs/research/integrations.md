# Integrations research (current APIs)

Researched 2026-10-20 against official docs. "Verified" = read on the official page this date. "Verify" = not confirmed on an official page, must be confirmed in sandbox before go-live.

Global design rule for every integration package (`packages/<name>`):
- One `Provider` interface, two implementations: `live` (real HTTP) and `mock` (local, deterministic). Selected by an admin setting `mode: mock | sandbox | live`, never by NODE_ENV.
- Secrets stored encrypted in Postgres (`integration_settings` table, AES-GCM with a key from env). Admin page shows masked values, "Test connection" button, last success/failure timestamp.
- Every inbound webhook: raw body stored first (`webhook_events` table, unique on provider + external event id), then verified, then processed by a pg-boss job. Idempotent handlers.
- Every outbound call: logged to `integration_logs` (request summary, status, latency, error) for the admin "Activity" tab.
- Mocks run in-process as Next.js route handlers under `/api/_mock/<provider>/...` (dev only) so the real HTTP client code path is exercised end to end, with the base URL swapped.

---

## 1. PhonePe Payment Gateway (PG v2, Standard Checkout)

Status: **v1 (salt key + X-VERIFY checksum) is deprecated and V1 credentials can no longer be generated.** New work must be v2 OAuth. Source: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/troubleshooting

### Endpoints (verified)
| Purpose | UAT | Prod |
|---|---|---|
| Auth token (POST, `application/x-www-form-urlencoded`) | `https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token` | `https://api.phonepe.com/apis/identity-manager/v1/oauth/token` |
| Create payment (POST) | `https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay` | `https://api.phonepe.com/apis/pg/checkout/v2/pay` |
| Order status (GET) | `.../pg-sandbox/checkout/v2/order/{merchantOrderId}/status?details=false&errorContext=true` | `https://api.phonepe.com/apis/pg/checkout/v2/order/{merchantOrderId}/status` |
| Refund (POST) | `.../pg-sandbox/payments/v2/refund` | `https://api.phonepe.com/apis/pg/payments/v2/refund` |
| Refund status (GET) | `.../pg-sandbox/payments/v2/refund/{merchantRefundId}/status` | `https://api.phonepe.com/apis/pg/payments/v2/refund/{merchantRefundId}/status` |

Note the prod token host path differs (`identity-manager`) from the prod PG path (`pg`). Easy to get wrong; keep each URL as its own constant.

Sources:
- https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization
- https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/create-payment
- https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/order-status
- https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/refund
- https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook

### Auth token
Body: `client_id`, `client_version`, `client_secret`, `grant_type=client_credentials`.
Response: `access_token`, `encrypted_access_token`, `expires_in` (null in sample), `issued_at`, `expires_at` (epoch seconds), `token_type: "O-Bearer"`, `session_expires_at`.
Use: header `Authorization: O-Bearer <access_token>`. No refresh token: re-call the same endpoint before `expires_at`. Cache the token in Postgres/memory, refresh when `now > expires_at - 120s`. Single-flight the refresh (one in-flight promise) so concurrent checkouts don't stampede.

### Create payment (redirect flow)
```json
{
  "merchantOrderId": "HA-20261020-000123",
  "amount": 249900,
  "expireAfter": 1200,
  "metaInfo": { "udf1": "<orderUuid>" },
  "paymentFlow": {
    "type": "PG_CHECKOUT",
    "message": "Hasiru Agro order HA-...",
    "merchantUrls": { "redirectUrl": "https://shop.hasiruagro.com/checkout/return?o=HA-..." }
  }
}
```
Constraints: `amount` in paise, min 100. `merchantOrderId` max 63 chars, only `_` and `-` as specials. `expireAfter` 300 to 3600 s. udf1-10 max 256 chars; udf11-15 alnum + `_ - + @ .` max 50. `paymentModeConfig` takes either `enabledPaymentModes` or `disabledPaymentModes`, never both (modes: UPI_INTENT, UPI_COLLECT, UPI_QR, CARD with cardTypes, NET_BANKING).
Response: `{ orderId, state: "PENDING", expireAt (epoch ms), redirectUrl }`. Redirect browser to `redirectUrl` (or use the iframe PayPage JS). Doc inconsistency: table says `expiryAt`, sample says `expireAt`. Parse leniently.
Error: `BAD_REQUEST` if `merchantOrderId` reused and not in CREATED state. So a retry after a failed attempt needs a new merchantOrderId (use `<order>-<attemptNo>`; keep a `payment_attempts` table).

### Order status
States: order `PENDING | COMPLETED | FAILED`; each `paymentDetails[]` attempt has `transactionId`, `paymentMode`, `state`, `errorCode`, `detailedErrorCode`. `details=true` returns all attempts. Invalid id returns `code: INVALID_MERCHANT_ORDER_ID`. Status API returns HTTP 429 on overuse.

### Webhooks (verified)
- Configure URL + username + password: PROD on the PhonePe dashboard; UAT by asking the PhonePe integration team.
- PhonePe sends header `Authorization: SHA256(username:password)`. Server recomputes and compares (constant-time). Encoding is not documented (assume lowercase hex; also accept `SHA256 <hex>` prefix). **Verify** against a real UAT callback.
- Events (use `event` field, `type` is being deprecated): `checkout.order.completed`, `checkout.order.failed`, `pg.refund.accepted`, `pg.refund.completed`, `pg.refund.failed`. Node SDK enum: `CHECKOUT_ORDER_COMPLETED`, `CHECKOUT_ORDER_FAILED`, `PG_REFUND_ACCEPTED`, `PG_REFUND_COMPLETED`, `PG_REFUND_FAILED`.
- Use root-level `payload.state` for status. `expireAt`, `timestamp` are epoch ms. Docs say "avoid overly strict parsing".

### Refunds
Body `{ merchantRefundId (max 63), originalMerchantOrderId, amount (paise, min 100, <= original) }`. Returns `{ refundId, amount, state: "PENDING" }`. Status: `PENDING | COMPLETED | FAILED` with `splitInstruments[]` (rail UPI utr etc.) and `errorCode` on failure. Partial refunds allowed (sum must not exceed original).

### Node SDK
`npm i @phonepe-pg/pg-sdk-node` (v2.0.5, Node 14+). `StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, Env.SANDBOX | Env.PRODUCTION)`; `validateCallback(username, password, authorizationHeader, rawBodyString)` throws `PhonePeException` on bad callbacks.
Source: https://developer.phonepe.com/payment-gateway/backend-sdk/nodejs-be-sdk/introduction and `.../api-reference-node-js/installation`, `.../webhook-handling`.
**Recommendation: do not use the SDK.** It is a singleton (`getInstance`) which fights per-request settings reload from the admin and makes the mock swap awkward. The REST surface is 5 calls; a ~150-line typed `fetch` client with a configurable base URL is smaller, testable against the mock, and has no supply-chain dependency. ponytail: revisit only if PhonePe adds signing we can't replicate.

### Reconciliation (best practice)
Three independent paths, all funnel into one idempotent `applyPaymentState(merchantOrderId, state, raw)`:
1. **Return URL**: on `/checkout/return`, server calls Order Status immediately and renders success/pending/failed. Never trust query params.
2. **Webhook**: verify, store, enqueue.
3. **Scheduled reconcile** (pg-boss): PhonePe's documented schedule (v1 checklist, still the reference): first check at 20-25 s, then every 3 s for 30 s, every 6 s for 60 s, every 10 s for 60 s, every 30 s for 60 s, then every 1 min until timeout (15 min per the checklist). Plus a nightly sweep of any `PENDING` older than `expireAt`. Pending is not failure. Back off on 429.
Source: https://developer.phonepe.com/v1/docs/pg-standard-checklist
Order state machine: only `PENDING -> COMPLETED|FAILED` transitions; a late COMPLETED after FAILED must raise an admin alert (auto-refund or manual capture decision), never silently flip.

### Sandbox test data (verified, public)
UAT host `https://api-preprod.phonepe.com/apis/pg-sandbox`. Credit card `4208 5851 9011 6667` exp 06/2027 CVV 508; debit `4242 4242 4242 4242` exp 12/2027 CVV 936; bank OTP `123456`. UPI success/failure/pending scenarios are set via "Test Case Templates" in the PhonePe Test App (Android `com.phonepe.simulator`) using the merchant ID. No public shared test merchant credentials: the client must obtain UAT client_id/secret/version.
Source: https://developer.phonepe.com/payment-gateway/uat-testing-go-live/uat-sandbox

### Collect from client
- PhonePe business account (KYC done), Merchant ID
- UAT: client_id, client_secret, client_version (via integration team ticket)
- PROD: client_id, client_secret, client_version (Dashboard > Developer Settings)
- Webhook username + password (we generate, they set on dashboard)
- Registered website domain shop.hasiruagro.com on PhonePe dashboard

### Admin settings fields
`mode (mock|sandbox|live)`, `merchantId`, `clientId`, `clientSecret`, `clientVersion`, `webhookUsername`, `webhookPassword`, `enabledPaymentModes[]` (optional), `orderExpirySeconds` (default 1200), read-only `webhookUrl` with copy button, "Test connection" (fetch token).

### Mock
Route handlers mimic all 5 endpoints with the same shapes. `/pay` returns `redirectUrl` to a local mock pay page `/api/_mock/phonepe/paypage?o=...` with buttons Success / Fail / Pending / Abandon. Clicking sets mock state, fires the webhook to our real webhook route with a correct `Authorization` SHA256 header (optionally delayed or duplicated to test idempotency), then redirects to `redirectUrl`. Token endpoint issues tokens with short `expires_at` (e.g. 60 s) so refresh logic is exercised. A toggle returns 429 on status to test backoff.

---

## 2. Meta WhatsApp Cloud API

### Big change to plan around (verified)
**Marketing templates are moving to the Marketing Messages API (MM API).** GA 2025-11-19. Cloud API `/messages` stops sending marketing: new messaging accounts created on/after **2027-04-13** cannot send marketing via Cloud API; on **2027-10-13** marketing via Cloud API errors for everyone. Utility, authentication and service stay on Cloud API.
- MM API endpoint: `POST https://graph.facebook.com/<ver>/<PHONE_NUMBER_ID>/marketing_messages`, same template payload schema, marketing templates only. Requires accepting MM API terms in App Dashboard > WhatsApp > Quickstart. Status webhooks show `marketing_lite` origin/category.
- Build: the WhatsApp package routes by template category: `MARKETING -> /marketing_messages`, everything else `-> /messages`. Since Hasiru's account will be new, this must be in from day one.
Sources: https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview , https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started

### Graph API version
Latest is **v26.0** (released 2026-07-29). v20.0 removed 2026-09-24, v21.0 removed 2027-01-21. Most tutorials still show v21; do not copy. Store version in config, default `v26.0`.
Source: https://developers.facebook.com/docs/graph-api/changelog/version26.0

### Sending
- `POST https://graph.facebook.com/v26.0/<PHONE_NUMBER_ID>/messages`, `Authorization: Bearer <system user token>`.
- Template payload: `{ messaging_product: "whatsapp", recipient_type: "individual", to: "+91XXXXXXXXXX", type: "template", template: { name, language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text }] }] } }`. Named params use `parameter_name` (order-free). Prefer **named** params (`{{order_number}}`) for readability.
- Free-form (non-template) only inside a 24 h customer service window opened by a user message.
- Authentication (OTP) send shape (verify in sandbox): body param = code, plus `{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] }` for copy-code button.
Sources: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview , https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages

### Template categories (verified)
- **Utility**: non-promotional and user-specific: order confirmation, shipping update, delivered, payment reminder, refund processed. No upsell/offers or it gets reclassified.
- **Marketing**: anything promotional. **Abandoned-cart reminders are MARKETING "even if requested by users"** (Retargeting objective). So the abandoned-cart flow is MM API + marketing opt-in + per-user limits.
- **Authentication**: OTP only. Fixed preset text (not customizable), optional `add_security_recommendation`, `code_expiration_minutes` (1-90) in footer, button `otp_type` `COPY_CODE` | `ONE_TAP` (Android, needs package name + signature hash) | zero-tap. For a website, COPY_CODE. Utility templates that should be authentication get rejected.
- Miscategorized utility templates are auto-moved to MARKETING (webhook `template_category_update`); repeated misuse escalates to utility rate limits/restrictions.
Sources: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization , https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates

### Template management API
- Create: `POST /v26.0/<WABA_ID>/message_templates` with `name` (lowercase + underscore), `category`, `language`, `parameter_format: "named"`, `components`, examples for every param. Auth templates via `upsert_message_templates` with `languages[]`.
- 100 creations/hour; 250 templates per account (unverified portfolio), 6000 if verified. Review up to 24 h. Statuses: APPROVED, PENDING/in review, REJECTED, PAUSED, DISABLED (+ quality High/Medium/Low). Templates inactive 12 months get archived.
- Build: admin "WhatsApp templates" page lists remote templates (GET same edge), maps each internal event (order_placed, order_shipped, ...) to a template name + param mapping. Seed JSON of our standard templates with a "Submit to Meta" button.

### Webhooks (verified)
- GET verify: `hub.mode=subscribe`, `hub.verify_token` must equal our stored token, respond 200 with `hub.challenge`.
- POST: header `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256(raw body, **app secret**). Reject on mismatch. Need raw body (Next.js route handler: `await req.text()` before JSON.parse).
- Retries for up to 7 days, up to 1000 updates per batch, duplicates happen: dedupe on `wamid` + status.
- Subscribe fields: `messages` (inbound + statuses), `message_template_status_update`, `message_template_quality_update`, `template_category_update`, `account_alerts`.
- Status values: `sent`, `delivered`, `read`, `played`, `failed` (`errors[]` with `code`, `title`, `error_data.details`). `read` may arrive without `delivered`. `pricing` object: `pricing_model: "PMP"`, `type: regular | free_customer_service | free_entry_point`, `category`. `billable` deprecated.
- Inbound: `entry[].changes[].value.messages[]` + `contacts[]` (`wa_id`, profile name). Use for STOP/opt-out keywords and opening the service window.
Sources: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint.md , https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status.md

### Limits (verified)
- Messaging limit (unique users outside service window per moving 24 h), **set at business portfolio level**: starts 250, then 2,000 (after business verification or 2k quality sends in 30 days), 10k, 100k, unlimited. Field `whatsapp_business_manager_messaging_limit` (old `messaging_limit_tier` deprecated).
- Throughput 80 msg/s per number (1,000 at high tiers). Error 130429 = throughput exceeded. Pair rate limit exists (too many messages to one user) without a published number.
- Per-user marketing limit: error **131049** (status webhook `failed`). Wait 24 h+ before retrying that user; repeated retries can block the user for 24 h. Never auto-retry 131049 quickly.
Sources: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits , `.../throughput.md`, `.../templates/marketing-templates/per-user-limits.md`

### Pricing (verified, page current Oct 2026)
- Per-message pricing since 2025-07-01, charged on **delivery**, by category + recipient country.
- **Changed 2026-10-01**: utility templates inside the service window are now **charged** (were free); service messages free only for first 1,000/month per number.
- Free entry point (Click-to-WhatsApp ad replies): up to 7 days, all categories free.
- Volume tiers for utility and authentication only.
- **India billing localization: eligible India accounts must migrate to INR billing by 2026-12-31; from 2027-01-01 Meta stops delivering for non-INR accounts.** New Hasiru account should be set up in INR from the start.
- India rates: read from Meta's rate card at setup time; third-party figures (~Rs 0.86 marketing, ~Rs 0.13 utility/auth) are unverified and outdated after the Jan 2026 marketing increase.
Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

### Opt-in (verified + India law)
- Meta policy: opt-in required before messaging; must clearly say the person is opting in to receive messages from **Hasiru Agro** (business named) over WhatsApp. Allowed channels: website, SMS, IVR, in person/paper. Honor opt-outs per category; separate opt-ins per category recommended.
- Build: checkout + account have two separate **unticked** checkboxes: "Order updates on WhatsApp" (utility) and "Offers and cart reminders on WhatsApp" (marketing). Store `consents` rows (channel, category, granted_at, source, ip, text version). Inbound "STOP" revokes marketing. (Unticked default is our choice: Meta's page doesn't mandate it, but India's DPDP Act requires affirmative consent.)
- DPDP Rules 2025 (notified 13/14 Nov 2025): notice + verifiable consent obligations come into force ~13-14 May 2027. Design consent records now so we're compliant at that date.
Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in ; DPDP timeline from https://www.azbpartners.com/bank/update-indias-digital-personal-data-protection-framework-comes-into-effect/

### Abandoned cart rules (derived)
Marketing category, MM API, needs marketing consent, counts toward per-user limit, charged at marketing rate. One reminder ~1-3 h after abandonment, optionally one more at 24 h, never more. Suppress if order placed, consent revoked, or 131049 seen in the last 24 h. Free-form reminder allowed only if the user messaged us in the last 24 h.

### Tokens and IDs (verified)
Direct integration uses a **System User access token** (Business Settings > System users) with `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`; system user needs asset access to the WhatsApp account + app. Choose "never" expiry when generating if offered (verify). User tokens expire in hours: testing only.
Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens.md

### Collect from client
- Meta Business portfolio (verified business preferred: raises limits to 2k and template cap to 6000)
- A phone number not already on the WhatsApp consumer/Business app (or migrated), display name approved
- WABA ID, Phone Number ID, Meta App ID, App Secret, System User token
- Accept MM API terms
- INR billing payment method on the WABA

### Admin settings fields
`mode`, `graphVersion` (default v26.0), `wabaId`, `phoneNumberId`, `appId`, `appSecret`, `systemUserToken`, `webhookVerifyToken` (generated), read-only `webhookUrl`, `marketingViaMmApi` (default on), template mapping table (event -> template name, language, param mapping), abandoned-cart delays, quiet hours (e.g. no marketing 9 pm to 9 am IST), "Send test message to..." button.

### Mock
Mock Graph server under `/api/_mock/meta/v26.0/...`: `/messages` and `/marketing_messages` return `{ messages: [{ id: "wamid.mock..." }] }`, then asynchronously POST signed status webhooks (sent, delivered, read; configurable failure codes 131049 / 130429 / 131026) to our webhook with a valid `X-Hub-Signature-256` using the configured app secret. `message_templates` GET/POST stores templates in memory and auto-approves after N seconds (emits `message_template_status_update`). A dev-only "WhatsApp inbox" page renders sent messages as chat bubbles and lets you send an inbound reply (to test STOP and service windows).

---

## 3. Meta catalog sync + Pixel + Conversions API

### Catalog (verified)
- `POST /v26.0/{catalog_id}/items_batch` with `item_type=PRODUCT_ITEM`, `requests=[{ method: "CREATE"|"UPDATE"|"DELETE", data: {...} }]`, `allow_upsert` (default true, so UPDATE alone works as upsert). Max 5000 items/request (recommend <3000), 28 MB. Response `handles[]` + `validation_status[]` (`retailer_id`, errors, warnings). Poll `GET /{catalog_id}/check_batch_request_status?handle=...` until done. Error 80014 = too many batch calls (back off).
- **Deprecated**: `POST /{catalog_id}/batch` (old), unavailable from API v27. Also Commerce Order Management API removed from all versions 2026-10-27 (not needed: we don't do on-Meta checkout).
- Required product fields (Meta spec, confirmed by SDK sample + feed spec summaries, verify in Commerce Manager): `id`, `title`, `description`, `availability` (`in stock`/`out of stock`), `condition` (`new`), `price` (`"2499.00 INR"`), `link`, `image_link`, `brand` (use "Hasiru Agro"). Optional useful: `sale_price`, `additional_image_link`, `item_group_id` (for size variants L/M/S), `google_product_category` (`Home & Garden > Plants`), `product_type` (our category path), `custom_label_0..4` (e.g. Timber/Fruit, bearing time), `quantity_to_sell_on_facebook`.
- Alternative (simpler, recommended as the default): **scheduled product feed URL**. Serve `/feeds/meta.csv` (or XML RSS with g: namespace) and set it as a scheduled data source in Commerce Manager (hourly/daily). items_batch then only used for near-real-time stock/price changes. Same feed generator can serve Google (section 4).
- Permission: `catalog_management` on the system user token (verify), catalog assigned to the system user.
Sources: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/items_batch , https://developers.facebook.com/documentation/ads-commerce/catalog/guides/manage-catalog-items/catalog-batch-api

### Pixel + Conversions API (verified)
- CAPI: `POST https://graph.facebook.com/v26.0/{PIXEL_ID}/events?access_token=...`, body `{ data: [ ... up to 1000 ], test_event_code? }`. Required per event: `event_name`, `event_time` (unix s, max 7 days old), `user_data`, `action_source: "website"`, and `event_source_url` (required for website). `custom_data`: `currency: "INR"`, `value`, `content_ids`, `content_type: "product"`, `contents[]`, `order_id`.
- `user_data`: SHA-256 of normalized `em` (trim, lowercase), `ph` (digits incl. country code 91), `fn`, `ln`, `ct`, `st`, `zp`, `country` (`in`), `external_id`; **unhashed** `client_ip_address`, `client_user_agent`, `fbp` (cookie `_fbp`), `fbc` (cookie `_fbc` or built from `fbclid`). Hashing normalization: verify on Customer Information Parameters page.
- **Dedup**: browser `fbq('track','Purchase',{...},{eventID: X})` and server `event_id: X` with the same `event_name`; 48 h window. Generate `event_id` server-side (e.g. `purchase:<orderId>`, `atc:<cartLineUuid>`) and pass it to the client.
- Events: PageView, ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo, Purchase (server on payment COMPLETED, not on return page), Lead (enquiry forms), Search.
- Pixel script must load after consent and with `afterInteractive`/idle loading so it doesn't hurt LCP/INP. Purchase is reliable via CAPI regardless of ad blockers.
Sources: https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api , https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events , https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event

### Collect from client
Meta Business portfolio access (admin role for WODO), Catalog ID (or permission to create), Pixel (dataset) ID, CAPI access token (Events Manager > Settings > Generate token), domain verification for hasiruagro.com (DNS TXT or meta tag), Test event code for QA.

### Admin settings fields
`catalogMode (feed|api|both)`, `catalogId`, `catalogToken` (can reuse system user token), feed URL (read-only, with optional secret query token), `pixelId`, `capiToken`, `testEventCode`, toggles per event, `domainVerificationMeta` (renders the meta tag), "Sync now" + last sync report (validation errors per product).

### Mock
`/items_batch` validates required fields exactly like Meta (returns `validation_status` errors for missing fields) and returns a handle; `check_batch_request_status` returns finished after one poll. `/events` validates hashing (64-hex), required fields, `event_time` window and echoes `events_received`; a dev page lists received events with dedup grouping by `event_id`.

---

## 4. Google Merchant Center, GA4, Google Ads

### Merchant API (verified)
- **Content API for Shopping is sunset (2026-08-18).** Progressive 410 errors since 2026-09-01; full shutdown early 2027. Do not build on it. Use **Merchant API v1** (`merchantapi.googleapis.com/.../v1/`; v1beta is the older surface, avoid).
Sources: https://developers.google.com/shopping-content/guides/sunset (updated 2026-09-10), https://developers.google.com/merchant/api/guides/products/overview (updated 2026-09-24)
- Setup: Merchant Center account, GCP project with Merchant API enabled, auth (service account added as a Merchant Center user, scope `https://www.googleapis.com/auth/content`, verify), **register as developer** (one-time registration of the GCP project), create an API data source.
- Data source: `POST https://merchantapi.googleapis.com/datasources/v1/accounts/{ACCOUNT_ID}/dataSources` `{ displayName, primaryProductDataSource: { feedLabel: "IN", contentLanguage: "en", countries: ["IN"] } }`. Returns `name` `accounts/{id}/dataSources/{dsId}`.
- Insert/upsert: `POST https://merchantapi.googleapis.com/products/v1/accounts/{ACCOUNT_ID}/productInputs:insert?dataSource=accounts/{ACCOUNT_ID}/dataSources/{DS_ID}` body `{ offerId, contentLanguage: "en", feedLabel: "IN", productAttributes: { title, description, link, imageLink, additionalImageLinks, availability: "IN_STOCK", condition: "NEW", price: { amountMicros: "2499000000", currencyCode: "INR" }, salePrice, brand, identifierExists: false, googleProductCategory, productTypes, shipping: [...] } }`. Delete: `DELETE .../productInputs/{productId}?dataSource=...`. Read processed status/issues: `products.get/list` (read-only `Product`).
- Price in **micros** (Rs 2,499 = 2,499,000,000). Common bug source; one helper `toMicros(paise)`.
Source: https://developers.google.com/merchant/api/guides/products/add-manage , https://developers.google.com/merchant/api/guides/data-sources/api-sources

### Required product data for plants (verified, Product data spec)
Required: `id`, `title`, `description`, `link`, `image_link`, `availability`, `price` (India: **GST-inclusive**). `condition` required only for used/refurbished (send `new` anyway). `brand` required for new products: "Hasiru Agro". Plants have no GTIN/MPN: send `identifier_exists: no` (`identifierExists: false`). **Shipping cost is required for India** (Shopping ads and free listings): either `shipping` per product or account-level shipping settings in Merchant Center (simpler: configure once in MC; mirror Bengaluru-zone rates). `google_product_category` optional; use `Home & Garden > Plants` (id 985; verify id). India-only optional `maximum_retail_price` (MRP, free listings only): map our regular price `r` when greater than sale price. Image size enforcement starts 2027-01-31 (check min size on spec page; our sharp pipeline outputs >= 1200 px).
Source: https://support.google.com/merchants/answer/7052112

### Feed file alternative
Merchant Center scheduled fetch of an XML (RSS 2.0 with `g:` namespace) or TSV file over HTTPS, daily. Not affected by the Content API sunset. **Recommendation: ship the feed first** (`/feeds/google.xml`, shared generator with Meta), add Merchant API push as an option for price/stock freshness. Feed URL must not be blocked by robots.txt and must not redirect.
Free listings: enable "Free listings" destination in MC; requires verified + claimed website (Search Console or DNS), shipping + return policy configured in MC.

### GA4 (verified)
- Client: gtag ecommerce events `view_item_list`, `select_item`, `view_item`, `add_to_cart`, `remove_from_cart`, `add_to_wishlist`, `view_cart`, `begin_checkout`, `add_shipping_info` (`shipping_tier`), `add_payment_info` (`payment_type`), `purchase`, `refund`, `view_promotion`, `select_promotion`. `currency` with `value`; `items[]` (item_id + item_name, up to 200); `transaction_id` required for purchase and refund. Source: https://developers.google.com/analytics/devguides/collection/ga4/ecommerce (updated 2026-10-14)
- **Server**: send `purchase` (on PhonePe COMPLETED) and `refund` via Measurement Protocol: `POST https://www.google-analytics.com/mp/collect?measurement_id=G-XXX&api_secret=...` with `client_id` (from `_ga` cookie, captured at checkout), `user_id` optional, `events[{ name, params: { session_id, engagement_time_msec, transaction_id, value, currency, items } }]`. Limits: 25 events/request, 25 params/event, backdate <= 72 h, body < 130 kB. `api_secret` server only. Validate via the debug endpoint (`/debug/mp/collect`, verify). Google now recommends the **Data Manager API** for new server-to-server integrations; MP is "mature, no deprecation planned", so MP is fine and simpler.
Source: https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events (updated 2026-10-13)
- Do not send purchase from both client and MP for the same transaction without the same `transaction_id` (GA4 dedups on it). Pick: server-side purchase only, client fires everything else.

### Google Ads conversion
- Purchase conversion via gtag `gtag('event','conversion',{ send_to: 'AW-XXXX/LABEL', value, currency: 'INR', transaction_id })` with a stable `transaction_id` (dedups reloads). Enhanced conversions: `gtag('set','user_data',{ email, phone_number, address })` before the conversion (Google hashes). Or import the GA4 `purchase` key event into Google Ads (fewer tags; recommended if client uses GA4 linking).
- Server-side/offline uploads: Data Manager API (`IngestEvents`, v1.8 2026-07-30 made transaction_id optional; unverified). Skip for launch; add if offline/phone orders need attribution.
- Consent Mode v2 signals (`ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`) from the cookie banner.
Source: https://support.google.com/google-ads/answer/6386790

### Collect from client
Merchant Center account ID (or let WODO create, client as owner), website claim (Search Console access or DNS), GCP project (WODO-owned is fine) + service account added as MC user, shipping/returns policy text, GA4 property + Measurement ID + MP API secret, Google Ads customer ID + conversion ID/label (if running ads), GTM: not needed (direct gtag is lighter).

### Admin settings fields
`merchantMode (feed|api|both)`, `merchantAccountId`, `dataSourceId`, `serviceAccountJson` (encrypted), `feedLabel` (IN), `contentLanguage` (en), feed URL (read-only), `googleProductCategoryDefault`, `ga4MeasurementId`, `ga4ApiSecret`, `adsConversionId`, `adsPurchaseLabel`, `enhancedConversions` toggle, `consentModeDefaults`, "Sync now" + per-product issues view.

### Mock
Mock `productInputs:insert/delete`, `dataSources`, `products.list` (returns issues for missing required attrs, e.g. no shipping). Mock MP endpoint that mirrors `/debug/mp/collect` validation messages. Mock OAuth token endpoint for the service account JWT exchange (so the signing code path runs).

---

## 5. Gmail API (send via OAuth refresh token)

Per WODO policy: Gmail API with OAuth, never SMTP.
- Send: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` body `{ raw: base64url(RFC 2822 MIME) }` (upload variant `https://gmail.googleapis.com/upload/gmail/v1/users/{userId}/messages/send` for large attachments). (Page updated 2026-04-15.)
- Scope: use the narrowest, `https://www.googleapis.com/auth/gmail.send`. (Also accepted: `gmail.compose`, `gmail.modify`, `https://mail.google.com/`.)
- Token: `POST https://oauth2.googleapis.com/token` with `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token` -> 1 h access token. Cache, refresh on 401.
- Refresh token gotchas: if the OAuth consent screen is External + "Testing", refresh tokens **expire after 7 days**. Use a Workspace "Internal" app or publish the app (gmail.send is a sensitive scope: verification needed for External production). Tokens are also revoked on password change for some account types and after 6 months unused. Admin page must show "Gmail connected as x@ / last send ok" and a Reconnect button (OAuth flow in admin, per-site refresh token stored encrypted).
- Quotas (page updated 2026-10-16): `messages.send` = 100 units; 6,000 units/min per user per project (= 60 sends/min); 1,200,000 units/min per project; 500 recipients/message. Daily caps from Gmail itself: ~500/day consumer, ~2,000/day Workspace (verify on Workspace page). Page notes charges above a daily billing threshold are planned later in 2026.
- Backoff: truncated exponential (2^n s + jitter, max 32-64 s) on 429/403 rateLimitExceeded. Queue all mail via pg-boss with rate limit ~1/s.
- Deliverability: send From the authenticated Gmail/Workspace address (or a verified "Send mail as" alias); SPF/DKIM for hasiruagro.com if Workspace.
Sources: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send , https://developers.google.com/workspace/gmail/api/reference/quota

### Collect from client
Which mailbox sends (e.g. orders@hasiruagro.com on Workspace preferred), a one-time "Connect Gmail" consent by that user. OAuth client: WODO agency client (from vault) or client-owned GCP project; decide which (agency client reuses across sites per WODO convention).

### Admin settings fields
`mode`, `oauthClientId`, `oauthClientSecret` (env or vault, not editable in UI if agency-shared), connected account email, `refreshToken` (set by Connect flow, never displayed), `fromName`, `replyTo`, `bccAdmin`, "Send test email" button, last error.

### Mock
Mock token endpoint + mock `messages/send` that decodes `raw`, parses MIME and stores it; a dev "Outbox" page renders HTML emails (like MailHog). Toggle to return 401 (expired token) and 429 to test refresh and backoff.

---

## 6. Claude API (advisor: rules decide, Claude narrates)

Facts from the bundled Claude API skill (model table cached 2026-10-06):
| Model | ID | Price in/out per MTok | Notes |
|---|---|---|---|
| Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 / $0.50 (prompts <= 100K; $0.50/$2.50 above) | 1M ctx, 128K out, adaptive thinking on by default, effort default `medium`, **no server-side refusal fallback** |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2 / $10 | effort default `high`; thinking off only via `{type:"between_tools"}` |
| Claude Opus 5.5 | `claude-opus-5-5` | $4 / $20 | default model in docs; thinking can't be disabled |
Use the exact IDs, no date suffix.

### Breaking API shapes to respect (2026)
- No assistant prefill (400). Use structured outputs.
- `budget_tokens` rejected (400) on all three. Control cost with `output_config: { effort: "low" }`.
- Forced `tool_choice` (`any`/`tool`) returns 400 on Opus 5.5 / Sonnet 5.5. Use `auto` + `strict: true` or structured output.
- Responses can start with `thinking` blocks (Haiku 5.5 thinks by default): read content by `type === "text"`, never `content[0]`. Thinking counts toward `max_tokens`; don't set tiny caps.
- Structured output: `output_config.format` (old `output_format` deprecated). TS: `client.messages.parse({ ..., output_config: { format: zodOutputFormat(Schema) } })` from `@anthropic-ai/sdk/helpers/zod`; `parsed_output` may be null, guard it.
- Always check `stop_reason` (`refusal`, `max_tokens`) before using output; fall back to the rules-engine template text.

### Architecture
1. Rules engine (pure TS, deterministic, unit tested) takes land size, region/soil/water, goals, budget and returns a `Recommendation` object: plant list with counts, spacing, layout model, costs, reasons codes. This is the source of truth; prices/stock come from our DB.
2. Claude **only narrates**: input = the `Recommendation` JSON + product facts; output (structured) = `{ summary, perPlantNotes[{id, note}], caveats[], followUpQuestions[] }`. Validate that every `id` exists in the input; drop anything else. Never let the model add products, change counts or prices.
3. "Ask AI" Q&A: Claude answers using retrieved catalogue facts passed in the prompt (keyword/pg full-text retrieval first, ~10 products) with a strict system prompt ("only recommend products from the provided list; if unsure, say so and offer WhatsApp/call"). Optional tool `search_products(query)` (strict schema) executed against Postgres, `tool_choice: auto`.
4. Model choice: **`claude-haiku-5-5` at effort `low`** for narration and Q&A (cheap, fast; streaming to UI). Admin setting can switch to `claude-sonnet-5-5`. (The skill defaults to Opus 5.5 unless told otherwise; for a public storefront narrator Haiku/Sonnet is the cost-sensible choice, keep it a setting.)
5. Prompt caching: put the long stable system prompt (brand voice, rules, plant knowledge base) first with `cache_control: { type: "ephemeral" }`; volatile user input after it. Minimum cacheable prefix on the 5.5 models is 512 tokens. Verify `usage.cache_read_input_tokens > 0` in logs. Cache reads 0.1x input price.
6. Cost guardrails: per-IP/session rate limit, `max_tokens` ~2000, cache identical narration results in Postgres keyed by hash(recommendation JSON + model + prompt version) so repeat plans cost nothing.
7. Copy rules applied in the system prompt: no em dashes, no "phase"/"v1"/"v2" wording.

### Collect from client / WODO
Anthropic API key (org decision: WODO-billed or client-billed), monthly spend cap in Console.

### Admin settings fields
`mode (mock|live)`, `apiKey`, `model` (select: haiku-5-5 / sonnet-5-5), `effort` (low/medium), `maxTokens`, `dailyRequestCap`, `systemPromptVersion` (read-only), toggle "Ask AI enabled", usage counter (tokens/day from `usage`).

### Mock
Mock provider returns deterministic narration built from the `Recommendation` JSON with a template (also used as the production fallback on error/refusal), streamed word-by-word to exercise the streaming UI. For Q&A, mock does keyword search over the catalogue and formats an answer. Tests assert the "no invented products" validator rejects ids outside the input.

---

## Deprecation / date watchlist
| Item | Date | Action |
|---|---|---|
| PhonePe PG v1 (salt key, X-VERIFY) | already deprecated | build v2 only |
| Google Content API for Shopping | sunset 2026-08-18, 410s from 2026-09-01, off early 2027 | Merchant API v1 / feed file |
| WhatsApp utility-in-window now charged | 2026-10-01 | budget for it |
| WhatsApp India INR billing | migrate by 2026-12-31, non-INR stops 2027-01-01 | set INR at account creation |
| Graph API v21 removed | 2027-01-21 | use v26.0 |
| Meta `/{catalog_id}/batch` | gone in v27 | use items_batch |
| WhatsApp marketing on Cloud API `/messages` | new accounts blocked 2027-04-13, all 2027-10-13 | use MM API `/marketing_messages` now |
| DPDP Rules notice/consent obligations | ~2027-05-13 | consent records from day one |
| Merchant Center image size enforcement | 2027-01-31 | sharp pipeline >= 1200 px |

## Open items to verify in sandbox
1. PhonePe webhook `Authorization` hash encoding (hex vs base64, prefix).
2. PhonePe `expireAt` vs `expiryAt` field name in create response.
3. WhatsApp auth template send payload (button sub_type url index 0) on v26.0.
4. Meta catalog required fields in Commerce Manager for India and whether `catalog_management` is needed on the system user.
5. Google `googleProductCategory` id for Plants and MC shipping settings for Bengaluru zones.
6. Gmail daily send cap for the client's mailbox type.
