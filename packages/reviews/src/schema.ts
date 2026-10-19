// Reviews tables (BUILD-PLAN section 3, "reviews"). Every table is prefixed reviews_.
// product_id, customer_id, order_id and media_id belong to catalog, auth, orders and media; no cross-module
// foreign keys, ownership is enforced in every query.
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, numeric, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

export const reviewsStatus = pgEnum('reviews_status', ['pending', 'approved', 'rejected']);

export const reviewsReview = pgTable(
  'reviews_review',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    productId: uuid('product_id').notNull(),
    customerId: uuid('customer_id'),
    orderId: uuid('order_id'),
    rating: smallint('rating').notNull(),
    title: text('title'),
    body: text('body').notNull(),
    authorName: text('author_name'),
    districtText: text('district_text'),
    isVerifiedBuyer: boolean('is_verified_buyer').notNull().default(false),
    status: reviewsStatus('status').notNull().default('pending'),
    adminReply: text('admin_reply'),
    /** Sample or demo rows are flagged and never counted or shown as genuine. */
    isSample: boolean('is_sample').notNull().default(false),
    dataSource: text('data_source').notNull().default('customer'),
    moderatedBy: uuid('moderated_by'),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('reviews_review_rating_range', sql`${t.rating} between 1 and 5`),
    index('reviews_review_product_idx').on(t.productId, t.status, t.createdAt.desc(), t.id.desc()),
    index('reviews_review_list_idx').on(t.createdAt.desc(), t.id.desc()),
    index('reviews_review_status_idx').on(t.status, t.createdAt.desc()),
    index('reviews_review_customer_idx').on(t.customerId),
    uniqueIndex('reviews_review_one_per_customer').on(t.productId, t.customerId),
  ],
);

export const reviewsMedia = pgTable(
  'reviews_media',
  {
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviewsReview.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.mediaId] })],
);

/** Refreshed in the moderation transaction; approved, non-sample reviews only. Never copied onto catalog rows. */
export const reviewsAggregate = pgTable('reviews_aggregate', {
  productId: uuid('product_id').primaryKey(),
  count: integer('count').notNull(),
  avg: numeric('avg', { precision: 3, scale: 2, mode: 'number' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
