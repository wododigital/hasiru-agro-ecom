// SEO tables (BUILD-PLAN section 3, "seo"). Every table is prefixed seo_.
import { newId } from '@ecomkit/core/ids';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const seoRedirectSource = pgEnum('seo_redirect_source', ['manual', 'slug_change', 'legacy_import', 'not_found_fix']);

/** One-hop redirects: the writer collapses chains and refuses loops (domain `planRedirect`). */
export const seoRedirect = pgTable(
  'seo_redirect',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    fromPath: text('from_path').notNull().unique(),
    toPath: text('to_path').notNull(),
    statusCode: integer('status_code').notNull().default(301),
    source: seoRedirectSource('source').notNull().default('manual'),
    hits: integer('hits').notNull().default(0),
    lastHitAt: timestamp('last_hit_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('seo_redirect_to_idx').on(t.toPath),
    index('seo_redirect_list_idx').on(t.createdAt.desc(), t.id.desc()),
    check('seo_redirect_status_check', sql`${t.statusCode} in (301, 302, 307, 308)`),
    check('seo_redirect_not_self', sql`${t.fromPath} <> ${t.toPath}`),
  ],
);

/** Paths that answered 404, with counts; `fixed_redirect_id` is set when an admin redirects one. */
export const seoNotFound = pgTable(
  'seo_not_found',
  {
    path: text('path').primaryKey(),
    hits: integer('hits').notNull().default(1),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
    /** Most recent distinct referrer hosts+paths, capped at 10. */
    referrers: text('referrers').array().notNull().default(sql`'{}'::text[]`),
    fixedRedirectId: uuid('fixed_redirect_id').references(() => seoRedirect.id, { onDelete: 'set null' }),
  },
  (t) => [index('seo_not_found_hits_idx').on(t.hits.desc(), t.path), index('seo_not_found_fixed_idx').on(t.fixedRedirectId), index('seo_not_found_last_idx').on(t.lastAt.desc())],
);

/** Manual overrides for hand-written pages (title, description, noindex, canonical, social image). */
export const seoPageMeta = pgTable(
  'seo_page_meta',
  {
    path: text('path').primaryKey(),
    title: text('title'),
    description: text('description'),
    noindex: boolean('noindex').notNull().default(false),
    canonical: text('canonical'),
    ogMediaId: uuid('og_media_id'),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('seo_page_meta_updated_idx').on(t.updatedAt.desc(), t.path)],
);

export type SeoRedirect = typeof seoRedirect.$inferSelect;
export type SeoNotFound = typeof seoNotFound.$inferSelect;
export type SeoPageMeta = typeof seoPageMeta.$inferSelect;
