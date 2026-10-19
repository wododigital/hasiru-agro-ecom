# Hasiru Agro e-com: feature inventory (designed so far)

Sources read in full: `_work/prototype.template.html` (1,653 lines; markup 382-609, script 611-1651), `HASIRU AGRO SRS Doc1 (1).pdf` (38 pages, via pdftotext), `_work/sketches/IMG_4848-4851.jpeg`, `site/3d.html` (444 lines), `HANDOFF.md`, plus tab headers of `Hasiru-Agro-Website-Data-Sheet.xlsx` and `latest_products.xlsx`.

Reference keys: `P:a-b` = prototype template line range. `SRS pN` = PDF page. `SK48..51` = sketch IMG_48xx. `3D:a-b` = `site/3d.html` lines. `H` = HANDOFF.md.

Every number in the prototype is a placeholder (H "Sample numbers"). The real build must make each one admin-configurable (SRS p37 "Core principle").

---

## Part A. Global shell and shared patterns

A1. **Brand tokens** P:11-16. forest #1B4332, forest-l #2D6A4F, forest-d #0F2B1F, gold #FDC717, cream #FAF6E9, cream-d #F0EAD6, earth #8B7355, text #2C2C2C, muted #6b6b60, line #e2dccb, red #b3261e; radius 18 / 12 / 24; shadow `0 6px 24px rgba(15,43,31,.08)`. Fonts DM Serif Display (h1-h3, `.serif`) + Outfit 300-700 (P:7-9). h1 `clamp(2rem,5vw,3.4rem)`, h2 `clamp(1.6rem,3.4vw,2.3rem)`.
A2. **Prototype switcher bar** P:384-393 (sticky dark strip "Prototype, sample data" + 7 screen links). Prototype-only, drop in build.
A3. **Site header** P:395-406: logo to home; nav "Shop plants", "Help me choose", "Farm inputs" (anchor `#home-inputs`), "Farm development" (toast "Farm development pages are part of the next round", i.e. not built). Nav hidden under 760px (P:49), so mobile has no menu (gap: needs a mobile nav/drawer).
A4. **Ask AI header button** P:403 (sparkle icon, label hides under 380px P:50).
A5. **Cart button with live count** P:404 `#cartN` = sum of quantities (not lines) P:1592-1598.
A6. **Mobile sticky cart bar** `#mbar` P:578, CSS P:373-375: "N items, Rs X, View cart". Shows only under 761px, when cart non-empty and not on cart route. Amount shown = total minus shipping.
A7. **Toast** P:609, `toast()` P:708 (2.2 s).
A8. **Footer** P:572-574: prototype disclaimer listing what is out of scope (accounts, product detail, payment, policies, Kannada, admin, farm development pages). Real footer must carry policy links (SRS p21).
A9. **Hash router** P:1599-1622: routes home/shop/choose/reco/cart/ask/req; `home-inputs` and `home-compost` deep-scroll anchors; per-route render; scroll restore on re-render. Build: real URLs (App Router).
A10. **Shared in-memory cart** state `S` P:693-701. Cart keys `x:<id>` (additional items) and `p:<id>` (package lines, with `pkg:true`, `mw:true` for Miyawaki). Same plant can sit in both. Build: persisted cart (server/cookie), guest + logged-in.
A11. **Quantity stepper** P:721-730: minus / numeric input / plus. Step size becomes 10 once qty >= 100 (bump P:724-729). Typed value clamped at 0. Same pattern in reco (`recoStep` P:1035-1038).
A12. **Image helper with fallback** P:706: lazy `<img>`, onerror swaps to an inline SVG leaf placeholder (FALLBACK P:614).
A13. **Currency format** `inr()` P:704: "Rs 1,23,456" en-IN grouping. Copy pattern: "Rs" not the rupee glyph.
A14. **Horizontal rails** CSS P:89-90: scroll-snap, 200 px cards. SRS p2 also asks for desktop/tablet nav arrows (missing).
A15. **Responsive breakpoints**: 380/480/520/560/600/760/820/900 px; reduced-motion stops the marquee (P:154). Playwright-checked at 375/768/1440 (H).
A16. **Escape key** closes calculator modal and 3D modal P:1646.
A17. **Copy rules**: no em dashes, no "phase"/"v1"/"v2" (H). Tone: short, farmer-direct, "Rs", "plants", "sq ft", "acre".

## Part B. Data model implied by the prototype

B1. **Plant** (`catalog.json`, 192 rows: fruit 163, other 15, timber 14; Desi 71, Exotic 92, Spices 9, Plantation 6; 52 in stock; 101 with spacing; 5 featured): `{id, n name, c timber|fruit|other, s subcat, p sale, r regular, sz L|M|S, sp [L,W] ft, ex exposure, t temperature, ty propagation type, b bearing time, y yield, img, st in-stock, f featured}` (H schema). Old CSV also has `offlineprice` (nursery rate).
B2. **Sample biomass plants** P:618-623: Gliricidia Rs 25, Banana G9 TC Rs 35, Subabul Rs 20, Moringa PKM-1 Rs 40, flagged `sample:true` (badge "Sample item").
B3. **Derived per size class** P:626-633: labels L "Large tree" / M "Medium tree" / S "Small plant"; height at sale L "3 to 4 ft", M "2 to 3 ft", S "1 to 2 ft"; bulk threshold L 50, M 100, S 200; weight L 3 kg, M 2, S 1 (Miyawaki sapling 0.8); packing L Rs 15, M 10, S 5. Bulk price = round5(sale x 0.72).
B4. **Input products** P:635-643: Vermicompost 25 kg Rs 450 (5%), Biochar 10 kg Rs 600 (5%), Farm compost 50 kg Rs 400 (5%), Neem cake 25 kg Rs 900 (5%), Jeevamrutha 5 L Rs 250 (5%), Neem oil bio-pesticide 1 L Rs 350 (18%), Green-manure seed mix 1 kg Rs 180 (5%). Fields: id, name, pack label, kg (also used as shipping weight), price, gst %, image, swatch colour.
B5. **Places** P:646-652: 36 places `[name, km from Bengaluru nursery]` (0 = local). Build: replace with 644-district geo table from `latest_products.xlsx` "Dis-wise Geo data" (state, district, taluk, hobli, village, soil type, land area, rivers, humidity min/max, temp min/max, avg rain, native crops) + computed distance.
B6. **Vehicles** P:654-658: `{name, capKg, flatBlr, perKm}` Ace 750/1500/22, 407 2500/3500/35, Eicher 1110 5000/6000/48.
B7. **Roles** P:661-665: M Main crop #1B4332, X Host/secondary #C08A1E, O Biomass/support #7FB069.
B8. **Models** P:666-688: `{name, tag, colSpacingFt, rowSpacingFt, rows[] pattern strings | mix{M,X,O}, weightOverride, plants{M[],X[],O[]}, videoTitle, desc}`. Commercial 6x12 `MOXOXOM`; Food Forest 6x6 `MOXOMOX`/`OXOXOXO`; Miyawaki 2x2 random mix M .10 X .50 O .40, sapling weight 0.8.
B9. **Dose per role** P:689: M [2 kg vermicompost, 1 kg biochar], X [1, .5], O [.5, .25]. Constants: 43,560 sq ft per acre, block 36x36 = 1,296 sq ft (P:690).
B10. **Client data received 18 Oct** (`latest_products.xlsx`, H): Plant data for 159 plants with Kannada name, variety, canopy size, primary/secondary/tertiary category, nitrogen fixer Y/N, drought tolerant, propagation, temperature opt/min/max, humidity opt/min/max, rainfall mm/y min/max, spacing per model (Food forest / Miyawaki / Commercial / **Boundary**, "-" = not used in that model), compost kg (at planting, 0-2 y, 3-6 y, 7+ y, twice a year). Plant list (29) with per-plant WhatsApp video / YouTube video flags and supplier. FAQs, General questions (pre-sale / pre-planting / post-planting / nursery / others), Nursery questions: questions only, no answers. Farmer questions: empty. Still missing: prices, stock, images, bulk, GST/HSN, weights, logistics. Rows 99-159 (scientific names) are separate products, do not merge (H).

## Part C. Screen-by-screen inventory (prototype)

### C1. Home (P:411-453; render P:754-777; SK48, SK49)
1. **Hero background** live image `hero_farm_transformation_hasiru_agro.webp` P:412.
2. **Eyebrow** "Nursery to farm, Bengaluru"; **H1** "Healthy saplings for *farm-scale* planting" (em-italic accent); **lead** "Grafted fruit trees, timber and plantation crops from our own nursery. Bulk prices, farm inputs and delivery across Karnataka." P:413-415.
3. **Two-path hero** P:416-425 (SRS p1-2 s1.1; SK48 "I know what / Help"):
   - Path card 1 "I know what I want" / "Browse 190+ plants, add quantities and unlock bulk prices." / CTA "Shop plants →" → Shop.
   - Path card 2 (highlighted) "Help me choose" / "Tell us your location, land size and purpose. Get a planting plan and package." / CTA "Start in 3 steps →" → wizard. Glass cards with backdrop blur, stack under 560 px.
4. **Best sellers rail** P:428-431, `renderBest` P:755-758: eyebrow "Best sellers", h2 "Most planted this season", link "View all →" (SRS CTA wording is "View All Plants"). Logic: in-stock non-sample, featured first then fruit, top 12. Uses product card C2.4.
5. **Plant calculator (inline)** P:433-436, mounted as instance `ch` P:1649. Eyebrow "Plant calculator", h2 "How many plants fit your land?" (see C2.6).
6. **Farm inputs rail** P:438-441, `inputCard` P:759-765: eyebrow "Farm inputs", h2 "Feed the soil, not just the plant", link "Compost calculator →". Card: colour swatch or image, "FARM INPUT · <pack>", name, price, "incl. N% GST extra" (contradictory wording, fix to "+ N% GST"), Add / stepper.
7. **Compost calculator** P:442-445, `renderCompost` P:838-862 (SRS p4-5 s1.4). Eyebrow "Compost calculator", h3 "How much compost do your plants need?". Mode toggle "Plants in my cart" (disabled when cart has no plants) / "Enter my own" (default manual counts L 0, M 100, S 0). Formula: vermicompost kg = 2L + 1M + 0.5S; biochar kg = 1L + 0.5M + 0.25S; packs = ceil(vc/25), ceil(bc/10); price = packs x 450 / x 600. Result: "Recommended for N plants", big "X kg vermicompost, plus Y kg biochar", two line items, CTA "Add recommended pack" (sets cart qty, replaces not adds), note "Sample dosage per pit. Hasiru Agro to share the real formula per crop."
8. **Credential marquee band** P:447, `renderBand` P:767-776 (SRS p5 s1.5; SK48 "Incubated by | recognised"): items with logos: "Incubated by UAS Dharwad", "Recognised by Startup India", "MSME registered", then "Own nursery in Bengaluru", "Delivered across Karnataka", "Rated 4.8 by farmers". Duplicated track, 28 s linear loop, gold top border, logo onerror removes img.
9. **Learn how video** P:449-452 (SK48 "Learn how" box): single poster with play button, caption "Pit preparation and mulching, 4 min (sample video)". Not playable. SRS wants a rail of DIY videos (see D3).

### C2. Shop (P:456-470; `renderShop` P:865-876; product card P:733-752)
1. Eyebrow "Shop plants", h2 "Plants for every acre".
2. **Category tabs** Timber Trees / Fruiting Trees / Other Plants with live counts (counts respect in-stock toggle). Default tab Fruiting. Switching resets sub-filter.
3. **Sub-filter segment**: Fruiting → All / Desi / Exotic; Other → All / Plantation / Spices / Biomass; Timber → none.
4. **Search box** "Search plants" (name contains, case-insensitive, live).
5. **"In stock only" checkbox** default on; count label "N plants"; empty state "No plants match. Try turning off "In stock only"."
6. **Product card** (quick-commerce style, also used in best sellers and Ask AI): square image; badges "Sample item" or "Best seller" (featured) + "N% off" (= 1 - effective price / regular); category line "FRUITING TREES · Desi"; name (2-line clamp); spec chips height (from size), exposure ☀, temperature 🌡 (shortened "°"); price bold effective + struck regular; **bulk hint** "Bulk price from 50 plants: Rs X" turning to "Bulk price unlocked at 50+" (green state) when the plant's total qty across cart crosses threshold; availability "In stock" / "Out of stock"; action: Add → becomes stepper; out of stock → grey "Notify" (toast "We will notify you when X is back").
7. **Bulk price unlock logic** `unitPrice(p, qtyOf(id))` P:711: qty summed across package and additional lines of the same plant; price drops live in card, reco and cart.
8. **Floating calculator FAB** P:469 "Plant calculator" (gold pill, bottom-right, above mobile cart bar) → modal `#calcModal` P:580-584 (instance `cm`), backdrop click / × / Esc closes; adding from modal closes it. SRS asks the FAB on Home too (p3); prototype has it only on Shop.
9. **Plant calculator component** P:780-835 (SRS p3 s1.2A, p9 s3.4; SK49 "43,560 x 3 / 100"):
   - Inputs: plant select "Plant (fills its recommended spacing)" listing in-stock plants with spacing, plus "Custom spacing"; land area number + Acre / Sq ft segment (converts value on toggle); "Plant to plant (ft)" default 18; "Row to row (ft)" default 18; layout Square / Triangular; checkbox "Add 3% extra for gap filling" (default on).
   - Formula: n = floor(sqft / (L x W) x (tri ? 1.155 : 1)); if buffer n = ceil(n x 1.03). Plants per acre = floor(43,560 / (L x W) x tri factor).
   - Output panel: "You can plant about" big N, plant name + "· bulk price applies" when n >= threshold, lines Plants per acre / Spacing "18 x 18 ft, square" / "Price for this quantity" "Rs T (Rs u each)" using bulk logic; CTA "Add N to cart" (disabled "Pick a plant to add"); formula note "Formula: 43,560 sq ft / (plant spacing x row spacing). Triangular layout fits about 15% more. Sample logic, Hasiru Agro to confirm."
   - SRS worked examples to use as tests: 9x9 → 538/acre; 10x10 → 436/acre (SRS p3; prototype floors, SRS rounds: 435.6 → 436, decide rounding).

### C3. Help Me Choose wizard (P:472-507; P:879-907; SK50 "1 Location 2 Land size 3 Purpose → Generate → KYC")
1. Eyebrow "Help me choose", h2 "Your planting plan in 3 steps", 3-dot progress `#st1-3` lights per answered step.
2. **Step 1 "Where is your land?"**: input "Type your village, town or district"; suggestions after 2 chars, max 6, each shows name + "N km" or "Local"; keyboard ↑/↓/Enter, mousedown pick, blur closes; no-match row "No match. Try your district name."; confirmation "✓ Mysuru, 150 km from our Bengaluru nursery" / ", local delivery". **"☉ Use my location"** link (demo: picks Ramanagara + toast "Location found (demo)"). SRS p10 also wants a **map picker** option (missing).
3. **Step 2 "How much land?"**: number (step .25 acre / 100 sq ft), Acre / Sq ft segment converting value, live conversion "= 43,560 sq ft" / "= 0.25 acre". Changing land clears cached recommendations.
4. **Step 3 "What is the purpose?"**: 3 icon cards Commercial "Fruit orchard with timber and biomass rows", Food Forest "Layered canopy, sub-canopy, shrub and biomass", Miyawaki "Dense native mini forest". Must be data-driven (SRS p10 "additional purposes later"; client sheet already adds **Boundary** model).
5. **CTA "Generate my plan"** (full-width gold) + note "Free. We will ask for your phone number to unlock the full plan." Demo: no validation, falls back to Mysuru / 1 acre.

### C4. Recommendations (P:510-526; P:909-1054; SK50 diagram + rows of cards; SK51 "Comm pkg")
1. **Purpose dropdown** top-left "Purpose [Commercial ▼]" (SRS p11 s5.1). Changing re-orders: chosen model first and open, rest "Also explore" collapsed.
2. **Summary chips**: 📍 location, land ("1 acre" / "N sq ft"), "33.6 blocks of 36 x 36 ft".
3. **Blurred preview + lead unlock** (H decision 3, P:1235-1264, CSS P:201-203): content blurred 7 px, max-height 900, not clickable; overlay card "Your plan is ready" / "Unlock your Commercial plan" / "See the planting diagram, plant quantities for your land and the package price. We send a one-time code to verify your number." Fields "Your name", "Mobile number" with fixed "+91" prefix, 10 digits. "Send OTP". OTP stage: "Enter the 4 digit code", "Sent to +91 X. Change", 4 single-digit boxes (auto-advance, backspace back, auto-submit when full), "Verify and unlock", error "That code does not match. Try 1234.". Demo: Send OTP unlocks directly; toast "Welcome <name>, your plan is unlocked". NOTE SRS p10-11 s4.2-4.3 orders OTP **before** Generate; Shyam's confirmed decision is blurred preview **after** Generate (better conversion). Keep decision; lead is created at OTP verify.
4. **All three models generated at once**, each a `<details>` expand/collapse section (SRS p11-12 s5.2) with summary: eyebrow "Recommended for you" / "Also explore", h3 "<Model> model", meta "N plants · Rs total", chevron. Canvas draws on open.
5. **Canvas 36x36 ft M/X/O diagram** `modelPoints` P:911-925, `drawModel` P:929-949 (SRS p12-13 s5.3; SK50 rows `M O X O X O M`):
   - Points at (c x colSpacing, r x rowSpacing) for c in 0..floor(36/col), r in 0..floor(36/row); pattern strings cycle per row and per column; Miyawaki uses seeded RNG (Park-Miller, seed 42) against mix shares.
   - Species assigned within role by cycling through the role's plant list.
   - Drawing: cream soil square, 6 ft grid lines, axis labels every 12 ft, "36 ft" side label, coloured circles per role with white letter when radius >= 8, DPR-aware, redraw on resize (debounced 150 ms P:1645).
   - Hover tooltip "M: Alphonso Mango (12, 0 ft)" (nearest point within radius+4). Mouse only, needs tap support.
   - **Legend** per role: dot, letter, role name, plant names, per-block count.
   - **Scale caption**: model desc + "N plants per 36 x 36 ft block x B blocks = about T plants for your land."
   - Per-block counting uses half-open [0,36) so edge plants are not double counted (`blockCounts` P:926-928). Commercial = 18 per block.
6. **Quantity scaling** `recoQty` P:962-973: role total = round(blockCount[role] x landSqft / 1,296); split evenly across role plants, remainder to first ones. Cached per model in `S.reco` (base quantities kept for "recommended N" hint).
7. **Plant sections by category** Timber Trees / Fruiting Trees / Other Plants with "N plants" subtotal (SRS p13-14 s5.4-5.6; must not hard-code categories). **Horizontal card** `hcard` P:1026-1034: image, role pill (coloured M/X/O), subcat, name, "Rs u each" + "bulk" tag or "· bulk from 50", "· recommended N" when edited, "View more" expands details (type, "Bears in", "Yield", "Spacing", "Sample item"), stepper, line total. SRS "View More" means *more varieties* of that category (alternates), prototype treats it as more details: build both (alternates swap list is missing).
8. **Recommended inputs block** P:975-981, P:1016-1018 (SRS p15-16 s6, 6.1): "Include" checkbox (fades block when off); rows: name, pack, unit price, "(suggested N)" when user-edited, stepper, line total. Calculation: vermicompost packs = ceil(sum(q x dose[role][0]) / 25); biochar = ceil(sum(q x dose[role][1]) / 10); neem cake = ceil(totalPlants x 0.25 / 25); Jeevamrutha = max(1, ceil(acres x 4)). Note "Calculated from your plant quantities: X kg vermicompost and Y kg biochar. Edit freely." When plant qty changes, inputs auto-follow unless the user edited them (`recoSet` P:1039-1046). Optional, not mandatory (SRS p16).
9. **Watch video** per model P:1010: poster image + "Watch: <model video title>" (Commercial "Commercial orchard layout and first-year care", Food Forest "Building a food forest, layer by layer", Miyawaki "Planting a Miyawaki forest in 120 sq m"). Placeholder (SRS p16-17 s8).
10. **Package footer** "<Model> package Rs total" + "Add package to cart" (`addPackage` P:1047-1054): blocked until unlocked (toast "Unlock the plan first"); replaces any existing package lines; adds plants (Miyawaki lines flagged for 0.8 kg weight) and inputs if included; sets package name; routes to cart; toast "<Model> package added". Package total `recoTotal` = sum(unitPrice(p,q) x q) + inputs.
11. **"View in 3D"** button on each diagram P:1006 → C4a.
12. **"Want to add something else?"** panel P:519-523: "Everything you add from the shop sits under Additional items in your cart." + "Browse all plants" (SRS p16 s7).

### C4a. 3D close-up and 2D plan (P:1056-1233 in-page modal; `site/3d.html` standalone)
1. On a hosted page "View in 3D" opens `3d.html?m=<model>` in a new tab; inside claude.ai preview it opens the in-page modal (P:1097-1110).
2. **In-page modal** P:585-607: header "3D close-up, illustrative" + model title; step preloader ("Loading 3D engine..." / "Preparing the patch..." / "Planting N plants..." / "Ready", progress bar, failure text "The 3D view could not load. Check your internet connection and try again."); three.js r128 + OrbitControls loaded lazily from jsDelivr only on open.
3. Patch = pattern repeated once each way: Commercial 13x3, Food 7x7, Miyawaki 7x7 (P:1060), spacing as model (1 unit = 1 ft); Miyawaki trees at 0.45x.
4. Procedural low-poly trees by archetype (canopy 12 ft, small 8, timber 18, palm 16, banana 9, shrub 6) chosen by plant id/category/name regex (P:1061-1076); soil bed, raised rows + drip lines when row spacing >= 6; M/X/O coloured basin rings (toggle "M / X / O markers"); 5.5 ft person for scale; gold dimension labels for column and row spacing; hemisphere + shadowed sun; fog.
5. Interactions: orbit drag / pinch / scroll (polar clamp), tap-to-identify card (role, name, role name, archetype, "sample item"), "Walk in" / "Back to aerial view" toggle, arrow pad ▲◀▼▶ and WASD/arrows in walk mode, drag to look, bounds clamp, Esc to close, full dispose on close.
6. Caption: "N plants on a W x D ft patch, spaced ... A patch like this repeats about R times across your <land>. Plant sizes are standard illustrations per plant type ...". Legend per role with plant names. Link "Open the high-quality 3D test (realistic trees, walk mode) →".
7. **`site/3d.html`** (3D:1-444): standalone "Hasiru 3D Farm Preview". Model segment Commercial / Food Forest / Miyawaki (query `?m=`), view segment "3D view / 2D plan" (query `?v=2d`), sun slider (3D only), "Walk in" button, PUBG-style joystick (drag elsewhere to look, WASD strafe, arrows turn), loading overlay "Preparing your farm view". Test spacing differs from prototype: Commercial 7.5 x 20 ft `MOXOXO`, Food Forest 10 x 10, Miyawaki 2 x 2 at 0.42x (3D:114-118). Instanced textured procedural trees (leaf textures, bark, wind sway shader, fruit), Tripo mango GLB (`assets/mango.glb`, 355 KB) for mango plants, faded surround rows (3D:128-137). 2D plan (3D:348-390): canopy-spread circles per archetype (mango 5.2 ft radius, guava 3.4, timber 3.3, shrub 2.3, banana 3.5), faded context, dashed patch outline, row lines, dimension labels, scale bar, tap to identify. Plant list for 3D is its own hard-coded map (3D:105-113), must come from catalogue in build.

### C5. Cart and delivery (P:529-543; P:1266-1351; SK51 "Comm pkg" box with steppers)
1. Eyebrow "Cart and delivery", h2 "Your order"; two-column grid (stacks under 900 px), summary box sticky.
2. **Recommended Package block** (pale green `#E8F1E9`, different background per SRS p17) titled "Recommended package: <Model>" + subtotal; empty state "No package yet. Get a planting plan and add it here in one tap."
3. **Additional items block** + subtotal; empty "Nothing extra. Browse plants".
4. **Cart line**: image, name, sub "Fruiting Trees · Medium tree" or input pack, "Rs u each · bulk price" or "· bulk at 100 (37 more)" (distance-to-bulk nudge), Remove, stepper, line total.
5. **Journey-1 input suggestion** P:1305-1313 (SRS p32 "Recommend plants inputs to be added based cart"): shown when there are additional (non-package) plants and no inputs in cart: "Recommended inputs for your plants" / "For N plants: vermicompost 25 kg x a and biochar 10 kg x b, Rs X" / "Add both".
6. **Truck capacity meter** P:1279-1284, P:1316-1324 (SRS p19 s13; differentiator, H research): total weight w = sum(plant qty x size weight (0.8 Miyawaki)) + sum(input qty x pack kg). Vehicle = smallest with cap >= w; else Eicher with trips = ceil(w/5000), fill = last-trip remainder / 5000. Shows truck icon, "[k trips, ] Tata 407 65% full", "W kg of C kg [on the last trip]", gradient meter, message ">= 90%: ✓ Nicely packed. You are using this trip well." else "Add about K kg (~P% more) and it ships at the same delivery cost.", note on sample weights. Empty "Add plants to see how much of a truck you fill."
7. **Delivery options** P:1327-1335 (SRS p18, p26 s29): radio cards
   - "Pick up at our nursery" "Free. Bengaluru nursery, any day 8 am to 5 pm."
   - "Bengaluru weekly delivery" (default) "Every Saturday. Flat rate by vehicle: Ace Rs 1,500, 407 Rs 3,500, Eicher Rs 6,000." + date select of next 4 Saturdays ("Saturday, 25 Oct"). Charge = flat x trips.
   - "Outstation delivery" "Distance x vehicle rate: Ace Rs 22/km, 407 Rs 35/km, Eicher Rs 48/km." + district select (places >= 60 km) + "N km from our nursery · Tata 407 [x trips]". Charge = km x perKm x trips (one-way, no minimum: open questions).
8. **Order summary** `totals` P:1285-1295, P:1338-1350 (SRS p17 cart fields, p20 s17):
   - Promo banner "🌱 Monsoon planting offer: 10% off fruiting trees, applied automatically" (when any fruit line).
   - "Subtotal (list price)" = sum(sale price x qty) (note: "list" here is sale price `p.p`, regular `r` only on cards).
   - "Bulk and online savings" = sum((sale - effective) x qty).
   - "Monsoon offer" = 10% of effective fruit-line value (`promoOn` P:713, stacks on bulk).
   - "Packing" = sum(size rate x qty), inputs free.
   - "Transport (vehicle x trips)" or "Free" for pickup.
   - "GST (plants 0%, inputs 5 to 18%)" = inputs only, on effective price, added on top.
   - "Total" = sub - save - promo + pack + gst + ship.
   - Policy note "No cancellation or return. Live plants are packed for your order. Damage on arrival is replaced as per our replacement policy (wording to be confirmed)." (SRS p21 s19-20).
   - CTA "Proceed to pay Rs X" (toast "Payment is outside this prototype"), "All rates are sample values for review."

### C6. Ask AI (P:562-570; P:1479-1588)
1. Hero: leaf avatar, eyebrow "Ask our plant expert", h2 "What would you like to grow?", mode pill "Catalogue search (AI runs on the live site)" / "AI answers".
2. Intro "Answers come from the Hasiru Agro plant catalogue: prices, bulk rates, spacing, sunlight, temperature, bearing time, yield and stock."
3. Suggested question chips (hide after first message): "Which mango varieties are in stock?", "Best timber trees for a 2 acre farm", "Fruit trees under Rs 400 that bear in 2 years", "What can I grow in partial shade?", "How does bulk pricing work?", "Exotic fruits for a hot, dry place".
4. Chat: greeting "Hello! Ask me about any plant we sell: price, bulk rate, spacing, sunlight, when it fruits, or what suits your land."; user bubble; bot bubble with streaming text, "Checking the catalogue..." / "Searching..." pending; light markdown (bold, "- " bullets, paragraphs); `[[ID]]` tokens rendered as "+ cart" chips; below the answer a rail of up to 8 product cards for mentioned plants; source/footnote line.
5. Composer: input (max 400 chars) "e.g. Which mango varieties are in stock?" + "Ask"; busy lock.
6. **LLM mode** (prototype via claude.ai `sample`): system rules P:1491-1503: answer ONLY from catalogue, cite ids as `[[HA0011]]`, never invent ids, Rs format, mention bulk price/qty for acreage questions, prefer in-stock, plants/acre formula, say so and suggest calling the team when unknown, 2-6 sentences or up to 6 bullets, no tables/headings/em dashes, delivery + no-return facts. Catalogue serialised as pipe table (P:1484-1489). Keeps last 8 turns. Error handling: capability off → fallback; rate limited; refused → "I can only help with plants and farming questions."; interrupted → partial + keyword fallback; "Answer cut short. Ask a narrower question.".
7. **Rules-first fallback** `localAnswer` P:1506-1530: intents bulk / delivery canned answers; filters by category keywords, exotic/desi, "under Rs N", shade, "N year" bearing, prefer in-stock, name match; top 6 sorted featured/in-stock; no-match message "I could not find a matching plant in our catalogue. Try a plant name, a category (timber, fruiting, spices, plantation) or a price, or call our team for advice."
   Build mapping: rules engine (retrieval + filters + recommendations) decides, Claude only narrates/answers grounded in returned rows (approved architecture).

### C7. Data needed (P:545-560; P:1353-1477)
1. Intro "For the Hasiru Agro team" / "Data and logic we need, feature by feature" + key chips (How it works now / Data we need / Please confirm / Received ✓ / Partly received) + status note for 18 Oct file.
2. 15 accordions (`REQ` P:1390-1466): Home two ways in; Plant catalogue and product cards; Bulk pricing; Plant calculator; Farm inputs and compost calculator; Help me choose wizard; Lead capture and OTP; Planting models and the 2D layout; Recommended inputs in the package; 3D view and 2D plan; Cart, packing and truck meter; Delivery options and charges; Taxes, offers and policies; Ask AI; Trust band and videos. Each: what, logic bullets (with `<code>` sample values), data items with received/partly status, questions.
3. Consolidated table "All data in one list": 39 data items (`REQ_TAB` P:1356-1374) with Excel tab + features using them.
   Build relevance: this is an **internal/client-facing checklist, not a storefront page**. Its open questions become admin settings + seed TODOs. Open client questions worth carrying into the build (all from REQ): bulk per plant vs per category, cross-plant bulk, second tier; meaning of "43,560 x 3 / 100"; square vs triangular; dosage dimension (crop/size/soil); serviceable districts, map distance; other purposes (Boundary); SMS/DLT provider, lead destination, WhatsApp instead of SMS; M/X/O meaning, fixed 36x36 block, real spacing, role shares, more models; later-stage inputs (3/6 months); 3D growth stage; truck limit by weight/count/volume, plants per vehicle; Bengaluru day/slots, outstation one-way/min charge, loading labour; GST/HSN per type; offer ownership; policy wording; AI fallback to call/WhatsApp; credential wording, review score source; existing videos.

## Part D. SRS requirements NOT in the prototype (or only partly)

| # | Requirement | SRS | Status in prototype |
|---|---|---|---|
| D1 | Product card extras: description, **rain preference**, **packet weight**, "View Product" link, click to product details; desktop **nav arrows** on rails | p2-3, p4 | Missing (card has height/exposure/temp only) |
| D2 | **Product detail page** (plants and inputs) | p2, p9 | Missing |
| D3 | **DIY / educational video rail** (play, open, scroll, view more) + admin (add/delete/modify, title, thumbnail, URL, category) + CTA "Explore Farm Development Services" | p5-6 (s1.6; heading s1.7 misplaced, H quirk) | Single placeholder poster |
| D4 | **Why Choose Us** home section (SK49: 4 tiles) and dedicated page: Plant Authenticity, Domain Expertise (plantation, farm dev, plant selection, permaculture), Proven Results (acres developed, farms, customers, projects; verified only), Delivery to Farm | p6-8 | Missing |
| D5 | **Testimonials & Reviews** rail (name, location, photo, review, rating, farm/project) + admin CRUD | p6; SK49 | Missing (band only says "Rated 4.8") |
| D6 | **Lower home links**: Explore Farm Development Services, About Us, Contact Us | p7; SK49 "Explore farm dev" | Missing |
| D7 | Floating plant calculator also on **Home** | p3 | Only Shop |
| D8 | Admin-manageable categories; input categories Compost / Seeds / Biochar / Liquid fertilizer / Bio-Pesticide; input product card "Product type", offer price, availability, View Product | p3-4, p8, p29 | Inputs hard-coded, no type/availability |
| D9 | Help Me Choose entry from Plants page; wizard as **popup/form** | p9 | Separate screen, no entry from Shop |
| D10 | **Map-based location picker** | p10 | Missing (text search + demo geolocation only) |
| D11 | **OTP before Generate** | p10-11 | Superseded by approved blurred-preview-after-Generate (H decision 3); real OTP not wired |
| D12 | Recommendation "View More" = **more varieties** per category; admin can add recommendation categories | p13-14 | Missing (View more = details) |
| D13 | **Checkout**: name, mobile, email; full address, location, PIN, district, state; delivery vs pickup | p17-18 | Missing |
| D14 | **Configurable GST** by product/category (admin) | p18 | Hard-coded |
| D15 | Transport engine considering distance, weight, quantity, volume, zone, current utilisation | p18-19, p25-26 s28 | Partial (weight + km + vehicle) |
| D16 | Bengaluru schedule configurable by admin | p19 | Hard-coded Saturday |
| D17 | **Packing rules**: per order / product-specific / quantity-based / size-weight-based | p20 | Size-based only |
| D18 | **Payment** (Razorpay / PhonePe / Cashfree; UPI, cards, netbanking, wallets); build decision: PhonePe PG | p20, p38 s41 | Missing |
| D19 | **Promotions**: activate/deactivate, % and fixed, product-specific, campaigns, **coupon codes**, start/end dates, eligible products/customers, usage rules, auto-reflect in cart | p21, p31 s33 | One hard-coded auto promo |
| D20 | **Policy pages** (damage, replacement, cancellation) + footer links + near checkout; refund rules mirror no-cancel | p21-22, p36 | Note near total only |
| D21 | **Farm Development Services page** "From Barren Land to Living Farm": Site Assessment, Design, Water & Rainwater Management, Land Preparation / Earthwork, Planting | p22-23 | Missing (toast) |
| D22 | **Our Work** portfolio (images, location, land size, scope, before/after, details) | p23 | Missing |
| D23 | **Our Clients** (name, project type, location, acreage, work done) | p23-24 | Missing |
| D24 | **Farm development results** counters (acres, farms, clients, projects, plants planted) | p24 | Missing |
| D25 | **Build Farm With Us** enquiry form: name, mobile, Business/Farmer, acres (min 1), location, timeline, requirement; optional photos, documents, notes; creates Farm Enquiry in admin | p24 | Missing |
| D26 | Incubation info also on company/service pages | p25 | Home band only |
| D27 | **About Us**: Chemical Free, Certified Permaculture Designer, Vision, Mission | p25 | Missing |
| D28 | **Admin dashboard**: sales total/period/region; orders total/pending/completed/cancelled; region by state/district/city/PIN; best sellers qty+revenue; farm enquiries new/pending/converted/closed; low stock (current, min, reorder) | p27-28 | Missing |
| D29 | **Inventory page**: product, SKU, category, current, reserved, available, low-stock threshold, availability | p28 | Missing |
| D30 | **Plant management**: add/modify/delete-deactivate, availability, prices, images, descriptions, categories, **variants**, stock | p28-29 | Missing |
| D31 | **Availability states**: Available, Out of Stock, Temporarily Unavailable, Coming Soon, Hidden | p29 | Boolean in-stock only |
| D32 | **Recommendation management** per model: plants, qty, category, spacing, host/biomass/main, related inputs, biochar & vermicompost qty, video | p29-30 | Hard-coded |
| D33 | **Order management**: view order, customer, products, qty, payment, delivery, transport, packing, discounts; update status | p30 | Missing |
| D34 | **Farm enquiry management**: customer, phone, farmer/business, location, acres, timeline, requirement, date, status, assignee, remarks | p30-31 | Missing |
| D35 | **Journey 1 end-to-end** incl. Checkout → Delivery/Pickup → charges → Payment → **Order Confirmation** | p31-32 | Stops at cart |
| D36 | **Journey 2** (written bottom-up, H quirk; read reversed): Home → Help Me Choose → Land size → Location → Generate all three → Name+Phone → OTP → Generate → Expand/collapse models → 36x36 diagram → Recommended package → Add additional plants → Watch video → Checkout → Delivery/Pickup → charges → Payment | p32-33 | Up to cart |
| D37 | **Journey 3** Farm development: Home → Explore → services → Our Work → Our Clients → Build Farm With Us → customer + farm details → enquiry → admin follow-up → site assessment → design → quotation → project (pipeline statuses) | p33-34 | Missing |
| D38 | Critical rules: single/multiple plants, outside-recommendation adds, recommendation depends on purpose + land + **location**, inventory updates on orders, low-stock + best sellers + region in dashboard, enquiries separate from orders, configurable models, admin-controlled availability | p35 | Location does not affect recommendation in prototype (only distance) |
| D39 | Calculator data still owed: compost formula, biochar, **seed calculation** (green-manure seed per acre), vermicompost | p36 | Seed calc missing |
| D40 | **Customer accounts**: phone OTP login, order history, live order/delivery tracking, **invoice download**, **saved land profiles** ("Main Farm - 5 Acres - Commercial") for re-generation | p37 s38 | Missing |
| D41 | **English + Kannada** with header toggle; admin edits static text, product names, categories in both | p37 s39 | Missing (Kannada names received for 157/159) |
| D42 | **Communication engine**: SMS/WhatsApp OTP, order confirmations, weekly slot reminders, outstation tracking, admin enquiry notifications; **WhatsApp share** for recommendations and DIY videos | p38 s40 | Missing |
| D43 | **GST-compliant invoices** B2C and B2B with customer GSTIN, CGST/SGST vs IGST split | p38 s41 | Missing |
| D44 | Core principle: admin manages products, prices, stock, availability, best sellers, recommendations, discounts, videos, testimonials, portfolio, delivery rules, offers | p37 s37 | Everything hard-coded |

Approved build additions beyond SRS (from the computed task, for completeness): Gmail API OAuth email, Meta catalog sync, Google Merchant Center feed, Claude rules-first assistant, hasiru-ops sync (orders out, inventory in), admin roles + 2FA, sharp image pipeline, pg-boss jobs.

## Part E. Mapping to the three user flows

### Flow (a) Buyers who know what they want
Designed: hero path 1 (C1.3), best-seller rail (C1.4), Shop tabs + Desi/Exotic + search + in-stock (C2.2-5), product card with price, offer, bulk unlock, availability, stepper (C2.6-7), plant calculator inline + FAB (C1.5, C2.8-9), inputs rail + compost calculator (C1.6-7), cart with additional items + Journey-1 input suggestion + truck meter + delivery + summary (C5), Ask AI for "which X is in stock" (C6).
Required by the flow brief but **not designed yet**:
- **Weather / region fit on cards**: data exists. Plant temp opt/min/max, humidity opt/min/max, rainfall min/max, drought tolerant (`latest_products.xlsx` Plant data) vs district temp min/max, humidity min/max, avg rain, soil, native crops (Dis-wise Geo data, 644 districts). Needs a saved/selected location (header "Delivering to <district>" or from wizard / account land profile) and a fit score badge ("Suits Hassan climate" / "Needs irrigation in Kolar"). Rules engine computes; no AI.
- **Yield on card**: field `y` exists (shown only in reco "View more" and AI); add chip. Bearing time `b` likewise.
- **Reviews on card**: no review model anywhere; SRS only has testimonials (D5). Needs product reviews (rating + count on card, list on PDP, verified-buyer gate, admin moderation).
- Product detail page (D2), checkout/payment/confirmation (D13, D18, D35), accounts (D40), Kannada (D41).

### Flow (b) Discoverers (AI / wizard / companions)
Designed: hero path 2, wizard (C3), blurred preview + OTP lead (C4.3), 3 models with canvas diagram, legend, scaling, plant sections, inputs, video, package to cart (C4), 3D/2D (C4a), Ask AI with grounded answers and add-to-cart chips (C6), cart Recommended Package block (C5.2).
Not designed yet:
- **Cross-farming companions for what they already planted** ("I already have 200 mango trees, what should I add?"). Nothing in prototype. Data to drive it: M/X/O role membership per model, model spacing columns ("-" = excluded), nitrogen fixer flag, canopy size class, categories, Boundary model. Rules: given planted species + acreage, pick model(s) where it fits as M, then suggest X and O companions with quantities from the pattern; Claude narrates only.
- Location actually influencing recommendations (D38) via the climate-fit rules above, filtering model plant lists by district suitability.
- Boundary model (client sheet), map picker (D10), View More alternates (D12), saved land profiles (D40), WhatsApp share of plan (D42), lead routing (admin + hasiru-ops?).

### Flow (c) End-to-end farm services enquiries
Designed: nothing beyond a header nav item that toasts (P:400) and the credential band.
Needed (all SRS): Farm Development page with 5 services (D21), Our Work (D22), Our Clients (D23), results counters (D24), Why Choose Us (D4), About Us (D27), testimonials (D5), Build Farm With Us form with uploads creating an enquiry (D25), enquiry pipeline New → Pending/Follow-up → Site assessment → Design → Quotation → Project / Converted / Closed with assignee + remarks (D34, D37), admin notifications via email/WhatsApp (D42), dashboard enquiry counts (D28). Cross-links: wizard results and large-acreage carts should offer "Want us to build it for you?" into this enquiry (not in SRS, natural bridge; flag as suggestion).

## Part F. Known prototype logic issues to fix (not copy) in the build
F1. Input card copy "incl. N% GST extra" contradicts itself (P:762).
F2. Summary "Subtotal (list price)" uses sale price, while cards strike through regular price; "N% off" badge uses regular. Define price fields clearly: MRP (regular), online price, bulk price, (nursery/offline price from CSV, not online).
F3. Promo stacks on bulk price with no admin rule (P:1291); needs stacking rules.
F4. GST added on top of input prices; decide inclusive vs exclusive per product (admin).
F5. Outstation district list is `km >= 60` from the same 36 places; Bengaluru vs outstation must be a zone rule, not a distance cut.
F6. Calculator floors, SRS rounds (436 vs 435).
F7. Canvas tooltip is mouse-only; needs tap/keyboard access and a text alternative (table of plants per block).
F8. Commercial 6 ft in-row spacing is too tight for mango (REQ note); 3D already uses 7.5 x 20. Real spacing comes from client per-model spacing columns.
F9. Mobile has no nav menu (P:49).
F10. Compost "Add recommended pack" replaces existing input quantities rather than adding.
F11. Reco state cache cleared on land change but not on location change (location does not feed recommendations yet).
