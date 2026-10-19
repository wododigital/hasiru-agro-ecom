# CRO, Filters, Admin and Analytics Research

Hasiru Agro e-commerce build. Researched 2026-10-20. Sources at the end. Vendor-blog numbers are marked "directional"; Baymard/Google/Shopify docs are primary.

Data reality check (client file `latest_products.xlsx`, Plant data tab, 159 plants): Kannada name, variety, canopy size, primary/secondary/tertiary category, nitrogen fixer Y/N, drought tolerant Y/N, propagation method, temperature min/opt/max, humidity min/opt/max, rainfall mm/y min/max, spacing per model (Food forest / Miyawaki / Commercial / Boundary, "-" = not used), compost kg by age band. District geo tab (644 districts): soil type, temp min/max, humidity, avg rain/y, native crops. Not yet supplied: price, stock, images, bulk threshold, GST/HSN, weight, bearing time/yield for most rows. Every facet below is mapped to a real column or marked "needs data".

---

## 1. Product card (PLP / carousels) for plant buyers

Evidence: Baymard list-item research: 64% of sites fail to present enough list info; missing attributes force pogo-sticking to PDPs, which drives abandonment. Attributes must be consistent across items (#443), visually distinct (#448), and numeric specs need labels + units (#449). Titles max 3-4 lines on mobile. Nurserylive card: image, "Save X%" badge, name, strike price + price, rating "4.31/5 (452)", short excerpt, Add to cart, "Sold out" swaps the button. Ugaoo: price + strike + % off, "inclusive of all taxes", rating, promo bar offers. Quick-commerce (Blinkit/Zepto) move: rupee savings ("Save Rs 120") over percent, big image, ADD button that morphs into a -/+ stepper in place (no navigation).

Card spec (top to bottom), fixed slots so every card has the same attributes (empty slot shows "-", never shifts layout):
1. Image 1:1 (or 4:5), AVIF/WebP via sharp, `sizes` attr, blur placeholder. Top-left badge stack, max 2: priority order `Out of stock` > `Bulk price unlocked` (when cart qty >= threshold) > `Fits your district` > `Bestseller` > `New` > `Save Rs X`. Top-right: wishlist heart (optional, low priority).
2. Category line, small caps: `Fruiting Tree · Exotic` / `Timber Tree`.
3. Name (2 lines max) + Kannada name small (data exists, helps local trust and SEO).
4. Attribute row, 3 icon chips with units: size class / canopy (`Large tree`), propagation (`Grafted`), and one of water need / bearing time (`Fruits in 3 yrs`) when known. Fixed order across all cards.
5. Climate fit chip (the differentiator): computed by the rules engine from the shopper's saved district (district geo temp/rain/humidity vs plant min/max). Three states: green `Good fit for Mysuru`, amber `Grows with care in Mysuru`, hidden when no district chosen (never show red "bad fit" on cards; explain on PDP). One "Set your district" prompt in the PLP header feeds all cards.
6. Rating `4.8 (126)` only when reviews >= 3; otherwise hide (empty stars hurt more than nothing).
7. Price block: `Rs 449` + struck MRP + `Save Rs 150` (rupees, quick-commerce style). Second line, muted: `Rs 320 each from 50 plants` (bulk tier hint; threshold per plant). When cart qty for this item crosses the threshold the line turns gold: `Bulk price applied`.
8. CTA: full-width `Add` button; after first tap becomes `- 1 +` stepper with long-press / tap-to-type quantity (farm buyers order 50-500; stepper alone is unusable at that scale; Baymard: 97% of sites lack button+field quantity, both are needed). Quick-add chips `+10` `+50` on focus for L/M/S size class.
9. Stock: `Only 12 left` under 20 (real number from hasiru-ops sync, never fake scarcity). Out of stock: button becomes `Notify me` (WhatsApp/email, feeds back-in-stock job).

Do not show on card: long description, delivery estimate (PLP-level header instead: "Delivering to 560001: Saturday slot"), multiple prices per variant.

## 2. Faceted filters that feel instant

### 2.1 Facet set (mapped to data)
Order by buying intent; keep 6-8 open/visible, rest collapsed (Baymard: 5-10 relevant attributes, avoid 20+).

| Facet | Type | Source column | Notes |
|---|---|---|---|
| Category | tabs (Timber / Fruiting / Other) + sub (Desi/Exotic/Spices/Plantation) | primary/secondary cat | Category is a path segment, not a filter param (indexable) |
| Fits my district | toggle + district picker | district geo × temp/rain/humidity min-max | Rules engine score; sticky across site |
| Purpose / model | multi-select (Commercial, Food forest, Miyawaki, Boundary) | model spacing non "-" | |
| In stock | toggle at top | stock from hasiru-ops | Default ON? No: default off but sort in-stock first |
| Price | dual slider + 2 inputs + preset brackets | price | Show per-plant and bulk |
| Size class | chips (Large tree / Medium / Small, shrub, climber) | sz / canopy size | |
| Rainfall | range or buckets (<600, 600-1000, 1000-1500, 1500-2500, >2500 mm) | rainfall min/max | overlap match, not equality |
| Temperature tolerance | buckets (handles heat > 40 C, handles cold < 10 C) | temp min/max | |
| Water need / drought tolerant | toggle `Drought tolerant` + Low/Med/High | Drought tolerant, Water | |
| Propagation | multi (Grafted, Seedling, Tissue culture, Air layered, Budded) | propagation method | |
| Nitrogen fixer | toggle | Nitrogen fixer | useful for food forest buyers |
| Exposure | Full sun / Partial shade | ex (old catalog) | needs data for new rows |
| Bearing time | buckets (<2 yrs, 2-4, 4-7, 7+) | b | needs data |
| Yield | buckets | y | needs data; may be hidden at launch |
| Land size | not a filter: it is an input to the calculator/wizard; on PLP show "Plants needed for 1 acre: 121" on cards when set | spacing | |
| Rating 4+ | toggle | reviews | hide facet until reviews exist |

Facet hiding rule: a facet with <2 distinct values in the current result set, or with >60% unknown values, is hidden automatically (no broken-looking filters while data is incomplete).

### 2.2 Interaction rules
- Multi-select within a facet = OR; across facets = AND (Baymard; 14-15% of sites fail multi-select).
- Counts next to every option, recomputed against the other active facets (disjunctive counting). Options that would yield 0 are shown disabled with `(0)`, not hidden, except for long lists.
- Desktop: left sticky sidebar, instant apply. Mobile: sticky `Filter · Sort` bar (+ count badge) opens a full-height bottom sheet; selections update the count live and the footer button reads `Show 37 plants`; explicit apply (Baymard: live refresh behind a sheet disorients). `Clear all` in header + per-group reset.
- Applied chips row above results, horizontally scrollable on mobile, each removable, plus `Clear all` (28% of sites lack an applied overview).
- Thematic quick filters as a chip rail at the top of PLP (one tap, preset combos): `Fits my district`, `Drought tolerant`, `For food forest`, `Under Rs 300`, `Bulk deals`, `Fruits in 2 yrs`. These are also SEO landing pages (see 2.4).
- Sort: Recommended (in stock + district fit + bestseller), Price low-high, high-low, Fastest bearing, Newest. Sort is never an indexable param.
- Search inside long lists (district picker is a combobox with 644 districts, type-ahead after 2 chars).
- Back button must restore filters and scroll position (URL state + `scrollRestoration`).
- Zero results: never a dead end. Show "No plants match all 4 filters" + one-tap chips to remove each filter with the count each removal would yield (`Remove Rainfall: 12 plants`), then "Closest matches" (relax the lowest-priority facet automatically), then `Ask our agronomist on WhatsApp` CTA and `Help me choose` wizard link. Log the zero-result combo to analytics.
- Accessibility: facets as `fieldset`/`legend`, checkboxes not radios, 44px targets, `aria-live="polite"` announcing result count.

### 2.3 Instant client-side filtering (<500 SKUs)
- At 200-500 SKUs, ship the full facet index to the client: a compact JSON (ids + facet values + price + stock + sort keys, no descriptions) ~20-40 KB gzip, generated at build/revalidate and served static with `ETag` + stale-while-revalidate. Filter in a plain loop with bitsets per facet value (precompute `Uint32Array` bitsets; AND/OR = bitwise ops; counts = popcount). Sub-millisecond for 500 items; no library needed.
- Server renders the first page of results for the URL (SSR, real HTML for SEO and LCP); client hydrates the index and takes over. No network round trip per filter click.
- INP target <200 ms: update state in `startTransition`, render only visible cards (render 24, "Show more" or IntersectionObserver for the next 24), keep card component memoized by id, avoid re-mounting images (stable keys). Debounce price slider (150 ms). Use `history.replaceState` for slider drags, `pushState` on discrete facet toggles.
- Stock/price freshness: index carries a version; a light `/api/stock?v=` diff (or revalidateTag on hasiru-ops inventory webhook) patches stock flags.
- Same index powers on-site search (prefix + synonym map: English, Kannada, scientific names, common misspellings like "mahagony", "chikku/sapota") and the wizard.

### 2.4 URL state and SEO
Google faceted-navigation guidance (Search Central): use `&` separators; keep filter order consistent and prevent duplicates; return 404 for empty/nonsensical combos (not a redirect); robots.txt blocking is the strongest control for URLs you never want crawled; canonical and nofollow are weaker signals.

Scheme:
- Indexable "facet landing pages" are clean paths with curated copy, title, H1, FAQ, and internal links, curated in admin (not auto-generated from every combo):
  - `/plants/fruiting-trees`, `/plants/fruiting-trees/exotic`, `/plants/timber-trees`
  - `/plants/for/food-forest`, `/plants/for/miyawaki`, `/plants/for/commercial-farming`
  - `/plants/drought-tolerant`, `/plants/nitrogen-fixing`
  - `/plants/grow-in/{district}` (e.g. `/plants/grow-in/mysuru`) generated only for districts the admin enables (Karnataka + neighbouring targets first) and only when >= 6 plants fit; unique intro from district geo data (rainfall, soil, native crops). This is the programmatic SEO play with real unique data.
- Everything else is query params, canonical-ordered (alphabetical keys, sorted values, comma-joined values within a key is fine for us since these pages are not indexed): `?rain=1000-1500&size=large&stock=1&sort=price`. These render `<meta name="robots" content="noindex,follow">` and `rel=canonical` to the nearest clean landing page. Sort, page-size and view params are always noindex.
- When a param combo equals a curated landing page (e.g. `?purpose=food-forest`), client navigation rewrites to the clean path.
- Pagination: `?page=2` on landing pages is indexable with self-canonical; filtered pagination is noindex.
- Empty clean-path landing page (e.g. a district with 0 fits) returns 404 (or is not generated).
- robots.txt: disallow `/*?*sort=` and `/search?` to save crawl budget; do not block the filter params that carry noindex (Google must see noindex), unless crawl stats show waste.
- Sitemap includes only clean landing pages + PDPs.

## 3. Product detail page (PDP)

Reference: Ugaoo PDP order (gallery, rating, price + "inclusive of all taxes", qty + ATC, offers, trust badges "30-day plant guarantee / support / pan-India", delivery Check field, care icons, "5 reasons to buy", comparison table vs local nursery, related products, reviews, FAQs, chat support, sticky ATC). Baymard: show delivery date not speed (dates read as a promise; users stall when they must compute arrival); 63% lack cross-review image navigation; sticky ATC on mobile.

Hasiru PDP blocks, mobile order:
1. Gallery (swipe, pinch zoom, video slot for the WhatsApp/YouTube plant videos the client listed; lazy-load video, poster only).
2. Name, Kannada name, scientific name, category chips, rating link to reviews.
3. Price block: unit price, MRP, `Save Rs X`, "GST included" or "0% GST on plants". **Bulk tier table** (2 rows now, schema supports N): `1-49: Rs 449 each`, `50+: Rs 320 each (save 29%)`, with live highlight of the active tier and a nudge `Add 8 more to unlock Rs 320 each, save Rs 6,450`.
4. Quantity: stepper + typed field + quick chips (+10, +50, +100) + "Plants for my land" mini-calculator (acre/sq ft input × model spacing → suggested qty, one tap applies).
5. Add to cart (primary) + `Buy now` (secondary) + `Ask on WhatsApp` (tertiary, prefilled message with plant name + qty).
6. District fit panel: "How it grows in your district" from rules engine: temp/rain/humidity bars of plant range vs district range, verdict + reason in plain words; Claude may narrate, rules decide.
7. Delivery estimator: pincode (6 digits, autodetect from saved address) → district → options with dates: `Nursery pickup: ready tomorrow (free)`, `Bengaluru Saturday slot: Sat 25 Oct`, `Outstation truck to Mysuru: by Tue 28 Oct, approx Rs X shared`. Pincode → district via India Post directory dataset (data.gov.in) imported into Postgres (no runtime third-party API).
8. Trust row: Incubated by UAS Dharwad, Startup India, MSME, "Disease-free nursery stock", "Grown in Bengaluru nursery", plant replacement/damage policy (no cancellation/return stated clearly near ATC, not hidden).
9. Key facts table (spacing per model, canopy, propagation, bearing time, yield, water, temperature range, rainfall range, nitrogen fixer, drought tolerant) with units.
10. "Grows well with" (companion/cross-sell): from model patterns (M/X/O roles: a Main fruit tree suggests Host timber + Biomass support), rules-based, 4-6 cards with one-tap add, plus "Inputs for this plant" (vermicompost/biochar dosage × qty, pre-calculated pack count).
11. Care guide (planting, watering, pruning, compost schedule by age band from data), FAQ (client FAQ sheet per plant, answers needed) with FAQPage schema only where answers are visible.
12. Reviews: photo-first strip, filter by "with photos", verified-buyer badge, district of reviewer ("Farm in Hassan"), sort by recent/helpful; gallery navigation across all review images. Q&A: "Ask a question" answered by admin (moderated), shows on PDP.
13. Sticky bottom bar on mobile after the main ATC scrolls out: price for current qty + stepper + Add. Desktop: sticky right column.
14. Recently viewed (localStorage only).

Schema: Product + Offer (price, availability, priceValidUntil), AggregateRating/Review only for real reviews, BreadcrumbList, `additionalProperty` for facts. Merchant listing compatible fields for Google Merchant Center.

## 4. Cart and checkout CRO for India

Evidence: Baymard average cart abandonment ~70%; checkout redesign worth up to 35% conversion lift; 62% of sites don't make guest checkout most prominent; 18% abandon over forced accounts; 49% don't explain why phone is needed and >70% are reluctant to give a phone number; 48% show speed not date; 52% omit some fulfilment options from the selector; 94% lack adaptive error messages; 61% don't mark both required and optional. India (directional, vendor sources): COD 45-65% of D2C orders with RTO up to ~30%; partial COD (token Rs 50-150 or 10-20% prepaid) cuts RTO sharply.

Cart:
- Two zones from prototype: Recommended package (tinted) above Additional items.
- Truck meter (differentiator): "Tata Ace 65% full. Add ~260 kg more at no extra transport cost", success state at full; for small orders show the classic "Rs X away from free Bengaluru delivery" bar. Start partly filled.
- Bulk savings line, auto promo line, inputs suggestion ("Recommended inputs for 120 plants: 10 x Vermicompost 25 kg"), one-tap add.
- Quantity editable inline (stepper + field), remove with undo toast, save for later.
- Delivery method in cart (pickup / Bengaluru slot / outstation) with dates and cost so total is known before checkout (no surprise fees: the #1 abandonment reason).
- Price breakdown: subtotal, bulk savings, promo, packing, transport, GST by rate, total. Policy note near total.

Checkout (single page, 3 accordion sections, progress indicator "Contact → Delivery → Payment"):
1. Contact: phone first (+91 fixed, numeric keypad, 10-digit validation), helper text "For delivery coordination on WhatsApp"; email optional (for invoice). Guest by default; OTP only at the end of payment or optional "Save details for next time" (Better Auth phone OTP). No password ever.
2. Address: pincode first → autofill city/district/state (local dataset), then house/street/landmark (landmark matters for farms), "Farm location" pin (optional map link). Mark optional fields "(optional)". Remember address in localStorage for guests.
3. Delivery: radio cards with dates and price; Bengaluru slot date picker (Saturdays); outstation shows truck + estimated cost (quote confirmed by team if beyond limits, order still placed).
4. Payment: PhonePe PG standard checkout (UPI intent/QR, cards, netbanking). UPI first and preselected on mobile. Verify via webhook (Authorization = SHA256(username:password); trust only root `payload.state`) AND server-side order status check on return; never trust the redirect alone. Pending state page polls status.
   - COD decision: recommend **no full COD** for truck orders (plants are perishable, no returns, high value). Offer **advance + balance on delivery** for orders above a threshold (e.g. 25% advance online, rest at delivery) and **pay at nursery** for pickup. Setting in admin: COD off / partial % / full COD with max order value + COD fee. This is a client decision (flag).
5. Order summary sticky on desktop, collapsible on mobile with total always visible. Place order button shows the amount: `Pay Rs 18,450`.
- Adaptive inline errors ("Pincode 56001 has 5 digits, needs 6"), never clear filled fields on error, preserve form on payment failure with "Try another UPI app / method".
- Trust near pay button: PhonePe secure, GST invoice, support phone/WhatsApp.

Exit intent: desktop only (mouse leave toward tab bar), once per session, only with a non-empty cart or wizard result, offer "Get this cart on WhatsApp" (captures phone with consent) rather than a discount. Mobile: no fake exit intent; use back-button interception never (bad UX/policy). Instead a gentle "Save your cart" bar after 45 s idle on cart page.

Abandoned cart recovery (pg-boss scheduled jobs; requires phone/email captured at checkout step 1 + marketing consent checkbox for WhatsApp):
| Step | Timing | Channel | Content |
|---|---|---|---|
| 1 | 1 h after last activity (not before 30 min; skip 9-11 am and 6:30-9 pm commute windows by shifting) | WhatsApp utility/marketing template (+ email) | "Your plants are reserved": cart image, items, one-tap restore link (signed cart token), help line. No discount |
| 2 | 24 h | Email + WhatsApp | Objection handling: delivery dates for their district, replacement policy, agronomist call option, reviews |
| 3 | 72 h | WhatsApp + email | Incentive escalation, admin-configured: free packing or 5% (cap) code valid 48 h, single-use, bound to that phone |
- Stop on purchase, on reply, on unsubscribe; max 3 messages; frequency cap 1 sequence per 7 days per contact. Directional recovery 10-25% with email + WhatsApp.
- Also: browse/wizard abandonment (wizard OTP leads who did not buy: day 1 recommendation recap PDF/link, day 3 agronomist call offer), back-in-stock, price-drop on wishlist.
- WhatsApp needs Meta-approved templates per message; email via Gmail API.

## 5. Admin structure (Shopify-style) and analytics dashboard

Shopify reference: Home default 4 metrics (sessions, total sales, orders, conversion rate) over 30 days, user-customisable per staff; task list ("x orders to fulfil", "payments to capture"); Live View (active visitors, pages, recent orders, map); Reports by category (Sales, Acquisition, Behaviour, Customers, Inventory, Finances).

Admin IA (left nav):
- **Home**: date range + compare; KPI tiles (net sales, orders, AOV, conversion rate, sessions, returning customer rate) each with sparkline + delta; task cards (orders to confirm, payments pending, truck slots this Saturday with fill %, low stock, abandoned checkouts today, failed messages, system health status); sales by delivery type; top products; recent orders.
- **Orders**: list with saved views/tabs (Unfulfilled, Pending payment, Bengaluru Saturday, Outstation, Pickup, COD/partial balance due), order detail timeline (payment events, messages sent, hasiru-ops sync status), fulfilment, dispatch planner (group by vehicle/route/date), invoices (GST), drafts/manual orders (phone orders), abandoned checkouts.
- **Products**: plants, inputs, collections (manual + rule-based), facet attributes, bulk tiers, inventory (read-only mirror from hasiru-ops + overrides), bulk CSV import/export, media library, reviews moderation, Q&A.
- **Customers**: list, segments (farm buyers > 100 plants, by district, wizard leads not converted), profile (orders, wizard results, consents, messages), leads.
- **Marketing**: campaigns, automations (abandoned cart, back-in-stock, wizard follow-up), UTM builder, Meta catalog + Google Merchant feed status.
- **Discounts**: auto promos, codes, bulk tiers override, free packing, limits/eligibility.
- **Content**: pages, blog/guides, facet landing pages (copy per path), district pages enable/disable, FAQs, navigation, banners/announcement bar, videos.
- **Analytics**: overview, reports, live view, journeys (section 6), search & filter insights.
- **Health**: section 7.
- **Settings**: store details/GST, payments (PhonePe keys, COD mode), delivery (vehicles, rates, slots, districts, pincode serviceability), taxes/HSN, notifications (templates email/WhatsApp), integrations (Gmail OAuth, WhatsApp Cloud, Meta catalog, Merchant Center, Claude, hasiru-ops), staff + roles + 2FA, policies, consent/privacy, domains.

Reports (each: date range, compare, chart + table, CSV export):
- Sales over time (gross, discounts, net, GST, transport), by product / category / district / delivery type.
- AOV over time; units per order (important for bulk).
- Conversion funnel: sessions → product view → add to cart → checkout started → payment initiated → paid, with drop-off % and by device/source.
- Sessions by source/medium/campaign (UTM), landing page, device, district/city.
- Top products by revenue, units, views, view-to-cart rate; worst converting viewed products.
- Returning customer rate, cohort repeat purchase, customer LTV.
- Abandoned checkouts: count, value, recovered (by step/channel).
- Bulk tier report: % of revenue at bulk tier, near-threshold carts.
- Search & filters: top searches, zero-result searches, facet usage, zero-result facet combos.
- Wizard: started, generated, OTP unlocked, package added, purchased.
- Inventory: low stock, sell-through, sync drift vs hasiru-ops.
- Finance: payments by method, refunds/replacements, GST summary by HSN.

## 6. First-party journey analytics module (Clarity-lite)

What existing tools offer: GA4 ecommerce events (`view_item_list`, `select_item`, `view_item`, `add_to_cart`, `remove_from_cart`, `view_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`, `refund`, with `item_list_name`, `index`, currency, value, transaction_id); Shopify analytics (sessions with 30-min inactivity timeout, bot filtering, funnel, live view); Microsoft Clarity (recordings, click/scroll heatmaps, rage clicks, dead clicks, excessive scrolling, quick backs, JS error filters).

Design (package `analytics`, brand-neutral):
- Tracker: <3 KB gzip script, loaded `defer`, no third-party. Batches events in memory, flushes via `navigator.sendBeacon` on `visibilitychange`/`pagehide` and every 10 s. Ignores bots (UA list + no-JS). Respects consent state.
- Identity: anonymous `visitor_id` (first-party cookie, 13 months) + `session_id` (30-min inactivity, resets at midnight/new UTM); joined to customer on login/checkout phone.
- Events (GA4-compatible names so a GA4/Meta CAPI forwarder is trivial): page_view (path, referrer, UTM, landing flag), view_item_list (list name, filters), select_item (index), view_item, add_to_cart/remove_from_cart (qty, value, bulk_tier), view_cart, begin_checkout, add_shipping_info (delivery type, district), add_payment_info, purchase, search (query, results count), filter_apply (facet, value, result count; zero-result flag), wizard_step, calculator_used, whatsapp_click, outbound_click, scroll_depth (25/50/75/100 milestones), product_attention (card visible >= 1 s at >= 50% via IntersectionObserver, measured on element ratio, batched per page), rage_click (>= 3 clicks within 1 s in 30 px), dead_click (click on non-interactive element with no DOM mutation/navigation within 500 ms), js_error, web_vitals (LCP/INP/CLS via `web-vitals` attribution build or PerformanceObserver).
- No DOM recording (privacy + payload). "Session replay-lite" = an ordered event timeline per session in admin: page path with time on page, scroll max, products seen, filters used, cart actions, where it ended. Enough to answer "what did people do before dropping".
- Storage: Postgres `events` table partitioned by month (raw kept 90 days), nightly pg-boss rollups into `daily_*` aggregate tables (kept indefinitely). Live view = sessions active in last 5 min from a small in-memory/Postgres query.
- Admin views: funnel (configurable steps), path explorer (top next pages from landing), product attention vs add-to-cart (high attention, low ATC = PDP problem), filter usage + zero-result combos, scroll depth per template, rage/dead click hotspots per page (selector + count), UTM attribution (first-touch and last-touch, stored on order), wizard funnel.
- Privacy/consent: India DPDP Act + Rules notified Nov 2025, main obligations phase in around mid-2027; consent must be specific, provable, withdrawable. Approach: strictly necessary + aggregate first-party analytics without personal data by default; personalised/behavioural tracking tied to identity and any Meta/Google pixels only after consent (banner with Accept / Reject / Choose, stored consent record with timestamp and version). Mask all input values, never log phone/email/address in events, IP truncated, honour DNT/GPC. Retention settings in admin. (Get legal confirmation; flag.)

## 7. Error and health monitoring

Package `monitor` (brand-neutral):
- Signals:
  - Client JS errors (`window.onerror`, `unhandledrejection`, React error boundaries) with release/version, URL, browser, top frames; source maps uploaded privately at build.
  - Server errors: Next.js route handler/server action exceptions (`instrumentation.ts` `onRequestError`), 5xx counts, slow requests (p95).
  - API/integration failures: per integration (PhonePe, Gmail, WhatsApp, Meta catalog, Merchant Center, Claude, hasiru-ops) record last success, last failure, error rate, latency.
  - Payment: webhook signature failures, webhook not received within 10 min of initiated payment (reconcile job calls status API), paid-but-order-not-confirmed mismatch, refund failures. Highest severity.
  - Messaging: email/WhatsApp send failures and template rejections, bounce/undelivered statuses, OAuth token refresh failure (Gmail), WhatsApp quality rating drops.
  - Jobs: pg-boss failed jobs, retries exhausted, queue backlog age, cron "dead man's switch" (each scheduled job writes a heartbeat; alert when missed).
  - Sync: hasiru-ops inventory pull stale > N min, order push failures, drift count.
  - Uptime: synthetic checks every 1-5 min from the VPS plus one external free pinger (a check from the same box cannot detect the box being down): home, PLP, PDP, `/api/health` (DB + queue), checkout page.
  - SSL expiry (alert 21/7/2 days), domain expiry (WHOIS, 30/7 days), DNS resolution of shop and email domains (A/MX/SPF/DKIM present), disk space, Postgres connections, backup last success.
  - Broken images (client `error` event on img, and server sharp failures), 404s (log path + referrer; top 404s report with one-click redirect creation), broken internal links crawl weekly.
  - Web Vitals regressions (p75 LCP/INP/CLS by template vs last 7 days).
- Grouping and dedup (Sentry/Keep/FireHydrant patterns): fingerprint = type + normalised message (strip ids/numbers) + top in-app frame / integration+error code. Same fingerprint updates one "issue" (count, first/last seen, sample events) instead of creating new alerts. Issue states: new, ongoing, resolved, regressed (resolved then seen again → alert again), muted.
- Alerting: rules per severity. Critical (payment, checkout down, site down, DB down): immediate, WhatsApp + email to developers, repeat every 30 min until acknowledged. High (integration failing, jobs failing, sync stale): alert on first occurrence of a new issue, then throttle to a digest at most hourly. Low (404s, broken images, JS errors under threshold): daily digest. Dedup window 30 min for transient, 6-24 h for persistent. Throttle per channel (max N/hour), quiet hours for non-critical, recovery ("resolved") notifications. Alert channels configurable: email (Gmail API), WhatsApp, webhook (Slack/Discord/Google Chat). Alert delivery itself must not depend only on the same Gmail/WhatsApp integration it monitors: keep a fallback webhook.
- Admin Health page: status grid (green/amber/red per integration and check), open issues list with counts and sparkline, job queue stats, cert/domain expiry dates, recent deploys (release markers so errors map to a release).

## Decisions / flags for the planner
1. COD policy: recommend partial advance (online) + balance on delivery for truck orders, pay-at-nursery for pickup, no full COD by default. Admin-configurable. Client to confirm.
2. Indexable facets limited to curated clean paths (category, purpose/model, drought tolerant, nitrogen fixing, district pages with >= 6 fits). All param combos noindex,follow + canonical; sort never indexed; empty curated pages 404.
3. Client-side bitset filtering over a static facet index (~20-40 KB gzip), SSR first page; no search engine service needed under ~2,000 SKUs.
4. District fit is computed by rules (district min/max vs plant min/max); Claude only narrates the explanation.
5. Pincode → district via India Post directory imported locally (data.gov.in); no runtime pincode API.
6. Analytics events use GA4 names; first-party Postgres store with monthly partitions + nightly rollups; no DOM replay.
7. Monitoring: fingerprinted issues + severity-based alerting with dedup windows, external uptime pinger in addition to on-box checks.
8. Needs client data: bearing time, yield, exposure, water level for new rows, reviews (import old 4.8/5 if verifiable), FAQ answers, replacement/damage policy wording, COD stance, abandoned-cart incentive limits.

## Sources
- Baymard, Product list filtering current state: https://baymard.com/research-articles/current-state-product-list-and-filtering
- Baymard, Ecommerce filter UI: https://baymard.com/blog/ecommerce-filter-ui
- Baymard, Applied filters: https://baymard.com/research-articles/how-to-design-applied-filters
- Baymard, Multi-select filters: https://baymard.com/research-articles/allow-applying-of-multiple-filter-values
- Baymard, Product listing information: https://baymard.com/blog/product-listing-information
- Baymard, List item design: https://baymard.com/blog/list-item-design-ecommerce
- Baymard, Checkout UX current state: https://baymard.com/blog/current-state-of-checkout-ux
- Baymard, Cart abandonment rate: https://baymard.com/lists/cart-abandonment-rate
- Baymard, Shipping speed vs delivery date: https://baymard.com/blog/shipping-speed-vs-delivery-date
- Baymard, Product page research: https://baymard.com/product-page
- Google Search Central, Faceted navigation: https://developers.google.com/search/docs/crawling-indexing/crawling-managing-faceted-navigation
- Shopify Help, Home page metrics: https://help.shopify.com/en/manual/shopify-admin/shopify-home
- Shopify analytics guides (secondary): https://www.firstpier.com/resources/shopify-analytics-reporting-guide , https://www.vortexiq.ai/blog/shopify-analytics-complete-dashboard-guide
- Ugaoo PDP (guava): https://ugaoo.com/products/guava-plant
- Nurserylive fruit plants collection: https://nurserylive.com/collections/fruit-plants
- Blinkit/Zepto listing discussion (anecdotal): https://www.desidime.com/discussions/blinkit-new-update-zepto-style-even-worse
- Filter apply patterns: https://design-system.dwp.gov.uk/research/filters/design-notes , https://designsystem.maersk.com/guidelines/search-filter-and-sort/filter-patterns/ , https://designsystem.nsw.gov.au/components/filters
- Abandoned cart India (directional): https://blog.campaignhq.co/abandoned-cart-recovery-whatsapp-email-india-2026/ , https://www.ithinklogistics.com/blog/how-to-reduce-cart-abandonment/ , https://nubea.com.ar/en/blog/how-to-recover-abandoned-carts
- COD / partial COD India (directional): https://razorpay.com/blog/cash-on-delivery/ , https://echai.ventures/d2c/d2c-rto-returns-cod/cod-to-prepaid-conversion-partial-cod , https://www.cashfree.com/blog/turning-cod-from-a-margin-leak-into-a-growth-lever-for-d2c-with-one-click-checkout/
- PhonePe webhooks: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
- GA4 ecommerce events (secondary): https://weltpixel.com/blogs/news/ga4-recommended-ecommerce-events-on-shopify-the-complete-canon-view-item-to-purchase
- Microsoft Clarity features: https://www.toptal.com/designers/ux-research/microsoft-clarity
- DPDP Rules 2025 and cookies (secondary): https://www.gotrust.tech/blog/dpdp-act-rules-2025-the-new-standard-for-cookie-consent-(and-how-to-get-it-right) , https://consently.net/blog/india-dpdp
- Sentry grouping/fingerprints: https://docs.sentry.io/product/issues/grouping-and-fingerprints/
- Alert dedup windows: https://docs.firehydrant.com/docs/alert-deduplication , https://docs.keephq.dev/overview/deduplication
- INP and filters (secondary): https://webkul.com/blog/how-to-improve-core-web-vitals-in-next-js/amp/
