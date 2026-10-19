# Seed data contract (`data/seed/`)

Written in Wave 0 so the data pipeline (WP-13, WP-14) and the importers (catalog `importSeed()` and each module's `seedHooks`) can be built in parallel. Field-level detail for products is `docs/research/product-data.md` section 12 ("Normalized product record"); this file pins the decisions that section leaves open. Where they differ, this file wins.

## General rules

- UTF-8 JSON, 2-space indent, LF line endings, keys in the order of the spec, arrays sorted by their natural key (`sku`, `slug`, `from`) so a rebuild produces a byte-identical file (`pnpm seed:build` is deterministic and idempotent).
- Every JSON file is an object `{ "version": 1, "generated_at": "<ISO, IST offset>", "sources": ["<input file>", ...], "records": [...] }`. `generated_at` is the only field allowed to change between identical runs, and the build writes the file only when `records` changed.
- **Money in seed files is integer rupees** (`price`, `compare_at_price`, `bulk_price`, `offline_price`, `cost_price`, `packing_fee`), exactly as the research spec. Importers convert once with `core.money.paise()`; the database and all code use integer paise.
- No `id` columns in seed files. Importers upsert by natural key and generate UUIDv7 ids on insert: products by `sku`, variants by `variants[].sku`, models by `slug`, districts by `slug`, FAQs by `key`, redirects by `from`, media by `sha256`. A second `seed:load` changes zero rows (test).
- Text has no em dashes or en dashes (replaced by a comma, colon or "to"), no `\r\n`, no HTML outside `description_html` (which is sanitised again by `core.safeHtml()` on import).
- Provenance is mandatory: every product carries `provenance` and `needs_review` / `review_notes`; anything not from the client file or the old store is marked (`researched`, `derived`, `placeholder`, `ai_draft`). Nothing is presented as a review or testimonial unless it came from the client or the current site (A13).
- Inputs (`latest_products.xlsx`, `_work/*.json`, `images/`) are read only, from their absolute paths in the main tree, and never modified.

## Files

| File | Owner | Natural key | Record |
|---|---|---|---|
| `products.json` | WP-14 | `sku` | research section 12 record with `kind: "plant"` |
| `inputs.json` | WP-14 | `sku` | same record with `kind: "input"` and the `input` block (research section 7) |
| `models.json` | WP-14 | `slug` | planting model (below) |
| `faqs.json` | WP-14 | `key` | general and product FAQs (below) |
| `cms.json` | WP-14 | per collection | pages, blocks, menus, testimonials, team, trust claims (below) |
| `redirects.json` | WP-14 | `from` | legacy Woo URL map (below) |
| `districts.json` | WP-13 | `slug` | states and districts (below) |
| `pincodes.csv` | WP-13 | `pincode` | `pincode,office_name,district_slug,state_code` (header row; may be absent when the dataset is unreachable, then `places.pincode_lookup = false`) |
| `../media/media-manifest.json` | WP-13, WP-14 | `sha256` | image masters (below) |

## Product record decisions (on top of research section 12)

- `sku`: plants `HAP-0001`..., inputs `HAI-001`...; stable across runs (assigned from `source_row` order, Agarwood and legacy rows after).
- `variants[]` has at least one entry; each gets `sku` = product sku + `-01`, `-02`... in listed order; the first variant is the default.
- `status`: `active` for client plants with a price; `draft` for the 128 Woo-only legacy rows (`provenance.identity = "woo"`, `data_source = "woo_legacy"`, `seo.noindex = true`) (A18).
- `collection`: `timber | fruiting | other | input`; `subcategory` is the display label from research section 10; the importer derives the subcollection slug with `core.ids.slugify()`.
- `availability` is derived (`in_stock` when `stock_qty > 0`, else `preorder` with `ready_in_days`), and `stock_qty` seeds `inventory_level` with `source = "seed"` (A26).
- `tax.gst_rate` is a number (0, 5, 18); `tax.needs_ca_confirmation: true` is allowed on inputs.
- `plant.models.<model>.role` uses `M | X | O | null`; defaults per A12 when the client gave none, with `provenance.models = "placeholder"`.
- `content.description_html` drafts carry `content.status: "ai_draft"` and `needs_review: true` (template text, never published as approved copy).
- `media.images[].src` is a path relative to `data/media/masters/` (e.g. `products/alphonso-mango-1.webp`); `image_needed: true` when there is no real photo (A16, addendum 6).

## `models.json` record

```json
{
  "slug": "commercial",
  "name": "Commercial",
  "description": "str",
  "kind": "area | line",
  "block_ft": { "w": 36, "h": 36 },
  "spacing_ft": { "plant": 6, "row": 12 },
  "pattern": ["MOXOXOM"],
  "mix": null,
  "rng_seed": null,
  "weight_override_kg": null,
  "legend": { "M": "Main", "X": "Host", "O": "Biomass" },
  "members": [{ "sku": "HAP-0027", "role": "M", "sort": 1 }],
  "video": null,
  "sort": 1
}
```
`pattern` rows cycle per row and per column; Miyawaki uses `mix: { "M": 0.1, "X": 0.5, "O": 0.4 }` with `rng_seed: 42` and `weight_override_kg: 0.8`; Boundary is `kind: "line"` with `spacing_ft.row = 0`.

## `faqs.json` record

`{ "key": "general-001", "product_sku": null, "question": "str", "answer": "str|null", "source": "client|derived|ai_draft|woo", "status": "approved|draft|needs_client", "sort": 1 }`. Only `approved` FAQs render publicly and feed `FAQPage` JSON-LD.

## `cms.json`

`{ "version": 1, ..., "records": { "pages": [...], "menus": [...], "testimonials": [...], "team": [...], "trust_claims": [...], "counters": [...] } }`.
- page: `{ "slug", "title", "status": "draft|published", "noindex": bool, "blocks": [{ "type", "props": {...}, "sort" }], "seo": { "title", "description" } }`. Policy pages are `draft` + `noindex` with only the SRS sentences (plan section 9 step 10).
- testimonial: `{ "key", "author", "location", "body", "source": "current_site|client", "sort" }` (only real ones from the current site).
- trust claim: `{ "key", "label", "logo": "path|null", "visible": bool }` ("Rated 4.8" is `visible: false`).

## `redirects.json` record

`{ "from": "/product/<old-slug>", "to_sku": "HAP-0027" | null, "to_path": "/plants/fruiting-trees" | null, "code": 301, "status": "pending|active" }`. `pending` until the target product is published.

## `districts.json`

`{ "version": 1, ..., "records": { "states": [{ "code": "KA", "name": "Karnataka", "gst_state_code": "29" }], "districts": [district] } }`, district per research section 9 "Region record", with `slug`, `state_code`, `aliases[]`, `lat`/`lng` (from the bundled static table, no runtime API), `distance_km` (haversine x 1.3 unless overridden), `climate`, `soil_text`, `soil_tags[]`, `rivers[]`, `native_crops[]`, `page_enabled`, `data_source`, `review_notes[]`. Fit levels are computed at runtime (`good | ok | not_recommended`, where `ok` carries the "needs irrigation" reason).

## `media-manifest.json` record

`{ "file": "products/alphonso-mango-1.webp", "sha256": "hex", "source": "woo_import|site_import|stock|wikimedia|client", "licence": "str", "author": "str|null", "source_url": "str|null", "credit_required": bool, "plants": ["HAP-0027"], "role": "main|gallery|as_delivered|site" }`. No AI-generated images; SaplingMart-branded files are excluded.
