'use cache';
// Cached catalog reads. Every export is an async 'use cache' function tagged with core cache tags; admin
// writes expire them (write.ts). Price, stock, reviews and fit are read per request by their own modules.
import { tags } from '@ecomkit/core/cache-tags';
import { db } from '@ecomkit/core/db';
import type { PlantClimate } from '@ecomkit/core/contracts';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { CardSource } from '../domain/card';
import type { Kind } from '../domain/enums';
import { facetRow } from '../domain/facets';
import {
  catalogCollection,
  catalogFaq,
  catalogProduct,
  catalogProductMedia,
  catalogProductTag,
  catalogRelated,
  catalogTag,
  catalogVariant,
  type CollectionRow,
  type ProductRow,
  type TagRow,
  type VariantRow,
} from '../schema';
import { cacheFor } from './cache';
import { climateOf, collectionPath, visible } from './shared';

const p = catalogProduct;
const parent = alias(catalogCollection, 'parent');

const defaultVariant = sql<string | null>`(select v.id from catalog_variant v where v.product_id = catalog_product.id order by v.is_default desc, v.position limit 1)`;

export interface CardRow extends CardSource {
  climate: PlantClimate | null;
}

const cardColumns = {
  id: p.id,
  slug: p.slug,
  kind: p.kind,
  name: p.name,
  nameKn: p.nameKn,
  status: p.status,
  availabilityOverride: p.availabilityOverride,
  collectionName: sql<string | null>`coalesce(${parent.name}, ${catalogCollection.name})`,
  subcategory: p.subcategory,
  sizeClass: p.sizeClass,
  bearingYearsMin: p.bearingYearsMin,
  bearingYearsMax: p.bearingYearsMax,
  timberRotationYears: p.timberRotationYears,
  yieldText: p.yieldText,
  isBestSeller: p.isBestSeller,
  publishedAt: p.publishedAt,
  variantId: defaultVariant,
  tempMin: p.tempMin,
  tempOpt: p.tempOpt,
  tempMax: p.tempMax,
  rainfallMin: p.rainfallMin,
  rainfallMax: p.rainfallMax,
  humidityMin: p.humidityMin,
  humidityOpt: p.humidityOpt,
  humidityMax: p.humidityMax,
  soilTags: p.soilTags,
};

type RawCardRow = { [K in keyof typeof cardColumns]: unknown } & Omit<CardSource, 'publishedAt'> & {
  publishedAt: Date | string | null;
  tempMin: number | null;
  tempOpt: number | null;
  tempMax: number | null;
  rainfallMin: number | null;
  rainfallMax: number | null;
  humidityMin: number | null;
  humidityOpt: number | null;
  humidityMax: number | null;
  soilTags: string[];
};

function toCardRow(r: RawCardRow): CardRow {
  return {
    id: r.id,
    slug: r.slug,
    kind: r.kind,
    name: r.name,
    nameKn: r.nameKn,
    status: r.status,
    availabilityOverride: r.availabilityOverride,
    collectionName: r.collectionName,
    subcategory: r.subcategory,
    sizeClass: r.sizeClass,
    bearingYearsMin: r.bearingYearsMin,
    bearingYearsMax: r.bearingYearsMax,
    timberRotationYears: r.timberRotationYears,
    yieldText: r.yieldText,
    isBestSeller: r.isBestSeller,
    publishedAt: r.publishedAt ? new Date(r.publishedAt) : null,
    variantId: r.variantId,
    climate: climateOf(r),
  };
}

export type ListSort = 'featured' | 'name' | 'newest';

export interface ListFilter {
  kind?: Kind;
  /** Includes the collection's children and secondary memberships. */
  collectionSlug?: string;
  tagSlug?: string;
  ids?: readonly string[];
  bestSellersOnly?: boolean;
  sort?: ListSort;
  limit?: number;
  offset?: number;
}

function collectionScope(slug: string): SQL {
  const ids = sql`(select c.id from catalog_collection c where c.slug = ${slug} or c.parent_id = (select x.id from catalog_collection x where x.slug = ${slug}))`;
  return or(sql`${p.collectionId} in ${ids}`, sql`${p.id} in (select pc.product_id from catalog_product_collection pc where pc.collection_id in ${ids})`)!;
}

/** Visible products for a listing, best sellers and featured first by default. `total` ignores limit/offset. */
export async function listProducts(filter: ListFilter = {}): Promise<{ rows: CardRow[]; total: number }> {
  cacheFor([tags.catalog, ...(filter.collectionSlug ? [tags.category(filter.collectionSlug)] : [])]);
  const where = and(
    visible(),
    filter.kind ? eq(p.kind, filter.kind) : undefined,
    filter.collectionSlug ? collectionScope(filter.collectionSlug) : undefined,
    filter.tagSlug ? sql`${p.id} in (select pt.product_id from catalog_product_tag pt join catalog_tag t on t.id = pt.tag_id where t.slug = ${filter.tagSlug})` : undefined,
    filter.ids ? (filter.ids.length ? inArray(p.id, [...filter.ids]) : sql`false`) : undefined,
    filter.bestSellersOnly ? or(eq(p.isBestSeller, true), eq(p.isFeatured, true)) : undefined,
  );
  const order =
    filter.sort === 'name'
      ? [asc(p.name), asc(p.id)]
      : filter.sort === 'newest'
        ? [desc(sql`coalesce(${p.publishedAt}, ${p.createdAt})`), desc(p.id)]
        : [desc(p.isBestSeller), desc(p.isFeatured), asc(p.name), asc(p.id)];
  const base = db.select(cardColumns).from(p).leftJoin(catalogCollection, eq(catalogCollection.id, p.collectionId)).leftJoin(parent, eq(parent.id, catalogCollection.parentId)).where(where);
  const [rows, [count]] = await Promise.all([
    base.orderBy(...order).limit(filter.limit ?? 500).offset(filter.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(p).where(where),
  ]);
  return { rows: (rows as unknown as RawCardRow[]).map(toCardRow), total: count?.n ?? 0 };
}

export interface ProductDetail {
  product: ProductRow;
  variants: VariantRow[];
  collection: { slug: string; name: string; parent: { slug: string; name: string } | null } | null;
  tags: Pick<TagRow, 'slug' | 'name' | 'kind' | 'showOnCard'>[];
  faqs: { question: string; answerHtml: string }[];
  media: { mediaId: string; role: string; position: number }[];
  related: { relatedId: string; relation: string }[];
}

/** Everything the PDP renders from catalog tables. Hidden products are returned too (the page decides). */
export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const [product] = await db.select().from(p).where(and(eq(p.slug, slug), isNull(p.deletedAt))).limit(1);
  if (!product) {
    cacheFor([tags.catalog]);
    return null;
  }
  cacheFor([tags.catalog, tags.product(product.id)]);
  const [variants, coll, tagRows, faqs, media, related] = await Promise.all([
    db.select().from(catalogVariant).where(eq(catalogVariant.productId, product.id)).orderBy(desc(catalogVariant.isDefault), asc(catalogVariant.position)),
    product.collectionId
      ? db
          .select({ slug: catalogCollection.slug, name: catalogCollection.name, parentSlug: parent.slug, parentName: parent.name })
          .from(catalogCollection)
          .leftJoin(parent, eq(parent.id, catalogCollection.parentId))
          .where(eq(catalogCollection.id, product.collectionId))
      : Promise.resolve([]),
    db
      .select({ slug: catalogTag.slug, name: catalogTag.name, kind: catalogTag.kind, showOnCard: catalogTag.showOnCard })
      .from(catalogProductTag)
      .innerJoin(catalogTag, eq(catalogTag.id, catalogProductTag.tagId))
      .where(eq(catalogProductTag.productId, product.id))
      .orderBy(asc(catalogTag.position), asc(catalogTag.name)),
    db
      .select({ question: catalogFaq.question, answerHtml: catalogFaq.answerHtml })
      .from(catalogFaq)
      .where(and(eq(catalogFaq.productId, product.id), eq(catalogFaq.status, 'published')))
      .orderBy(asc(catalogFaq.position)),
    db
      .select({ mediaId: catalogProductMedia.mediaId, role: catalogProductMedia.role, position: catalogProductMedia.position })
      .from(catalogProductMedia)
      .where(eq(catalogProductMedia.productId, product.id))
      .orderBy(sql`${catalogProductMedia.role} = 'main' desc`, asc(catalogProductMedia.position)),
    db.select({ relatedId: catalogRelated.relatedId, relation: catalogRelated.relation }).from(catalogRelated).where(eq(catalogRelated.productId, product.id)),
  ]);
  const c = coll[0];
  return {
    product,
    variants,
    collection: c ? { slug: c.slug, name: c.name, parent: c.parentSlug && c.parentName ? { slug: c.parentSlug, name: c.parentName } : null } : null,
    tags: tagRows,
    // Only answered-and-published FAQs render (and feed FAQPage JSON-LD).
    faqs: faqs.filter((f): f is { question: string; answerHtml: string } => !!f.answerHtml),
    media,
    related,
  };
}

/** Current slug for an earlier one (slug change history), or null. */
export async function movedSlug(oldSlug: string): Promise<{ slug: string; kind: Kind } | null> {
  cacheFor([tags.catalog]);
  const [row] = await db
    .select({ slug: p.slug, kind: p.kind })
    .from(p)
    .where(and(sql`${p.previousSlugs} @> array[${oldSlug}]::text[]`, isNull(p.deletedAt)))
    .limit(1);
  return row ?? null;
}

export interface CollectionDetail {
  collection: CollectionRow;
  parent: Pick<CollectionRow, 'slug' | 'name'> | null;
  children: Pick<CollectionRow, 'slug' | 'name' | 'nameKn' | 'position'>[];
}

export async function getCollection(slug: string): Promise<CollectionDetail | null> {
  cacheFor([tags.catalog, tags.category(slug)]);
  const [row] = await db.select().from(catalogCollection).where(eq(catalogCollection.slug, slug)).limit(1);
  if (!row) return null;
  const [par, children] = await Promise.all([
    row.parentId ? db.select({ slug: catalogCollection.slug, name: catalogCollection.name }).from(catalogCollection).where(eq(catalogCollection.id, row.parentId)) : Promise.resolve([]),
    db
      .select({ slug: catalogCollection.slug, name: catalogCollection.name, nameKn: catalogCollection.nameKn, position: catalogCollection.position })
      .from(catalogCollection)
      .where(eq(catalogCollection.parentId, row.id))
      .orderBy(asc(catalogCollection.position), asc(catalogCollection.name)),
  ]);
  return { collection: row, parent: par[0] ?? null, children };
}

/** Top-level collections of a kind with their visible product counts (listing tabs). */
export async function topCollections(kind: Kind): Promise<{ slug: string; name: string; count: number }[]> {
  cacheFor([tags.catalog]);
  const rows = await db
    .select({ id: catalogCollection.id, slug: catalogCollection.slug, name: catalogCollection.name })
    .from(catalogCollection)
    .where(and(eq(catalogCollection.kind, kind), isNull(catalogCollection.parentId)))
    .orderBy(asc(catalogCollection.position), asc(catalogCollection.name));
  const counts = await Promise.all(rows.map((r) => db.select({ n: sql<number>`count(*)::int` }).from(p).where(and(visible(), collectionScope(r.slug)))));
  return rows.map((r, i) => ({ slug: r.slug, name: r.name, count: counts[i]?.[0]?.n ?? 0 }));
}

/** A trait tag that has a curated page (kind = trait and at least one visible product). */
export async function getCuratedTag(slug: string): Promise<Pick<TagRow, 'slug' | 'name' | 'nameKn' | 'introHtml'> | null> {
  cacheFor([tags.catalog]);
  const [row] = await db
    .select({ slug: catalogTag.slug, name: catalogTag.name, nameKn: catalogTag.nameKn, introHtml: catalogTag.introHtml })
    .from(catalogTag)
    .where(and(eq(catalogTag.slug, slug), eq(catalogTag.kind, 'trait')))
    .limit(1);
  return row ?? null;
}

/** Static params for /plants/[collection]: plant collections plus curated trait tags with products. */
export async function listingSlugs(): Promise<{ collections: { slug: string; parentSlug: string | null }[]; traits: string[] }> {
  cacheFor([tags.catalog]);
  const [collections, traits] = await Promise.all([
    db.select({ slug: catalogCollection.slug, parentSlug: parent.slug }).from(catalogCollection).leftJoin(parent, eq(parent.id, catalogCollection.parentId)).where(eq(catalogCollection.kind, 'plant')),
    db
      .selectDistinct({ slug: catalogTag.slug })
      .from(catalogTag)
      .innerJoin(catalogProductTag, eq(catalogProductTag.tagId, catalogTag.id))
      .innerJoin(p, eq(p.id, catalogProductTag.productId))
      .where(and(eq(catalogTag.kind, 'trait'), visible())),
  ]);
  return { collections, traits: traits.map((t) => t.slug) };
}

/** Slugs to prerender at build time (visible products). */
export async function productSlugs(kind: Kind): Promise<string[]> {
  cacheFor([tags.catalog]);
  const rows = await db.select({ slug: p.slug }).from(p).where(and(visible(), eq(p.kind, kind))).orderBy(asc(p.slug));
  return rows.map((r) => r.slug);
}

/** Main image media id per product (first `main`, else the lowest position). */
export async function mainMediaIds(productIds: readonly string[]): Promise<Record<string, string>> {
  cacheFor([tags.catalog]);
  if (!productIds.length) return {};
  const rows = await db
    .selectDistinctOn([catalogProductMedia.productId], { productId: catalogProductMedia.productId, mediaId: catalogProductMedia.mediaId })
    .from(catalogProductMedia)
    .where(inArray(catalogProductMedia.productId, [...productIds]))
    .orderBy(catalogProductMedia.productId, sql`${catalogProductMedia.role} = 'main' desc`, asc(catalogProductMedia.position));
  return Object.fromEntries(rows.map((r) => [r.productId, r.mediaId]));
}

/** Rows for the search module's facet index (visible products only). */
export async function facetSource() {
  cacheFor([tags.catalog]);
  const rows = await db
    .select({
      id: p.id,
      kind: p.kind,
      sizeClass: p.sizeClass,
      propagation: p.propagation,
      exposure: p.exposure,
      droughtTolerance: p.droughtTolerance,
      waterNeed: p.waterNeed,
      nitrogenFixer: p.nitrogenFixer,
      tempMin: p.tempMin,
      tempMax: p.tempMax,
      rainfallMin: p.rainfallMin,
      rainfallMax: p.rainfallMax,
      bearingYearsMin: p.bearingYearsMin,
      matureHeightMaxFt: p.matureHeightMaxFt,
      hasYield: sql<boolean>`${p.yieldText} is not null`,
      collectionSlugs: sql<string[]>`array_remove(array[(select c.slug from catalog_collection c where c.id = catalog_product.collection_id), (select pc.slug from catalog_collection c join catalog_collection pc on pc.id = c.parent_id where c.id = catalog_product.collection_id)] || coalesce((select array_agg(c.slug) from catalog_product_collection x join catalog_collection c on c.id = x.collection_id where x.product_id = catalog_product.id), '{}'), null)`,
      tagSlugs: sql<string[]>`coalesce((select array_agg(t.slug order by t.slug) from catalog_product_tag pt join catalog_tag t on t.id = pt.tag_id where pt.product_id = catalog_product.id), '{}')`,
    })
    .from(p)
    .where(visible())
    .orderBy(asc(p.id));
  return rows.map((r) => facetRow({ ...r, collectionSlugs: [...new Set(r.collectionSlugs)] }));
}

/** Sitemap entries: visible indexable products, plant collections, curated trait pages. */
export async function sitemapEntries(): Promise<{ path: string; lastModified?: string }[]> {
  cacheFor([tags.catalog]);
  const [products, collections, curated] = await Promise.all([
    db.select({ slug: p.slug, kind: p.kind, updatedAt: p.updatedAt }).from(p).where(and(visible(), eq(p.noindex, false))).orderBy(asc(p.slug)),
    db
      .select({ slug: catalogCollection.slug, parentSlug: parent.slug, kind: catalogCollection.kind, updatedAt: catalogCollection.updatedAt })
      .from(catalogCollection)
      .leftJoin(parent, eq(parent.id, catalogCollection.parentId))
      .where(eq(catalogCollection.isIndexable, true)),
    listingSlugs(),
  ]);
  const iso = (d: Date) => d.toISOString();
  return [
    ...products.map((r) => ({ path: r.kind === 'input' ? `/input/${r.slug}` : `/plant/${r.slug}`, lastModified: iso(r.updatedAt) })),
    ...collections.filter((c) => c.kind === 'plant').map((c) => ({ path: collectionPath(c), lastModified: iso(c.updatedAt) })),
    ...curated.traits.map((slug) => ({ path: `/plants/${slug}` })),
  ];
}
