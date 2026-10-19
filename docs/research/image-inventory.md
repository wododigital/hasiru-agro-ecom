# Image inventory and plant-to-image mapping

Generated 2026-10-20 by `_work/scripts/map_images.py` (rerun: `python3 _work/scripts/map_images.py`, about 4 s). Machine output: `_work/image-map.json`.

## 1. Headline numbers

| | Count |
|---|---|
| Plants in `latest_products.xlsx` > Plant data (master list) | 159 rows (about 150 distinct species, the sheet repeats some under botanical names) |
| Plants mapped to a backup image | **88** (69 high, 8 medium, 11 low confidence) |
| Plants with **no image anywhere in the backup** | **71** (about 68 distinct species) |
| Distinct backup files used by the map (primary + gallery) | 194 files, 15.1 MB, 155 jpg + 39 webp |
| Distinct primary images | 76 (some rows share a species photo) |
| Current static-site images (`images/*`) | 66 files, 9.9 MB (58 webp, 6 png, 1 jpg) |

## 2. How the map was built

1. **Index originals.** Walks `wordpress uploads/{2020..2026, hasiruimages}` only. Skipped as derivative or junk: `al_opt_content` (optimiser copies), `elementor`, `template-kits`, `s1` (a 165-frame image sequence), `smush`, `wc-logs`, plugin dirs, css/fonts/php. Files are grouped by stem with `-WxH`, `-scaled`, `-rotated`, `-e<timestamp>` and `.jpg.webp` stripped, and the largest-pixel file in each group (non-webp on a tie) is kept as the original. Backup totals: 1,610 originals (134 MB) vs 11,339 thumbnails (354 MB).
2. **CSV gallery first.** Each Plant data row is matched to the old WooCommerce export (`git show HEAD:wc-product-export-16-10-2026-*.csv`, 194 products, `Images` column = 1 to 4 URLs; `catalog.json` `img` is the first of these). URLs are rewritten from `/wp-content/uploads/...` to the backup path and resolved to the original.
   - Matching uses token sets with a synonym table (chickoo/sapota to chikku, alphonoso to alphonso, mosumbi/musambi, longon/longan, haas/hass, verigated/variegated, lakshmanphal/soursop, amate/hog plum/indian olive, honge/pongamia, etc.), CamelCase splitting (`GuavaTaiwan Pink`), and per-row aliases. Botanical-name rows use common-name aliases (Santalum album = sandalwood, Syzygium cumini = jamun, etc.).
   - Variety match (sheet `Variety` column + qualifiers in the name such as "Nutmeg seeded" or "Jamun gratfed") is required for **high**. If only the species matches, the photo is of a *different cultivar* and is marked **low**. Colour and form words (red, white, dwarf, grafted...) do not count as a variety match.
3. **Filename fuzzy fallback** over all originals with the same token logic. In practice it added nothing new: every plant it could find was already in the CSV. A `find` for papaya, neem, moringa, curry, mulberry, karonda, wood apple, banana (other than banana sapota, which is a chikku), and the others came back empty, so the 71 missing really are missing.
4. **Image role** (pixel-based, because filenames are inconsistent: 2024 `-plant-` files show fruit):
   - `plant_with_fruit`: an in-situ photo, less than 30% white. **Used as primary** (84 of 88 rows). It matches the prototype cards.
   - `fruit`: produce cut out on white (fruit, nuts, also teak log and mahogany planks).
   - `sapling`: a potted sapling on white, which is what the buyer receives. 46 plants have one. Recommend it as **gallery image 2, labelled "As delivered"**.
   - Known mislabels, 4 images, cosmetic only: bamboo circle crops, Honge seeds and ice-cream-bean pods are tagged `sapling`.
5. Visual QA: all 88 primaries and their sapling shots were checked on contact sheets. No wrong-species primaries remain. Banana rows were mapped to "banana sapota" (a chikku cultivar) at first; that is fixed, and bananas are now in the missing list.

### image-map.json schema
```
{ "plants": { "<plant_key>": {
    "name", "variety", "sku_match" (old HA### SKU), "csv_name",
    "primary": "images/wordpress uploads/2023/08/....jpg" | null,
    "gallery": [ {path, role, w, h, kb, fmt, third_party_brand} ],   // primary first
    "match_method": "csv_gallery" | "filename_fuzzy" | null,
    "match_level": "variety" | "variety_partial" | "species",
    "confidence": "high" | "medium" | "low" | "none",
    "search": {common, scientific, kannada} } },
  "missing": [plant_key, ...] }
```
`plant_key` = slug of `Plant name + Variety` (for example `mango-alphonoso`, `sapota-chikku-cricket-ball`, `santalum-album-l`). The seeder should join on this key or on (name, variety).

## 3. Mapped but weak (use for now, flag in admin as "replace photo")

| plant_key | Confidence | Mapped from (old product, match level) | Issue |
|---|---|---|---|
| `coconut-dwarf` | low | Coconut Channarayapatna (species) | the photo is a tall palm |
| `jackfruit-j-33` | low | Byrachandra Jackfruit (species) | other cultivar |
| `jackfruit-red-honey` | low | Byrachandra Jackfruit (species) | other cultivar |
| `jamun-gratfed` | low | Bhadoli Jamun (species) | fine visually |
| `lemon-seedless` | low | Balaji Lemon (species) | other cultivar |
| `mango-sakkaregutli` | low | Alphonso Mango (species) | other cultivar |
| `pepper-karimunda`, `pepper-paniyur` | low | Pepper (Grafted) (species) | vines look alike, acceptable |
| `cardamom-nelyani-gold` | low | Cardamom (Vijetha) (species) | acceptable |
| `cinnamon-celyon` | low | Cinnamon (species) | acceptable |
| `dendrocalamus-strictus-roxb-nees` | low | Bhima Bamboo | different bamboo species |
| `ber-bore-hannu`, `ziziphus-mauritiana-lam` | medium | Apple Ber | same species, grafted cultivar |
| `jackfruit-vietnam-super-early` | medium | Vietnam Jackfruit All season | file is literally "Vietnam-super-early", effectively correct |
| `macadamia-nuts-grafted/-seeded` | medium | Australian Macadamia | same species |
| `phyllanthus-emblica-l`, `syzygium-cumini-l-skeels`, `tamarindus-indica-l` | medium | Amla (Grafted), Bhadoli Jamun, Thai sweet tamarind | wild species row shown with a cultivar photo |

Botanical-name duplicates that reuse the common row's images: `santalum-album-l` (Sandalwood), `pterocarpus-santalinus-l-f` (Red sandal), `dalbergia-latifolia-roxb` (old "Rose wood" product, sapling photo only).

## 4. Plants with NO image (71 rows), to source

Sourcing rule: real photos only. Use Magnific **stock** (`stock_search`/`stock_download`, not generation) or Wikimedia Commons with a CC-BY / CC-BY-SA / PD licence (store author, licence and source URL in the media table and render a credit on the PDP). Pexels, Unsplash and Coverr are blocked from this machine. Prefer an in-situ photo of the tree with fruit, flowers or foliage (it becomes the primary, which matches the rest of the catalogue). The client should later replace or add their own nursery "as delivered" sapling shots.

Expected availability: the fruit, spice and biomass rows (top 16 and bottom 8) are easy on stock. The 47 native forestry species (Miyawaki list) are thin on stock, so **plan on Wikimedia Commons** for them. They all have Commons categories under the botanical name.

| plant_key | Sheet name / variety | Search terms (Magnific stock or Wikimedia Commons) |
|---|---|---|
| `karonda` | Karonda | Karonda; Carissa carandas; Karonda sapling |
| `monkey-jack` | Monkey Jack | Monkey jack (Lakuchi); Artocarpus lacucha; Monkey jack sapling |
| `papaya-pandrah-no-15` | Papaya / Pandrah (No.15) | Papaya; Carica papaya; Papaya Pandrah (No.15); Papaya sapling |
| `rose-apple-panneralu` | Rose apple (Panneralu) | Rose apple; Syzygium jambos; Rose apple sapling |
| `jackfruit-hebbalasu-wild` | Jackfruit (Hebbalasu) / Wild | Wild jack (Hebbalasu); Artocarpus hirsutus; Wild jack (Hebbalasu) Wild; Wild jack sapling |
| `wood-apple` | Wood apple | Wood apple; Limonia acidissima; Wood apple sapling |
| `banana-yelakki` | Banana / Yelakki | Banana; Musa acuminata; Banana Yelakki; Banana sapling |
| `banana-robusta-pachbaale` | Banana / Robusta (Pachbaale) | Banana; Musa acuminata; Banana Robusta (Pachbaale); Banana sapling |
| `banana-red` | Banana / Red | Banana; Musa acuminata; Banana Red; Banana sapling |
| `baraba` | Baraba | Baraba fruit; Baraba fruit sapling |
| `jaboticaba-sabara` | Jaboticaba Sabara | Jabuticaba; Plinia cauliflora; Jabuticaba sapling |
| `matoa` | Matoa | Matoa; Pometia pinnata; Matoa sapling |
| `velvet-apple` | Velvet apple | Velvet apple (Mabolo); Diospyros blancoi; Velvet apple sapling |
| `curry-leaves` | Curry leaves | Curry leaf; Murraya koenigii; Curry leaf sapling |
| `neem` | Neem | Neem; Azadirachta indica; Neem sapling |
| `soapnut-antwala` | Soapnut (Antwala) | Soapnut; Sapindus emarginatus; Soapnut sapling |
| `adansonia-digitata-l` | Adansonia digitata L. | Baobab; Adansonia digitata; Baobab sapling |
| `aegle-marmelos-l-corr-a` | Aegle marmelos (L.) Corrêa | Bael (Bilva); Aegle marmelos; Bael sapling |
| `alangium-salviifolium-l-f-wangerin` | Alangium salviifolium (L.f.) Wangerin | Sage-leaved alangium (Ankole); Sage-leaved alangium sapling |
| `albizia-amara-roxb-boivin` | Albizia amara (Roxb.) Boivin | Krishna siris; Albizia amara; Krishna siris sapling |
| `albizia-lebbeck-l-benth` | Albizia lebbeck (L.) Benth. | Siris tree; Albizia lebbeck; Siris tree sapling |
| `bauhinia-racemosa-lam` | Bauhinia racemosa Lam. | Bidi leaf tree (Apta); Bauhinia racemosa; Bidi leaf tree sapling |
| `bombax-ceiba-l` | Bombax ceiba L. | Red silk cotton tree; Bombax ceiba; Red silk cotton tree sapling |
| `butea-monosperma-lam-kuntze` | Butea monosperma (Lam.) Kuntze | Flame of the forest (Palash); Butea monosperma; Flame of the forest sapling |
| `butea-superba-roxb-ex-willd` | Butea superba Roxb. ex Willd. | Climbing palash; Butea superba; Climbing palash sapling |
| `capparis-moonii-wight` | Capparis moonii Wight | Rudanti; Capparis moonii; Rudanti sapling |
| `careya-arborea-roxb` | Careya arborea Roxb. | Kumbhi (Wild guava); Careya arborea; Kumbhi sapling |
| `carissa-carandas-l-hedge` | Carissa carandas L. / hedge | Karonda (hedge); Carissa carandas; Karonda (hedge) hedge; Karonda sapling |
| `cassia-fistula-l` | Cassia fistula L. | Golden shower tree (Amaltas); Cassia fistula; Golden shower tree sapling |
| `chloroxylon-swietenia-dc` | Chloroxylon swietenia DC. | East Indian satinwood; Chloroxylon swietenia; East Indian satinwood sapling |
| `cochlospermum-religiosum-l-alston` | Cochlospermum religiosum (L.) Alston | Buttercup tree (Yellow silk cotton); Cochlospermum religiosum; Buttercup tree sapling |
| `cordia-dichotoma-g-forst` | Cordia dichotoma G.Forst. | Indian cherry (Lasora); Cordia dichotoma; Indian cherry sapling |
| `dalbergia-sissoo-roxb-ex-dc` | Dalbergia sissoo Roxb. ex DC. | Shisham; Dalbergia sissoo; Shisham sapling |
| `diospyros-melanoxylon-roxb` | Diospyros melanoxylon Roxb. | Tendu (Coromandel ebony); Diospyros melanoxylon; Tendu sapling |
| `diospyros-montana-roxb` | Diospyros montana Roxb. | Bombay ebony; Diospyros montana; Bombay ebony sapling |
| `dodonaea-viscosa-jacq-hedge` | Dodonaea viscosa Jacq. / hedge | Hopbush; Dodonaea viscosa; Hopbush hedge; Hopbush sapling |
| `dolichandrone-falcata-wall-ex-dc-seem` | Dolichandrone falcata (Wall. ex DC.) Seem. | Medshingi; Dolichandrone falcata; Medshingi sapling |
| `ehretia-aspera-willd` | Ehretia aspera Willd. | Ehretia; Ehretia sapling |
| `flacourtia-indica-burm-f-merr` | Flacourtia indica (Burm.f.) Merr. | Governor's plum; Flacourtia indica; Governor's plum sapling |
| `hardwickia-binata-roxb` | Hardwickia binata Roxb. | Anjan tree; Hardwickia binata; Anjan tree sapling |
| `helicteres-isora-l` | Helicteres isora L. | Indian screw tree; Helicteres isora; Indian screw tree sapling |
| `heterophragma-quadriloculare-roxb-k-schum` | Heterophragma quadriloculare (Roxb.) K.Schum. | Heterophragma; Heterophragma sapling |
| `holarrhena-pubescens-wall-ex-g-don` | Holarrhena pubescens Wall. ex G.Don | Kurchi (Bitter oleander); Holarrhena pubescens; Kurchi sapling |
| `holoptelea-integrifolia-roxb-planch` | Holoptelea integrifolia (Roxb.) Planch. | Indian elm; Holoptelea integrifolia; Indian elm sapling |
| `kydia-calycina-roxb` | Kydia calycina Roxb. | Kydia; Kydia sapling |
| `lagerstroemia-parviflora-roxb` | Lagerstroemia parviflora Roxb. | Small-flowered crape myrtle; Lagerstroemia parviflora; Small-flowered crape myrtle sapling |
| `lannea-coromandelica-houtt-merr` | Lannea coromandelica (Houtt.) Merr. | Indian ash tree (Jhingan); Lannea coromandelica; Indian ash tree sapling |
| `lawsonia-inermis-l` | Lawsonia inermis L. | Henna; Lawsonia inermis; Henna sapling |
| `madhuca-longifolia-var-latifolia-roxb-a-chev` | Madhuca longifolia var. latifolia (Roxb.) A.Chev. | Mahua (Ippe); Madhuca longifolia; Mahua sapling |
| `melia-dubia-cav` | Melia dubia Cav. | Malabar neem (Hebbevu); Melia dubia; Malabar neem sapling |
| `pithecellobium-dulce-roxb-benth` | Pithecellobium dulce (Roxb.) Benth. | Manila tamarind; Pithecellobium dulce; Manila tamarind sapling |
| `prosopis-cineraria-l-druce` | Prosopis cineraria (L.) Druce | Khejri (Banni); Prosopis cineraria; Khejri sapling |
| `pterocarpus-marsupium-roxb` | Pterocarpus marsupium Roxb. | Indian kino (Honne); Pterocarpus marsupium; Indian kino sapling |
| `sapindus-emarginatus-vahl` | Sapindus emarginatus Vahl | Soapnut; Sapindus emarginatus; Soapnut sapling |
| `schleichera-oleosa-lour-oken` | Schleichera oleosa (Lour.) Oken | Kusum tree; Schleichera oleosa; Kusum tree sapling |
| `senegalia-catechu-l-f-p-j-h-hurter-mabb` | Senegalia catechu (L.f.) P.J.H.Hurter & Mabb. | Khair (Cutch tree); Senegalia catechu; Khair sapling |
| `sterculia-foetida-l` | Sterculia foetida L. | Wild almond (Java olive); Sterculia foetida; Wild almond sapling |
| `sterculia-urens-roxb` | Sterculia urens Roxb. | Karaya gum tree; Sterculia urens; Karaya gum tree sapling |
| `tecomella-undulata-sm-seem` | Tecomella undulata (Sm.) Seem. | Rohida (Desert teak); Tecomella undulata; Rohida sapling |
| `terminalia-bellirica-gaertn-roxb` | Terminalia bellirica (Gaertn.) Roxb. | Bahera; Terminalia bellirica; Bahera sapling |
| `vitex-negundo-var-negundo` | Vitex negundo var. negundo | Nirgundi; Vitex negundo; Nirgundi sapling |
| `wrightia-arborea-dennst-mabb` | Wrightia arborea (Dennst.) Mabb. | Wrightia arborea; Wrightia arborea sapling |
| `wrightia-tinctoria-roxb-r-br` | Wrightia tinctoria (Roxb.) R.Br. | Pala indigo (Sweet indrajao); Wrightia tinctoria; Pala indigo sapling |
| `sesbania` | Sesbania | Sesbania (Agathi); Sesbania sapling |
| `gliricidia` | Gliricidia | Gliricidia; Gliricidia sapling |
| `moringa` | Moringa | Moringa (Drumstick); Moringa sapling |
| `lemongrass` | Lemongrass | Lemongrass; Cymbopogon citratus; Lemongrass sapling |
| `vetiever-grass` | Vetiever grass | Vetiver grass; Chrysopogon zizanioides; Vetiver grass sapling |
| `marigold` | Marigold | Marigold; Tagetes erecta; Marigold sapling |
| `mexican-sunflower` | Mexican sunflower | Mexican sunflower; Tithonia diversifolia; Mexican sunflower sapling |
| `mulberry` | Mulberry | Mulberry; Morus alba; Mulberry sapling |

Shared images for duplicates: `carissa-carandas-l-hedge` can use the `karonda` photo, `sapindus-emarginatus-vahl` can use the `soapnut-antwala` photo, and the 3 banana rows can share one banana photo (a variety-specific photo is optional). That leaves about 67 distinct photos to source.

## 5. The 66 current site images by storefront use

| Use | Files (prefix `images/`, all `*_hasiru_agro.*`) |
|---|---|
| **Brand / meta** | `logo_color` (274x114), `logo_white` (824x258), `favicon_hasiru_agro.webp` (512), `favicon_32px.png`, `apple_touch_icon.png` (180) |
| **Hero** | `hero_farm_transformation` (1962x1452, primary home hero), `dream_section_earthwork_sunrise` (1920x1920, CTA band), `nursery_saplings_shade_net` (1280x960, shop / nursery hero) |
| **Services (3 pillar cards)** | `service_plant_nursery_shop`, `service_farm_setup_design`, `service_farm_management_team` (900x900 each), `usp_farm_design_blueprint` (804x536) |
| **Trust badges / band** | `incubated_uasb_bionest` (2132x158 strip), `badge_startup_india.jpg` (480x360), `badge_msme.png` (150x112) |
| **Team** | `team_anirudh_cofounder` (1920x1280), `team_arjun_cofounder` (1240x1600), `team_shyam_cto` (400), `team_suhas_cmo` (400) |
| **Testimonials** | `reviewer_rajesh_m`, `reviewer_sornah_pandian`, `reviewer_yash_shah` (75x75 png avatars) |
| **Process (4-step)** | `process_site_assessment_field_survey`, `process_satellite_topographical_map`, `process_earthwork_aerial_swales_basin`, `process_planting_coconut_sapling`, `process_harvest_jackfruit_farmer` (all about 720x1000) |
| **Farm-design gallery** | `design_contour_water_flow_map`, `design_farm_blueprint_zonal_plan`, `design_farm_layout_terraces`, `design_mandala_garden_aerial`, `design_satellite_zone_layout` |
| **Site analysis** | `site_analysis_*` x6 (earthworms, erosion, GPS survey, soil testing, soil worms, team land review) |
| **Earthwork / water** | `earthwork_*` x6, `water_harvesting_pond_excavation` |
| **Planting / delivery** | `planting_saplings_truck_loading` (delivery / logistics section), `planting_sandalwood_saplings_nursery`, `planting_team_drip_line_execution`, `planting_heirloom_seed_varieties`, `mulching_sapling_with_organic_matter` (compost / inputs section) |
| **Pest management / inputs** | `pest_management_*` x5 (vermicompost bed and herbal brew suit the inputs / compost calculator section) |
| **Transformation (before/after, case studies)** | `transformation_*` x6 |
| **Harvest (lifestyle)** | `harvest_amla_gooseberry_hand`, `harvest_avocado_picking`, `harvest_guava_abundant_farmer`, `harvest_team_under_fruit_tree` |

Bonus for product galleries (real Hasiru field photos, more trustworthy than stock): `harvest_amla_*` goes on Amla, `harvest_avocado_*` on Avocado, `harvest_guava_*` on Guava, `process_harvest_jackfruit_*` on Jackfruit, `process_planting_coconut_*` on Coconut, `planting_sandalwood_saplings_nursery` on Sandalwood, and `transformation_papaya_*` x2 as interim **Papaya** photos (Papaya is otherwise missing).

## 6. Formats and sizes, for the sharp AVIF/WebP pipeline

**Product originals are small:** 187 of 194 are exactly **800x800** and 7 are 790x790. All are square, about 40 to 200 KB each, and most are stock-style photos. So:
- Never upscale. Generate widths **[160, 320, 480, 640, 800]**, square, AVIF (q about 50) + WebP (q about 75), with the original kept as the master. A card at 2x density needs at most 640 to 800. The PDP zoom tops out at 800, so use no zoom, or a 1.5x zoom.
- Some masters are webp already (39, mostly 2023/07, with filenames truncated by the old optimiser). sharp reads webp fine.
- Generate a blur placeholder (about 16 px base64 or a dominant colour) per image for card shimmer without layout shift. Always serve explicit width and height (1:1).

**Site images:** 9.9 MB in total. Most are 720 to 1280 px webp portraits, 50 to 470 KB. Largest: `mulching_sapling` 468 KB, `site_analysis_erosion_points` 456 KB, `dream_section` 408 KB, `hero_farm_transformation` 387 KB (1962x1452). Widths **[480, 768, 1024, 1440, 1920]**, capped at the source width. The hero should get `priority`/`fetchpriority=high`, AVIF at about 1440 for desktop and 768 for mobile. Tiny assets (favicons, 75 px avatars, logos, badges) can pass through, or be converted once to webp/svg. Avatars should be resized to 150 for 2x.

**What will actually be used (source bytes):** product masters 15.1 MB (194 files) + site 9.9 MB (66 files) = **about 25 MB, 260 masters**, plus about 67 new sourced photos (at about 1600 px, roughly 15 to 25 MB more). The 833 MB WordPress backup itself does not ship. Only the files referenced in `image-map.json` get imported into the media library.

## 7. Risks and notes for the planner

- **Licensing:** most old product photos look like commercial stock (white-background fruit cut-outs, in-situ fruit trees). They were used on the old WP shop, but we do not know where they came from or how they were licensed. Recommend that Shyam/client confirm, or plan replacements over time with the client's own nursery photos. The admin media library should have `source`, `licence`, `credit` fields from day one (these are also needed for the Wikimedia credit).
- `hasiruimages/` holds 330 "SaplingMart-...-Sapling-Wholesale" photos (800x800, potted sapling + fruit). SaplingMart is named in the client's FAQ sheet ("sapling mart varieties"). These were **not needed** (CSV galleries covered everything they would match). The script prefers non-SaplingMart files and flags them with `third_party_brand`. Do not use them without client confirmation (third-party brand name).
- Merchant Center / Meta catalog: primaries are clean photos with no text or watermarks, fine for feeds. Feed `image_link` should point to an 800 px JPEG/WebP rendition (Merchant Center does not take AVIF).
- No duplicate binary detection was done across rows. Rows that share a species photo (for example 3 Pepper and 2 Nutmeg rows) reuse the same master. The media table should de-duplicate by path or hash.
- Script self-check runs on every invocation (`_selftest()` asserts on thumb grouping, token synonyms and the CamelCase split).
