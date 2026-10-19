# Product data analysis and gap-fill plan

Date: 2026-10-20. Scope: what the store's product records look like, how complete the client data is, and how we fill each gap. The plant data comes from the client file `latest_products.xlsx` (the client sent it on 2026-10-18). Pricing, descriptions and images come from the old WooCommerce shop export (`git show HEAD:wc-product-export-16-10-2026-1792136471168.csv`, 194 rows, the header is on line 2). The field list comes from the data template `Hasiru-Agro-Website-Data-Sheet.xlsx`, and the rest from HANDOFF.md.

Scratch scripts used for the numbers below (re-runnable): `/private/tmp/claude-501/-Users-shyam-Desktop-Claude-Dev-Projects/d18da15a-5098-4203-9d95-a297ff0881af/scratchpad/scripts/match.py`, `build.py`, `names.py`. The importer package should take over this logic. The scripts are not part of the repo.

---

## 0. Key decisions (TL;DR)

1. **Master list = the client's "Plant data" tab: 159 rows, all kept as separate products.** The 55 scientific-name rows are a separate product line. These are native / Miyawaki saplings: all seeded, almost all Miyawaki-only spacing, 2 kg compost. Examples: Santalum album, Syzygium cumini and Phyllanthus emblica. They are never merged with the common-name rows (Sandalwood, Jamun, Amla). They get a common display name plus the scientific name, e.g. "Native Sandalwood (Santalum album)".
   - The handoff calls these rows 99 to 159, but in sheet-row terms they are rows 100 to 154.
   - Sheet rows 155 to 162 are 8 biomass and support plants with common names: Sesbania, Gliricidia, Moringa, Lemongrass, Vetiver, Marigold, Mexican sunflower and Mulberry.
2. **+1 plant: Agarwood.** It appears in the client's "Plant list" and "FAQs" tabs but has no row in "Plant data". Import it from Woo (HA005, 28 local images) and fill its climate data by research. Flag it for the client.
3. **The other 128 Woo plant products are not in the client file.** Examples: many named mango and jackfruit cultivars, avocado types, Cocoa, Coffee and Rose wood. Import them as **draft (hidden, noindex)** records with `data_source: woo_legacy` and their prices, descriptions and images. The admin can publish them after filling spacing and climate. Old URLs get a 301 only once the record is published, and to the collection page until then. The Woo "Secret Science" e-book (virtual product) is dropped.
4. **Name match result (159 rows)**
   - 65 exact Woo matches: the price, compare-at, description, gallery, attributes and SEO come from Woo.
   - 15 sibling matches (same species, different variety): only the price and attributes are borrowed, flagged.
   - 24 have no match: researched price.
   - 55 scientific rows: no match by rule, priced from the native-sapling band.
5. **Price fill**
   - Matched rows: Woo **sale price**.
   - Sibling rows: the sibling's sale price.
   - All other rows: an Indian nursery rate (KAU 2025-26, UAS Bengaluru 2026 lists, retail listings) scaled to the old shop's price level.
   - `compare_at` (the struck-out price) is only ever the real Woo regular price. It is **never invented**, because of consumer law and Merchant Center policy.
   - Bulk price = round(price x 0.72): to Rs 5 when the price is Rs 100 or more, to Rs 1 below that. Threshold by size class: L 50 / M 100 / S 200.
6. **Size class from the client's "Canopy size"**: Large tree = L (68), Medium tree = M (62), Small tree / Shrub / Climber = S (29). Weight L 3 / M 2 / S 1 kg, except: native Miyawaki saplings 0.8 kg, slips and cuttings priced under Rs 30 at 0.2 kg.
7. **Tax**
   - Plants: HSN 0602, GST 0%.
   - Packed, branded compost, vermicompost and biochar: HSN 3101, 5% (loose and unbranded is NIL).
   - Bio-pesticide: the handoff says 18%. That is likely out of date, because rates were rationalised in Sept 2025. It needs CA confirmation.
   - Tax is an admin-editable tax class per product, never hard-coded.
8. **Every filled value carries provenance.** Each field group records `data_source` (`client` | `woo` | `woo_sibling` | `derived` | `researched` | `researched_native` | `ai_draft` | `placeholder`), and the record has `needs_review`. The admin gets a "Data gaps" filter.
9. **Collections**
   - Timber Trees: 39.
   - Fruiting Trees: Desi 43, Exotic 31, Forest fruit 11.
   - Other Plants: Spices 9, Plantation 6, Native & medicinal 10, Biomass & support 10.
   - All 3 category columns from the client also become filter tags.
10. **No images in the client file**
    - The local WP dump (`images/wordpress uploads/`) has all 470 Woo gallery images (0 missing). That covers the 65 exact matches, Agarwood and the 128 drafts.
    - 94 client rows have no photo. They get a collection placeholder and `image_needed: true`.
    - We do not use AI-generated photos as product images.

---

## 1. What each input contains

| Source | Content | Usable for |
|---|---|---|
| `Plant list` (29 rows) | Priority plants. Columns: video on WhatsApp Y/N, YouTube Y/N, category (Forestry / Fruits / Horticulture / Spices), "Suppiler" Y/N (bought from a supplier rather than grown in-house). | `is_priority` (homepage / best-seller seed), `has_video_*`, `sourcing: supplier | own` (admin only). Names use loose labels ("White Sandalwood", "Red sandar", "Areca") that map to Plant data rows. |
| `Plant data` (159 rows, 27 cols, 3-row merged header) | Name, variety, Kannada name, canopy size, primary/secondary/tertiary category, nitrogen fixer, drought tolerance, propagation, temperature opt/min/max (C), humidity opt/min/max (%), rainfall min/max (mm/yr), spacing for Food forest / Miyawaki / Commercial (strings "18 x 18" ft), Boundary (single number, ft along the line), compost kg at planting, 0-2 y, 3-6 y, 7+ y (twice a year). | Core agronomy, climate fit, model membership, compost calculator. |
| `FAQs` | 7 template questions (variety, permission to grow, height + package size, intercropping, yield + earnings, propagation + mother plant age, host plant) x 30 plants. **0 answers.** | Per-plant FAQ question set. |
| `General questions` | 59 questions: pre-sale 23, pre-planting 6, post-planting 7, nursery operation 15, others 8. **0 answers.** | Knowledge base / guides. The customer-facing questions are pre-sale, pre-planting and post-planting (36). The nursery-operation set is B2B / blog material, not needed at launch. |
| `Nursery questions` | 33 plant-specific questions for 10 plants (Sandalwood 5, Avocado 5, Agarwood 5, Pepper 4, Mango 3, Jackfruit 3, Guava 3, Coconut 2, Apple 2, Custard apple 1). **0 answers.** | Per-plant FAQ extras. |
| `Farmer questions` | Header with 16 plants, every cell empty. | Nothing yet. |
| `Dis-wise Geo data` | 644 districts in 24 states (+1 blank Maharashtra row). Columns: taluk/hobli/village counts, soil type (free text), total land, agri land (all "NA"), rivers, humidity min/max, temperature min/max, rain mm/yr, native crops. | Wizard location, climate fit, delivery zones, district SEO pages (section 9). |
| Woo CSV (193 plants + 1 e-book) | Name, SKU (HA001.. inconsistent padding), regular/sale price, `Meta: offlineprice` (walk-in nursery rate, about 35-50% of sale), stock (some negative), short and long descriptions, a gallery of about 2.4 images per product, growth habit, spacing text, fruit shape, harvest season, yield per tree, bearing time, exposure, temperature, fruit size, type, maturity, intercropping, soil type (31), climate (32), Yoast/RankMath SEO (about 150). Weight 1 kg / 70 cm is a **placeholder on every row**. | Price, compare-at, descriptions, attributes, SEO and images for the matched rows. |
| `_work/catalog.json` | Compact prototype catalogue built from Woo (192). Superseded by this spec. | Nothing new. |
| Data sheet template | 46 plant columns, plus Input Products, Models, Calculators, Logistics, Content tabs. The client did **not** return it filled. They sent `latest_products.xlsx` instead. | Field checklist (section 2). |
| hasiru-ops (read-only) | `items(id, name, variety, hsn, unit, default_rate, default_weight, gst_rate, cost_rate, vendor_id)`, `stock_batches(item_id, location_id, qty_available, status, expected_ready)`, `order_items(plant_name, variety, ...)`. | Sync key = ops `items.id`, matched on (name, variety). Stock = sum of `qty_available` over batches with status ready. `expected_ready` drives "available from" for preorders. |

---

## 2. Normalized product field schema

Field groups, with the source for each. **Bold** = required to publish.

### Identity and naming
| Field | Type | Source / rule |
|---|---|---|
| **id** | uuid | generated |
| **sku** | text unique | New scheme `HAP-0001`.. (plants), `HAI-001`.. (inputs). `legacy_sku` keeps the Woo SKU (inconsistent padding: HA001 / HA0010 / HA00100). |
| legacy_woo_id | int | Woo ID (for 301 map) |
| ops_item_id | uuid null | hasiru-ops `items.id`, linked in the admin by (name, variety) |
| **name_en** | text | display name, "{Variety} {Base}" e.g. "Alphonso Mango". Scientific rows use "{Common} (Scientific)". |
| base_name, variety | text | client columns, typo-fixed (Alphonoso->Alphonso, Verigated->Variegated, Mahagony->Mahogany, Celyon->Ceylon, gratfed->Grafted, Longon->Longan, Vetiever->Vetiver), originals kept in `search_aliases` |
| name_kn | text | client (157/159; missing Egg fruit, Milk fruit; Monkey Jack shows the jackfruit word ಹಲಸು, flag) |
| scientific_name | text | client for rows 100-154. Researched for the common rows (lookup in names.py, `data_source: researched`). |
| search_aliases | text[] | typo forms, Kannada, romanized Kannada (maavu, halasu, nerale), old Woo name |
| **slug** | text unique | kebab of name_en, e.g. `alphonso-mango`. Native rows end in `-native-sapling`. |

### Classification
| Field | Type | Source / rule |
|---|---|---|
| **collection** | enum `timber` / `fruiting` / `other` / `input` | from client primary category (section 10) |
| **subcategory** | text | Desi / Exotic / Forest fruit / Timber / Spices / Plantation / Native & medicinal / Biomass & support |
| tags | text[] | all three client category columns (Medicinal, Native, Flowering, Pioneers, Pest repellent, Soil binder, Biomass, Forest fruit...) + `nitrogen_fixer`, `drought_tolerant` |
| **size_class** | enum L/M/S | canopy: Large tree L, Medium tree M, Small tree / Shrub / Climber S |
| canopy | enum | client: large_tree / medium_tree / small_tree / shrub / climber |
| propagation | enum | client: seeded / grafted / air_layered / cuttings / suckers / tissue_culture / other |
| nitrogen_fixer | bool | client (17 yes) |
| drought_tolerance | enum low/moderate/high | client |
| is_priority, has_video_whatsapp, has_video_youtube, sourcing | | Plant list tab |
| is_best_seller, is_featured | bool | Woo `Is featured?` (5) + priority list. Admin can edit. |

### Climate fit (rules-engine inputs)
| Field | Type | Source |
|---|---|---|
| temp_c {opt,min,max} | number | client (100%) |
| humidity_pct {opt,min,max} | number | client (100%) |
| rainfall_mm {min,max} | number | client (100%) |
| exposure | enum full_sun / partial_shade / shade | Woo for matched ("Full sun"/"Open sun" -> full_sun). Otherwise derived: spices (pepper, cardamom, nutmeg, clove, cinnamon, allspice) partial_shade when young, rest full_sun. |
| water_need | enum low / medium / high | derived from drought_tolerance (high -> low, moderate -> medium, low -> high) |
| soil_tags | text[] | **missing in client file.** Woo soiltype for 31. Default `["well_drained","loam","red","laterite"]` flagged. The rules engine uses soil only as a soft signal. |
| region_notes | text | free text |

### Planting models
| Field | Type | Source |
|---|---|---|
| spacing_ft.food_forest / .miyawaki / .commercial | [L,W] or null | client strings "18 x 18" parsed. "-" = not in model. |
| spacing_ft.boundary | number or null | client (ft between plants along a boundary line, single row) |
| models | text[] derived | where spacing is not null: food_forest 86, miyawaki 76, commercial 95, boundary 92. Miracle fruit is in no model (shop only), Peanut butter is boundary only. |
| model_role | per model {M\|X\|O} | **missing.** Default rule: L fruit / timber = M, M-size = X, S + biomass = O. Admin-editable. |
| plants_per_acre | derived | 43,560 / (L x W) per model |
| compost_kg {at_planting, y0_2, y3_6, y7_plus} | number or null | client ("-" = none). The last three are per application, twice a year. |

### Horticulture attributes (spec table)
| Field | Source |
|---|---|
| mature_height_ft {min,max} | Woo growth-habit text where parsable, else derived from canopy (L 30-60, M 15-30, S 6-15, shrub 3-8, climber "climber"), flagged |
| bearing_years / timber_rotation_years | Woo bearing-time (179) for fruit, researched for timber (teak 20-25, mahogany 12-15, Melia dubia 6-8, sandalwood 15-20, red sanders 20-25), flagged |
| yield_per_tree, harvest_season, fruit_size, fruit_shape | Woo where matched. Otherwise null (UI hides empty rows), or a researched value flagged. |
| intercropping | Woo (30) or ai_draft |

### Commerce
| Field | Type | Source / rule |
|---|---|---|
| **price** | int INR | section 6.1 |
| compare_at_price | int null | Woo regular price, exact matches only |
| **bulk_price** | int | round(price x 0.72): to Rs 5 when the price is Rs 100 or more, to Rs 1 below |
| **bulk_min_qty** | int | L 50 / M 100 / S 200. Per-plant override. |
| offline_price | int null | Woo `offlineprice`, admin-only reference |
| cost_price | int null | from ops `cost_rate` via sync |
| variants | [{label, height_ft, bag_size, price, bulk_price, weight_kg}] | Default 1 variant. Size variants seeded where Woo had 2 sizes: Mangosteen 1.5 ft / 6 ft, Rambutan N-18 3 ft / 8 ft. |
| **stock_qty**, availability | int, enum in_stock / preorder / out_of_stock | hasiru-ops sync is the source of truth. Seed = Woo stock clamped to >= 0 (exact matches). Unmatched rows start as `preorder`, with `ready_in_days` from ops `expected_ready` or a 30-day default (flag). |
| low_stock_threshold | int | default = bulk_min_qty |
| **weight_kg** | number | L 3 / M 2 / S 1. Native Miyawaki 0.8. Slips and cuttings 0.2. |
| bag_size, height_at_dispatch_ft | text, number | missing. Default by propagation: grafted / air-layered 1.5-2 ft in 8x10" bag, seedling 1-1.5 ft in 6x8" bag. Flagged. |
| packing_fee | int | S 5 / M 10 / L 15 (handoff sample) |
| **hsn**, **gst_rate** | text, number | plants 0602 / 0 (tax class `plants_nil`) |

### Content and media
| Field | Source |
|---|---|
| short_description, description_html | Woo for exact matches, cleaned (strip `\r\n` artifacts, em/en dashes replaced: 9 descriptions have em dashes, 14 have en dashes). Otherwise generated from a template over plant data, plus an ai_draft long text with `needs_review`. |
| faqs [{q, a, source, status}] | section 6.6 |
| images [{src, alt, w, h, role: main/gallery/fruit/plant}] | Woo gallery from local dump. Alt = "{name_en} sapling, {Kannada}". Missing: `image_needed: true`. |
| videos [{url, kind}] | Plant list Y flags, URLs pending from the client |

### SEO and feeds
| Field | Rule |
|---|---|
| seo_title | Woo RankMath/Yoast title (about 65) if not a pattern string, else "Buy {name_en} Plant Online in Bengaluru \| Hasiru Agro" (60 chars max) |
| seo_description | Woo meta desc (about 150), else the first 155 chars of short_description |
| focus_keyword | Woo focus keyword (about 150) |
| canonical, noindex | noindex while draft or image_needed + no description |
| google_product_category | "Home & Garden > Plants" subtree (verify id in the admin) |
| identifier_exists | false (no GTIN) |
| schema.org | `Product` + `Offer`. Bulk price as a second `UnitPriceSpecification` with `eligibleQuantity.minValue = bulk_min_qty`. |

### Provenance
`data_source` per field group: {identity, climate, models, compost, attributes, price, stock, content, images, seo}. Plus `needs_review: bool` and `review_notes: text[]`.

---

## 3. Coverage of the client file (Plant data, 159 rows)

| Field | Filled | Notes |
|---|---|---|
| Plant name | 159 | 135 distinct (varieties share a base name) |
| Variety | 48 | |
| Kannada name | 157 | missing: Egg fruit, Milk fruit |
| Canopy size | 159 | Large 68, Medium 62, Small 16, Shrub 10, Climber 3 |
| Primary category | 159 | 13 values (section 10) |
| Secondary / tertiary category | 81 / 36 | |
| Nitrogen fixer | 159 | Yes 17 |
| Drought tolerance | 159 | High 74, Low 44, Moderate 41 |
| Propagation | 159 | Seeded 104, Grafted 26, Air layered 14, Cuttings 8, Suckers 3, Tissue culture 2, Others 2 |
| Temp opt/min/max | 159 | only 5-6 distinct values per column (climate-group presets, fine for rules) |
| Humidity opt/min/max | 159 | presets |
| Rainfall min/max | 159 | presets |
| Spacing Food forest | 86 | 73 "-" |
| Spacing Miyawaki | 76 | 83 "-" |
| Spacing Commercial | 95 | 64 "-"; equals Food forest wherever both are set (confirmed intentional) |
| Spacing Boundary | 92 | 66 "-", 1 blank (Pomegranate, treat as "-") |
| Compost at planting / 0-2 y / 3-6 y | 159 / 159 / 157 | |
| Compost 7+ y | 88 | 71 "-" |
| **Price, bulk price/qty, stock, weight, bag size, height at sale, HSN/GST** | **0** | all gaps |
| **Exposure, water need, soil, bearing time, yield, harvest season, mature height** | **0** | gaps (Woo covers the matched rows) |
| **Images, descriptions, FAQ answers, SEO** | **0** | gaps |
| **Scientific name (common rows), common name (scientific rows)** | **0 / 0** | filled by lookup |

Per-plant model membership: 1 plant in 0 models (Miracle fruit), 1 in 1 (Peanut butter, boundary), 129 in 2, 22 in 3, 6 in 4.

### Data quality issues to correct on import (log in `review_notes`)
- Typos in names (section 2). Trailing spaces ("Coconut ", "Pepper ", "Sandalwood ", "Mangosteen ").
- Header says "Models spacing (sqft)", but the values are ft L x W. Boundary is a single ft value.
- Mexican sunflower has tertiary category "Desi fruits" (likely wrong). Anjeer (Fig) has secondary "Biomass" and propagation "Seeded" (figs are normally cuttings or air layers; Woo says grafted).
- Monkey Jack's Kannada name duplicates jackfruit. "Baraba" is unclear (probably Biriba, Rollinia deliciosa).
- Melia dubia appears only as a scientific row with Miyawaki-only spacing, but it is mainly a commercial timber crop. Ask whether it needs commercial spacing.
- Compost "-" in mid-age columns (Karonda 7+, Neem and Pongamia 3-6 y): assume 0, confirm.
- Kagzi lemon is named "Lemon All season" with variety "Kagzi". Display name: "All Season Kagzi Lemon".

---

## 4. Name matching: client plants vs old Woo products

**Strategy (in `match.py` + curated `build.py`):**
1. Normalize: lowercase, expand parentheses, strip punctuation. Alias map: chikku/sapota, musambi/mosumbi, alphonoso/alphonso, mahagony/mahogany, tirthalli/thirthahalli, areca/arecanut, lakshmanphal/soursop, chakota/pomelo, honge/pongamia, bagwa/bhagwa, ana/anna, all spices/allspice, dragonfruit, kaju/cashew, longon/longan, variegated spellings. Drop stop tokens (plant, tree, grafted, sweet, japanese, australian, size tokens like "3ft").
2. Score = Jaccard(tokens) + 0.3 when all variety tokens are present - 0.5 when the variety is missing + 0.2 x SequenceMatcher ratio. Auto-accept 0.55 or above.
3. **Hard gate:** the base species must match. This kills the false positives auto-matching produced: Coconut Dwarf -> "Malaysian dwarf Jackfruit", Lemon Seedless -> "Jamun seedless", Banana Red -> "Red Amla", Jamun grafted -> "Jamun seedless".
4. **Propagation tie-break:** pick the Woo row whose type matches the client propagation. For example, Amla (client Seeded) -> "Amla (Seeded)", not "Amla (Grafted)", and Abiu (Seeded) -> "Abiu (Seeded)".
5. **Size variants** (Mangosteen 1.5 ft / 6 ft, Rambutan N-18 3 ft / 8 ft): match the smaller one as the default variant, and add the larger as a second variant.
6. **Sibling ("variant") match** = same species, different cultivar. Used only for the price and spec defaults, flagged `woo_sibling`. Never for the description, images or SEO.
7. **Scientific rows 100-154: never matched to Woo, by rule** (client confirmed they are distinct products, and they are a different stock type: native seedlings for dense planting).
8. Curated overrides confirmed by hand:
   - Hog plum (Amatekai) = "Indian Olive (Amate)" (Spondias)
   - Vietnam super early Jackfruit = "Vietnam Jackfruit All season Grafted"
   - Mozaffarpur shahi Litchi = "Sweet Shahi Litchi"
   - Mexican Hass = "Hass Avocado Plant"
   - Rose apple = "Rose Water Apple"
   - Red sandal = "Red Sandalwood"
   - Ceylon Cinnamon = "Cinnamon"

**Result:** 65 exact, 15 sibling, 24 none, 55 scientific. Woo products left unmatched: 128 (they become drafts) + Agarwood (imported as published, since the client listed it).

| Row | Client plant | Sibling used | Price |
|---|---|---|---|
| 5 | Anjeer (Fig) | Diana Anjeer Fig | 350 |
| 10 | Ber (Bore hannu) | Apple Ber Plant | 140 |
| 21 | J-33 Jackfruit | Siddu jackfruit | 530 |
| 22 | Red honey Jackfruit | Mankale red Jackfruit | 490 |
| 25 | Jamun Grafted | Thai black Jamun | 280 |
| 28 | Seedless Lemon | Thai seedless lime | 310 |
| 35 | Sakkaregutli Mango | Totapuri Mango | 490 |
| 45, 46 | Karimunda / Paniyur Pepper | Pepper (Rooted) | 190 |
| 47 | Pomelo (Chakota) | Thai chakota/Pomelo | 420 |
| 72 | Macadamia Grafted | Australian Macadamia (seeded) | 770 (grafted likely higher, flag) |
| 88 | Nelyani gold Cardamom | Cardamom (Vijetha) | 225 |
| 92 | Bamboo | Bhima Bamboo | 250 |
| 94, 98 | Neem, Soapnut | Honge (Pongamia) | 225 |

Full per-row table: Appendix A.

---

## 5. Price calibration (web research, 2026-10-20)

The old shop's sale prices sit well above government and university nursery rates. A grafted sapling in a large bag sells at about **1.5 to 2.5x** the university price (mango Woo Rs 490 vs KAU large-bag hybrid Rs 300; sapota Rs 365 vs Rs 250; jack Rs 490-530 vs Rs 300; Tiptur tall coconut Rs 420 vs Rs 270). The Woo `offlineprice` (walk-in) is close to the university rates. Researched prices for unmatched rows are set at the old shop's level so the catalogue stays consistent.

| Reference | Price seen | Source |
|---|---|---|
| Mango graft, hybrid/rare, LPB >1 y / 2 y | Rs 300 / 800 | KAU 2025-26 list |
| Jack graft, all varieties, PB / >1 y | Rs 100 / 300 | KAU 2025-26 |
| J-33 jack graft, retail | Rs 300-380 | Veliyath Gardens, IndiaMART |
| Sapota graft LPB >1 y | Rs 250 | KAU 2025-26 |
| Coconut dwarf PB / hybrid PB / WCT 2 y | Rs 200 / 375 / 270 | KAU 2025-26 |
| Cashew graft 1 y large bag | Rs 150-250 (retail Rs 55-350) | KAU, IndiaMART |
| Pepper rooted cutting / bush pepper | Rs 12 / 150-300 | KAU 2025-26 |
| Cardamom sucker / Cinnamon layer MPB / Nutmeg graft | Rs 90-100 / 100 / 250-650 | KAU 2025-26 |
| TC banana G9 retail / bulk | Rs 89-175 / 20-40 | upjau.in, Dial4Trade |
| Red Lady papaya seedling | Rs 40 (KAU), retail Rs 12-79 | KAU, IndiaMART |
| Jaboticaba (1.5-3 ft) | Rs 1,029 | The Nursery Live |
| Velvet apple / Miracle fruit / Wood apple / Karonda | Rs 50-100 / 30-100 / 40 / 20-40 | KAU 2025-26 |
| Native trees (Bael, Neem, Cassia fistula, Santalum, Pterocarpus, Terminalia, Wrightia, Vitex...) | Rs 35-100 per plant | **UAS Bengaluru (GKVK) price list effective 01.04.2026** |
| Curry leaf / Lemongrass slip / Vetiver slip | Rs 25 / 5 / 5 | UAS Bengaluru 2026 |
| Teak stump / polypot | Rs 8-16 | MP Forest, KFRI |
| Mulberry cutting PB / MPB | Rs 25 / 100 | KAU 2025-26 |

Sources: [KAU 2025-26 price list](https://intranet.kau.in/sites/default/files/documents/price_list_seeds_and_planting_materials_2025-26_website.pdf), [UAS Bengaluru price list 01.04.2026](https://www.uasbangalore.edu.in/wp-content/uploads/2026/04/Updated-price-list-01.04.2026-1.pdf), [Veliyath J33](https://veliyathgarden.com/products/j33-jack-live-plants), [upjau G9 banana](https://upjau.in/banana-g9-plant-sapling/), [IndiaMART cashew](https://m.indiamart.com/impcat/cashew-plant.html), [Paudhewale jaboticaba](https://www.paudhewale.com/product/grimal-jabuticaba-fruit-plant-1-5-3-feet-height-the-nursery-live), [KFRI teak notice](https://kfri.res.in/noticeboard.asp?ID=2122), [MP Forest nurseries](https://mpforest.gov.in/mprvvn/Nurseries.html), [IndiaMART Miyawaki plants](https://m.indiamart.com/impcat/forestry-plants.html).

**Price bands (sale price per sapling, applied when there is no Woo match):**

| Band | Rs | Used for |
|---|---|---|
| Grafted / layered desi fruit (L/M) | 350-550 | Monkey Jack 350 |
| Grafted exotic fruit | 600-1,800 | (Woo covers most) |
| Seeded exotic, rare | 450-1,200 | Baraba 450, Velvet apple 450, Matoa 800, Jaboticaba 1,200 |
| Plantation | coconut 420-490, areca 225, papaya 60, TC banana 60 | Dwarf coconut 450, Pandrah papaya 60, Bananas 60 |
| Seeded desi fruit / wild | 120-150 | Ber 120 (Woo sibling 140 used), Karonda 120, Jamun seeded 150, Hebbalasu 150, Wood apple 150, Cashew 150 |
| Spices | 80-310 | Curry leaves 80 (Woo spices 190-310) |
| Timber seedlings | 225-310 | Woo level (Teak 310, Mahogany 250, Sandalwood 265) |
| **Native / Miyawaki sapling (rows 100-154)** | **60-150** | max(60, round5(UASB 2026 rate x 1.5)) where UASB lists the species, else L 90 / M 75 / S 60 |
| Biomass / support | 10-60 | Sesbania 45, Gliricidia 25, Moringa 60, Mulberry 40, Marigold 15, Mexican sunflower 15, Lemongrass 10/slip, Vetiver 10/slip |

Flag for the client:
- Woo pepper (Rs 190) is about 16x the KAU rooted-cutting price.
- Native Neem and Soapnut common rows (Rs 225, Woo level) vs native rows (Rs 60-150): confirm the two price tiers (larger bagged tree vs Miyawaki seedling).
- Bulk 0.72x is still above `offlineprice` for most items.

---

## 6. Gap-fill rules (implementation spec for the importer)

### 6.1 Price
```
if match == exact:        price = woo.sale;   compare_at = woo.regular; src = woo
elif match == sibling:    price = sibling.sale; compare_at = None;      src = woo_sibling
elif row in 100..154:     price = max(60, r5(uasb_rate*1.5)) or {L:90,M:75,S:60}[size]; src = researched_native
else:                     price = RESEARCHED[row]; src = researched
bulk_price = r5(price*0.72)   # r5: round to 5 if >=100 else round to 1
bulk_min_qty = {L:50, M:100, S:200}[size_class]
```
Never set `compare_at` without a real old price. Every non-woo price gets `needs_review`.

### 6.2 Logistics
`weight_kg`:
- L 3 / M 2 / S 1.
- 0.8 for rows 100-154.
- 0.2 for slips and cuttings priced under Rs 30.

`packing_fee`: S 5 / M 10 / L 15. These are the vehicle-meter inputs, all `placeholder`.

### 6.3 Tax
- Plants: tax class `plants_nil` (HSN 0602, 0%).
- Inputs: section 7.

### 6.4 Stock
- Seed: Woo stock, clamped to 0 or more, for exact matches.
- Then: the hasiru-ops sync overwrites it.
- No stock data: `availability = preorder`, `ready_in_days = 30` (placeholder).

### 6.5 Attributes
- Exposure: Woo, else derived.
- Water need: derived from drought tolerance.
- Mature height: Woo text parse, else canopy band.
- Bearing time, yield, harvest season, fruit size: Woo for exact matches only, never copied from siblings except bearing time (flag). Otherwise null.
- Timber rows: `timber_rotation_years` (researched).

### 6.6 Descriptions and FAQs
**Short description.** Woo cleaned. Otherwise a template:

> "{name_en} ({name_kn}) is a {canopy} {propagation} sapling suited to {temp_min}-{temp_max} C and {rain_min}-{rain_max} mm rainfall. Plant at {spacing} ft in a {models} layout."

**Long description.** Woo cleaned. Otherwise a Claude draft from the plant record, stored as `ai_draft` + `needs_review`. Copy rules apply: no em dashes, and no "phase"/"v1"/"v2".

**FAQ answers, split three ways:**

1. *Derivable, auto-answered from the record* (`derived`): what variety; height and package size; propagation; spacing; rainfall, temperature and exposure; compost by age; intercropping (from model membership + role).
2. *Drafted* (`ai_draft`, unpublished until approved): host plants, how to plant, maintenance, region choice, variety comparisons. These cover the 33 nursery questions and 36 customer general questions.
3. *Client-only* (blank until answered, hidden on site):
   - "Do you need permission to grow?" (sandalwood, red sanders, agarwood, teak: legal)
   - "Yield and how much money can we earn?" (no earnings claims; show yield range only)
   - "Age of mother plant"

**Display.** The per-plant FAQ shows only approved answers, as FAQPage JSON-LD on the product page.

### 6.7 Images
1. Import the Woo gallery from `images/wordpress uploads/` (470 files, all present). Use originals and skip `-NNNxNNN` WP thumbnails.
2. Run them through the sharp pipeline (AVIF + WebP, widths 320/640/960/1280, blur placeholder).
3. Rows without photos: collection placeholder art + `image_needed`. The admin "Data gaps" view lists them for a client photo shoot.

### 6.8 SEO
- Reuse the Woo title, description and focus keyword where present. Discard pattern strings like `%title% %sep%`.
- Otherwise generate from the pattern in section 2.
- Slugs are unique. Redirect map: old `hasiruagro.com/product/<woo-slug>` -> new URL (exact matches and published drafts). Take the old slugs from the old site's product sitemap if it is still reachable, else derive them WP-style from the Woo name.

---

## 7. Input products (HANDOFF sample, all `placeholder`, `needs_review`)

| SKU | Name | Pack | Price Rs | HSN | GST | Dosage hook |
|---|---|---|---|---|---|---|
| HAI-001 | Vermicompost | 25 kg | 450 | 3101 | 5% (packed + branded) | M 2 kg, X 1 kg, O 0.5 kg per plant |
| HAI-002 | Biochar | 10 kg | 600 | 3101 (or 4402, confirm) | 5% | M 1, X 0.5, O 0.25 kg |
| HAI-003 | Farm compost | 50 kg | 400 | 3101 | 5% | client `compost_kg.at_planting` per plant |
| HAI-004 | Neem cake | 25 kg | 900 | 2306 | 5% (confirm) | soil application |
| HAI-005 | Jeevamrutha liquid | 5 L | 250 | 3101 | 5% (confirm) | drench |
| HAI-006 | Neem oil bio-pesticide | 1 L | 350 | 3808 | 18% in handoff; reported cut after the Sept 2025 GST rationalisation, **CA to confirm** | spray |
| HAI-007 | Green-manure seed mix | 1 kg | 180 | 1209 | 0% | per acre / per 36x36 block |

Input record fields: the same core as plants, plus `pack_size`, `unit` (kg/L/g/packet), `pack_weight_kg`, `dosage_rules` [{basis: per_plant | per_acre | per_block, model?, role?, size_class?, qty, unit}], `recommended_with` (models/roles). Weight = pack weight. Packing fee 0 (handoff). Bulk not applicable by default.

**Compost calculator.** It uses the client's `compost_kg.at_planting` (5 / 3 / 2 / 1 / 0.5 kg), summed over the cart's plants, and recommends whole packs (round up). The yearly maintenance schedule (0-2 y, 3-6 y, 7+ y, twice a year) is shown as "next year you will need X kg". The vermicompost and biochar M/X/O dosages stay placeholders until the client gives real formulas.

---

## 8. Plant list tab mapping (29 priority plants)

These map to Plant data rows by base name. Plants with several varieties (Mango 9, Jackfruit 6, Apple 3...) set `is_priority` on all varieties. The tab's "Supplier = Yes" (13) sets `sourcing: supplier`. "Red sandar" = Red sandal, "White Sandalwood" = Sandalwood, "Areca" = Arecanut, "Agarwood" = Woo HA005 (extra row). Video flags (WhatsApp yes: White Sandalwood, Dragon fruit, Avocado, Jackfruit, Apple) mean videos exist, but the URLs are pending.

---

## 9. District geo data (644 districts) usage

**Shape.** One row per district:
- state, district
- taluk, hobli and village counts
- soil text
- total land (all "agri land" values are NA)
- rivers
- humidity min/max %
- temperature min/max C (annual average min/max, not extremes; Hassan 20-35)
- rain mm/yr (109 to 4,285)
- native crops (free text)

There are **no lat/lng, PIN codes, LGD codes or distances**.

**Coverage gaps:**
- 24 states. Missing: Delhi, J&K, Ladakh, Uttarakhand, Sikkim, Tripura, Nagaland, Puducherry and other UTs.
- Andhra Pradesh uses the 13 pre-2022 districts.
- Karnataka has 30 (Vijayanagara missing) and old or variant spellings: Mysore, Raicur, Kodugu, Karwar (= Uttara Kannada), Bijapur (= Vijayapura), Tumkur, Chikmagaluru, Chikballapur.

**Normalize.** Store a canonical name + `aliases[]` ("Ballari (Bellary)" -> Ballari + alias Bellary). Add Vijayanagara by copying Ballari's climate (flagged). Parse soil text into `soil_tags` via a keyword map: red, black, laterite, alluvial, sandy, loamy, clay, coastal, hill.

**Region record:**
```
{id, state, district, aliases[], lat, lng, distance_km_from_nursery, delivery_zone,
 climate:{temp_min, temp_max, humidity_min, humidity_max, rain_mm}, soil_text, soil_tags[],
 rivers[], native_crops[], counts:{taluks, hoblis, villages}, total_land, data_source}
```
`lat`/`lng` come from a one-time geocode of district headquarters at seed time (OSM/Nominatim), stored and admin-editable. `distance_km` = haversine x 1.3 road factor, overridden by the handoff mock distances (Mysuru 150, Tumakuru 70, Hassan 185, ...) and by admin edits.

**Uses:**
1. **Help Me Choose location.** Typeahead after 2 characters over district + aliases + state (+ "use my location" -> nearest centroid). Land size and purpose as in the prototype.
2. **Climate fit (rules engine decides, Claude only narrates).** For plant P in district D:
   - Temperature: OK if `D.temp_min >= P.temp.min - 2` and `D.temp_max <= P.temp.max + 2`. Hard fail if outside by more than 5.
   - Rain: OK if `rain_min <= D.rain <= rain_max x 1.2`. Below the minimum gives "needs irrigation" (softened for drought_tolerance high). Above the maximum gives a "drainage / waterlogging risk" note.
   - Humidity: range overlap (soft).
   - Soil: soft bonus only (plant soil data missing).
   - Native-crop boost: when the plant's base name or species appears in `D.native_crops` (coffee, pepper, coconut, areca, mango, banana, sapota...).
   - Output levels: `good` / `ok_with_irrigation` / `not_recommended`, plus reasons. Model plant lists are filtered by these levels.
3. **Delivery zones** (admin-editable, sample):
   - Bengaluru Urban + Bengaluru Rural (+ Ramanagara?): `bengaluru_weekly`.
   - Rest of Karnataka, Tamil Nadu, Kerala, Andhra Pradesh, Telangana, Goa: `outstation` (km x vehicle rate).
   - Other states: `enquiry` (WhatsApp quote, no checkout).
   - Pickup is always available.
4. **SEO.** Programmatic "Best plants to grow in {District}" pages. Each page shows unique data: climate numbers, rivers, native crops, and the top `good` plants with prices. Index the 30 Karnataka districts first. Other states stay `noindex` until there is enough unique content. Internal links go from each product page ("Grows well in: ...") and from the wizard results.
5. **Analytics and leads.** The wizard lead stores region_id. This matches hasiru-ops leads location fields (`0015_leads_location`, `0020_leads_geocode`).

---

## 10. Category mapping (client primary category -> store)

| Client primary | Count | Store collection / sub |
|---|---|---|
| Desi fruits | 43 | Fruiting Trees / Desi |
| Exotic fruits | 31 | Fruiting Trees / Exotic |
| Forest fruit | 11 | Fruiting Trees / Forest fruit (new sub-filter) |
| Forestry / Timber | 39 | Timber Trees |
| Spices | 9 | Other Plants / Spices |
| Plantation crop | 6 | Other Plants / Plantation |
| Medicinal, Native, Flowering | 10 | Other Plants / Native & medicinal (new) |
| Biomass, Pest repellent, Soil binder, Pioneers | 10 | Other Plants / Biomass & support (new) |

Secondary and tertiary values become tags (filters: Medicinal, Native, Flowering, Nitrogen fixer, Drought tolerant, Forest fruit, Timber value). The new sub-filters need client approval.

---

## 11. Questions for the client (to show in the admin "Data gaps" view)

1. **Prices**
   - Confirm all 24 researched prices and the 55 native sapling prices (Rs 60-150).
   - Confirm the 15 sibling-based prices.
   - Bulk 0.72x and the L 50 / M 100 / S 200 thresholds.
   - Two price tiers for Neem / Soapnut / Sandalwood (bagged tree vs native seedling)?
2. **The 128 Woo-only plants:** keep as draft, publish, or delete?
3. **Agarwood:** add to Plant data (climate, spacing, compost).
4. **Sizes and logistics:** bag size and dispatch height per propagation type, real weights, the size variants list.
5. **Model roles** M/X/O per plant per model, vermicompost and biochar formulas.
6. **Soil preference** per plant (not in the file).
7. **FAQ answers:** permission-to-grow and earnings questions are client-only.
8. **Data fixes:**
   - Kannada names: Egg fruit, Milk fruit, Monkey Jack.
   - "Baraba" identity.
   - Melia dubia commercial spacing.
   - Fig propagation.
   - Mexican sunflower category.
9. **GST:** biochar HSN, neem cake, bio-pesticide rate (CA).
10. **District list:** add Vijayanagara, update the AP districts, and decide which states are served.

---

## 12. Normalized product record (python-friendly JSON spec)

Types: `str`, `int`, `float`, `bool`, `null`, lists and dicts. Enums are listed inline. One record per sellable product (plants and inputs). `variants` always has at least 1 entry, and the first is the default. Prices are integer INR.

```json
{
  "id": "uuid",
  "sku": "str  # HAP-0001 plants | HAI-001 inputs",
  "legacy_sku": "str|null  # Woo SKU e.g. HA0011",
  "legacy_woo_id": "int|null",
  "ops_item_id": "uuid|null  # hasiru-ops items.id",
  "source_row": "int|null  # latest_products.xlsx Plant data sheet row",
  "status": "draft|active|archived",
  "kind": "plant|input",

  "name_en": "str",
  "base_name": "str",
  "variety": "str|null",
  "name_kn": "str|null",
  "scientific_name": "str|null",
  "search_aliases": ["str"],
  "slug": "str",

  "collection": "timber|fruiting|other|input",
  "subcategory": "str  # Desi|Exotic|Forest fruit|Timber|Spices|Plantation|Native & medicinal|Biomass & support|Compost|Vermicompost|Biochar|Seeds|Liquid fertiliser|Bio-pesticide",
  "tags": ["str"],
  "is_priority": "bool",
  "is_best_seller": "bool",
  "is_featured": "bool",
  "sourcing": "own|supplier|null",
  "has_video": {"whatsapp": "bool", "youtube": "bool"},

  "plant": {
    "size_class": "L|M|S",
    "canopy": "large_tree|medium_tree|small_tree|shrub|climber",
    "propagation": "seeded|grafted|air_layered|cuttings|suckers|tissue_culture|other",
    "nitrogen_fixer": "bool",
    "drought_tolerance": "low|moderate|high",
    "climate": {
      "temp_c": {"opt": "float", "min": "float", "max": "float"},
      "humidity_pct": {"opt": "float", "min": "float", "max": "float"},
      "rainfall_mm": {"min": "float", "max": "float"},
      "exposure": "full_sun|partial_shade|shade",
      "water_need": "low|medium|high",
      "soil_tags": ["str"]
    },
    "models": {
      "food_forest": {"spacing_ft": ["float", "float"], "role": "M|X|O|null"},
      "miyawaki":    {"spacing_ft": ["float", "float"], "role": "M|X|O|null"},
      "commercial":  {"spacing_ft": ["float", "float"], "role": "M|X|O|null"},
      "boundary":    {"spacing_ft": "float", "role": "M|X|O|null"}
    },
    "compost_kg": {"at_planting": "float|null", "y0_2": "float|null", "y3_6": "float|null", "y7_plus": "float|null", "applications_per_year": 2},
    "attributes": {
      "mature_height_ft": {"min": "float|null", "max": "float|null"},
      "bearing_years": "str|null",
      "timber_rotation_years": "str|null",
      "yield_per_tree": "str|null",
      "harvest_season": "str|null",
      "fruit_size": "str|null",
      "fruit_shape": "str|null",
      "intercropping": "str|null"
    }
  },

  "input": {
    "pack_size": "float",
    "unit": "kg|L|g|packet",
    "dosage_rules": [{"basis": "per_plant|per_acre|per_block", "model": "str|null", "role": "M|X|O|null", "size_class": "L|M|S|null", "qty": "float", "unit": "str"}],
    "recommended_with": ["str"]
  },

  "variants": [{
    "id": "uuid",
    "label": "str  # e.g. '1.5-2 ft, 8x10 in bag'",
    "height_at_dispatch_ft": "float|null",
    "bag_size": "str|null",
    "price": "int",
    "compare_at_price": "int|null  # only a real old price",
    "bulk_price": "int",
    "bulk_min_qty": "int",
    "offline_price": "int|null  # admin only",
    "cost_price": "int|null  # from ops",
    "weight_kg": "float",
    "packing_fee": "int",
    "stock_qty": "int",
    "availability": "in_stock|preorder|out_of_stock",
    "ready_in_days": "int|null",
    "low_stock_threshold": "int"
  }],

  "tax": {"hsn": "str", "gst_rate": "float", "tax_class": "plants_nil|inputs_5|inputs_18|seeds_nil"},

  "content": {
    "short_description": "str|null",
    "description_html": "str|null",
    "faqs": [{"q": "str", "a": "str|null", "source": "client|derived|ai_draft|woo", "status": "approved|draft|needs_client"}]
  },
  "media": {
    "images": [{"src": "str", "alt": "str", "w": "int", "h": "int", "role": "main|gallery|plant|fruit", "blur": "str"}],
    "videos": [{"url": "str", "kind": "youtube|whatsapp|other", "model": "str|null"}],
    "image_needed": "bool"
  },
  "seo": {
    "title": "str", "description": "str", "focus_keyword": "str|null",
    "noindex": "bool", "legacy_urls": ["str"],
    "google_product_category": "str", "identifier_exists": false
  },

  "provenance": {
    "identity": "client|woo|researched",
    "climate": "client|researched|derived",
    "models": "client|placeholder",
    "compost": "client|placeholder",
    "attributes": "woo|woo_sibling|derived|researched|ai_draft|null",
    "price": "woo|woo_sibling|researched|researched_native|placeholder",
    "stock": "ops|woo|placeholder",
    "content": "woo|derived|ai_draft|null",
    "images": "woo|client|placeholder",
    "seo": "woo|derived"
  },
  "needs_review": "bool",
  "review_notes": ["str"],
  "created_at": "iso8601", "updated_at": "iso8601"
}
```

Example (abridged):
```json
{"sku": "HAP-0027", "legacy_sku": "HA0011", "source_row": 30, "status": "active", "kind": "plant",
 "name_en": "Alphonso Mango", "base_name": "Mango", "variety": "Alphonso", "name_kn": "ಮಾವಿನಹಣ್ಣು",
 "scientific_name": "Mangifera indica", "search_aliases": ["Alphonoso Mango", "maavu", "hapus"],
 "slug": "alphonso-mango", "collection": "fruiting", "subcategory": "Desi", "tags": [],
 "plant": {"size_class": "L", "canopy": "large_tree", "propagation": "grafted", "nitrogen_fixer": false,
   "drought_tolerance": "moderate",
   "climate": {"temp_c": {"opt": 27, "min": 15, "max": 38}, "humidity_pct": {"opt": 60, "min": 30, "max": 85},
     "rainfall_mm": {"min": 500, "max": 2500}, "exposure": "full_sun", "water_need": "medium", "soil_tags": []},
   "models": {"food_forest": {"spacing_ft": [18, 18], "role": "M"}, "commercial": {"spacing_ft": [18, 18], "role": "M"},
     "miyawaki": null, "boundary": null},
   "compost_kg": {"at_planting": 5, "y0_2": 5, "y3_6": 8, "y7_plus": 10, "applications_per_year": 2}},
 "variants": [{"label": "Grafted sapling", "price": 490, "compare_at_price": 700, "bulk_price": 355, "bulk_min_qty": 50,
   "offline_price": 350, "weight_kg": 3, "packing_fee": 15, "stock_qty": 168, "availability": "in_stock"}],
 "tax": {"hsn": "0602", "gst_rate": 0, "tax_class": "plants_nil"},
 "provenance": {"identity": "client", "climate": "client", "models": "client", "price": "woo", "stock": "woo",
   "content": "woo", "images": "woo", "attributes": "woo", "seo": "woo", "compost": "client"},
 "needs_review": false}
```

---

## Appendix A: per-row match and price fill (159 client rows + Agarwood)

Models: FF food forest, MY Miyawaki, CO commercial, BD boundary. Thr = bulk_min_qty. Price is the sale price in Rs.

| Row | Display name | Scientific | Size | Collection / sub | Match | Woo ref | Price | Bulk | Thr | Source | Models |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | Amla | Phyllanthus emblica | L | fruiting / Desi | exact | HA0014 Amla (Seeded) | 490 | 355 | 50 | woo | FF,CO |
| 5 | Anjeer (Fig) | Ficus carica | L | fruiting / Desi | variant | HA0016 Diana Anjeer Fig Plants | 350 | 250 | 50 | woo_sibling | FF,CO |
| 6 | Anna Apple | Malus domestica | M | fruiting / Desi | exact | HA0018 Apple Ana | 390 | 280 | 100 | woo | FF,CO |
| 7 | Dorset Apple | Malus domestica | M | fruiting / Desi | exact | HA0021 Apple Dorset | 390 | 280 | 100 | woo | FF,CO |
| 8 | Hariman-99 Apple | Malus domestica | M | fruiting / Desi | exact | HA0022 Apple Hariman-99 | 420 | 300 | 100 | woo | FF,CO |
| 9 | Thirthahalli Arecanut | Areca catechu | M | other / Plantation | exact | HA0026 Areca Tirthalli | 225 | 160 | 100 | woo | FF,CO,BD |
| 10 | Ber (Bore hannu) | Ziziphus mauritiana | S | fruiting / Desi | variant | HA00191 Apple Ber Plant | 140 | 100 | 200 | woo_sibling | FF,MY,CO,BD |
| 11 | Cashewnut | Anacardium occidentale | L | fruiting / Desi | none |  | 150 | 110 | 50 | researched | FF,CO |
| 12 | Cricket ball Sapota (Chikku) | Manilkara zapota | L | fruiting / Desi | exact | HA0046 Chikku (Cricket ball) | 365 | 265 | 50 | woo | FF,CO |
| 13 | Kalapatti Sapota (Chikku) | Manilkara zapota | L | fruiting / Desi | exact | HA0047 Chikku (kalapatti) | 365 | 265 | 50 | woo | FF,CO |
| 14 | Dwarf Coconut | Cocos nucifera | L | other / Plantation | none |  | 450 | 325 | 50 | researched | FF,CO,BD |
| 15 | Tiptur Tall Coconut | Cocos nucifera | L | other / Plantation | exact | HA0053 Coconut Tiptur Tall | 420 | 300 | 50 | woo | FF,CO,BD |
| 16 | Custard Apple | Annona squamosa | M | fruiting / Desi | exact | HA0055 Custard apple | 280 | 200 | 100 | woo | FF,CO |
| 17 | Pink Guava | Psidium guajava | M | fruiting / Desi | exact | HA002 GuavaTaiwan Pink | 420 | 300 | 100 | woo | FF,CO |
| 18 | White Guava | Psidium guajava | M | fruiting / Desi | exact | HA00150 Guava Taiwan White | 225 | 160 | 100 | woo | FF,CO |
| 19 | Hog plum (Amatekai) | Spondias pinnata | S | fruiting / Desi | exact | HA0074 Indian Olive (Amate) | 490 | 355 | 200 | woo | FF,CO,BD |
| 20 | Gumless Jackfruit | Artocarpus heterophyllus | L | fruiting / Desi | exact | HA0070 Gumless Jackfruit | 530 | 380 | 50 | woo | FF,CO |
| 21 | J-33 Jackfruit | Artocarpus heterophyllus | L | fruiting / Desi | variant | HA00143 Siddu jackfruit | 530 | 380 | 50 | woo_sibling | FF,CO |
| 22 | Red honey Jackfruit | Artocarpus heterophyllus | L | fruiting / Desi | variant | HA0099 Mankale red Jackfruit | 490 | 355 | 50 | woo_sibling | FF,CO |
| 23 | Vietnam super early Jackfruit | Artocarpus heterophyllus | L | fruiting / Exotic | exact | HA00174 Vietnam Jackfruit All season Grafted | 365 | 265 | 50 | woo | FF,CO |
| 24 | Jamun (Jambu nerale) | Syzygium cumini | L | fruiting / Desi | none |  | 150 | 110 | 50 | researched | FF,CO,BD |
| 25 | Jamun Grafted | Syzygium cumini | L | fruiting / Desi | variant | HA00156 Thai black Jamun | 280 | 200 | 50 | woo_sibling | FF,CO |
| 26 | Karonda | Carissa carandas | S | fruiting / Desi | none |  | 120 | 86 | 200 | researched | FF,MY,CO,BD |
| 27 | All Season Kagzi Lemon | Citrus limon | M | fruiting / Desi | exact | HA0079 Lemon Tree - All Season Kagzi lemon | 310 | 225 | 100 | woo | FF,CO |
| 28 | Seedless Lemon | Citrus limon | M | fruiting / Desi | variant | HA00161 Thai seedless lime | 310 | 225 | 100 | woo_sibling | FF,CO |
| 29 | All Season Mango | Mangifera indica | L | fruiting / Desi | exact | HA008 All Season Mango | 490 | 355 | 50 | woo | FF,CO |
| 30 | Alphonso Mango | Mangifera indica | L | fruiting / Desi | exact | HA0011 Alphonoso Mango | 490 | 355 | 50 | woo | FF,CO |
| 31 | Badami Mango | Mangifera indica | L | fruiting / Desi | exact | HA0033 Badami Mango | 490 | 355 | 50 | woo | FF,CO |
| 32 | Dasheri Mango | Mangifera indica | L | fruiting / Desi | exact | HA0058 Dasheri Mango | 490 | 355 | 50 | woo | FF,CO |
| 33 | Mallika Mango | Mangifera indica | L | fruiting / Desi | exact | HA0095 Mallika Mango | 490 | 355 | 50 | woo | FF,CO |
| 34 | Raspuri Mango | Mangifera indica | L | fruiting / Desi | exact | HA00131 Raspuri Mango | 490 | 355 | 50 | woo | FF,CO |
| 35 | Sakkaregutli Mango | Mangifera indica | L | fruiting / Desi | variant | HA00166 Totapuri Mango | 490 | 355 | 50 | woo_sibling | FF,CO |
| 36 | Totapuri Mango | Mangifera indica | L | fruiting / Desi | exact | HA00166 Totapuri Mango | 490 | 355 | 50 | woo | FF,CO |
| 37 | Monkey Jack | Artocarpus lakoocha | L | fruiting / Desi | none |  | 350 | 250 | 50 | researched | FF,CO |
| 38 | Malta B-1 Mosumbi | Citrus limetta | M | fruiting / Desi | exact | HA0032 B-1 Musambi Malta | 350 | 250 | 100 | woo | FF,CO |
| 39 | Mozaffarpur shahi Litchi | Litchi chinensis | L | fruiting / Exotic | exact | HA00105 Sweet Shahi Litchi (Air layered) | 420 | 300 | 50 | woo | FF,CO |
| 40 | Nagpur Orange | Citrus reticulata | M | fruiting / Desi | exact | HA00106 Nagpur Orange | 350 | 250 | 100 | woo | FF,CO |
| 41 | Nutmeg grafted | Myristica fragrans | L | other / Spices | exact | HA00107 Nutmeg (Grafted) | 700 | 505 | 50 | woo | FF,CO |
| 42 | Nutmeg seeded | Myristica fragrans | L | other / Spices | exact | HA00108 Nutmeg (Seeded) | 280 | 200 | 50 | woo | FF,CO |
| 43 | Pandrah (No.15) Papaya | Carica papaya | S | other / Plantation | none |  | 60 | 43 | 200 | researched | FF,CO,BD |
| 44 | Peanut butter | Bunchosia argentea | S | fruiting / Exotic | exact | HA00113 Peanut butter | 700 | 505 | 200 | woo | BD |
| 45 | Karimunda Pepper | Piper nigrum | S | other / Spices | variant | HA00117 Pepper ( Rooted ) | 190 | 135 | 200 | woo_sibling | FF,CO |
| 46 | Paniyur Pepper | Piper nigrum | S | other / Spices | variant | HA00117 Pepper ( Rooted ) | 190 | 135 | 200 | woo_sibling | FF,CO |
| 47 | Pomelo (Chakota) | Citrus maxima | M | fruiting / Desi | variant | HA00157 Thai chakota/Pomelo | 420 | 300 | 100 | woo_sibling | FF,CO,BD |
| 48 | Super bhagwa Pomegranate | Punica granatum | M | fruiting / Desi | exact | HA00193 Super Bagwa Pomegranate | 175 | 125 | 100 | woo | FF,CO |
| 49 | Rose apple (Panneralu) | Syzygium jambos | L | fruiting / Desi | exact | HA00138 Rose Water Apple | 365 | 265 | 50 | woo | FF,CO,BD |
| 50 | Soursop (Lakshmanphal) | Annona muricata | M | fruiting / Desi | exact | HA0086 Lakshmanphal | 390 | 280 | 100 | woo | FF,CO,BD |
| 51 | Starfruit | Averrhoa carambola | S | fruiting / Desi | exact | HA00147 Starfruit | 350 | 250 | 200 | woo | FF,CO,BD |
| 52 | Sweet tamarind | Tamarindus indica | L | fruiting / Desi | exact | HA00163 Thai sweet tamarind | 310 | 225 | 50 | woo | FF,MY,CO,BD |
| 53 | Water Apple Red | Syzygium samarangense | M | fruiting / Desi | exact | HA00179 Water Apple Red | 310 | 225 | 100 | woo | FF,CO |
| 54 | Wild Jackfruit (Hebbalasu) | Artocarpus hirsutus | L | fruiting / Desi | none |  | 150 | 110 | 50 | researched | FF,MY,CO,BD |
| 55 | Wood apple | Limonia acidissima | M | fruiting / Desi | none |  | 150 | 110 | 100 | researched | FF,MY,CO,BD |
| 56 | Yelakki Banana | Musa spp. | S | other / Plantation | none |  | 60 | 43 | 200 | researched | FF,CO,BD |
| 57 | Robusta (Pachbaale) Banana | Musa spp. | S | other / Plantation | none |  | 60 | 43 | 200 | researched | FF,CO,BD |
| 58 | Red Banana | Musa spp. | S | fruiting / Desi | none |  | 60 | 43 | 200 | researched | FF,CO,BD |
| 59 | Abiu | Pouteria caimito | L | fruiting / Exotic | exact | HA003 Abiu (Seeded) | 1090 | 785 | 50 | woo | FF,CO |
| 60 | Achachiru | Garcinia humilis | M | fruiting / Exotic | exact | HA004 Achachiru | 1080 | 780 | 100 | woo | FF,CO |
| 61 | Coorg Avocado | Persea americana | L | fruiting / Exotic | exact | HA0027 Avocado coorg variety | 350 | 250 | 50 | woo | FF,CO |
| 62 | Mexican Hass Avocado | Persea americana | L | fruiting / Exotic | exact | HA0028 Hass Avocado Plant | 1120 | 805 | 50 | woo | FF,CO |
| 63 | Baraba | Rollinia deliciosa (Biriba)? | M | fruiting / Exotic | none |  | 450 | 325 | 100 | researched | FF,CO |
| 64 | Bread fruit | Artocarpus altilis | L | fruiting / Exotic | exact | HA0043 Bread fruit | 630 | 455 | 50 | woo | FF,MY,CO,BD |
| 65 | Jumbo red Dragonfruit | Selenicereus undatus | S | fruiting / Exotic | exact | HA0060 Sweet Red Dragonfruit Plants - Jumbo | 250 | 180 | 200 | woo | FF,CO,BD |
| 66 | Egg fruit | Pouteria campechiana | M | fruiting / Exotic | exact | HA0064 Egg fruit | 350 | 250 | 100 | woo | FF,CO |
| 67 | Japanese Red diamond Guava | Psidium guajava | M | fruiting / Exotic | exact | HA0076 Japanese Red diamond Guava | 560 | 405 | 100 | woo | FF,CO |
| 68 | Strawberry Guava | Psidium guajava | M | fruiting / Exotic | exact | HA00148 Strawberry guava | 630 | 455 | 100 | woo | FF,CO |
| 69 | Ice cream beans | Inga edulis | M | fruiting / Exotic | exact | HA00190 Ice cream beans | 1120 | 805 | 100 | woo | FF,CO |
| 70 | Jaboticaba Sabara | Plinia cauliflora | M | fruiting / Exotic | none |  | 1200 | 865 | 100 | researched | FF,CO |
| 71 | Longan | Dimocarpus longan | M | fruiting / Exotic | exact | HA0090 Longon | 1960 | 1410 | 100 | woo | FF,CO |
| 72 | Macadamia Nuts Grafted | Macadamia integrifolia | L | fruiting / Exotic | variant | HA0091 Australian Macadamia Nut plant | 770 | 555 | 50 | woo_sibling | FF,CO |
| 73 | Macadamia Nuts Seeded | Macadamia integrifolia | L | fruiting / Exotic | exact | HA0091 Australian Macadamia Nut plant | 770 | 555 | 50 | woo | FF,CO |
| 74 | Variegated Mango | Mangifera indica | L | fruiting / Exotic | exact | HA00170 Variegated Mango | 740 | 535 | 50 | woo | FF,CO |
| 75 | Mangosteen | Garcinia mangostana | M | fruiting / Exotic | exact | HA0097 Mangosteen (1.5ft) | 630 | 455 | 100 | woo | FF,CO |
| 76 | Matoa | Pometia pinnata | M | fruiting / Exotic | none |  | 800 | 575 | 100 | researched | FF,CO |
| 77 | Milk fruit/ star apple | Chrysophyllum cainito | M | fruiting / Exotic | exact | HA00102 Milk fruit | 1175 | 845 | 100 | woo | FF,CO |
| 78 | Miracle fruit | Synsepalum dulcificum | S | fruiting / Exotic | exact | HA00103 Miracle fruit | 1765 | 1270 | 200 | woo | - |
| 79 | Miyazaki Mango | Mangifera indica | L | fruiting / Exotic | exact | HA00104 Japanese Miyazaki Mango Plant Grafted | 1120 | 805 | 50 | woo | FF,CO |
| 80 | Olive | Olea europaea | M | fruiting / Exotic | exact | HA00109 Olive | 630 | 455 | 100 | woo | FF,CO |
| 81 | Passion fruit | Passiflora edulis | S | fruiting / Exotic | exact | HA00110 Passion fruit | 310 | 225 | 200 | woo | FF,CO |
| 82 | Rain forest plum | Eugenia candolleana | M | fruiting / Exotic | exact | HA00199 Rain forest Plum | 1960 | 1410 | 100 | woo | FF,CO |
| 83 | N-18 Rambutan | Nephelium lappaceum | L | fruiting / Exotic | exact | HA00127 Rambutan N-18 (3ft) | 770 | 555 | 50 | woo | FF,CO |
| 84 | Schoolboy Rambutan | Nephelium lappaceum | L | fruiting / Exotic | exact | HA00130 Rambutan Schoolboy | 770 | 555 | 50 | woo | FF,CO |
| 85 | Salak | Salacca zalacca | M | fruiting / Exotic | exact | HA00198 Salak | 1820 | 1310 | 100 | woo | FF,CO |
| 86 | Velvet apple | Diospyros blancoi | M | fruiting / Exotic | none |  | 450 | 325 | 100 | researched | FF,CO |
| 87 | All spice | Pimenta dioica | S | other / Spices | exact | HA009 All spices | 310 | 225 | 200 | woo | FF,CO |
| 88 | Nelyani gold Cardamom | Elettaria cardamomum | S | other / Spices | variant | HA0045 Cardamom(Vijetha) | 225 | 160 | 200 | woo_sibling | FF,CO |
| 89 | Ceylon Cinnamon | Cinnamomum verum | M | other / Spices | exact | HA0049 Cinnamon | 225 | 160 | 100 | woo | FF,CO |
| 90 | Clove | Syzygium aromaticum | M | other / Spices | exact | HA0050 Clove | 225 | 160 | 100 | woo | FF,CO |
| 91 | Curry leaves | Murraya koenigii | M | other / Spices | none |  | 80 | 58 | 100 | researched | FF,CO |
| 92 | Bamboo | Bambusa spp. | L | timber / Timber | variant | HA0038 Bhima Bamboo | 250 | 180 | 50 | woo_sibling | CO,BD |
| 93 | Mahogany | Swietenia macrophylla | L | timber / Timber | exact | HA0092 Mahagony | 250 | 180 | 50 | woo | MY,CO,BD |
| 94 | Neem | Azadirachta indica | L | other / Native & medicinal | variant | HA0073 Honge(Pongamia pinnata) | 225 | 160 | 50 | woo_sibling | MY,CO,BD |
| 95 | Pongamia (Honge) | Pongamia pinnata | L | other / Native & medicinal | exact | HA0073 Honge(Pongamia pinnata) | 225 | 160 | 50 | woo | MY,CO,BD |
| 96 | Red sandal | Pterocarpus santalinus | M | timber / Timber | exact | HA00137 Red Sandalwood | 265 | 190 | 100 | woo | MY,CO,BD |
| 97 | Sandalwood | Santalum album | M | timber / Timber | exact | HA00181 Sandalwood (Chandan) | 265 | 190 | 100 | woo | MY,CO,BD |
| 98 | Soapnut (Antwala) | Sapindus spp. | M | other / Native & medicinal | variant | HA0073 Honge(Pongamia pinnata) | 225 | 160 | 100 | woo_sibling | MY,CO,BD |
| 99 | Teak | Tectona grandis | M | timber / Timber | exact | HA00152 Teak | 310 | 225 | 100 | woo | MY,CO,BD |
| 100 | Baobab | Adansonia digitata L. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 101 | Bael | Aegle marmelos (L.) Corrêa | M | timber / Timber | scientific |  | 150 | 110 | 100 | researched_native | MY,BD |
| 102 | Ankola (Sage-leaved Alangium) | Alangium salviifolium (L.f.) Wangerin | M | timber / Timber | scientific |  | 60 | 43 | 100 | researched_native | MY,BD |
| 103 | Bitter Albizia (Chigare) | Albizia amara (Roxb.) Boivin | L | other / Biomass & support | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 104 | Siris Tree | Albizia lebbeck (L.) Benth. | L | other / Biomass & support | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 105 | Bidi Leaf Tree (Apta) | Bauhinia racemosa Lam. | M | other / Native & medicinal | scientific |  | 90 | 65 | 100 | researched_native | MY,BD |
| 106 | Red Silk Cotton | Bombax ceiba L. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 107 | Flame of the Forest (Palash) | Butea monosperma (Lam.) Kuntze | M | timber / Timber | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 108 | Palash Creeper | Butea superba Roxb. ex Willd. | M | timber / Timber | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 109 | Rudravanti | Capparis moonii Wight | S | timber / Timber | scientific |  | 60 | 43 | 200 | researched_native | MY,BD |
| 110 | Kumbhi (Wild Guava) | Careya arborea Roxb. | L | fruiting / Forest fruit | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 111 | Karonda Hedge | Carissa carandas L. | S | timber / Timber | scientific |  | 60 | 43 | 200 | researched_native | MY,BD |
| 112 | Indian Laburnum (Golden Shower) | Cassia fistula L. | L | other / Native & medicinal | scientific |  | 75 | 54 | 50 | researched_native | MY,BD |
| 113 | East Indian Satinwood | Chloroxylon swietenia DC. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 114 | Yellow Silk Cotton | Cochlospermum religiosum (L.) Alston | M | timber / Timber | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 115 | Indian Cherry (Lasora) | Cordia dichotoma G.Forst. | M | timber / Timber | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 116 | Indian Rosewood (Beete) | Dalbergia latifolia Roxb. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 117 | Shisham | Dalbergia sissoo Roxb. ex DC. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 118 | Male Bamboo | Dendrocalamus strictus (Roxb.) Nees | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 119 | Tendu (Coromandel Ebony) | Diospyros melanoxylon Roxb. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 120 | Mountain Persimmon | Diospyros montana Roxb. | M | timber / Timber | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 121 | Hopbush | Dodonaea viscosa Jacq. | S | timber / Timber | scientific |  | 60 | 43 | 200 | researched_native | MY,BD |
| 122 | Medshingi | Dolichandrone falcata (Wall. ex DC.) Seem. | M | timber / Timber | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 123 | Khanduchi (Ehretia) | Ehretia aspera Willd. | M | fruiting / Forest fruit | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 124 | Governor's Plum | Flacourtia indica (Burm.f.) Merr. | S | fruiting / Forest fruit | scientific |  | 60 | 43 | 200 | researched_native | MY,BD |
| 125 | Anjan Tree | Hardwickia binata Roxb. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 126 | Indian Screw Tree | Helicteres isora L. | S | other / Native & medicinal | scientific |  | 60 | 43 | 200 | researched_native | MY,BD |
| 127 | Waras | Heterophragma quadriloculare (Roxb.) K.Schum. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 128 | Kurchi (Kodasige) | Holarrhena pubescens Wall. ex G.Don | M | other / Native & medicinal | scientific |  | 90 | 65 | 100 | researched_native | MY,BD |
| 129 | Indian Elm | Holoptelea integrifolia (Roxb.) Planch. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 130 | Kydia (Bende) | Kydia calycina Roxb. | M | timber / Timber | scientific |  | 90 | 65 | 100 | researched_native | MY,BD |
| 131 | Lendia | Lagerstroemia parviflora Roxb. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 132 | Indian Ash Tree (Jhingan) | Lannea coromandelica (Houtt.) Merr. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 133 | Henna | Lawsonia inermis L. | S | other / Native & medicinal | scientific |  | 60 | 43 | 200 | researched_native | MY,BD |
| 134 | Mahua (Ippe) | Madhuca longifolia var. latifolia (Roxb.) A.Chev. | L | fruiting / Forest fruit | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 135 | Melia Dubia (Malabar Neem) | Melia dubia Cav. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 136 | Native Amla | Phyllanthus emblica L. | M | fruiting / Forest fruit | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 137 | Manila Tamarind (Jungle Jalebi) | Pithecellobium dulce (Roxb.) Benth. | L | fruiting / Forest fruit | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 138 | Khejri (Banni) | Prosopis cineraria (L.) Druce | M | other / Biomass & support | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 139 | Indian Kino (Honne) | Pterocarpus marsupium Roxb. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 140 | Native Red Sanders | Pterocarpus santalinus L.f. | M | timber / Timber | scientific |  | 90 | 65 | 100 | researched_native | MY,BD |
| 141 | Native Sandalwood | Santalum album L. | M | timber / Timber | scientific |  | 90 | 65 | 100 | researched_native | MY,BD |
| 142 | Native Soapnut | Sapindus emarginatus Vahl | M | fruiting / Forest fruit | scientific |  | 90 | 65 | 100 | researched_native | MY,BD |
| 143 | Kusum (Sagade) | Schleichera oleosa (Lour.) Oken | L | fruiting / Forest fruit | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 144 | Khair (Kaggali) | Senegalia catechu (L.f.) P.J.H.Hurter & Mabb. | M | timber / Timber | scientific |  | 60 | 43 | 100 | researched_native | MY,BD |
| 145 | Wild Almond (Pinari) | Sterculia foetida L. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 146 | Karaya Gum Tree | Sterculia urens Roxb. | L | timber / Timber | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 147 | Native Jamun | Syzygium cumini (L.) Skeels | L | fruiting / Forest fruit | scientific |  | 90 | 65 | 50 | researched_native | MY,BD |
| 148 | Tamarind | Tamarindus indica L. | L | timber / Timber | scientific |  | 120 | 86 | 50 | researched_native | MY,BD |
| 149 | Rohida (Desert Teak) | Tecomella undulata (Sm.) Seem. | S | other / Native & medicinal | scientific |  | 60 | 43 | 200 | researched_native | MY,BD |
| 150 | Bahera (Tare) | Terminalia bellirica (Gaertn.) Roxb. | L | fruiting / Forest fruit | scientific |  | 120 | 86 | 50 | researched_native | MY,BD |
| 151 | Nirgundi (Lakki) | Vitex negundo var. negundo | S | other / Native & medicinal | scientific |  | 60 | 43 | 200 | researched_native | MY,BD |
| 152 | Woolly Dyeing Rosebay | Wrightia arborea (Dennst.) Mabb. | M | timber / Timber | scientific |  | 120 | 86 | 100 | researched_native | MY,BD |
| 153 | Pala Indigo (Beppale) | Wrightia tinctoria (Roxb.) R.Br. | M | timber / Timber | scientific |  | 120 | 86 | 100 | researched_native | MY,BD |
| 154 | Native Ber (Indian Jujube) | Ziziphus mauritiana Lam. | M | fruiting / Forest fruit | scientific |  | 75 | 54 | 100 | researched_native | MY,BD |
| 155 | Sesbania | Sesbania grandiflora | M | other / Biomass & support | none |  | 45 | 32 | 100 | researched | MY,BD |
| 156 | Gliricidia | Gliricidia sepium | M | other / Biomass & support | none |  | 25 | 18 | 100 | researched | MY,BD |
| 157 | Moringa | Moringa oleifera | M | fruiting / Desi | none |  | 60 | 43 | 100 | researched | MY,CO,BD |
| 158 | Lemongrass | Cymbopogon flexuosus | S | other / Biomass & support | none |  | 10 | 7 | 200 | researched | MY,BD |
| 159 | Vetiver Grass | Chrysopogon zizanioides | S | other / Biomass & support | none |  | 10 | 7 | 200 | researched | MY,BD |
| 160 | Marigold | Tagetes erecta | S | other / Biomass & support | none |  | 15 | 11 | 200 | researched | MY,BD |
| 161 | Mexican sunflower | Tithonia diversifolia | S | other / Biomass & support | none |  | 15 | 11 | 200 | researched | MY,BD |
| 162 | Mulberry | Morus alba | S | other / Biomass & support | none |  | 40 | 29 | 200 | researched | MY,BD |
| extra | Agarwood | Aquilaria malaccensis | L | timber / Timber | exact (not in Plant data) | HA005 Agarwood | 280 | 200 | 50 | woo | - (client to give spacing) |
