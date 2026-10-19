// CMS tables (BUILD-PLAN section 3, "cms"). Every table is prefixed cms_.
import { newId } from '@ecomkit/core/ids';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const cmsStatus = pgEnum('cms_status', ['draft', 'published']);
export const cmsPageTemplate = pgEnum('cms_page_template', ['default', 'landing', 'policy', 'service']);
export const cmsVideoKind = pgEnum('cms_video_kind', ['youtube', 'whatsapp', 'file']);

const id = () => uuid('id').primaryKey().$defaultFn(newId);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const status = () => cmsStatus('status').notNull().default('draft');
const position = () => integer('position').notNull().default(0);

/** A page at `/<slug>` (slug may hold one or two `/`, e.g. `policies/delivery`). Blocks hold the content. */
export const cmsPage = pgTable(
  'cms_page',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    titleKn: text('title_kn'),
    status: status(),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    noindex: boolean('noindex').notNull().default(false),
    template: cmsPageTemplate('template').notNull().default('default'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cms_page_status_idx').on(t.status, t.template), index('cms_page_list_idx').on(t.createdAt.desc(), t.id.desc())],
);

/** Ordered typed blocks; `data` is validated by the block's zod schema on every write. */
export const cmsBlock = pgTable(
  'cms_block',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => cmsPage.id, { onDelete: 'cascade' }),
    position: position(),
    type: text('type').notNull(),
    data: jsonb('data').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('cms_block_page_idx').on(t.pageId, t.position)],
);

export const cmsMenu = pgTable('cms_menu', {
  key: text('key').primaryKey(),
  label: text('label').notNull().default(''),
  updatedAt: updatedAt(),
});

/** Two levels: top items and their children (`parent_id`). */
export const cmsMenuItem = pgTable(
  'cms_menu_item',
  {
    id: id(),
    menuKey: text('menu_key')
      .notNull()
      .references(() => cmsMenu.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => cmsMenuItem.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    href: text('href').notNull(),
    position: position(),
    isExternal: boolean('is_external').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('cms_menu_item_menu_idx').on(t.menuKey, t.position), index('cms_menu_item_parent_idx').on(t.parentId)],
);

/** Real customer words only (from the client or the current site). `key` is the seed's natural key. */
export const cmsTestimonial = pgTable(
  'cms_testimonial',
  {
    id: id(),
    key: text('key').unique(),
    name: text('name').notNull(),
    location: text('location'),
    photoMediaId: uuid('photo_media_id'),
    body: text('body').notNull(),
    rating: integer('rating'),
    projectType: text('project_type'),
    /** Where the words came from (current_site, client); shown to admins, never invented. */
    source: text('source'),
    status: status(),
    position: position(),
    createdAt: createdAt(),
  },
  (t) => [
    index('cms_testimonial_status_idx').on(t.status, t.position),
    index('cms_testimonial_list_idx').on(t.createdAt.desc(), t.id.desc()),
    check('cms_testimonial_rating_check', sql`${t.rating} is null or ${t.rating} between 1 and 5`),
  ],
);

/** The one video table: optional product or planting-model link puts a video on that page. */
export const cmsVideo = pgTable(
  'cms_video',
  {
    id: id(),
    title: text('title').notNull(),
    description: text('description'),
    url: text('url').notNull(),
    kind: cmsVideoKind('kind').notNull().default('youtube'),
    posterMediaId: uuid('poster_media_id'),
    category: text('category'),
    productId: uuid('product_id'),
    modelSlug: text('model_slug'),
    position: position(),
    status: status(),
    createdAt: createdAt(),
  },
  (t) => [
    index('cms_video_product_idx').on(t.productId),
    index('cms_video_model_idx').on(t.modelSlug),
    index('cms_video_status_idx').on(t.status, t.category, t.position),
    index('cms_video_list_idx').on(t.createdAt.desc(), t.id.desc()),
  ],
);

/** Guides (blog). */
export const cmsPost = pgTable(
  'cms_post',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    bodyHtml: text('body_html').notNull().default(''),
    coverMediaId: uuid('cover_media_id'),
    author: text('author'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    status: status(),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    noindex: boolean('noindex').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cms_post_status_idx').on(t.status, t.publishedAt.desc()), index('cms_post_list_idx').on(t.createdAt.desc(), t.id.desc())],
);

export const cmsPortfolioItem = pgTable(
  'cms_portfolio_item',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    location: text('location'),
    landSizeAcres: numeric('land_size_acres', { mode: 'number' }),
    scope: text('scope'),
    beforeMediaId: uuid('before_media_id'),
    afterMediaId: uuid('after_media_id'),
    gallery: uuid('gallery').array().notNull().default(sql`'{}'::uuid[]`),
    bodyHtml: text('body_html').notNull().default(''),
    status: status(),
    position: position(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cms_portfolio_status_idx').on(t.status, t.position), index('cms_portfolio_list_idx').on(t.createdAt.desc(), t.id.desc())],
);

export const cmsClient = pgTable(
  'cms_client',
  {
    id: id(),
    name: text('name').notNull(),
    projectType: text('project_type'),
    location: text('location'),
    acreage: numeric('acreage', { mode: 'number' }),
    workDone: text('work_done'),
    logoMediaId: uuid('logo_media_id'),
    status: status(),
    position: position(),
    createdAt: createdAt(),
  },
  (t) => [index('cms_client_status_idx').on(t.status, t.position), index('cms_client_list_idx').on(t.createdAt.desc(), t.id.desc())],
);

/** Team members for the about page (`team` block). */
export const cmsTeamMember = pgTable(
  'cms_team_member',
  {
    id: id(),
    key: text('key').unique(),
    name: text('name').notNull(),
    role: text('role'),
    bio: text('bio'),
    photoMediaId: uuid('photo_media_id'),
    status: status(),
    position: position(),
    createdAt: createdAt(),
  },
  (t) => [index('cms_team_status_idx').on(t.status, t.position), index('cms_team_list_idx').on(t.createdAt.desc(), t.id.desc())],
);

/** Results counters; the storefront shows only `verified` ones. */
export const cmsCounter = pgTable('cms_counter', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  value: integer('value').notNull().default(0),
  suffix: text('suffix'),
  verified: boolean('verified').notNull().default(false),
  position: position(),
  updatedAt: updatedAt(),
});

/** Trust band claims (incubation, registrations, a rating); hidden until `show`. */
export const cmsTrustClaim = pgTable('cms_trust_claim', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  value: text('value'),
  logoMediaId: uuid('logo_media_id'),
  show: boolean('show').notNull().default(false),
  position: position(),
  updatedAt: updatedAt(),
});

export type CmsPage = typeof cmsPage.$inferSelect;
export type CmsBlockRow = typeof cmsBlock.$inferSelect;
export type CmsMenuItem = typeof cmsMenuItem.$inferSelect;
export type CmsTestimonial = typeof cmsTestimonial.$inferSelect;
export type CmsVideo = typeof cmsVideo.$inferSelect;
export type CmsPost = typeof cmsPost.$inferSelect;
export type CmsPortfolioItem = typeof cmsPortfolioItem.$inferSelect;
export type CmsClient = typeof cmsClient.$inferSelect;
export type CmsTeamMember = typeof cmsTeamMember.$inferSelect;
export type CmsCounter = typeof cmsCounter.$inferSelect;
export type CmsTrustClaim = typeof cmsTrustClaim.$inferSelect;
