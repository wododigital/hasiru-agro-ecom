# @ecomkit/cms

Store content: pages built from typed blocks, menus, policy pages, guides, videos (optionally linked to a product or a
planting model), testimonials, portfolio projects, clients, team, results counters and the trust band. One block
editor and one generic admin form cover every content type; a new block or content type is a zod schema plus a field
list, never a new form.

Hard dependencies: `core`, `media` (asset ids). Optional: `seo` (metadata, JSON-LD, redirects, logged 404s).

## Host wiring (once, at boot)

```ts
import { configureCms } from '@ecomkit/cms/server';
configureCms({
  images: (ids) => getImages(ids),            // media
  resolveMediaIds: (paths) => idsForMasters(paths), // media, seed only (trust claim logos)
  metadata: buildMetadata, jsonLd, onMissing: resolveMissing, addRedirect, // seo (all optional)
  productRail: ProductRailSlot,               // renders `product_rail` blocks (catalog ProductRail)
  components: { plant_calculator: { label: 'Plant calculator', Component: PlantCalculatorSlot } }, // `component` blocks
  messages: { guides: { title: 'Guides' } },   // host copy
});
```

## Block types

`hero` (heading, subheading, image, up to 2 buttons; the h1 on `landing` pages), `rich_text` (HTML, sanitised with
core `safeHtml` on save and again on read), `faq` (feeds FAQPage JSON-LD), `cta`, `video` (by ids or category; feeds
VideoObject), `trust_band` (claims with `show` only), `testimonials`, `counters` (verified only), `gallery`, `rail`
(link cards), `team`, `product_rail` (eyebrow, heading, source `bestsellers | collection | tag | ids` with a slug or
product ids, `plant | input`, limit, optional link; rendered by the host's `productRail` port, so cms never reads
products) and `component` (embeds a host-registered component by key, e.g. a calculator; the page editor lists the
registered keys). Both render their heading in the static shell and the port output in a request-time Suspense hole
(build workers prerender shells before the host binds its ports); an unbound port leaves the heading only. The trust band is a running marquee of the shown
claims with their logos. A block whose stored data no longer validates is skipped, never rendered broken. Links accept a
site path, https, `tel:` or `mailto:` only.

Videos link out (poster plus "Watch on YouTube"); no third-party iframe or image loads on the page, so the storefront
CSP stays self-only.

## Public API

- `@ecomkit/cms/domain`: `blockSchema`, `BLOCK_TYPES`, `BLOCK_FIELDS`, `parseBlock`, `pageInputSchema`,
  `RESERVED_ROOTS`, `menuItemsSchema`, `menuTree`, `ENTITIES` (schema, fields and columns of every simple type),
  editor list operations (`moveItem`, `removeItem`, `setIn`, `emptyValues`), `youtubeId`, `videoLinks`, IST datetime helpers.
- `@ecomkit/cms/server`: `configureCms`, `getPage(slug)`, `getMenu(key)`, `videosFor({ productId | modelSlug | category | ids })`,
  `listPosts`, `getPost`, `listTestimonials`, `listCounters`, `listTrustClaims`, `listTeam`, `listPortfolio`,
  `getPortfolioItem`, `listClients`, `resolveBlocks`, `blockJsonLd`, `CmsPageBody` (render a page with JSON-LD),
  admin writes `savePage`, `saveMenu`, `saveEntity`, `deleteEntity`, and the sitemap sources.
- `@ecomkit/cms/ui`: `BlockList`, `PageView`, `MenuLinks`, `VideoGrid`, `GuideList`, `GuideArticle`, `SmartLink`.
- `@ecomkit/cms/admin`: content hub, pages list/editor (block editor island), menus, generic list/editor for every simple type.

Hand-written host pages (home, farm development, our work) use `getPage`/`resolveBlocks`/`BlockList` and the list
readers above rather than their own queries.

## Tables

`cms_page` (slug unique, 1 to 3 segments; `policies/<x>` is always the policy template), `cms_block`, `cms_menu`,
`cms_menu_item` (two levels), `cms_testimonial`, `cms_video` (product_id, model_slug indexed), `cms_post` (guides),
`cms_portfolio_item`, `cms_client`, `cms_team_member`, `cms_counter` (key pk, `verified`), `cms_trust_claim` (key pk, `show`).

## Routes

Storefront: `/[...slug]` (catch-all for cms pages; anything else goes to seo `resolveMissing`), `/policies/[slug]`,
`/guides`, `/guides/[slug]`, `/videos`, `/about`, `/contact` (both with LocalBusiness JSON-LD). Every dynamic route
checks existence and calls `notFound()` before any Suspense, so status codes are real.
Admin: `/admin/content`, `/admin/content/pages[/<id>|/new]` (`?template=policy` = Policies), `/admin/content/menus[/<key>]`,
`/admin/content/<guides|videos|testimonials|portfolio|clients|team|counters|trust>[/<id>|/new]`.

## Publishing rules

- Drafts never render or reach a sitemap; noindex pages render but stay out of the sitemap.
- Policy pages are seeded as draft + noindex whatever the seed file says; they go live when the owner publishes them.
- Guides publish at their date (lists cached for hours, so a scheduled guide appears within the hour).
- A published page or guide that changes address gets a 301 through the bound seo `addRedirect`.
- Counters show only when verified; trust claims only when `show` (a rating stays hidden until confirmed).
  Testimonials are real customer words only (source recorded).

## Extension points used

`sitemapSources`: `pages` (pages plus /guides and /videos when they have content), `guides`.
`seedHooks`: `content` (data/seed/cms.json: pages with blocks `{ type, props, sort }`, menus, testimonials, team,
trust_claims, counters; inserts missing rows only, a second run changes nothing).

Settings: none. Events: none. Permission: `content.write`. Cache tags: `nav`, `cms:pages`, `cms:page_<slug>`,
`cms:menu_<key>`, `cms:guides`, `cms:guide_<slug>`, `cms:videos`, `cms:testimonials`, `cms:counters`, `cms:trust`,
`cms:team`, `cms:portfolio`, `cms:clients`.

## Disable

Leave `cms` out of `modules.config.ts`: its routes are not generated and modules that read videos or menus get
nothing (planting's `videosFor` is optional there). Unknown paths then 404 through Next directly.
