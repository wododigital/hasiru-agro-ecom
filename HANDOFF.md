# Hasiru Agro: New E-Commerce Site, Prototype Handoff

Last updated: 2026-10-16. Resume from here.

## Goal
Hasiru Agro (Bengaluru nursery + farm-development company, incubated by UAS Dharwad) wants a new site that is **primarily plant e-commerce** (farm-scale buyers) with farm-development services as a second pillar. Deliverables:
1. **Done:** formatted Excel listing the features and the data their team must fill per product.
2. **Built (2026-10-16):** `hasiru-agro-prototype.html`, a **single `.html` prototype file** with separate pages/screens showing the **main features only** (no standard e-com pages like account, product detail, policies), in Hasiru Agro brand language.

## Files in this folder
| File | What |
|---|---|
| `HASIRU AGRO SRS Doc1 (1).pdf` | Client's 38-page requirements doc (the spec) |
| `IMG_4848-4851.jpeg` | Client's notebook sketches (downscaled copies in `_work/sketches/`) |
| `wc-product-export-16-10-2026-*.csv` | WooCommerce export of the old shop, 194 products. Note: first line is blank, real header on line 2 |
| `wp_posts.sql` | Old WP posts dump (descriptions only, no prices). Superseded by the CSV |
| `logo_white_hasiru_agro.webp` | White logo |
| `Hasiru-Agro-Website-Data-Sheet.xlsx` | **Deliverable 1** (built by `_work/build_xlsx.py`) |
| `_work/catalog.json` | Compact catalogue for the prototype, 192 plants (see schema below) |
| `_work/products.json` | Full parsed CSV rows |
| `hasiru-agro-prototype.html` | **Deliverable 2**, self-contained (catalogue + logo inlined). Do not edit directly |
| `site/index.html` | Copy of the prototype for Vercel (project root directory `site`), written by the build script |
| `_work/prototype.template.html` | Prototype source (6 screens incl. Ask AI: uses Claude `sample` capability when published as a claude.ai artifact, else keyword search over the catalogue). Rebuild: `python3 _work/build_prototype.py` |
| `_work/build_xlsx.py` | Rebuild Excel: `python3 _work/build_xlsx.py _work/products.json Hasiru-Agro-Website-Data-Sheet.xlsx` |

Current hasiruagro.com (WODO-built static services site) source: `../hasiru-agro/Latest/` (images in `Latest/images/`, also live at `https://hasiruagro.com/images/<name>.webp`).

## Brand (use the CURRENT site, not the old WP one)
- Colours: forest `#1B4332`, forest-light `#2D6A4F`, forest-dark `#0F2B1F`, gold `#FDC717`, cream `#FAF6E9`, cream-dark `#F0EAD6`, earth `#8B7355`, text `#2C2C2C`
- Fonts: **DM Serif Display** (headings) + **Outfit** (body), Google Fonts
- Radius 18px (12 small, 24 large)
- Useful live images: `hero_farm_transformation_hasiru_agro.webp`, `nursery_saplings_shade_net_hasiru_agro.webp`, `planting_saplings_truck_loading_hasiru_agro.webp`, `incubated_uasb_bionest_hasiru_agro.webp`, `badge_startup_india_hasiru_agro.jpg`, `badge_msme_hasiru_agro.png`, `mulching_sapling_with_organic_matter_hasiru_agro.webp`, `pest_management_vermicompost_bed_hasiru_agro.webp`
- Product images: old WP uploads still load at `https://hasiruagro.com/wp-content/uploads/...` (URL in `catalog.json` `img`). Add an onerror fallback.
- Site copy rules: no em dashes; no "phase"/"v1"/"v2".

## Decisions confirmed by Shyam (2026-10-16)
1. **Pricing:** two prices per plant: normal price below a bulk quantity, bulk price at/above it. **Bulk threshold differs per plant** (e.g. 50 mango trees is bulk, 200 small shrubs is bulk). Excel has columns for both.
2. **Categories:** Forestry → **Timber Trees**; Desi + Exotic Fruits → **Fruiting Trees** (Desi/Exotic as sub-filter); Spices + Plantation → **Other Plants**.
3. **OTP placement:** after Generate, show a **blurred preview** of the recommendations, unlock with name + phone OTP (better conversion, lead still captured). Demo OTP in prototype e.g. `1234`. (2026-10-16: validation and OTP entry switched off for the demo; Send OTP unlocks directly, wizard falls back to Mysuru / 1 acre.)
4. **Diagram:** use researched placeholder patterns. **M, X, O are 3 categories of plants** (treat as Main / Host-secondary / Biomass-support, legend editable). The **36 x 36 ft chart must auto-generate on a `<canvas>`** from the model's pattern.
5. **Scope:** no standard e-com pages. Focus on prototypes of the main features. Standard e-com discussed later.
6. **Logistics numbers:** invent sample values (my suggestion accepted).
7. **Input products:** invent sample products/prices.
8. **Integration (real build, later):** only **inventory + orders sync to hasiru-ops** (ops.hasiruagro.com, client's Next.js/Supabase ERP). Everything else lives in the new e-com admin panel. Stack for real build not decided yet.

## Prototype spec (single HTML, built)
One file, hash-routed screens, a top switcher bar labelled "Prototype, sample data". Mobile-first, responsive. Shared in-memory cart across screens.

**Screens:**
1. **Home (features only):** two-path hero ("I know what I want" → Shop, "Help me choose" → wizard); best sellers carousel, quick-commerce style (Blinkit/Zepto cards: image, name, category, height, exposure, temp, price, offer price, availability, +/- add); **plant calculator** right after best sellers; inputs carousel; **compost calculator** (from plants selected → kg → recommended pack → add); "Incubated by UAS Dharwad / recognised by Startup India" running band.
2. **Shop:** Timber / Fruiting / Other tabs (+ Desi/Exotic filter), cards with qty stepper and **bulk-price unlock** hint ("Bulk price from 50 plants: Rs X"); price drops live when qty crosses threshold. **Floating plant calculator** button.
3. **Help Me Choose wizard:** location (search with suggestions after 2-3 chars, mock list of Karnataka/South India places with distance from Bengaluru; optional "use my location"), land size with **acre / sq ft** toggle, purpose (Commercial / Food Forest / Miyawaki). Generate → blurred preview → name + phone → OTP → unlock.
4. **Recommendations:** "Purpose: Commercial ▼" top-left (changing it reorders/opens that model); **all 3 models** as expand/collapse sections, each with: canvas diagram + legend + counts per 36x36 block; plant sections **Timber / Fruiting / Other** (horizontal cards: image, name, recommended qty scaled to land size, +/-, price, add, view more); **recommended inputs** (vermicompost, biochar, etc.) calculated from selected qty, editable, optional; Watch video (model-specific placeholder); "Want to add something else? Browse all plants"; "Add package to cart".
5. **Cart + delivery:** **Recommended Package** block (different background) above **Additional Items**; Journey-1 "recommended inputs for your plants" suggestions; **truck capacity meter** ("Truck 65% full, add ~35% more"); delivery options: **Nursery pickup** (free) / **Bengaluru** weekly scheduled slot (pick a date) / **Outstation** (district → km × rate); line items: subtotal, bulk savings, auto promo discount, packing, transport, GST, total; "No cancellation or return" policy note near total.

**Not in prototype:** Kannada toggle, admin panel, accounts, payment, farm-dev pages (can mention as next steps).

## Sample numbers to use (placeholders, label as sample)
- **Size class** (from growth habit in `catalog.json` `sz`): L (big tree) / M / S (small, shrub, climber).
- **Bulk threshold:** L 50, M 100, S 200 plants. **Bulk price** ≈ sale price × 0.72, rounded to Rs 5.
- **Weight per sapling incl. bag:** L 3 kg, M 2 kg, S 1 kg; Miyawaki saplings 0.8 kg.
- **Vehicles:** Tata Ace 750 kg, Tata 407 2,500 kg, Eicher 1110 5,000 kg. Pick the smallest that fits; meter shows % fill.
- **Bengaluru weekly delivery:** every Saturday; flat by vehicle Ace Rs 1,500 / 407 Rs 3,500 / Eicher Rs 6,000.
- **Outstation:** km × rate (Ace Rs 22/km, 407 Rs 35/km, Eicher Rs 48/km). Mock distances: Mysuru 150, Tumakuru 70, Hassan 185, Shivamogga 300, Chikkamagaluru 245, Mangaluru 350, Hubballi 410, Dharwad 430, Belagavi 500, Kolar 70, Chennai 350, Coimbatore 365, Hyderabad 570.
- **Packing:** Rs 5 per small plant, Rs 10 medium, Rs 15 large; inputs free.
- **GST:** plants 0% (HSN 0602); compost/vermicompost/biochar 5% (HSN 3101); bio-pesticide 18%. Confirm with client.
- **Auto promo:** e.g. "Monsoon planting offer: 10% off fruiting trees" auto-applied.
- **Input products (invented):** Vermicompost 25 kg Rs 450; Biochar 10 kg Rs 600; Farm compost 50 kg Rs 400; Neem cake 25 kg Rs 900; Jeevamrutha liquid 5 L Rs 250; Neem oil bio-pesticide 1 L Rs 350; Green-manure seed mix 1 kg Rs 180.
- **Input dosage per plant:** Main (M) vermicompost 2 kg + biochar 1 kg; Host (X) 1 kg + 0.5 kg; Biomass (O) 0.5 kg + 0.25 kg. Research found no reliable public per-pit biochar figure; client must supply real formulas (TNAU: 10 kg FYM per pit for mango/jackfruit).
- **Plant calculator:** plants/acre = 43,560 / (L × W ft); triangular layout ≈ ×1.155; optional 3% replacement buffer (sketch note "43,560 × 3 / 100", unconfirmed). Picking a plant autofills its spacing from `sp`.
- **Model scaling:** plants for land = qty per 36x36 block × (land sq ft / 1,296); 1 acre = 33.6 blocks.

## Placeholder model patterns (36 x 36 ft, M/X/O)
Generic model shape: `{colSpacingFt, rowSpacingFt, rows: [pattern strings cycling]}`; canvas draws points across 36 ft, colours per letter, legend, hover tooltip with plant name.
- **Commercial:** 6 ft along row, 12 ft between rows, every row `M O X O X O M` (from the client's sketch) → rows at 0/12/24/36 ft. M = fruit tree (e.g. Alphonso mango, Taiwan pink guava), X = timber/host (e.g. Mahogany, Sandalwood), O = biomass (Gliricidia, banana).
- **Food Forest:** 6 x 6 ft grid (7 x 7 = 49 points), alternating rows e.g. `M O X O M O X` / `O X O X O X O`; layers canopy / sub-canopy / shrub / biomass (Kerala home-garden stack; banana + Gliricidia as host/biomass).
- **Miyawaki:** 2 x 2 ft grid (19 x 19 = 361 ≈ 3 plants/m² on 120 m²); seeded-random layer mix approx M 10% canopy, X 50% tree/sub-tree, O 40% shrub.
- Biomass plants (Gliricidia, Subabul, Banana G9, Moringa) are **not in the catalogue**; add them as invented "Other Plants" items marked sample.

## catalog.json schema
`{id, n:name, c:"timber"|"fruit"|"other", s:subcat (Desi/Exotic/Spices/Plantation), p:sale price, r:regular price, sz:"L"|"M"|"S", sp:[L,W] ft or null, ex:exposure, t:temperature, ty:type (Grafted/Seeded...), b:bearing time, y:yield, img:url, st:in stock bool, f:featured bool}`. 52 in stock. Old CSV also has `Meta: offlineprice` (much lower, nursery rate) and placeholder weight 1 kg / 70 cm for every product.

## Research notes (condensed)
- Old WP site (Wayback, 2024-25): categories Desi Fruits / Exotic Fruits / Spices / Forestry / Plantation; prices shown as ~30% off list; "100+ plants → contact" bulk route; reviews 4.8/5; never sold inputs online; old brand was green #208A6A + yellow #F9B224 + Poppins (do not use).
- Truck-fill meter: no precedent in nursery retail (differentiator). Closest pattern: "Rs X away from free delivery" progress bar, start partly filled, success state at goal.
- Miyawaki 3-5 plants/m²; compost 5-10 kg/m² (IVN Tiny Forest handbook). Triangular spacing gives ~15% more plants than square.
- Diagram inspiration: AgroForest Designer, Garden Map Maker (grid + guild legend).

## 3D close-up (proof of concept, 2026-10-16)
- "View 3D close-up" on each model's diagram opens a three.js view (three@0.128.0 from jsDelivr, loaded only when opened).
- Shows the pattern repeated once in each direction, max ~50 plants (Commercial 13 x 3, Food Forest 7 x 7, Miyawaki 7 x 7), at true spacing (1 unit = 1 ft), with a 5.5 ft person for scale, spacing labels, M/X/O basin markers, tap to identify, and a walk mode (arrow pad / WASD).
- Plants use standard display sizes per type (canopy, small fruit, timber, palm, banana, shrub), no growth scaling. Miyawaki shown at 0.45x as young saplings.
- `_work/3d-hq-demo.html`: higher-quality procedural 3D test (not deployed): textured leaf clusters, bark, soil, grass, ACES lighting, 4096 shadows, wind sway, sun slider, faded surrounding rows in walk mode, live stats. Same three.js download (~150 KB gzip), no asset files.
- Magnific: stock 3D trees are cartoon icons (150 credits); text-to-3D realistic tree ~580 credits each (Tripo, 8k faces). Magnific files cannot be downloaded from the cloud session; user would download GLBs.
- HQ demo now uses realistic spacing (Commercial 7.5 ft slots so sandalwood is 15 ft and mango 45 ft apart, rows 20 ft; Food Forest 10 x 10 ft), a step preloader, and a Magnific (Tripo) mango GLB for mango plants: 2.7 MB raw, 355 KB after `gltf-transform optimize --texture-compress webp --texture-size 512`, 7.3k triangles, instanced (downloaded once per tree type). Deployed at `/3d.html` (`site/3d.html` + `site/assets/mango.glb`, built by `_work/build_prototype.py`).
- Prototype 3D modal: step preloader + link to `/3d.html`. Its spacing still follows the 6 x 12 ft placeholder (tied to the 36 x 36 block quantities); change only with the client's real spacing.
- 2026-10-16 later: Recommendations cards keep the 2D diagram; "View in 3D" opens `/3d.html?m=<model>` in a new tab on the live site (falls back to the simple in-page 3D modal inside the claude.ai preview). `/3d.html` now has Commercial, Food Forest and Miyawaki (2 ft grid, random layer mix, plants at 0.42x as saplings), a PUBG-style thumbstick for walking (drag elsewhere to look; WASD strafe, arrows turn), and no stats panel.
- `/3d.html` has a "3D view / 2D plan" toggle (also `?v=2d`): flat top view drawn on a canvas, canopy-spread circles by M/X/O colour, faded context rows, dashed patch outline, spacing labels, scale bar, tap to identify.
- Prototype screen 7 "Data needed" (`#req`): one accordion per feature (what it does, current logic with sample values, data needed, questions) + a 2-column table (data item with Excel tab | features using it). Content lives in `REQ` / `REQ_TAB` in `_work/prototype.template.html`.
- Next ideas discussed: semi-realistic textured tree models, AI "hero" render from the 3D layout, real land boundary from a map.

## SRS quirks to remember
- Section 1.7 heading is misplaced: the "after Why Choose Us, before Testimonials" placement text belongs to DIY videos.
- Journey 2 in section 34 is written bottom-up (read in reverse).
- Policy: no cancellation/return; damage + replacement policy wording pending from client.

## Next steps
1. Done: prototype built and checked with Playwright at 375 / 768 / 1440 (full flow, no JS errors, no horizontal scroll). Product and live-site images could not load from the build sandbox, so only the fallback leaf showed; check real images in a normal browser.
2. Review the prototype with Shyam, then share with the client.
3. Send Excel to client; collect real formulas, model patterns, logistics, input prices.
4. Later: decide stack for real build; admin panel; Kannada; payment; hasiru-ops sync (inventory + orders only).
