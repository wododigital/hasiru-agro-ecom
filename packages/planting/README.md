# @ecomkit/planting

Planting models (Commercial, Food Forest, Miyawaki, Boundary or any the admin adds), per-model plant membership with main / host / biomass roles (M / X / O), the pattern engine (cycling rows, seeded random mix, boundary line), scaling to the land, the server-rendered SVG plan, the 3-step "Help me choose" wizard, blurred preview + unlock (`soft` or `otp`), the recommendations page, package to cart, "Grows well with" companions, model explainer pages and the curated `/plants/for/[model]` listing.

Hard dependencies: `core`, `ui`, `catalog`, `pricing`, `customers`, `places`. Optional (reached through `configurePlanting` ports or the registry, each degrades to "not shown"): `cart` (package button), `farm-calculators` (recommended inputs), `auth` (OTP unlock), `cms` (model videos), `planting-3d` ("View in 3D"), `seo` (metadata builder through catalog).

## Public API

| Export | What |
|---|---|
| `./domain` | Pure: zod schemas for every boundary (`generateInputSchema`, `unlockInputSchema`, `packageInputSchema`, `patternSchema`, `modelFieldsSchema`, `memberFieldsSchema`), `blockLayout`, `planLayout` (the core `PlanLayout` contract), `blocksFor`, `roleTotals`, `splitEvenly`, `estimateBoundaryFt`, `seededRandom`, `apportion`, `choosePicks`, `recommendModel`, `companionsOf`, `unitAt`, `whatsappShareUrl`, `SQFT_PER_ACRE` |
| `./server` | `configurePlanting(ports)`, `generatePlan`, `getPlan`, `planView`, `unlockPlan`, `addPackage`, `inputsFor`, `saveLandFromPlan`, `modelLayout(slug, { planId })` (3D viewer, assistant), `companionIds(productId)` (assistant facts), `loadModels`, `loadModel`, cached `activeModels` / `activeModel` / `modelPage`, admin writes `saveModel` / `saveMember` / `removeMember` (`products.write`, audited), `handleGenerate` / `handleUnlock`, `runPlantingSeed`, `plantingSettings` |
| `./ui` | `PlanDiagram` (server SVG), `PlanTooltipIsland`, `WizardIsland`, `UnlockIsland`, `ResultsIsland`, `Companions` (PDP section), `ROLE_FILL` / `ROLE_BG` |
| `./admin` | `ModelsPage`, `ModelEditPage`, form actions `saveModelForm`, `saveMemberForm`, `removeMemberForm` |
| `./messages` | `plantingMessages` (plain strings, safe to pass to islands) |

## Host wiring (WP-28, once at boot)

```ts
configurePlanting({
  registry,                                                     // has('planting-3d'), has('cart')
  cart: { replacePackage },                                     // cart: replace the 'planting' package
  inputs: { recommend },                                        // farm-calculators: input packs for plant lines
  otp: { send: sendOtp, verify: verifyOtp },                    // auth: only needed for unlock_mode = otp
  videos: async (slug) => (await videosFor({ modelSlug: slug })).map(({ id, title, url }) => ({ id, title, url })),
  productIdsBySku,                                              // seed: catalog product id per sku
  messages: en.planting,                                        // host copy overrides
});
```

Defaults when unbound: products from `catalog.listProducts` (visible products only) plus their main images, places from `@ecomkit/places/server`, pricing from `@ecomkit/pricing/server` (no prices if it is not configured), nitrogen fixers from the catalog `nitrogen-fixing` tag; no cart (button disabled with a call-us note), no inputs block, no videos, OTP mode answers `not_configured`.

## Tables

- `planting_model` (slug, name, name_kn, description_html, block 36 x 36 or 36 x 0 for lines, column and row spacing, `pattern` jsonb `{kind: rows|random|line}`, legend, `weight_override_kg`, position, is_active)
- `planting_model_plant` (model_id, product_id, role M|X|O, spacing_ft, position, is_default_pick), pk (model_id, product_id)
- `planting_plan` (visitor_id, customer_id, lead_id, district_slug + label snapshot, sqft, boundary_ft, boundary_estimated, purpose, inputs_included, unlock_mode, unlocked_at, `selections` per model, `climate_fit` per product)

No foreign keys into catalog, customers or places (other modules' tables).

## Rules (tested)

- Commercial block: `M O X O X O M` along 6 ft, rows 12 ft apart = 18 plants per 36 x 36 ft block; per-block counts are half-open `[0, 36)`, edge dots are drawn faint (they belong to the next block).
- Area models: blocks = sqft / 1296 (1 acre = 33.6); role total = round(perBlock x blocks), split evenly over the role's picks, remainder to the first.
- Boundary: round(boundary_ft / spacing) plants along one line, roles by cycling the pattern (835 ft / 10 ft = 84); empty boundary = 4 x sqrt(area), labelled estimated.
- Miyawaki: exact shares placed by a seeded shuffle; seed = plan id, so a plan's drawing is stable.
- Picks: fitting members only (`places.fit` is good or ok; unknown climate counts as ok), default picks first, then better fit, then position; `picks_per_role` per role; the rest are "more varieties".
- Locked plans send no quantities, prices or inputs to the browser.

## Routes

| Path | What |
|---|---|
| `/plan` | Wizard (static shell, client island; prefill `?district=&sqft=&purpose=`) |
| `/plan/results/[planId]` | Recommendations (request-time, noindex) |
| `/models/[model]` | Model explainer (static per active model) |
| `/plants/for/[model]` | Curated listing through catalog's `ListingPage` |
| `POST /api/plan/generate` | JSON or plain form (303 to the results); sets `plan_visitor` (httpOnly) and `district` cookies |
| `POST /api/plan/unlock` | `step: soft | send | verify`; JSON or plain form; forwards the auth session cookie on OTP verify |
| `/admin/planting`, `/admin/planting/[model]` | Models, pattern, spacing, legend, members and roles (`products.write`); `new` creates |

Same-origin check and an 8 KB body cap on both handlers; rate limits `plan-generate:<ipHash>` 30/h, `plan-unlock:<ipHash>` 20/h and `plan-unlock:<phoneHash>` 8/h.

## Settings (`/admin/settings/planting`)

`unlock_mode` (`soft` default, `otp`), `picks_per_role` (1 to 8, default 3), `build_for_me_path` (default `/build-farm-with-us`; the plan id, district and acres travel as query parameters).

## Events, extension points, jobs

Emits `plan.generated`, `plan.unlocked` (in the write transaction) and, through customers' `upsertLead`, `lead.created` (source `wizard`, `ref` = plan id). Consumes none; no jobs. `pdpSections`: `planting.companions` (slot `below`). `sitemapSources`: `models`. `seedHooks`: `planting` (creates missing models from `data/seed/models.json` with members and per-model spacing from `products.json`; existing models belong to the admin and are never touched).

## Disable

Remove `planting` from the app's `modules.config.ts` and run `modules:sync`. The catalog hides "Help me choose" (it checks `registry.has('planting')`), `planting-3d` and the assistant lose their layouts and companions.
