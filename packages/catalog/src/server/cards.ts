import type { CardChip, ClimateFit, ImageRef, PriceQuote, ReviewAggregate, StockInfo } from '@ecomkit/core/contracts';
import { defineSettings, getSettings } from '@ecomkit/core/settings';
import { buildProductCard, type ProductCardData } from '../domain/card';
import { catalogSettingsSchema, type CatalogSettings } from '../settings';
import { mainMediaIds, type CardRow } from './queries';
import { catalogRuntime, optionalService } from './runtime';

export const catalogSettings = defineSettings('catalog', catalogSettingsSchema);

/** Catalog settings with defaults; a database without a settings row (or no core tables yet) gets the defaults. */
export async function readCatalogSettings(): Promise<CatalogSettings> {
  try {
    return await getSettings(catalogSettings);
  } catch {
    return catalogSettingsSchema.parse({});
  }
}

export interface CardOptions {
  /** Visitor's district slug for climate-fit chips; default from the runtime (cookie). Pass null to skip. */
  district?: string | null;
  /** Product id -> quantity already in the cart. */
  cartQty?: Readonly<Record<string, number>>;
}

/** ImageRefs by media id through the bound media capability ({} when none is bound). */
export async function imagesFor(mediaIds: readonly string[]): Promise<Record<string, ImageRef>> {
  const images = catalogRuntime().images;
  return images && mediaIds.length ? images(mediaIds) : {};
}

/**
 * Cards for listing rows: one batched call per optional module (pricing, inventory, reviews, places and each
 * productCardChips source), so a 24-card grid costs a handful of queries, never one per card.
 */
export async function buildCards(rows: readonly CardRow[], options: CardOptions = {}): Promise<ProductCardData[]> {
  if (!rows.length) return [];
  const rt = catalogRuntime();
  const ids = rows.map((r) => r.id);
  const variantIds = rows.flatMap((r) => (r.variantId ? [r.variantId] : []));
  const district = options.district === undefined ? await rt.readDistrict() : options.district;
  const [pricing, inventory, reviews, places, media] = await Promise.all([
    optionalService('pricing'),
    optionalService('inventory'),
    optionalService('reviews'),
    optionalService('places'),
    mainMediaIds(ids),
  ]);
  const chipSources = rt.registry?.list('productCardChips') ?? [];
  const [prices, stocks, aggregates, images, fits, chipSets] = await Promise.all([
    pricing ? pricing.getPrices(variantIds.map((variantId) => ({ variantId, qty: 1 }))) : Promise.resolve({} as Record<string, PriceQuote>),
    inventory ? inventory.getStocks(variantIds) : Promise.resolve({} as Record<string, StockInfo>),
    reviews ? reviews.aggregates(ids) : Promise.resolve({} as Record<string, ReviewAggregate>),
    imagesFor(Object.values(media)),
    district && places ? Promise.all(rows.map((r) => (r.climate ? places.fit(district, r.climate) : Promise.resolve(null)))) : Promise.resolve(rows.map((): ClimateFit | null => null)),
    Promise.all(chipSources.map(async (s) => (await s.resolve())(ids))),
  ]);
  const now = rt.now();
  return rows.map((r, i) => {
    const extraChips: CardChip[] = chipSets.flatMap((set) => set[r.id] ?? []);
    const mediaId = media[r.id];
    return buildProductCard(r, {
      image: mediaId ? (images[mediaId] ?? null) : null,
      price: r.variantId ? (prices[r.variantId] ?? null) : null,
      stock: r.variantId ? (stocks[r.variantId] ?? null) : null,
      reviews: aggregates[r.id] ?? null,
      fit: fits[i]?.level ?? null,
      extraChips,
      cartQty: options.cartQty?.[r.id] ?? 0,
      now,
      messages: rt.messages,
    });
  });
}
