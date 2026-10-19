# Seed data pipeline (`pnpm seed:build`)

Turns the client's workbook, the old WooCommerce export and the image backup into the committed seed files that the module importers load (`pnpm seed:load`). Contract: `data/seed/SCHEMA.md` and `docs/research/product-data.md` section 12. Plan: BUILD-PLAN section 9.

Deterministic and idempotent: a rebuild writes a file only when its records change, so an unchanged run leaves every byte as it was. About 1 second.

## Inputs (read only)

| Input | Where |
|---|---|
| `latest_products.xlsx` (Plant data, Plant list, FAQs, General and Nursery questions) | gitignored, main tree only; a worktree finds it through `git rev-parse --git-common-dir` (override: `SEED_INPUT_ROOT`) |
| `images/` (WordPress backup + current site images) | same |
| `_work/products.json`, `_work/catalog.json`, `_work/image-map.json` | committed |
| `seed/data/research-rows.json` | research appendix A as data: display and scientific names, the reviewed match per row, researched and native-band prices |

## Steps (`run.ts`, in order)

| Step | Writes | What |
|---|---|---|
| `normalize-plants` | | 159 Plant data rows: typo fixes (originals kept as aliases), category map, size class, spacing parse, compost, climate, data-quality flags |
| `match-woo` | | species-gated token scoring against 193 Woo plants + 11 pinned hand decisions: 65 exact, 15 sibling, 24 none, 55 native (never matched) |
| `fill-gaps` | `data/seed/products.json`, `data/seed/match-review.csv` | price, bulk, logistics, tax, stock, attributes, template copy, images, SEO, provenance; Agarwood live; 125 Woo-only plants as noindex drafts |
| `inputs` | `data/seed/inputs.json` | 7 placeholder input products with dosage rules |
| `models` | `data/seed/models.json` | 4 planting models, members from the client spacing, A12 default roles |
| `districts`, `pincodes` | (WP-13) | |
| `media` | `data/media/masters/{products,site}/`, `data/media/media-manifest.json` | copies only the masters the records use (523 files, 44 MB), removes unused ones, keeps other steps' manifest records |
| `faqs` | `data/seed/faqs.json` | 36 general + per-plant questions; answers only where the data gives them |
| `cms-content` | `data/seed/cms.json` | pages, menus, testimonials, team, trust claims, counters; policy pages draft + noindex |
| `legacy-redirects` | `data/seed/redirects.json` | old product and category URLs |
| `client-questions` | `docs/CLIENT-QUESTIONS.md` | open questions from the `needs_review` flags |
| `self-check` | | re-reads the written files: row and match counts, prices, slugs, images and hashes, references, copy rules |

## Options

- `--dry-run`: runs every step, writes nothing (tested: files stay byte-identical).
- `SEED_OUT_ROOT=<dir>`: write `data/seed`, `data/media` and `docs` under another root (tests use a temp dir).

## Changing data

- A hand decision on a match: add it to `PINS` in `match-woo.ts` with the reason (a test fails on pins the scoring already agrees with).
- A researched price or a name: edit `seed/data/research-rows.json`.
- Every default is flagged in the record's `review_notes` and listed in `docs/CLIENT-QUESTIONS.md`; replace it in the client file or the admin, not here.

## Tests

`tooling/scripts/test/seed-rules.test.ts` (rules and matcher against the real inputs) and `seed-build.test.ts` (the real CLI into a temp tree: self-check, byte-identical rerun, read-only dry run, committed outputs current).
