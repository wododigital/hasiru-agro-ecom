# @ecomkit/notifications

Sends templated messages to customers and staff over email (Gmail API with OAuth, never SMTP), WhatsApp (Cloud API, with marketing templates routed to the Marketing Messages API), an SMS mock and a log channel. Owns the template registry, the send log, provider webhooks, opt-outs, quiet hours, the OTP kill switch and the dev outbox. Brand-neutral: the store name is the `{{store_name}}` variable filled from settings.

Depends on `core` only. Other modules reach it through the `notifications` service (`registry.service('notifications')`), never by import.

## Public API

| Export | What |
|---|---|
| `@ecomkit/notifications/server` | `send(templateKey, to, vars, { channel?, tx?, orderId?, flowRunId?, isTest? })` (also the `notifications` service, contract `NotificationSender`), `deliver()`, `sendSessionText(phone, text)` (free-form WhatsApp inside the 24 h window only), `lastInboundAt()`, `renderTemplate()`, `resolveTemplate()`, `listTemplates()`, `saveTemplate()`, `resetTemplate()`, channel factories (`createGmailChannel`, `createWhatsappChannel`, `createSmsMockChannel`, `logChannel`, `channelFor`), webhook handlers, `syncWhatsappTemplates()`, `submitWhatsappTemplates()`, `connectGmailAction()`, `gmailCallback()`, `settingsDef`, `loadSettings()`, `addressHash()`, `listMessages()`, `outboxMessages()` |
| `@ecomkit/notifications/domain` | `DEFAULT_TEMPLATES` (one per frozen template key), `fillTemplate`, `templateVariables`, `textToHtml`, `quietHoursRelease`, `optKeyword`, `inServiceWindow`, `whatsappEndpoint`, `classifyWhatsappError`, `nextStatus`, `maskAddress`, `backoffMs`, `templatePayload`, `templateCreatePayload`, `webhookItems`, `buildMime`, `parseMime` |
| `@ecomkit/notifications/admin` | `MessagesPage`, `TemplatesPage`, `OutboxPage`, `SettingsPanel` |
| `@ecomkit/notifications/mocks/meta`, `/mocks/gmail` | mock provider route handlers (`GET`, `POST`) |

`send` writes one `notifications_message` row and one `notifications.deliver` job per channel, in the caller's transaction when `tx` is given (nothing goes out for a rolled-back order). Without `channel`, a recipient gets email when it has an email and email is not off, WhatsApp when it has a phone and WhatsApp is not off; with neither available the message goes to the log channel so it is never silently dropped. `enquiry.received_admin`, `alert.*` and `test.send` with no recipient go to the admin email and phone from settings. Every template variable must be supplied (missing one throws; `store_name` is added by the module).

Checked when queued (row written as `skipped` with the reason): OTP kill switch (`otp_disabled`), opt-out for marketing on WhatsApp/SMS (`opted_out`), WhatsApp error 131049 for that number in the last 24 h (`per_user_limit_24h`). Marketing queued during quiet hours (IST) is held until they end (`startAfter`); utility and authentication always go.

Delivery (`notifications.deliver` job): idempotent; success marks `sent` and emits `message.sent`; rate limits, 5xx and WhatsApp 130429 throw so the queue retries with backoff (attempt 6 marks `failed`); permanent errors, 131049 and a Gmail `invalid_grant` (`gmail_refresh_failed`) mark `failed` and emit `message.failed`. Every provider call is logged by `core.integrationCall`. Gmail refreshes the access token once on 401 and backs off (2^n s + jitter, up to 4 retries) on 429 / `rateLimitExceeded`.

## Tables
`notifications_template` (admin overrides of the default text, versioned), `notifications_whatsapp_template` (mirror of the account's templates), `notifications_message` (send log: hashed and masked recipient, rendered text without the address, status, error code, pricing), `notifications_webhook_event` (raw webhook items, unique dedupe key), `notifications_optout` (STOP). Enums `notifications_channel`, `notifications_category`, `notifications_wa_template_status`, `notifications_message_status`.

## Routes
- `GET /api/webhooks/whatsapp` (verify token handshake), `POST` (HMAC `X-Hub-Signature-256` with the app secret over the raw body; rate limit 600/min; items stored with dedupe keys `wamid:status`, inbound `wamid`, template events; processed by `notifications.process-webhook`).
- `GET /api/auth/gmail/callback` (signed state bound to the admin who clicked, 10 min; requires `settings.secrets` and the same user; stores the refresh token encrypted and the mailbox address).
- Admin: `/admin/messages` (log), `/admin/templates` (edit overrides; only the default's variables are allowed), `/admin/dev/outbox` (dev and test only; rendered messages plus a form that simulates an inbound WhatsApp message, e.g. STOP).
- Mocks (dev/test configs only, 404 unless `ENABLE_MOCKS=1`): `/api/_mock/meta/[...path]` (messages, marketing_messages, message_templates with auto-approve, signed status webhooks, `_control` failure toggles 130429/131049/131026, `_inbound`, `_state`), `/api/_mock/gmail/[...path]` (consent redirect, token, send that parses the MIME into an outbox, `_control` 401/429/revoke toggles, `_state`).

## Settings (`/admin/settings/notifications`)
General: store name, admin email/phone, quiet hours (default 21:00 to 09:00 IST), OTP kill switch. Email: mode `off|mock|live`, OAuth client override (default from env `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET`), refresh token (secret, set by Connect Gmail), connected mailbox, from name, reply-to, BCC admin. WhatsApp: mode `off|mock|sandbox|live`, Graph version (default v26.0), WABA ID, phone number ID, app ID, app secret, system user token, verify token (secrets), language, marketing via MM API (default on). SMS: `off|mock`.
Actions: Connect Gmail (oauth-redirect, `settings.secrets`), Send test email, Send test WhatsApp (test-connection), Sync WhatsApp templates, Submit templates to WhatsApp. Custom panel: webhook URL, connected mailbox, kill switch warning.
Mock mode needs no credentials (built-in mock ids), so the dev outbox works out of the box. Live and sandbox calls go through `core.safeFetch` with host allowlists (`graph.facebook.com`, `oauth2.googleapis.com`, `gmail.googleapis.com`).

## Events, jobs, health
Emits `message.sent`, `message.failed` (and `integration.failed` through core). Consumes none. Jobs `notifications.deliver`, `notifications.process-webhook`, `notifications.sync-templates` (daily 04:15 IST). Provides service `notifications`. Health checks `notifications-email`, `notifications-whatsapp` (not configured / mock in production / failure rate over 20% in the last hour / blocked templates), `notifications-otp` (degraded while the kill switch is on).

## Disabling
Remove `notifications` from the app's module list. Callers get `null` from `registry.service('notifications')` and fall back (auth logs codes in dev and refuses in production); flows and monitoring degrade per their own READMEs.

## Tests
`pnpm turbo run typecheck lint test --filter=@ecomkit/notifications` (Postgres 17, see docs/CONVENTIONS.md). `domain.test.ts`: catalogue covers every key, exact text of every template pinned, copy rules, quiet hours, keywords, window, routing, error classes, status order, payloads, webhook dedupe keys, MIME. `server.test.ts` (real Postgres, a real HTTP server serving the mocks and the webhook route): every key on every channel, overrides, send and deliver both channels, status webhooks and dedupe, signature and verify token, routing, 131049, 130429, STOP/START, service window, quiet hours, OTP kill switch, transaction rollback, admin fallback and log channel, Gmail 401 refresh, 429 backoff, revoked token, Connect Gmail flow, test email action, template submit/sync/approval. `worker.test.ts`: the manifest in a registry with a real worker, end to end to `read`. `manifest.test.ts`: validation, mock stubs only for dev configs, every lazy reference resolves.
