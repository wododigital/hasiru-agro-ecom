# @ecomkit/farm-calculators

Plant calculator (how many plants fit a piece of land), compost and input calculator, dosage rules by M/X/O role and plant age, pack rounding, and the recommended-inputs engine other modules (planting packages, assistant, PDP) call.

## Public API

- `@ecomkit/farm-calculators/domain` (pure, client-safe):
  - `plantCount({ area, unit, lengthFt, widthFt, layout, buffer })` (A10: base `round(sqft / (L x W) x (tri ? 1.155 : 1))`, buffer `ceil(n x 1.03)`; 1 acre at 9 x 9 = 538, at 10 x 10 = 436), `convertArea`, `toSqft`, `suggestedSpacing(spacingFt, prefer)`, `plantCalcInputSchema`.
  - `recommendInputs({ plants: [{ qty, role, compostKg? }], acres, rules, ageBand? })` -> `[{ inputProductId, amount, unit, packSize, packs }]`; `packsFor`, `linesFromSizes({ L, M, S })` (A12 size to role), `SIZE_ROLE`, `dosageRuleSchema`.
- `@ecomkit/farm-calculators/server`:
  - `recommendedInputs({ plants, acres, ageBand? })`: the dosage contract for planting. Adds `name`, `slug`, `variantId` per input; hidden inputs are left out.
  - `plantCalculatorData()`, `compostCalculatorData()` (cached), `plantLinesFor(cartLines)`.
  - `listDosageRules()` (cached, tag `settings:farm-calculators`), `listDosageRulesFresh()`, `saveDosageRule()`, `deleteDosageRule()` (audited), `seedDosageRules` (seed hook), `rulesFromProduct`.
  - `configureFarmCalculators({ registry, cartLines, messages })`: bound once by the app at boot.
- `@ecomkit/farm-calculators/ui`: `PlantCalculator` (inline), `PlantCalculatorLauncher` (floating button + modal; loads `/api/calculators/plants` on hover or open), `CompostCalculator` (inline; static shell, cart mode streams in), and the islands `PlantCalculatorIsland`, `PlantCalculatorLauncherIsland`, `CompostCalculatorIsland`.
- `@ecomkit/farm-calculators/admin`: `DosageRulesPage`.

## Table

`farmcalc_dosage_rule(id, input_product_id, basis per_plant|per_acre, role M|X|O|any, age_band at_planting|y0_2|y3_6|y7_plus, amount, pack_size, unit kg|L, min_packs, use_plant_compost, is_active, position, created_at, updated_at)`, unique `(input_product_id, basis, role, age_band)`. `input_product_id` is not a foreign key (modules never constrain each other's tables).

## Routes

- `/calculators/plants`, `/calculators/compost` (pages), `/api/calculators/plants` (GET, public JSON for the modal).
- Admin: `/admin/dosage-rules` (nav "Dosage rules", Products band, `products.read`; writes need `products.write`).

## Settings, events, jobs

None. Cache tag `settings:farm-calculators` is expired on every rule write.

## Seed

`seedDosageRules` (order 20, after the catalog seed): converts each input product's imported `dosageRules` (data/seed `inputs.json`) into rules; `per_block` rules are derived and skipped; `per_acre` rules get `min_packs = 1`. Idempotent (`on conflict do nothing`), so admin edits survive re-seeding. It imports the catalog server API, so `seed:load` runs with `--conditions=react-server`.

## Cart

Buttons speak the cart HTTP contract (`POST /api/cart/lines { variantId, delta }`, A04-10). A delta always adds to the cart (A11). Buttons render only when `configureFarmCalculators({ registry })` reports the cart module enabled.

## How to disable

Remove `farm-calculators` from `modules.config.ts` and run `modules:sync`. Nothing else imports it except the planting module (which declares it as a dependency).
