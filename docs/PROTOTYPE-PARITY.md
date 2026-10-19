# Prototype parity checklist

One row per prototype behaviour in `docs/research/feature-inventory.md` Part C (C1 to C6, with C4a). The approved prototype is the design and behaviour source; the "Build note" column records where the build intentionally fixes a prototype issue (Part F) or follows a plan decision instead.

How to fill: the owner adds the Playwright step id (`<spec file>:<test title>`) that proves the row when the spec lands. WP-28 fills the gaps or marks a row "not built, see section 14" of BUILD-PLAN.md. No row may stay empty at the Definition of Done. C7 (Data needed) is an internal checklist, not a storefront page, and is covered by the admin Data gaps view (WP-04).

| ID | Behaviour | Owner | Build note | Playwright step |
|---|---|---|---|---|
| C1.1 | Home hero background image | WP-28 | real image via `ImageWithFallback`, LCP preload | |
| C1.2 | Eyebrow, H1 with italic accent, lead copy | WP-28 | copy from messages | |
| C1.3 | Two-path hero: "I know what I want" to shop, "Help me choose" (highlighted) to wizard; cards stack on mobile | WP-28 | | |
| C1.4 | Best sellers rail: in-stock, featured first, top 12, "View all" | WP-04 / WP-28 | CTA wording per SRS ("View All Plants") | |
| C1.5 | Inline plant calculator on home | WP-25 / WP-28 | | |
| C1.6 | Farm inputs rail with pack, price, GST note, add / stepper | WP-04 / WP-28 | GST note fixed to "+ N% GST" wording per A7 (prices GST-inclusive) | |
| C1.7 | Compost calculator: plants-in-cart or manual mode, formula, packs, "Add recommended pack" | WP-25 | adds to existing quantities (A11, fix F10) | |
| C1.8 | Credential marquee band with logos, looping track | WP-09 / WP-28 | "Rated 4.8" hidden until admin enters it (A13) | |
| C1.9 | "Learn how" video block | WP-09 / WP-28 | DIY video rail from cms videos | |
| C2.1 | Shop eyebrow and heading | WP-04 | | |
| C2.2 | Category tabs Timber / Fruiting / Other with live counts, default Fruiting | WP-04 / WP-05 | | |
| C2.3 | Sub-filter segment per category (Desi / Exotic; Plantation / Spices / Biomass) | WP-05 | data-driven subcategories | |
| C2.4 | Live search box | WP-05 | | |
| C2.5 | "In stock only" toggle (default on), count label, empty state | WP-05 | | |
| C2.6 | Product card: image, badges, category line, name clamp, spec chips, price + struck price, bulk hint, availability, Add then stepper, Notify when out of stock | WP-04 | rating or "New" chip (A13); compare-at only real old price | |
| C2.7 | Bulk price unlocks live when total qty of a plant crosses the threshold (package + additional lines) | WP-06 / WP-17 | | |
| C2.8 | Floating plant calculator button opens modal; Esc, backdrop and close button dismiss; adding closes it | WP-25 | also on Home (SRS) | |
| C2.9 | Plant calculator: plant select fills spacing, acre / sq ft toggle converts, square / triangular, 3% buffer, output panel, "Add N to cart" | WP-25 | rounding per A10 (9x9 = 538, 10x10 = 436) | |
| C3.1 | Wizard header with 3-step progress | WP-24 | | |
| C3.2 | Step 1 location typeahead (2 chars, max 6, keyboard), distance or Local, confirmation line, "Use my location" | WP-24 / WP-13 | real geolocation to nearest district; map picker noted in section 14 | |
| C3.3 | Step 2 land size with acre / sq ft conversion; change clears cached plan | WP-24 | | |
| C3.4 | Step 3 purpose cards, data-driven (Commercial, Food Forest, Miyawaki, Boundary) | WP-24 | Boundary asks `boundary_ft` | |
| C3.5 | "Generate my plan" CTA with free note | WP-24 | validation on (prototype demo skipped it) | |
| C4.1 | Purpose dropdown re-orders models, chosen first and open | WP-24 | | |
| C4.2 | Summary chips: location, land, blocks | WP-24 | | |
| C4.3 | Blurred preview with unlock card (name, +91 phone, OTP boxes) | WP-24 / WP-02 | `soft` mode default creates an unverified lead; `otp` mode optional (A23) | |
| C4.4 | All models generated, each an expandable section with plant count and total | WP-24 | | |
| C4.5 | 36 x 36 ft M/X/O diagram: grid, labels, role colours, tooltip, legend, scale caption, half-open block counting | WP-24 | server SVG + tooltip island with tap and keyboard (A2) | |
| C4.6 | Quantity scaling by blocks, split across role plants, remainder to first | WP-24 | Boundary by `boundary_ft / spacing_ft` | |
| C4.7 | Plant sections by category with horizontal cards, role pill, "View more", stepper, line total | WP-24 | both meanings of "View more" (details and alternates) | |
| C4.8 | Recommended inputs block with Include toggle, auto-follow until user edits | WP-24 / WP-25 | | |
| C4.9 | Watch video per model | WP-24 / WP-09 | from cms `videosFor({ modelSlug })` | |
| C4.10 | Package footer total and "Add package to cart" (blocked until unlocked; replaces existing package) | WP-24 / WP-17 | Miyawaki lines weigh 0.8 kg via `origin.weightKg` | |
| C4.11 | "View in 3D" per diagram | WP-24 / WP-25 | preload on intent | |
| C4.12 | "Want to add something else?" panel with Browse all plants | WP-24 | | |
| C4a.1 | 3D opens on its own route | WP-25 | `/models/[model]/3d` | |
| C4a.2 | Step preloader with failure text | WP-25 | | |
| C4a.3 | Patch repeated per model; Miyawaki scaled | WP-25 | | |
| C4a.4 | Procedural trees by archetype, soil, rows, basin rings toggle, person, dimension labels, sun, fog | WP-25 | GLB mango | |
| C4a.5 | Orbit, tap to identify, walk mode with thumbstick and WASD, Esc, dispose | WP-25 | | |
| C4a.6 | Caption and legend from catalogue | WP-25 | plant list from catalogue, not hard-coded | |
| C4a.7 | 3D / 2D toggle, sun slider, 2D canopy plan with scale bar | WP-25 | 2D default under reduced motion | |
| C5.1 | Cart heading and two-column layout with sticky summary | WP-17 | | |
| C5.2 | Recommended package block with its own background and empty state | WP-17 | | |
| C5.3 | Additional items block with empty state | WP-17 | | |
| C5.4 | Cart line: image, name, sub, unit price with bulk state or distance-to-bulk, remove, stepper, line total | WP-17 | | |
| C5.5 | Input suggestion for non-package plants, "Add both" | WP-17 / WP-25 | | |
| C5.6 | Truck capacity meter: vehicle, fill %, trips, nudge message | WP-18 | | |
| C5.7 | Delivery options: pickup, Bengaluru weekly with next Saturdays, outstation by distance x vehicle rate | WP-18 | zone rule, not a km cut (A9, fix F5) | |
| C5.8 | Order summary: promo banner, subtotal, savings, offer, packing, transport, GST, total, policy note, pay CTA | WP-17 / WP-19 | `core.computeTotals` with F2 definitions; GST inclusive split (A7, fix F1/F4); stacking per A8 | |
| C6.1 | Assistant hero with mode pill | WP-26 | | |
| C6.2 | Intro line on catalogue grounding | WP-26 | | |
| C6.3 | Suggested question chips, hidden after first message | WP-26 | | |
| C6.4 | Chat bubbles, streaming, pending text, light markdown, product chips, card rail | WP-26 | | |
| C6.5 | Composer with 400 char limit and busy lock | WP-26 | | |
| C6.6 | Grounded answers only, ids validated, error states (off, rate limited, refused, interrupted) | WP-26 | | |
| C6.7 | Rules-first fallback with no-match message | WP-26 | | |
