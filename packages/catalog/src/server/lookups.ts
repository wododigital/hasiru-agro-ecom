// System reads other modules bind at boot through their ports (cart, pricing, orders, reviews, flows, seo).
// Shapes match those ports structurally; catalog never imports them.
import type { ImageRef, StockInfo } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { deriveAvailability, isPurchasable } from '../domain/availability';
import { productPath } from '../domain/card';
import { catalogProduct as p, catalogProductCollection, catalogProductTag, catalogVariant as v } from '../schema';
import { imagesFor } from './cards';
import { mainMediaIds } from './queries';
import { optionalService } from './runtime';

export interface VariantFacts {
  variantId: string;
  productId: string;
  kind: 'plant' | 'input';
  name: string;
  nameKn: string | null;
  label: string | null;
  href: string;
  weightKg: number | null;
  image: ImageRef | null;
  purchasable: boolean;
  collectionIds: string[];
  tagIds: string[];
  sku: string;
  hsn: string | null;
  sizeClass: string | null;
  packingFeePaise: number;
}

/** Variant facts for carts and checkout, keyed by variant id (unknown ids are absent). */
export async function variantFacts(variantIds: readonly string[]): Promise<Record<string, VariantFacts>> {
  const ids = [...new Set(variantIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return {};
  const rows = await db
    .select({ v, p })
    .from(v)
    .innerJoin(p, eq(p.id, v.productId))
    .where(and(inArray(v.id, ids), isNull(p.deletedAt)));
  if (!rows.length) return {};
  const productIds = [...new Set(rows.map((r) => r.p.id))];
  const [inventory, media, cols, tagRows, counts] = await Promise.all([
    optionalService('inventory'),
    mainMediaIds(productIds),
    db.select().from(catalogProductCollection).where(inArray(catalogProductCollection.productId, productIds)),
    db.select().from(catalogProductTag).where(inArray(catalogProductTag.productId, productIds)),
    db.select({ productId: v.productId }).from(v).where(inArray(v.productId, productIds)),
  ]);
  const [stocks, images] = await Promise.all([
    inventory ? inventory.getStocks(rows.map((r) => r.v.id)) : Promise.resolve({} as Record<string, StockInfo>),
    imagesFor(Object.values(media)),
  ]);
  const out: Record<string, VariantFacts> = {};
  for (const { v: vr, p: pr } of rows) {
    const state = deriveAvailability({ status: pr.status, override: pr.availabilityOverride, deletedAt: pr.deletedAt, stock: stocks[vr.id] ?? null });
    const single = counts.filter((c) => c.productId === pr.id).length === 1;
    out[vr.id] = {
      variantId: vr.id,
      productId: pr.id,
      kind: pr.kind,
      name: pr.name,
      nameKn: pr.nameKn,
      label: single ? null : vr.label,
      href: productPath(pr.kind, pr.slug),
      weightKg: vr.weightKg ?? pr.weightKg,
      image: media[pr.id] ? (images[media[pr.id]!] ?? null) : null,
      purchasable: isPurchasable(state),
      collectionIds: [...new Set([pr.collectionId, ...cols.filter((c) => c.productId === pr.id).map((c) => c.collectionId)].filter((x): x is string => !!x))],
      tagIds: tagRows.filter((t) => t.productId === pr.id).map((t) => t.tagId),
      sku: `${pr.sku}${vr.skuSuffix}`,
      hsn: pr.hsn,
      sizeClass: pr.sizeClass,
      packingFeePaise: pr.packingFeePaise ?? 0,
    };
  }
  return out;
}

/** GST rate (percent) per product id; products without a rate are absent (pricing quotes them at 0). */
export async function gstRatesFor(productIds: readonly string[]): Promise<Record<string, number>> {
  if (!productIds.length) return {};
  const rows = await db.select({ id: p.id, gst: p.gstRate }).from(p).where(inArray(p.id, [...new Set(productIds)]));
  return Object.fromEntries(rows.flatMap((r) => (r.gst == null ? [] : [[r.id, r.gst]])));
}

export async function variantsOf(productId: string): Promise<{ variantId: string; label: string }[]> {
  const rows = await db.select({ variantId: v.id, label: v.label }).from(v).where(eq(v.productId, productId)).orderBy(asc(v.position));
  return rows;
}

/** Name and storefront link of a product (deleted products answer null). */
export async function productLabel(productId: string): Promise<{ name: string; href: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return null;
  const [r] = await db.select({ name: p.name, kind: p.kind, slug: p.slug }).from(p).where(and(eq(p.id, productId), isNull(p.deletedAt)));
  return r ? { name: r.name, href: productPath(r.kind, r.slug) } : null;
}

/** A variant by its full sku (product sku + variant suffix), for staff manual orders. */
export async function variantBySku(sku: string): Promise<{ variantId: string; productId: string; snapshot: { name: string; sku: string; hsn: string | null; gstRatePct: number; sizeClass: string | null; weightKg: number } } | null> {
  const [hit] = await db
    .select({ v, p })
    .from(v)
    .innerJoin(p, eq(p.id, v.productId))
    .where(and(sql`${p.sku} || ${v.skuSuffix} = ${sku}`, isNull(p.deletedAt)));
  if (!hit) return null;
  return {
    variantId: hit.v.id,
    productId: hit.p.id,
    snapshot: { name: hit.p.name, sku: `${hit.p.sku}${hit.v.skuSuffix}`, hsn: hit.p.hsn, gstRatePct: hit.p.gstRate ?? 0, sizeClass: hit.p.sizeClass, weightKg: hit.v.weightKg ?? hit.p.weightKg ?? 0 },
  };
}

/** The storefront path and current SEO text of a product (seo's product form tab). */
export async function productSeo(_kind: 'product', id: string): Promise<{ path: string; title: string; description: string; noindex: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db.select().from(p).where(eq(p.id, id));
  return r ? { path: productPath(r.kind, r.slug), title: r.seoTitle ?? r.name, description: r.seoDescription ?? r.shortDescription ?? '', noindex: r.noindex } : null;
}

/** Variant and product ids by full variant sku (product sku + suffix), for other modules' seed hooks. */
export async function variantRefsBySku(skus: readonly string[]): Promise<Record<string, { variantId: string; productId: string }>> {
  if (!skus.length) return {};
  const full = sql<string>`${p.sku} || ${v.skuSuffix}`;
  const rows = await db.select({ sku: full, variantId: v.id, productId: v.productId }).from(v).innerJoin(p, eq(p.id, v.productId)).where(inArray(full, [...new Set(skus)]));
  return Object.fromEntries(rows.map((r) => [r.sku, { variantId: r.variantId, productId: r.productId }]));
}
