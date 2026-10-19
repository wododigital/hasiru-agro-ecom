# @ecomkit/seo

Search and sharing for any store built from these modules: metadata and JSON-LD builders, the sitemap index and
per-module sitemap files, robots.txt, llms.txt, OG image cards, redirects (one hop, loop-proof), the 404 log and
page meta overrides. Brand-neutral: the store's identity is host config.

Hard dependencies: `core`. Optional: none (other modules feed it through `sitemapSources` and bound callbacks).

## Host wiring (once, at boot: instrumentation `register()` or the root layout)

```ts
import { configureSeo } from '@ecomkit/seo/server';
import { registry } from '@/src/generated/registry';

configureSeo({
  site: { url: process.env.SITE_URL!, name: 'My Store', description: '...', logo: '/logo.png', searchPath: '/search',
          businessType: 'Store', address: {...}, geo: {...}, openingHours: ['Mo-Sa 08:00-18:00'], returnPolicy: { category: 'not_permitted' } },
  registry,                                  // sitemap files come from every enabled module's sitemapSources
  robotsDisallow: ['/plan/results', '/r/'],  // added to DEFAULT_DISALLOW
  llms: { sections: [{ title: 'Buying in bulk', body: '...' }], sourceTitles: { products: 'Products' } },
  ogCard: async (path) => null,              // e.g. product name, price and photo for /plant/<slug>
  ogColors: { background, foreground, accent }, // theme values; satori cannot read CSS variables
  images: (ids) => getImages(ids),           // media, for page meta social images
  entitySeo: async (kind, id) => null,       // catalog, for the product SEO tab
  notFoundLinks: [{ label: 'All plants', href: '/plants' }],
  messages: { notFound: { ... } },           // host copy
});
```

Other modules take seo through their own runtime bindings, never by import: catalog
`configureCatalog({ jsonLd: jsonLd(), metadata: buildMetadata, addRedirect })`, cms
`configureCms({ jsonLd, metadata: buildMetadata, onMissing: resolveMissing, addRedirect })`.

`app/not-found.tsx` re-exports `@ecomkit/seo/routes/not-found` (hand-written, one line).

Where redirects are answered: paths no route matches reach the cms catch-all, which calls `resolveMissing` (308 or
307, before streaming). For exact 301s on every path (also old slugs under a live route such as `/plant/<old>`), the
request proxy should call `redirectFor(pathname)` and return `NextResponse.redirect(to, statusCode)`, and set an
`x-pathname` request header so the 404 page can log misses. Both are host wiring (see BUILD-STATUS/wp-09.md).

## Public API

- `@ecomkit/seo/domain` (pure): `siteIdentity()`, `normalisePath()`, `canonicalUrl()`, `metadataFor(input, site, override?)`,
  `createJsonLd(site)` (implements the core `JsonLdBuilders` contract: organization, website, localBusiness, product with
  offer, bulk `UnitPriceSpecification`, rating and up to 5 reviews, breadcrumbs, faqPage, collectionPage (24 items),
  article, videoObject, `graph()` escaped), `escapeJsonLd()`, `planRedirect()`, `sitemapUrls()`, `urlsetXml()`,
  `sitemapIndexXml()`, `robotsTxt()`, `llmsTxt()`, `AI_CRAWLERS`, `DEFAULT_DISALLOW`, `TITLE_MAX`, `DESCRIPTION_MAX`.
- `@ecomkit/seo/server`: `configureSeo`, `buildMetadata(input)` (sync), `pageMetadata(input)` (applies page meta
  override), `jsonLd()`, `canonical(path)`, `addRedirect(from, to, opts)`, `removeRedirect`, `redirectFor(path)` (30 s
  in-process map, usable from the request proxy), `resolveMissing(path)` (redirect or logged 404, call before any
  Suspense), `logNotFound`, `fixNotFound`, `listRedirects`, `listNotFound`, `savePageMeta`, `getPageMeta`, sitemap,
  robots, llms and OG response builders.
- `@ecomkit/seo/ui`: `JsonLdScript`, `NotFoundView`.
- `@ecomkit/seo/admin`: `RedirectsPage`, `NotFoundLogPage`, `PageMetaPage`, `SeoProductTab`.

## Rules it enforces

- Canonical: absolute on the pinned host, lowercase outside percent escapes, no trailing slash, no query except
  `?page=n` (n > 1). Paths are normalised the same way everywhere (redirects, 404 log, page meta, sitemaps).
- Redirects are always one hop: a new target that redirects is followed to its end, rows that pointed at the source
  are re-pointed, loops (including two writers at once, serialised with an advisory lock) are refused.
- Sitemaps list only what returns 200 and is indexable: sources list published, indexable rows; seo also drops
  redirect sources, noindex overrides, query URLs and duplicates. A failing source is captured and skipped.
- JSON-LD `graph()` escapes `<`, `>`, `&`, U+2028 and U+2029, so no value can close the script element.
- robots.txt is a route (never a static file): private paths disallowed, AI crawlers allowed by name, sitemap line.

## Tables

`seo_redirect` (from_path unique, to_path, status_code 301/302/307/308, source manual | slug_change |
legacy_import | not_found_fix, hits, last_hit_at), `seo_not_found` (path pk, hits, first/last seen, last 10
referrers, fixed_redirect_id), `seo_page_meta` (path pk, title, description, noindex, canonical, og_media_id).

## Routes

`/sitemap.xml`, `/sitemap/[file]` (`<name>.xml`), `/robots.txt`, `/llms.txt`, `/og/[...slug]` (`/og/home` is the home
page; default social image for every page), admin `/admin/seo` (redirects), `/admin/seo/not-found`, `/admin/seo/page-meta`.

## Extension points used

- `productFormTabs`: `seo` (search preview with length counters, indexing state, redirects into the product).
- `jobs`/`schedules`: `seo.prune-not-found` daily 03:45 IST (keeps the 404 log bounded).
- `seedHooks`: `redirects` (active rows of `data/seed/redirects.json` with a `to_path`; SKU rows wait for the catalog).
- Consumes every module's `sitemapSources`.

Settings: none (identity is host config). Events: none emitted or consumed. Permission: `content.write`.
Cache tag: `settings:seo` (page meta overrides).

## Disable

Leave `seo` out of `modules.config.ts`: no sitemap, robots or OG routes are generated; modules that bound seo
callbacks fall back (catalog and cms render without JSON-LD, plain titles, plain 404s). Remove the
`app/not-found.tsx` re-export or point it at the host's own page.
