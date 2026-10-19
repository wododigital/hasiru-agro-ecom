// Admin reads: always fresh (no 'use cache'), every list paged with an id tiebreak.
import { db } from '@ecomkit/core/db';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Kind } from '../domain/enums';
import { catalogCollection, catalogFaq, catalogProduct as p, catalogProductCollection, catalogProductTag, catalogTag, catalogVariant } from '../schema';

export const ADMIN_PAGE_SIZE = 50;

export interface AdminProductFilter {
  kind: Kind;
  q?: string;
  status?: string;
  review?: 'needs_review' | 'image_needed';
  sort?: string | null;
  dir?: 'asc' | 'desc';
  page?: number;
}

export async function listAdminProducts(f: AdminProductFilter) {
  const q = f.q?.trim();
  const where = and(
    eq(p.kind, f.kind),
    isNull(p.deletedAt),
    f.status === 'draft' || f.status === 'active' || f.status === 'archived' ? eq(p.status, f.status) : undefined,
    f.review === 'needs_review' ? eq(p.needsReview, true) : f.review === 'image_needed' ? eq(p.imageNeeded, true) : undefined,
    q ? or(ilike(p.name, `%${q}%`), ilike(p.sku, `%${q}%`), ilike(p.slug, `%${q}%`), sql`${p.searchAliases}::text ilike ${`%${q}%`}`) : undefined,
  );
  const dir = f.dir === 'desc' ? desc : asc;
  const order = f.sort === 'sku' ? [dir(p.sku)] : f.sort === 'updated' ? [dir(p.updatedAt)] : f.sort === 'status' ? [dir(p.status)] : [dir(p.name)];
  const page = Math.max(1, f.page ?? 1);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: p.id,
        sku: p.sku,
        name: p.name,
        slug: p.slug,
        status: p.status,
        availabilityOverride: p.availabilityOverride,
        needsReview: p.needsReview,
        imageNeeded: p.imageNeeded,
        updatedAt: p.updatedAt,
        collection: catalogCollection.name,
      })
      .from(p)
      .leftJoin(catalogCollection, eq(catalogCollection.id, p.collectionId))
      .where(where)
      .orderBy(...order, asc(p.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset((page - 1) * ADMIN_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(p).where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

/** The product form's data: row, variants, tag ids, secondary collection ids. */
export async function getProductForEdit(id: string) {
  const [product] = await db.select().from(p).where(and(eq(p.id, id), isNull(p.deletedAt)));
  if (!product) return null;
  const [variants, tagRows, secondary] = await Promise.all([
    db.select().from(catalogVariant).where(eq(catalogVariant.productId, id)).orderBy(asc(catalogVariant.position)),
    db.select({ tagId: catalogProductTag.tagId }).from(catalogProductTag).where(eq(catalogProductTag.productId, id)),
    db.select({ collectionId: catalogProductCollection.collectionId }).from(catalogProductCollection).where(eq(catalogProductCollection.productId, id)),
  ]);
  return { product, variants, tagIds: tagRows.map((t) => t.tagId), secondaryCollectionIds: secondary.map((s) => s.collectionId) };
}

export async function listCollectionsAdmin() {
  return db
    .select({
      id: catalogCollection.id,
      slug: catalogCollection.slug,
      name: catalogCollection.name,
      nameKn: catalogCollection.nameKn,
      kind: catalogCollection.kind,
      parentId: catalogCollection.parentId,
      position: catalogCollection.position,
      isIndexable: catalogCollection.isIndexable,
      introHtml: catalogCollection.introHtml,
      seoTitle: catalogCollection.seoTitle,
      seoDescription: catalogCollection.seoDescription,
      descriptionHtml: catalogCollection.descriptionHtml,
      products: sql<number>`(select count(*)::int from catalog_product x where x.collection_id = catalog_collection.id and x.deleted_at is null)`,
    })
    .from(catalogCollection)
    .orderBy(asc(catalogCollection.kind), asc(catalogCollection.position), asc(catalogCollection.name), asc(catalogCollection.id));
}

export async function listTagsAdmin() {
  return db
    .select({
      id: catalogTag.id,
      slug: catalogTag.slug,
      name: catalogTag.name,
      nameKn: catalogTag.nameKn,
      kind: catalogTag.kind,
      showOnCard: catalogTag.showOnCard,
      position: catalogTag.position,
      introHtml: catalogTag.introHtml,
      products: sql<number>`(select count(*)::int from catalog_product_tag x where x.tag_id = catalog_tag.id)`,
    })
    .from(catalogTag)
    .orderBy(asc(catalogTag.kind), asc(catalogTag.position), asc(catalogTag.name), asc(catalogTag.id));
}

export async function listFaqsAdmin(filter: { status?: string; page?: number } = {}) {
  const where: SQL | undefined =
    filter.status && ['answered', 'ai_draft', 'client_only', 'published'].includes(filter.status) ? eq(catalogFaq.status, filter.status as 'published') : undefined;
  const page = Math.max(1, filter.page ?? 1);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: catalogFaq.id,
        productId: catalogFaq.productId,
        product: p.name,
        question: catalogFaq.question,
        answerHtml: catalogFaq.answerHtml,
        status: catalogFaq.status,
        position: catalogFaq.position,
        source: catalogFaq.source,
      })
      .from(catalogFaq)
      .leftJoin(p, eq(p.id, catalogFaq.productId))
      .where(where)
      .orderBy(sql`${p.name} nulls first`, asc(catalogFaq.position), asc(catalogFaq.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset((page - 1) * ADMIN_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(catalogFaq).where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

export type GapKind = 'needs_review' | 'image_needed' | 'no_collection' | 'no_description' | 'no_local_name' | 'no_scientific_name' | 'no_size_class' | 'no_climate' | 'no_spacing' | 'unanswered_faqs';

/**
 * Data gaps: products flagged for review or missing a field the storefront or the planting tools need, with the
 * importer's review notes (the open questions for the grower). Drafts are included: they are what needs filling.
 */
export async function dataGaps(): Promise<{ id: string; sku: string; name: string; kind: Kind; status: string; gaps: GapKind[]; notes: string[] }[]> {
  const rows = await db
    .select({
      id: p.id,
      sku: p.sku,
      name: p.name,
      kind: p.kind,
      status: p.status,
      needsReview: p.needsReview,
      imageNeeded: p.imageNeeded,
      collectionId: p.collectionId,
      descriptionHtml: p.descriptionHtml,
      shortDescription: p.shortDescription,
      nameKn: p.nameKn,
      scientificName: p.scientificName,
      sizeClass: p.sizeClass,
      tempMin: p.tempMin,
      rainfallMin: p.rainfallMin,
      spacingFt: p.spacingFt,
      reviewNotes: p.reviewNotes,
      openFaqs: sql<number>`(select count(*)::int from catalog_faq f where f.product_id = catalog_product.id and f.status <> 'published')`,
    })
    .from(p)
    .where(isNull(p.deletedAt))
    .orderBy(asc(p.status), asc(p.name), asc(p.id));
  return rows
    .map((r) => {
      const plant = r.kind === 'plant';
      const gaps: GapKind[] = [];
      if (r.needsReview) gaps.push('needs_review');
      if (r.imageNeeded) gaps.push('image_needed');
      if (!r.collectionId) gaps.push('no_collection');
      if (!r.descriptionHtml && !r.shortDescription) gaps.push('no_description');
      if (!r.nameKn) gaps.push('no_local_name');
      if (plant && !r.scientificName) gaps.push('no_scientific_name');
      if (plant && !r.sizeClass) gaps.push('no_size_class');
      if (plant && (r.tempMin == null || r.rainfallMin == null)) gaps.push('no_climate');
      if (plant && !Object.values(r.spacingFt ?? {}).some((v) => v != null)) gaps.push('no_spacing');
      if (r.openFaqs > 0) gaps.push('unanswered_faqs');
      return { id: r.id, sku: r.sku, name: r.name, kind: r.kind, status: r.status, gaps, notes: r.reviewNotes };
    })
    .filter((r) => r.gaps.length > 0);
}

export async function collectionOptions() {
  return db.select({ id: catalogCollection.id, name: catalogCollection.name, kind: catalogCollection.kind, parentId: catalogCollection.parentId }).from(catalogCollection).orderBy(asc(catalogCollection.position), asc(catalogCollection.name));
}

export async function tagOptions() {
  return db.select({ id: catalogTag.id, name: catalogTag.name, kind: catalogTag.kind }).from(catalogTag).orderBy(asc(catalogTag.kind), asc(catalogTag.name));
}

export async function productOptions() {
  return db.select({ id: p.id, name: p.name }).from(p).where(isNull(p.deletedAt)).orderBy(asc(p.name));
}
