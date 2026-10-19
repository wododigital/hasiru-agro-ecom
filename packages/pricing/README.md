# @ecomkit/pricing

List price, compare-at, bulk tiers (any number per variant), the admin-only offline price and cost, tier hints, and the Pricing tab on the product form. All amounts are GST-inclusive integer paise (A7).

## Public API

| Export | What |
|---|---|
| `@ecomkit/pricing/domain` | `tierFor(tiers, qty)`, `nextTierFor(tiers, qty)`, `quote(book, qty, tierQty?)`, `quoteLines(lines, books, groupKey?)` (cross-line summation), `byVariant`, `variantPricingSchema` (admin input, paise), `variantPricingFormSchema` (admin form, rupee strings). Pure, safe on the client. |
| `@ecomkit/pricing/server` | `configurePricing({ gstRates, variantsOf })`, `getPrice(variantId, qty)`, `getPrices(items)`, `tierFor(variantId, qty)`, `priceLines(lines, { groupKey })`, `priceSnapshot(lines)`, `pricingReader` (core `PricingReader`), `loadBooks()`, `getAdminPricing(productId)` (needs `products.read`), `saveVariantPricing(input, actor)`, `UnpricedLineError`. |
| `@ecomkit/pricing/admin` | `PricingTab` (product form tab), `savePricingAction` (form action, needs `pricing.write`). |
| `@ecomkit/pricing/messages` | `pricingMessages` (bulk hint copy). |

Tier rule: the tier with the highest `minQty` not above the quantity applies (boundary inclusive: `min_qty - 1` pays list, `min_qty` pays the tier). A tier never raises the price. Tiers must get cheaper as `minQty` rises (validated).

Cross-line summation: `getPrices` sums repeated variants before choosing the tier; `priceLines`/`priceSnapshot` price each line at the tier its group's total reaches. The default group is the variant (a plant in a package plus the same plant added separately unlock bulk together, parity item C2.7). Pass `groupKey: (line, book) => book.productId` (or any key) to pool more widely.

Offline price and cost never appear in a `PriceQuote`; only `getAdminPricing` (staff with `products.read`) returns them.

## Wiring (app boot)

Pricing does not query catalog tables. The app calls once at boot:

```ts
configurePricing({ gstRates: catalog.gstRatesFor, variantsOf: catalog.variantsOf });
```

Until it is called, reads throw `pricing is not configured`.

## Tables

- `pricing_price(variant_id pk, product_id, price_paise, compare_at_paise, offline_price_paise, cost_paise, currency, updated_at)`; checks: amounts >= 0, compare-at above price.
- `pricing_tier(id, variant_id fk -> pricing_price cascade, min_qty >= 2, unit_price_paise)`, unique `(variant_id, min_qty)`.

No history table: every real change writes a `core_audit_log` row (`price.update`, entity `variant`, before/after).

## Routes, settings, jobs

None. The admin surface is the injected product form tab (`productFormTabs[0]`, id `pricing`, order 20, permission `pricing.write`).

## Events and cache

- Emits `price.changed { productId, variantId }` inside the save transaction (only when something changed).
- Expires the `price:<productId>` cache tag after commit.
- Provides service `pricing` (`registry.service('pricing')`).

## Disable

Remove `pricing` from the app's `modules.config.ts`. Modules that read prices through `registry.service('pricing')` get `null`; cart, checkout and feeds depend on it hard, so a store without pricing cannot sell online.
