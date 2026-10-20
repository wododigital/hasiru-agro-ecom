# Requirements addendum (Shyam, 2026-10-20)

Applies on top of BUILD-PLAN.md. Where they conflict, this file wins.

1. **Pick-and-choose modules.** Every feature is a self-contained package that a new store can include or leave out. A future e-com project must be able to start from the shared core, select only the modules it wants (e.g. catalog + cart + checkout + payments, without planting models or the truck meter), and get a working store. Concretely:
   - Each module declares a manifest (id, dependencies, DB schema/migrations, storefront routes, admin nav + pages, settings fields, jobs, events emitted/consumed).
   - The host app enables modules from one config list; admin nav, settings pages, migrations and jobs assemble from the enabled manifests only.
   - Modules talk through the core event bus and declared contracts, never by importing each other's internals. Optional cross-module features (e.g. abandoned cart using WhatsApp) degrade cleanly when the other module is off.
   - Hasiru-specific logic (planting models, M/X/O diagrams, truck capacity, compost calculator) lives in its own modules, not inside generic ones.
   - Document a "new store from these modules" recipe and prove it with a test: a minimal app enabling only core + catalog + cart + checkout + payments builds and passes its E2E smoke test.
2. **Fully autonomous run.** No human input until the finished, tested local build. Decide sensible defaults and record them under "Assumptions" in BUILD-STATUS.md.
3. **No code reuse from other WODO projects.** Learn the behaviour, implement fresh in this stack and naming.
4. **Avoid redundancy from the start**, and audit after each wave to remove it.
5. **Speed without breaking UX.** Optimise loading (code-split, lazy load, prefetch on intent, skeletons); never drop features or design to get a score.
6. **Missing plant images:** real photos only (Magnific stock, not AI; or Wikimedia Commons open licence with attribution recorded).
7. **Model routing:** Fable plans, orchestrates and verifies; Opus 5.5 does the real work; Sonnet only for simple, repetitive code.
8. **Git:** commit locally on `ecom-build`; do not push.

## 9. Admin = Shopify admin structure (Shyam, 2026-10-20 06:40, binding for Wave 3: WP-29 owns it)

"Like Shopify" means the **layout, navigation, tables and feature structure**, not just KPI cards. WP-29 may edit `packages/admin-shell/**` and the admin table/form primitives in `packages/ui` for this (WP-28 must not touch those paths in Wave 3). No contract change: derive groups from the existing `admin.nav[].order` bands.

1. **Shell**: top bar with store name/logo left, global search (Cmd/Ctrl+K) centre, alerts bell + account menu right. Left sidebar, light neutral admin palette.
2. **Sidebar with expanding sub-menus**: one entry per band; the lowest-order item in a band is the parent, the band's other items are its children, shown indented under the parent only while that section is active (Shopify behaviour; chevron-free, one section open). Order: Home; Orders (Abandoned checkouts, Dispatch planner, Replacements); Products (Categories/Collections, Inventory, Planting models, Inputs, Reviews); Customers (Enquiries/Services leads); Content (Pages, DIY videos/Blog, Files/Media, Navigation, FAQs); Analytics (Reports, Live view, Journeys, Search insights); Marketing (Automations = abandoned-cart email/WhatsApp flows, Tags and pixels, Catalog feeds Meta/Google, Attribution); Discounts; Health (errors, alerts, jobs).
3. **Settings pinned bottom-left** (gear). Opens a Shopify-style settings layout: its own left list, content right, close (X) back to the admin. Every module's settings land here, grouped: Store details; Users and permissions (staff, roles, 2FA); Payments (PhonePe, bank transfer, COD/advance); Checkout; Shipping and delivery (zones, vehicles, weekly slots, outstation rates, pickup); Taxes (GST/HSN); Notifications (email via Gmail OAuth connect, WhatsApp Cloud API, templates, test send); Integrations (Meta, Google, Claude API, hasiru-ops) with the keys checklist status; Domains and SEO; Policies; Activity log (audit).
4. **Index tables** (orders, products, customers, enquiries, discounts, abandoned checkouts, reviews): saved-view tabs above the table, search + filter chips + sort, row checkboxes with a bulk-action bar, status badges, pagination, whole-row click to detail, empty and loading states.
5. **Detail pages**: back arrow + title + status badges + primary action + "More actions" menu; two columns (main cards left, summary/side cards right); sticky contextual save bar ("Unsaved changes" Discard / Save) on edit forms.
6. **Home**: date-range picker with compare, KPI cards with sparklines (sessions, total sales, orders, conversion rate, AOV), "things to do" (orders to dispatch, payments pending, failed messages, low stock, open alerts).
7. **Analytics**: overview of cards with date range + compare; Reports list (sales over time, AOV, conversion funnel, sessions by source, top products, returning customers, abandoned checkouts, search terms); Live view.
Acceptance (no Playwright): every nav entry and sub-entry routes to a page that renders for an owner with no 5xx (the smoke covers it), Settings opens the settings layout, and the role matrix hides entries a role cannot use.
