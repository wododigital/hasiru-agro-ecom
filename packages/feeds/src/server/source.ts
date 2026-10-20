import { getProductBySlug, listProducts, type ProductDetail } from '@ecomkit/catalog/server';
import { deriveAvailability, offerAvailability } from '@ecomkit/catalog/domain';
import { getStocks } from '@ecomkit/inventory/server';
import { baseOf, derivativeKey, mediaSrc, planWidths, shareSrc } from '@ecomkit/media/domain';
import { getImages } from '@ecomkit/media/server';
import { getPrices } from '@ecomkit/pricing/server';
import type { ImageRef } from '@ecomkit/core/contracts';
import type { FeedSourceRow } from '../domain/item';

const FEED_IMAGE_PX = 800;
const DETAIL_CONCURRENCY = 8;

/** Media URLs for a feed: the 800 px WebP derivative (or the largest below it) and the share JPEG. */
export function feedImagePaths(ref: Pick<ImageRef, 'src' | 'width'>): { webp: string; jpeg: string } {
  const storageKey = `public${ref.src.slice('/media'.length)}`;
  const base = baseOf(storageKey);
  const widths = planWidths(ref.width);
  const width = widths.includes(FEED_IMAGE_PX) ? FEED_IMAGE_PX : widths[widths.length - 1]!;
  return { webp: mediaSrc(derivativeKey(base, width, 'webp')), jpeg: shareSrc(storageKey) };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/**
 * One row per variant of every visible, indexable product, read through the public server APIs of catalog,
 * pricing, inventory and media (never their tables). About 2 + products / 8 round trips; run in the worker.
 */
export async function loadFeedRows(): Promise<FeedSourceRow[]> {
  const { rows } = await listProducts({ limit: 100_000, sort: 'name' });
  const details = (await mapLimit(rows, DETAIL_CONCURRENCY, (r) => getProductBySlug(r.slug))).filter(
    (d): d is ProductDetail => !!d && d.product.status === 'active' && !d.product.deletedAt && !d.product.noindex && d.variants.length > 0,
  );
  const variantIds = details.flatMap((d) => d.variants.map((v) => v.id));
  const [prices, stocks, images] = await Promise.all([
    getPrices(variantIds.map((variantId) => ({ variantId, qty: 1 }))),
    getStocks(variantIds),
    getImages(details.flatMap((d) => d.media.map((m) => m.mediaId))),
  ]);

  return details.flatMap((d) => {
    const p = d.product;
    const refs = d.media.map((m) => images.get(m.mediaId)).filter((r): r is ImageRef => !!r);
    const main = refs[0] ? feedImagePaths(refs[0]) : null;
    const collectionPath = d.collection ? [...(d.collection.parent ? [d.collection.parent.name] : []), d.collection.name] : [];
    return d.variants.map((v): FeedSourceRow => {
      const stock = stocks[v.id] ?? null;
      const price = prices[v.id];
      return {
        productId: p.id,
        variantId: v.id,
        sku: `${p.sku}${v.skuSuffix}`,
        productSku: p.sku,
        kind: p.kind,
        slug: p.slug,
        name: p.name,
        variantLabel: v.label,
        skuSuffix: v.skuSuffix,
        variantCount: d.variants.length,
        shortDescription: p.shortDescription,
        descriptionHtml: p.descriptionHtml,
        collectionPath,
        imageWebp: main?.webp ?? null,
        imageJpeg: main?.jpeg ?? null,
        additionalImages: refs.slice(1).map((r) => feedImagePaths(r).webp),
        listPaise: price ? price.listUnitPaise : null,
        compareAtPaise: price?.compareAtPaise ?? null,
        availability: offerAvailability(deriveAvailability({ status: p.status, override: p.availabilityOverride, deletedAt: p.deletedAt, stock })),
        readyInDays: stock?.readyInDays ?? null,
      };
    });
  });
}
