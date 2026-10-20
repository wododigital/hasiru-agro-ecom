# verify-jobs (2026-10-20, 10:20-11:00 IST, boot agent)

Same server, worker and database as `verify-money.md` (`ecomkit_boot2`, port 3301). Command:
`node tooling/smoke.mjs --base=http://localhost:3301` (full) and `--only=jobs`.

| Check | Result | Evidence |
|---|---|---|
| worker boots | PASS | 50 queues, 20 schedules, ports bound by `boot()` |
| cart marked abandoned (`cart.mark-abandoned`, every 5 min) | PASS | idle guest cart -> `abandoned`, `cart.abandoned` emitted |
| abandoned cart flow run started | PASS | `flows_run` running (contact read from the cart's checkout session, marketing consent granted) |
| reminder queued | PASS | `cart.reminder_1` on WhatsApp + email (run clock moved back one hour by the smoke) |
| restore link works | PASS | link in the message: GET 200 (read-only page), POST 303 -> `/cart` |
| notify-me | PASS | 201, `inventory_subscription` row |
| enquiry submit (no-JS form) | PASS | 303 `?enquiry=sent`, `enquiries_enquiry` row |
| wizard plan generate / unlock | PASS / PASS | 200 planId / 200 `unlocked` |
| ERP sync against the mock | PASS | `erp-sync.pull-inventory` job -> `erp_sync_run` +1 (hasiru-ops mock transport) |
| feed regeneration | PASS | `feeds.regenerate` job -> `feeds_run` +2 (google + meta) |
| developer alert on a payment failure | PASS | 3 forged PhonePe webhooks -> critical `payments.webhook_signature` alert |
| sitemap lists products | PASS | 5 sitemap files, 163 product URLs (was empty: no `configureSeo`) |
| Google feed served | SKIP | 403 without the feed token (token is a sealed setting) |

Smoke notes: the checkout form autosaves the contact and the consent tick with JavaScript, so the abandoned-cart check
writes those two rows (checkout session contact, consent row with core's contact hashes) the way the autosave does;
everything after that (abandon job, event, flow run, reminder, restore link) is the real pipeline. ERP "Sync stock now"
and feeds "Rebuild feeds now" are JS-only settings buttons that only enqueue a job; the smoke enqueues the same jobs.

Fixed for this table: abandoned-cart reminders could never start for a guest (`cart.abandoned` carries no checkout
session id, so the flows snapshot had no contact); the host port now reads the cart's checkout session
(`checkoutContact(cartId, { byCart: true })`).
