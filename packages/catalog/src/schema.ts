// Catalog tables (BUILD-PLAN section 3, "catalog"). Every table is prefixed catalog_.
// Deviations from the plan's column list are recorded in BUILD-STATUS/wp-04.md (A04-*).
import { newId } from '@ecomkit/core/ids';
import { sql } from 'drizzle-orm';
import * as E from './domain/enums';
import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().$defaultFn(newId);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const num = (name: string) => numeric(name, { mode: 'number' });
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`);

export const catalogKind = pgEnum('catalog_kind', E.KINDS);
export const catalogStatus = pgEnum('catalog_status', E.STATUSES);
export const catalogSizeClass = pgEnum('catalog_size_class', E.SIZE_CLASSES);
export const catalogCanopy = pgEnum('catalog_canopy', E.CANOPIES);
export const catalogPropagation = pgEnum('catalog_propagation', E.PROPAGATIONS);
export const catalogLevel = pgEnum('catalog_level', E.LEVELS);
export const catalogWaterNeed = pgEnum('catalog_water_need', E.WATER_NEEDS);
export const catalogExposure = pgEnum('catalog_exposure', E.EXPOSURES);
export const catalogAvailabilityOverride = pgEnum('catalog_availability_override', E.AVAILABILITY_OVERRIDES);
export const catalogTagKind = pgEnum('catalog_tag_kind', E.TAG_KINDS);
export const catalogFaqStatus = pgEnum('catalog_faq_status', E.FAQ_STATUSES);
export const catalogMediaRole = pgEnum('catalog_media_role', E.MEDIA_ROLES);
export const catalogRelation = pgEnum('catalog_relation', E.RELATIONS);

export const catalogCollection = pgTable(
  'catalog_collection',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    nameKn: text('name_kn'),
    kind: catalogKind('kind').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => catalogCollection.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    descriptionHtml: text('description_html'),
    introHtml: text('intro_html'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    heroMediaId: uuid('hero_media_id'),
    isIndexable: boolean('is_indexable').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('catalog_collection_parent_idx').on(t.parentId, t.position)],
);

/** Per-model spacing in feet: [length, width] for area models, a single distance for line models. */
export type SpacingFt = Record<string, [number, number] | number | null>;
export type CompostKg = { at_planting: number | null; y0_2: number | null; y3_6: number | null; y7_plus: number | null };
/** Free-text horticulture attributes shown on the spec table (fruit size, intercropping, bearing text...). */
export type ProductAttributes = Record<string, string | null>;
/** Provenance per field group, e.g. { price: 'researched', content: 'ai_draft' }. */
export type DataSource = Record<string, string | null>;

export const catalogProduct = pgTable(
  'catalog_product',
  {
    id: id(),
    sku: text('sku').notNull().unique(),
    legacySku: text('legacy_sku'),
    legacyWooId: integer('legacy_woo_id'),
    erpItemId: text('erp_item_id'),
    kind: catalogKind('kind').notNull(),
    slug: text('slug').notNull().unique(),
    /** Earlier slugs; the PDP answers them with a permanent redirect even when the seo module is off. */
    previousSlugs: textArray('previous_slugs'),
    name: text('name').notNull(),
    nameKn: text('name_kn'),
    scientificName: text('scientific_name'),
    baseName: text('base_name'),
    variety: text('variety'),
    collectionId: uuid('collection_id').references(() => catalogCollection.id, { onDelete: 'restrict' }),
    subcategory: text('subcategory'),
    sizeClass: catalogSizeClass('size_class'),
    canopy: catalogCanopy('canopy'),
    propagation: catalogPropagation('propagation'),
    nitrogenFixer: boolean('nitrogen_fixer').notNull().default(false),
    droughtTolerance: catalogLevel('drought_tolerance'),
    waterNeed: catalogWaterNeed('water_need'),
    exposure: catalogExposure('exposure'),
    tempMin: num('temp_min'),
    tempOpt: num('temp_opt'),
    tempMax: num('temp_max'),
    humidityMin: num('humidity_min'),
    humidityOpt: num('humidity_opt'),
    humidityMax: num('humidity_max'),
    rainfallMin: integer('rainfall_min'),
    rainfallMax: integer('rainfall_max'),
    soilTags: textArray('soil_tags'),
    matureHeightMinFt: num('mature_height_min_ft'),
    matureHeightMaxFt: num('mature_height_max_ft'),
    bearingYearsMin: num('bearing_years_min'),
    bearingYearsMax: num('bearing_years_max'),
    timberRotationYears: num('timber_rotation_years'),
    yieldText: text('yield_text'),
    harvestSeason: text('harvest_season'),
    attributes: jsonb('attributes').$type<ProductAttributes>().notNull().default(sql`'{}'::jsonb`),
    spacingFt: jsonb('spacing_ft').$type<SpacingFt>().notNull().default(sql`'{}'::jsonb`),
    compostKg: jsonb('compost_kg').$type<CompostKg>(),
    inputType: text('input_type'),
    packSize: text('pack_size'),
    dosageRules: jsonb('dosage_rules').$type<unknown[]>(),
    shortDescription: text('short_description'),
    descriptionHtml: text('description_html'),
    careHtml: text('care_html'),
    status: catalogStatus('status').notNull().default('draft'),
    availabilityOverride: catalogAvailabilityOverride('availability_override'),
    isFeatured: boolean('is_featured').notNull().default(false),
    isBestSeller: boolean('is_best_seller').notNull().default(false),
    weightKg: num('weight_kg'),
    packingFeePaise: integer('packing_fee_paise'),
    hsn: text('hsn'),
    gstRate: num('gst_rate'),
    taxClass: text('tax_class'),
    bagSize: text('bag_size'),
    heightAtDispatchFt: num('height_at_dispatch_ft'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    focusKeyword: text('focus_keyword'),
    noindex: boolean('noindex').notNull().default(false),
    ogMediaId: uuid('og_media_id'),
    dataSource: jsonb('data_source').$type<DataSource>().notNull().default(sql`'{}'::jsonb`),
    needsReview: boolean('needs_review').notNull().default(false),
    reviewNotes: textArray('review_notes'),
    imageNeeded: boolean('image_needed').notNull().default(false),
    searchAliases: textArray('search_aliases'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('catalog_product_collection_idx').on(t.collectionId, t.status),
    index('catalog_product_best_idx').on(t.status, t.isBestSeller),
    index('catalog_product_kind_idx').on(t.kind, t.status),
    index('catalog_product_aliases_idx').using('gin', t.searchAliases),
    index('catalog_product_prev_slugs_idx').using('gin', t.previousSlugs),
    index('catalog_product_list_idx').on(t.createdAt.desc(), t.id.desc()),
  ],
);

export const catalogVariant = pgTable(
  'catalog_variant',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => catalogProduct.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    /** Appended to the product sku (`-01`); also the import's natural key within a product. */
    skuSuffix: text('sku_suffix').notNull(),
    heightFt: num('height_ft'),
    bagSize: text('bag_size'),
    weightKg: num('weight_kg'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('catalog_variant_label_uq').on(t.productId, t.label),
    uniqueIndex('catalog_variant_suffix_uq').on(t.productId, t.skuSuffix),
    uniqueIndex('catalog_variant_default_uq').on(t.productId).where(sql`${t.isDefault}`),
  ],
);

export const catalogProductCollection = pgTable(
  'catalog_product_collection',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => catalogProduct.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => catalogCollection.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.collectionId] }), index('catalog_product_collection_coll_idx').on(t.collectionId)],
);

export const catalogTag = pgTable('catalog_tag', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  nameKn: text('name_kn'),
  /** `trait` tags with active products get a curated listing page at /plants/<slug>. */
  kind: catalogTagKind('kind').notNull().default('filter'),
  showOnCard: boolean('show_on_card').notNull().default(false),
  position: integer('position').notNull().default(0),
  introHtml: text('intro_html'),
});

export const catalogProductTag = pgTable(
  'catalog_product_tag',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => catalogProduct.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => catalogTag.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.tagId] }), index('catalog_product_tag_tag_idx').on(t.tagId)],
);

export const catalogFaq = pgTable(
  'catalog_faq',
  {
    id: id(),
    /** Seed natural key (`general-001`); null for FAQs created in the admin. */
    key: text('key').unique(),
    productId: uuid('product_id').references(() => catalogProduct.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answerHtml: text('answer_html'),
    status: catalogFaqStatus('status').notNull().default('answered'),
    position: integer('position').notNull().default(0),
    source: text('source'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('catalog_faq_product_idx').on(t.productId, t.status, t.position)],
);

export const catalogProductMedia = pgTable(
  'catalog_product_media',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => catalogProduct.id, { onDelete: 'cascade' }),
    /** media_asset.id (owned by the media module; no cross-module FK). */
    mediaId: uuid('media_id').notNull(),
    role: catalogMediaRole('role').notNull().default('gallery'),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.mediaId] }), index('catalog_product_media_media_idx').on(t.mediaId)],
);

export const catalogRelated = pgTable(
  'catalog_related',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => catalogProduct.id, { onDelete: 'cascade' }),
    relatedId: uuid('related_id')
      .notNull()
      .references(() => catalogProduct.id, { onDelete: 'cascade' }),
    relation: catalogRelation('relation').notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.relatedId, t.relation] }), index('catalog_related_related_idx').on(t.relatedId)],
);

export type ProductRow = typeof catalogProduct.$inferSelect;
export type ProductInsert = typeof catalogProduct.$inferInsert;
export type VariantRow = typeof catalogVariant.$inferSelect;
export type CollectionRow = typeof catalogCollection.$inferSelect;
export type TagRow = typeof catalogTag.$inferSelect;
export type FaqRow = typeof catalogFaq.$inferSelect;
