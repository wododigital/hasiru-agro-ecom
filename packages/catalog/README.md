# @ecomkit/catalog

Products, variants, collections, tags, FAQs; listing and product pages; the admin product form (which hosts other modules' `productFormTabs`); the grower-sheet and CSV import/export; the data gaps view. Brand-neutral: store copy comes from the host through `configureCatalog({ messages })`.

Hard dependencies: `core`, `media`. Optional (read through the registry, a missing one renders nothing): `pricing`, `inventory`, `reviews`, `places`, `search`, `cart`, `seo`, `planting`.

## Binding the host (required once at boot)

Route stubs only re-export catalog pages, so the app binds its capabilities once, in `instrumentation.ts` `register()` (and at module scope of the root layout for the edge of dev reloads). The binding lives on `globalThis`, so every bundle sees it.

```ts
import { configureCatalog } from '@ecomkit/catalog/server';
configureCatalog({
  registry,                                   // apps/<app>/src/generated/registry
  images: (ids) => media.imageRefs(ids),      // media: ImageRef per asset id
  resolveMediaIds: (paths) => media.assetIdsForMasters(paths), // seed import: master path -> asset id
  jsonLd, metadata: buildMetadata, addRedirect, // seo module
  listingAside: FacetSidebar,                 // search module
  messages: en.catalog,                       // host copy overrides
});
```

Unbound means: no registry -> no prices, stock, reviews, fit or cart buttons; no `images` -> leaf placeholders; no `jsonLd` -> no structured data; no `addRedirect` -> old slugs still 308 through `previous_slugs`.

## Public API

| Export | What |
|---|---|
| `./server` | `listProducts(filter)`, `getProduct(slug)` / `getProductBySlug`, `movedSlug`, `getCollection`, `topCollections`, `getCuratedTag`, `productCard(id)`, `productCards(ids)`, `buildCards(rows)`, `facetSource()`, `sitemapEntries()`, `loadListing()`; writes `saveProduct`, `deleteProduct`, `saveCollection`, `saveTag`, `saveFaq` (+ deletes); `importSeed`, `importSheet`, `importCsv`, `exportSheet`, `exportCsv`; admin reads (`listAdminProducts`, `getProductForEdit`, `dataGaps` ...); `configureCatalog`; `pageMetadata` |
| `./domain` | pure: `deriveAvailability`, `buildProductCard` (badge priority, chips), `productJsonLdInput`, `productFacts`, `tierLadder` / `tierAt`, `facetRow`, `productFieldsSchema` (zod, every boundary), seed mapping, the grower-sheet layout, CSV columns |
| `./ui` | `ProductCard`, `ProductGrid`, `ListingPage`, `ProductPage`, `FitPanel`, `TierTable`, `Gallery`, `NotifyForm`, islands `CardBuyIsland`, `BuyBoxIsland`, `RecentlyViewedIsland` |
| `./admin` | `ProductEditPage`, `ProductCreatePage`, `ProductsListPage`, `CollectionsPage`, `TagsPage`, `FaqsPage`, `DataGapsPage`, `ImportPage`, `ActionFormIsland` |
| `./messages` | `catalogMessages` (default copy) |

## Tables

`catalog_product`, `catalog_variant`, `catalog_collection`, `catalog_product_collection`, `catalog_tag`, `catalog_product_tag`, `catalog_faq`, `catalog_product_media`, `catalog_related` (BUILD-PLAN section 3, plus `previous_slugs`, `attributes`, `catalog_faq.key`, `catalog_tag.intro_html`, `catalog_variant.sku_suffix`; see BUILD-STATUS/wp-04.md).

## Routes

Storefront: `/plants`, `/plants/[collection]` (a top-level plant collection or a curated `trait` tag page), `/plants/[collection]/[sub]`, `/plant/[slug]`, `/inputs`, `/input/[slug]`. Route handler: `GET /api/catalog/export?format=xlsx|csv` (staff, `products.read`).
Admin: `/admin/products`, `/admin/products/new`, `/admin/products/[id]`, `/admin/inputs`, `/admin/collections`, `/admin/tags`, `/admin/faqs`, `/admin/data-gaps`, `/admin/import`. Nav in the Products band (200 to 209).

Listing URLs: `?page=n` keeps a self canonical; any other parameter (sort, facets) is `noindex,follow` with the clean canonical. A PDP for an earlier slug answers with a permanent redirect; drafts, archived, hidden and deleted products 404.

## Contracts the pages speak

- Cart: `POST /api/cart/lines` JSON `{ variantId, delta }` -> `{ qty }`, and the same path as a plain form post (`variantId`, `qty`, `intent=add|buy`) answering 303, so buying works without JS. A `cart:changed` window event follows each change.
- Back in stock: plain form post to `/api/notify-me` (`variantId`, `phone`, `email`, `consent`).
- District: `readDistrict()` defaults to the `district` cookie (a district slug).

## Settings (`/admin/settings/catalog`)

`whatsappNumber` (digits with country code; shows "Ask on WhatsApp"), `pageSize` (listing page size, default 24).

## Events

Emits `product.updated` (every save, delete, import change) and `product.published` (first activation), both inside the write transaction. Consumes none.

## Caching

Catalog reads are `'use cache'` with `cacheLife('days')` and tags `catalog`, `product:<id>`, `category:<slug>`; the PDP shell's price, stock and review reads are cached under `price:<productId>`, `stock:<productId>`, `reviews:<productId>`. Saves call `updateTag` (server actions) or core `invalidateTags`. Visitor-specific parts (district fit, cards with fit chips) stream inside Suspense.

## Extension points

Consumes `productFormTabs` (product form, permission-filtered), `pdpSections` (slots `main`, `aside`, `below`), `productCardChips` (one batched call per source per grid). Provides `sitemapSources` (`products`, `collections`) and the `products` seed hook.

## Seed and import

`seed:load` runs `importSeed`: `data/seed/products.json` + `inputs.json` (+ optional `collections.json`, `faqs.json`). Natural keys: product `sku`, variant suffix, collection and tag `slug`, FAQ `key`. Every entity is compared before writing, so a second run reports 0 inserted and 0 updated. Without `collections.json`, collections derive from the product codes (`fruiting`, child `desi`); "&" in a subcategory is a separator (`native-medicinal`). Prices and stock in the records are for the pricing and inventory seed hooks.

Admin import: the grower's "Plant data" sheet (27 columns, three header rows) matches plants by variety + base name (or name or alias) and updates agronomy columns only; unknown rows become drafts flagged for review. The CSV (export headers, or an older store export matched on legacy SKU) updates any field.

## Disable

Remove `catalog` from `modules.config.*.ts` and run `modules:sync`; every module that lists it as a dependency must go too (cart, pricing, inventory, search, feeds, planting...).
