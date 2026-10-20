'use cache';
// Cached reads of other modules' data for the PDP shell (Cache Components: the static shell may only await cached
// work). Tagged per product, so pricing, inventory and reviews expire them with core's price:/stock:/reviews: tags.
import { tags } from '@ecomkit/core/cache-tags';
import type { ImageRef, ReviewAggregate, StockInfo } from '@ecomkit/core/contracts';
import { tierLadder, type TierStep } from '../domain/tiers';
import type { CatalogSettings } from '../settings';
import { cacheFor } from '@ecomkit/core/cache-tags';
import { imagesFor, readCatalogSettings } from './cards';
import { optionalService } from './runtime';

export async function cachedImages(mediaIds: readonly string[]): Promise<Record<string, ImageRef>> {
  cacheFor([tags.catalog]);
  return imagesFor(mediaIds);
}

export async function cachedSettings(): Promise<CatalogSettings> {
  cacheFor([tags.settings('catalog')]);
  return readCatalogSettings();
}

export interface PdpCommerce {
  ladder: { list: TierStep; tiers: TierStep[] } | null;
  stock: StockInfo | null;
  reviews: ReviewAggregate | null;
}

/** Price ladder, stock and review aggregate for one product's default variant (each null when its module is off). */
export async function pdpCommerce(productId: string, variantId: string | null): Promise<PdpCommerce> {
  cacheFor([tags.product(productId), tags.price(productId), tags.stock(productId), tags.reviews(productId)]);
  const [pricing, inventory, reviews] = await Promise.all([optionalService('pricing'), optionalService('inventory'), optionalService('reviews')]);
  const [ladder, stock, aggregate] = await Promise.all([
    pricing && variantId ? tierLadder((qty) => pricing.getPrice(variantId, qty)) : Promise.resolve(null),
    inventory && variantId ? inventory.getStock(variantId) : Promise.resolve(null),
    reviews ? reviews.aggregate(productId) : Promise.resolve(null),
  ]);
  return { ladder, stock, reviews: aggregate };
}
