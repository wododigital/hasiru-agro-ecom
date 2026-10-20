import { audit } from '@ecomkit/core/audit';
import { NotFoundError } from '@ecomkit/core/auth-context';
import { tags } from '@ecomkit/core/cache-tags';
import { withTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { createLogger } from '@ecomkit/core/observability';
import { safeHtml } from '@ecomkit/core/validation';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { productPath } from '../domain/card';
import * as E from '../domain/enums';
import { normaliseVariants, SLUG_PATTERN, type ProductFields, type VariantFields } from '../domain/product';
import { catalogCollection, catalogFaq, catalogProduct, catalogProductCollection, catalogProductTag, catalogTag, catalogVariant, type ProductRow } from '../schema';
import { expireTags } from '@ecomkit/core/cache-tags';
import { catalogRuntime } from './runtime';

const log = createLogger('catalog');

export interface Actor {
  actorId: string | null;
  actorType: 'staff' | 'system';
}

export interface SaveProductInput {
  /** Null creates a product. */
  id: string | null;
  fields: ProductFields;
  /** At least one; an empty list keeps (or creates) a single default variant. */
  variants: readonly VariantFields[];
  /** Replaces the product's tags when given. */
  tagIds?: readonly string[];
  /** Replaces secondary collection memberships when given. */
  secondaryCollectionIds?: readonly string[];
}

export interface SaveProductResult {
  id: string;
  slug: string;
  previousSlug: string | null;
  /** How caches were expired: `update` inside a server action (read-your-own-writes), `invalidate` elsewhere. */
  expired: 'update' | 'invalidate';
}

async function collectionTags(tx: Tx, ids: readonly (string | null)[]): Promise<string[]> {
  const real = ids.filter((x): x is string => !!x);
  if (!real.length) return [];
  const rows = await tx
    .select({ slug: catalogCollection.slug, parentSlug: sql<string | null>`(select x.slug from catalog_collection x where x.id = catalog_collection.parent_id)` })
    .from(catalogCollection)
    .where(inArray(catalogCollection.id, real));
  return rows.flatMap((r) => [tags.category(r.slug), ...(r.parentSlug ? [tags.category(r.parentSlug)] : [])]);
}

async function syncVariants(tx: Tx, productId: string, input: readonly VariantFields[], fallbackLabel: string): Promise<void> {
  const existing = await tx.select().from(catalogVariant).where(eq(catalogVariant.productId, productId));
  const wanted = normaliseVariants(input.length ? input : existing.length ? [] : [{ id: null, label: fallbackLabel, skuSuffix: '-01', isDefault: true, heightFt: null, bagSize: null, weightKg: null, position: 0 }]);
  if (!wanted.length) return;
  const keep: string[] = [];
  // Clear the default flag first so the partial unique index never sees two defaults mid-update.
  await tx.update(catalogVariant).set({ isDefault: false }).where(eq(catalogVariant.productId, productId));
  for (const v of wanted) {
    const match = existing.find((e) => (v.id && e.id === v.id) || e.skuSuffix === v.skuSuffix);
    const values = { label: v.label, skuSuffix: v.skuSuffix, isDefault: v.isDefault, heightFt: v.heightFt, bagSize: v.bagSize, weightKg: v.weightKg, position: v.position };
    if (match) {
      await tx.update(catalogVariant).set(values).where(eq(catalogVariant.id, match.id));
      keep.push(match.id);
    } else {
      const [row] = await tx.insert(catalogVariant).values({ productId, ...values }).returning({ id: catalogVariant.id });
      keep.push(row!.id);
    }
  }
  await tx.delete(catalogVariant).where(and(eq(catalogVariant.productId, productId), notInArray(catalogVariant.id, keep)));
}

/**
 * Creates or updates a product in one transaction: variants, tags, secondary collections, audit row and the
 * `product.updated` (+ `product.published` on first activation) events in the same transaction. A slug change
 * keeps the old slug in `previous_slugs` (the PDP 301s it) and asks the seo module for a redirect after commit.
 */
export async function saveProduct(input: SaveProductInput, actor: Actor): Promise<SaveProductResult> {
  const f = input.fields;
  const values = {
    ...f,
    descriptionHtml: f.descriptionHtml ? safeHtml(f.descriptionHtml) : null,
    careHtml: f.careHtml ? safeHtml(f.careHtml) : null,
    updatedAt: new Date(),
  };

  const result = await withTx(async (tx) => {
    let before: ProductRow | null = null;
    if (input.id) {
      [before = null] = await tx.select().from(catalogProduct).where(eq(catalogProduct.id, input.id)).for('update');
      if (!before || before.deletedAt) throw new NotFoundError('product not found');
    }
    const slugChanged = !!before && before.slug !== f.slug;
    const previousSlugs = before ? [...new Set([...before.previousSlugs, ...(slugChanged ? [before.slug] : [])])].filter((s) => s !== f.slug) : [];
    const publishedAt = f.status === 'active' ? (before?.publishedAt ?? new Date()) : (before?.publishedAt ?? null);

    // A slug a product gives up can be claimed by another one: the new owner wins the old path.
    await tx
      .update(catalogProduct)
      .set({ previousSlugs: sql`array_remove(${catalogProduct.previousSlugs}, ${f.slug})` })
      .where(sql`${catalogProduct.previousSlugs} @> array[${f.slug}]::text[]`);

    const [row] = before
      ? await tx.update(catalogProduct).set({ ...values, previousSlugs, publishedAt }).where(eq(catalogProduct.id, before.id)).returning()
      : await tx.insert(catalogProduct).values({ ...values, previousSlugs, publishedAt }).returning();
    const product = row!;

    await syncVariants(tx, product.id, input.variants, product.name);
    if (input.tagIds) {
      await tx.delete(catalogProductTag).where(eq(catalogProductTag.productId, product.id));
      if (input.tagIds.length) await tx.insert(catalogProductTag).values([...new Set(input.tagIds)].map((tagId) => ({ productId: product.id, tagId })));
    }
    let secondary: string[] = [];
    if (input.secondaryCollectionIds) {
      const old = await tx.select({ id: catalogProductCollection.collectionId }).from(catalogProductCollection).where(eq(catalogProductCollection.productId, product.id));
      secondary = [...old.map((o) => o.id), ...input.secondaryCollectionIds];
      await tx.delete(catalogProductCollection).where(eq(catalogProductCollection.productId, product.id));
      if (input.secondaryCollectionIds.length)
        await tx.insert(catalogProductCollection).values([...new Set(input.secondaryCollectionIds)].map((collectionId) => ({ productId: product.id, collectionId })));
    }

    await audit({ actorId: actor.actorId, actorType: actor.actorType, action: before ? 'product.update' : 'product.create', entity: 'catalog_product', entityId: product.id, before, after: product }, { tx });
    await emit('product.updated', { productId: product.id }, { tx });
    if (product.status === 'active' && before?.status !== 'active') await emit('product.published', { productId: product.id, slug: product.slug }, { tx });

    const tagList = [tags.catalog, tags.product(product.id), ...(await collectionTags(tx, [before?.collectionId ?? null, product.collectionId, ...secondary]))];
    return { product, previousSlug: slugChanged ? before!.slug : null, tagList };
  });

  const { product, previousSlug } = result;
  const addRedirect = catalogRuntime().addRedirect;
  if (previousSlug && addRedirect) {
    try {
      await addRedirect(productPath(product.kind, previousSlug), productPath(product.kind, product.slug));
    } catch (err) {
      // previous_slugs still answers the old URL with a 301; the seo table catches up on the next save.
      log.warn('redirect not recorded', { productId: product.id, error: String(err) });
    }
  }
  const expired = await expireTags(result.tagList);
  return { id: product.id, slug: product.slug, previousSlug, expired };
}

/**
 * Bulk status change from the products index: one transaction, an audit row and `product.updated` per product
 * (`product.published` on first activation, as `saveProduct` does), deleted products skipped. Returns how many changed.
 */
export async function setProductStatus(ids: readonly string[], status: (typeof E.STATUSES)[number], actor: Actor): Promise<number> {
  const wanted = z.array(z.uuid()).max(200).parse([...new Set(ids)]);
  if (!wanted.length) return 0;
  const { count, tagList } = await withTx(async (tx) => {
    const before = await tx.select().from(catalogProduct).where(and(inArray(catalogProduct.id, wanted), sql`${catalogProduct.deletedAt} is null`)).for('update');
    const changed = before.filter((b) => b.status !== status);
    for (const b of changed) {
      const [after] = await tx
        .update(catalogProduct)
        .set({ status, updatedAt: new Date(), publishedAt: status === 'active' ? (b.publishedAt ?? new Date()) : b.publishedAt })
        .where(eq(catalogProduct.id, b.id))
        .returning();
      await audit({ actorId: actor.actorId, actorType: actor.actorType, action: 'product.update', entity: 'catalog_product', entityId: b.id, before: b, after }, { tx });
      await emit('product.updated', { productId: b.id }, { tx });
      if (status === 'active') await emit('product.published', { productId: b.id, slug: b.slug }, { tx });
    }
    const tagList = changed.length ? [tags.catalog, ...changed.map((b) => tags.product(b.id)), ...(await collectionTags(tx, changed.map((b) => b.collectionId)))] : [];
    return { count: changed.length, tagList };
  });
  if (tagList.length) await expireTags(tagList);
  return count;
}

/** Soft delete: the row stays for orders and history; the PDP 404s and listings drop it. */
export async function deleteProduct(id: string, actor: Actor): Promise<void> {
  const tagList = await withTx(async (tx) => {
    const [row] = await tx.update(catalogProduct).set({ deletedAt: new Date(), status: 'archived' }).where(eq(catalogProduct.id, id)).returning();
    if (!row) throw new NotFoundError('product not found');
    await audit({ actorId: actor.actorId, actorType: actor.actorType, action: 'product.delete', entity: 'catalog_product', entityId: id }, { tx });
    await emit('product.updated', { productId: id }, { tx });
    return [tags.catalog, tags.product(id), ...(await collectionTags(tx, [row.collectionId]))];
  });
  await expireTags(tagList);
}

const blank = (v: unknown) => (v === '' || v === undefined ? null : v);
const optText = z.preprocess(blank, z.string().trim().max(50_000).nullable());

export const collectionFieldsSchema = z.object({
  id: z.preprocess(blank, z.uuid().nullable()).default(null),
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN).max(120),
  name: z.string().trim().min(1).max(120),
  nameKn: optText,
  kind: z.enum(E.KINDS),
  parentId: z.preprocess(blank, z.uuid().nullable()).default(null),
  position: z.coerce.number().int().default(0),
  descriptionHtml: optText,
  introHtml: optText,
  seoTitle: optText,
  seoDescription: optText,
  isIndexable: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()),
});
export type CollectionFields = z.infer<typeof collectionFieldsSchema>;

export async function saveCollection(input: CollectionFields, actor: Actor): Promise<{ id: string }> {
  const { id, ...rest } = input;
  if (id && rest.parentId === id) throw new Error('a collection cannot be its own parent');
  const values = { ...rest, descriptionHtml: rest.descriptionHtml ? safeHtml(rest.descriptionHtml) : null, introHtml: rest.introHtml ? safeHtml(rest.introHtml) : null, updatedAt: new Date() };
  const row = await withTx(async (tx) => {
    const [before] = id ? await tx.select().from(catalogCollection).where(eq(catalogCollection.id, id)) : [];
    if (id && !before) throw new NotFoundError('collection not found');
    const [saved] = before
      ? await tx.update(catalogCollection).set(values).where(eq(catalogCollection.id, before.id)).returning()
      : await tx.insert(catalogCollection).values(values).returning();
    await audit({ actorId: actor.actorId, actorType: actor.actorType, action: before ? 'collection.update' : 'collection.create', entity: 'catalog_collection', entityId: saved!.id, before, after: saved }, { tx });
    return { saved: saved!, oldSlug: before?.slug ?? null };
  });
  await expireTags([tags.catalog, tags.nav, tags.category(row.saved.slug), ...(row.oldSlug ? [tags.category(row.oldSlug)] : [])]);
  return { id: row.saved.id };
}

/** Refuses while products still point at the collection (the FK is RESTRICT). */
export async function deleteCollection(id: string, actor: Actor): Promise<void> {
  const slug = await withTx(async (tx) => {
    const [row] = await tx.delete(catalogCollection).where(eq(catalogCollection.id, id)).returning();
    if (!row) throw new NotFoundError('collection not found');
    await audit({ actorId: actor.actorId, actorType: actor.actorType, action: 'collection.delete', entity: 'catalog_collection', entityId: id, before: row }, { tx });
    return row.slug;
  });
  await expireTags([tags.catalog, tags.nav, tags.category(slug)]);
}

export const tagFieldsSchema = z.object({
  id: z.preprocess(blank, z.uuid().nullable()).default(null),
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN).max(80),
  name: z.string().trim().min(1).max(80),
  nameKn: optText,
  kind: z.enum(E.TAG_KINDS),
  showOnCard: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()),
  position: z.coerce.number().int().default(0),
  introHtml: optText,
});
export type TagFields = z.infer<typeof tagFieldsSchema>;

export async function saveTag(input: TagFields, actor: Actor): Promise<{ id: string }> {
  const { id, ...rest } = input;
  const values = { ...rest, introHtml: rest.introHtml ? safeHtml(rest.introHtml) : null };
  const saved = await withTx(async (tx) => {
    const [before] = id ? await tx.select().from(catalogTag).where(eq(catalogTag.id, id)) : [];
    if (id && !before) throw new NotFoundError('tag not found');
    const [row] = before ? await tx.update(catalogTag).set(values).where(eq(catalogTag.id, before.id)).returning() : await tx.insert(catalogTag).values(values).returning();
    await audit({ actorId: actor.actorId, actorType: actor.actorType, action: before ? 'tag.update' : 'tag.create', entity: 'catalog_tag', entityId: row!.id, before, after: row }, { tx });
    return row!;
  });
  await expireTags([tags.catalog]);
  return { id: saved.id };
}

export async function deleteTag(id: string, actor: Actor): Promise<void> {
  await withTx(async (tx) => {
    const [row] = await tx.delete(catalogTag).where(eq(catalogTag.id, id)).returning();
    if (!row) throw new NotFoundError('tag not found');
    await audit({ actorId: actor.actorId, actorType: actor.actorType, action: 'tag.delete', entity: 'catalog_tag', entityId: id, before: row }, { tx });
  });
  await expireTags([tags.catalog]);
}

export const faqFieldsSchema = z.object({
  id: z.preprocess(blank, z.uuid().nullable()).default(null),
  productId: z.preprocess(blank, z.uuid().nullable()).default(null),
  question: z.string().trim().min(3).max(500),
  answerHtml: optText,
  status: z.enum(E.FAQ_STATUSES),
  position: z.coerce.number().int().default(0),
  source: z.preprocess(blank, z.string().trim().max(40).nullable()).default(null),
});
export type FaqFields = z.infer<typeof faqFieldsSchema>;

/** A FAQ can only be published with an answer (unanswered questions never render). */
export async function saveFaq(input: FaqFields, actor: Actor): Promise<{ id: string }> {
  const { id, ...rest } = input;
  if (rest.status === 'published' && !rest.answerHtml) throw new Error('a published FAQ needs an answer');
  const values = { ...rest, answerHtml: rest.answerHtml ? safeHtml(rest.answerHtml) : null, updatedAt: new Date() };
  const saved = await withTx(async (tx) => {
    const [before] = id ? await tx.select().from(catalogFaq).where(eq(catalogFaq.id, id)) : [];
    if (id && !before) throw new NotFoundError('faq not found');
    const [row] = before ? await tx.update(catalogFaq).set(values).where(eq(catalogFaq.id, before.id)).returning() : await tx.insert(catalogFaq).values(values).returning();
    await audit({ actorId: actor.actorId, actorType: actor.actorType, action: before ? 'faq.update' : 'faq.create', entity: 'catalog_faq', entityId: row!.id, before, after: row }, { tx });
    return row!;
  });
  await expireTags([tags.catalog, ...(saved.productId ? [tags.product(saved.productId)] : [])]);
  return { id: saved.id };
}

export async function deleteFaq(id: string, actor: Actor): Promise<void> {
  const productId = await withTx(async (tx) => {
    const [row] = await tx.delete(catalogFaq).where(eq(catalogFaq.id, id)).returning();
    if (!row) throw new NotFoundError('faq not found');
    await audit({ actorId: actor.actorId, actorType: actor.actorType, action: 'faq.delete', entity: 'catalog_faq', entityId: id, before: row }, { tx });
    return row.productId;
  });
  await expireTags([tags.catalog, ...(productId ? [tags.product(productId)] : [])]);
}
