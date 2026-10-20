# @ecomkit/feeds

Google Merchant Center XML and Meta catalog CSV product feeds served as token-protected files (A24), rebuilt from catalog, pricing, inventory and media after changes (debounced) and daily, rewritten only when an item's hash changed, with a per-item validation report. Brand-neutral.

Pushing through the Merchant API or Meta `items_batch` is not built: scheduled file fetch is what both platforms recommend under 10k items. Adding it later means a `push` job per destination that sends the items whose `feeds_item_state.hash` changed (the state table already tracks exactly that).

## Public API

`@ecomkit/feeds/server`

| Export | What |
|---|---|
| `regenerateFeeds({ force?, destinations?, now? })` | Builds items, validates per destination, hashes, compares with `feeds_item_state`; rewrites `feeds_file` only when an item was added, changed or removed (or `force`); records a `feeds_run` with the issues. Returns one report per destination |
| `serveFeed(destination, req)` | Route handler body: 404 when the destination is off, 403 without the right `?token=` (constant-time compare), builds the file on the first fetch, `ETag`/`If-None-Match`, `X-Robots-Tag: noindex` |
| `loadFeedRows()` | One row per variant of every visible, indexable product, read through `@ecomkit/catalog/server`, `@ecomkit/pricing/server`, `@ecomkit/inventory/server`, `@ecomkit/media/server` (never their tables) |
| `setFeedRowSource(fn)` | Swap the row loader (another store's catalog shape) |
| `scheduleRegenerate()` | Debounced enqueue of `feeds.regenerate` |
| `rotateFeedToken(actorId)`, `feedStatus(destination)`, `feedImagePaths(imageRef)` | |

`@ecomkit/feeds/domain`: `toFeedItem`, `forDestination`, `validateFeedItem`, `renderGoogleXml`, `renderMetaCsv`, `feedPrice`, `htmlToText`, `stableItemText`.

## Item rules

- One item per variant. `id` = product sku + variant suffix; `item_group_id` = product sku when a product has more than one variant; the link then carries `?variant=<suffix>`.
- Price is the GST-inclusive online price for one unit. With a real compare-at, `price` = compare-at and `sale_price` = the list price.
- Availability comes from catalog's `deriveAvailability` + `offerAvailability` over live stock: `in_stock`, `out_of_stock`, `preorder` (with `availability_date` = today + ready-in days, 30 when unknown).
- `identifier_exists` = no (no GTIN/MPN); `condition` = new; brand and Google product categories come from settings.
- Images: Google gets the 800 px WebP derivative (or the largest below 800 for small masters); Meta gets the share JPEG.
- Errors keep an item out of the file and are stored on `feeds_item_state.last_error` and in the run log: missing id/title/description/link/image/price/brand, http links when the site is https, zero price, sale above price, pre-order without a date. Warnings (no category, description equals title) are reported only.

## Tables

`feeds_item_state` (pk destination + variant: last hash written, last pushed, last error), `feeds_run` (kind `full | delta`, items, rejected, log with added/changed/removed/unchanged/rewritten and issues), `feeds_file` (pk destination: body, content type, etag, items, generated at; web and worker share it).

## Routes

`GET /feeds/google.xml?token=…`, `GET /feeds/meta.csv?token=…`; admin `/admin/marketing/feeds` (URLs, counts, last runs, rejected items, Rebuild now).

## Settings (`/admin/settings/feeds`)

`feedToken` (secret; action "Generate new feed token"), `googleEnabled`, `metaEnabled`, `brand`, `googleCategoryPlant`, `googleCategoryInput`, `includeOutOfStock` (default on), `debounceSec` (default 120). Action "Rebuild feeds now".

## Jobs and events

`feeds.regenerate` (queue policy `stately`: at most one queued plus one running), scheduled daily at 03:15 IST with `force`. Subscribes to `product.updated`, `product.published`, `price.changed`, `stock.changed`: each schedules one rebuild `debounceSec` later; further events inside the window fold into the queued job.

## Merchant Center and Commerce Manager setup

Add the feed URL as a scheduled fetch (daily) / scheduled data source. Configure shipping and returns at account level in Merchant Center (the feed carries no shipping). `SITE_URL` must be the https canonical origin: links and images are absolute and http links are rejected. robots.txt must not block `/feeds/`.

## Disable

Remove `feeds` from the app config; the routes, job and subscribers disappear with it.

## Tests

`test/domain.test.ts` (item mapping, required fields for both destinations, XML escaping and `g:` fields, CSV columns and quoting), `test/server.test.ts` (real Postgres with catalog, pricing, inventory and media tables: source rows, rejected items with reasons, no rewrite when hashes are unchanged, rewrite on a price change, recovery and removal, token required, 404 when off, ETag, token rotation, first-fetch build, debounced queueing), `test/manifest.test.ts`.
