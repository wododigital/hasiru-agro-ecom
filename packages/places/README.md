# @ecomkit/places

Districts, aliases, pincodes, typeahead, climate-fit rules and the public district pages. Brand-neutral: nothing here names a store. Depends on `core` and `ui`; `catalog` is optional (it supplies the plants for district pages).

## Public API

| Entry | What |
|---|---|
| `@ecomkit/places/domain` | Pure TS. `computeFit`, `rankFits`, `meetsPageRule`, `FIT_RULES`; `suggestDistricts`, `buildIndex`, `fold`; `haversineKm`, `roadDistanceKm`, `nearest`; `canonicalDistrict`, `assignSlugs`, `soilTags`, `parseList`; `buildDistrictMatcher` (pincode import); zod schemas for `districts.json` and `district-hq.json`; `STATES` with GST codes |
| `@ecomkit/places/server` | `places` (service key `places`: `suggest`, `getDistrict`, `fit`, plus `fitScored`, `nearest`, `districtsFor(plant)` for "Grows well in"), `getDistrictPage`, `listEnabledDistrictSlugs`, `registerPlantSource`, `findPincode`, `runPlacesSeed`, `districtSitemapEntries`, `invalidatePlacesCache` |
| `@ecomkit/places/ui` | `DistrictFacts`, `DistrictPlantList` (server), `PlaceTypeaheadIsland` (client combobox, optional "use my location") |
| `@ecomkit/places/admin` | `DistrictsPage`, server actions `setPageEnabled`, `setPageIntro` |
| `@ecomkit/places/messages` | `placesMessages` default copy |

## Tables

`places_state(code, name, gst_code)`, `places_district` (slug unique, aliases text[], HQ lat/lng, `distance_km_from_nursery`, soil, climate ranges, rivers, native crops, `page_enabled`, `page_intro_html`, `admin_locked`), `places_pincode(pincode pk, office_name, district_id null, state_code)`. Aliases are a column, not a table (see assumption 1 in BUILD-STATUS/wp-13.md).

## Routes

| Route | Notes |
|---|---|
| `GET /api/places/suggest?q=&limit=` | Typeahead from 2 characters; six digits are looked up as a pincode first. `Cache-Control: public, s-maxage=3600`. Rate limit 120 per IP per minute. |
| `GET /api/places/pincode?code=` | `{found, office, stateCode, district}`; `{lookup:'off'}` when no directory is loaded; 404 for an unknown pincode. |
| `GET /api/places/nearest?lat=&lng=` | Nearest district HQ ("use my location"). Not cached. |
| `/grow-in/[district]` | Static per enabled district; tag `district:<slug>`; `robots` noindex until 6 or more plants fit. |
| `/admin/places` | Enable list (needs `content.write`): switch pages on or off, write the intro, see how many plants fit. Karnataka first. |

## Settings (`places`)

`pincode_lookup` (boolean, default true; the seed sets it false when no directory is loaded), `suggest_limit` (3 to 12, default 6).

## Climate fit rules

The rules decide; no model is involved. Numbers live in `FIT_RULES` and are covered by tests. Temperature: 2 C slack, more than 5 C beyond that is `not_recommended`, 0 to 5 C beyond is `ok`. Rain: below the plant minimum needs irrigation (`ok`), below 40% of it is `not_recommended` unless the plant is drought tolerant (high: `light_irrigation` down to 70%); above 1.2x the maximum is a waterlogging `ok`, above 2x `not_recommended`. Humidity: no overlap drops `good` to `ok`. Soil and native-crop matches add reasons and score only. Reasons are message keys (`fit.too_dry`, ...).

## Seed data

`pnpm seed:build` runs `districts` (sheet to `data/seed/districts.json`) then `pincodes` (India Post directory to `data/seed/pincodes.csv`). `pnpm seed:load` runs the `places` seed hook: idempotent upserts, districts edited by staff (`admin_locked`) are skipped. HQ positions come from `data/seed/district-hq.json` (one-off OpenStreetMap lookup, `tooling/scripts/seed/geocode-districts.ts`); nothing geocodes at runtime. Distances: handoff samples win, otherwise haversine x 1.3 rounded to 5 km from the nursery origin.

## Plant source for district pages

Places never reads catalog tables. The app registers a source once at boot:

```ts
registerPlantSource(async () => plants.map((p) => ({ sku, name, nameKn, path, image, priceLabel, climate: { tempC, rainfallMm, humidityPct, soilTags, droughtTolerance, names } })));
```

Without a source the page shows climate facts and a link to all plants.

## Events, jobs, extension points

Emits and consumes no events; no jobs. Provides service `places`; one `sitemapSources` entry (`districts`); one `seedHooks` entry.

## Disable

Remove `places` from the app's `modules.config.ts`. Shipping and checkout fall back to a free district field and the enquiry-only zone; the wizard loses location search.
