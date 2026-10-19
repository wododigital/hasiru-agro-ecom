// Media tables (BUILD-PLAN section 3, "media"). Every table is prefixed media_.
import { boolean, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

export const mediaKind = pgEnum('media_kind', ['image', 'video', 'document']);
/** `client` = photos from the store owner (seed manifest uses it for real field photos). */
export const mediaSource = pgEnum('media_source', ['upload', 'woo_import', 'site_import', 'stock', 'wikimedia', 'client']);
export const mediaStatus = pgEnum('media_status', ['ready', 'processing', 'failed']);
export const mediaFormat = pgEnum('media_format', ['avif', 'webp', 'jpeg']);

export const mediaAsset = pgTable(
  'media_asset',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    kind: mediaKind('kind').notNull(),
    /** Path under MEDIA_ROOT: `public/m/<aa>/<hex>.webp` or `private/<aa>/<hex>.<ext>`. */
    storageKey: text('storage_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes').notNull(),
    /** Of the uploaded bytes; the dedupe key. */
    sha256: text('sha256').notNull().unique(),
    blurDataUrl: text('blur_data_url'),
    alt: text('alt').notNull().default(''),
    caption: text('caption'),
    source: mediaSource('source').notNull().default('upload'),
    licence: text('licence'),
    author: text('author'),
    sourceUrl: text('source_url'),
    creditRequired: boolean('credit_required').notNull().default(false),
    /** Private files live outside the public tree and are served only through signed URLs. */
    isPrivate: boolean('is_private').notNull().default(false),
    status: mediaStatus('status').notNull().default('processing'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('media_asset_list_idx').on(t.createdAt.desc(), t.id.desc()), index('media_asset_status_idx').on(t.status)],
);

export const mediaDerivative = pgTable(
  'media_derivative',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAsset.id, { onDelete: 'cascade' }),
    format: mediaFormat('format').notNull(),
    width: integer('width').notNull(),
    storageKey: text('storage_key').notNull(),
    bytes: integer('bytes').notNull(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.format, t.width] })],
);

export const mediaUsage = pgTable(
  'media_usage',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAsset.id, { onDelete: 'restrict' }),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.entity, t.entityId] }), index('media_usage_entity_idx').on(t.entity, t.entityId)],
);

export type MediaAsset = typeof mediaAsset.$inferSelect;
export type MediaDerivative = typeof mediaDerivative.$inferSelect;
