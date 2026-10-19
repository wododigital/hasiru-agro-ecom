import type { PriceQuote, StockInfo } from '@ecomkit/core/contracts';
import { z } from 'zod';
import { deriveAvailability, isPurchasable } from '../domain/availability';
import type { ProductCardData } from '../domain/card';
import { buildCards, type CardOptions } from './cards';
import { listProducts, type ListFilter } from './queries';
import { optionalService } from './runtime';

export const SORTS = ['featured', 'price_asc', 'price_desc', 'name', 'newest'] as const;
export type Sort = (typeof SORTS)[number];

export const listingQuerySchema = z.object({
  sort: z.enum(SORTS).catch('featured'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export function parseListingQuery(sp: Record<string, string | string[] | undefined>): { sort: Sort; page: number } {
  return listingQuerySchema.parse({ sort: first(sp.sort) ?? 'featured', page: first(sp.page) ?? 1 });
}

export interface Listing {
  cards: ProductCardData[];
  total: number;
  page: number;
  pages: number;
  /** Every product id in the listing (for the facet sidebar), in display order. */
  productIds: string[];
}

/**
 * One listing page. The whole (cached, under 500 rows) result is ordered here: purchasable first, then the sort;
 * price sorts read prices for all rows in one pricing call. Only the visible page becomes cards.
 */
export async function loadListing(filter: Omit<ListFilter, 'limit' | 'offset' | 'sort'>, query: { sort: Sort; page: number; pageSize: number }, cardOptions: CardOptions = {}): Promise<Listing> {
  const { rows } = await listProducts({ ...filter, sort: query.sort === 'name' || query.sort === 'newest' ? query.sort : 'featured' });
  const variantIds = rows.flatMap((r) => (r.variantId ? [r.variantId] : []));
  const [pricing, inventory] = await Promise.all([optionalService('pricing'), optionalService('inventory')]);
  const wantPrices = query.sort === 'price_asc' || query.sort === 'price_desc';
  const [prices, stocks] = await Promise.all([
    pricing && wantPrices ? pricing.getPrices(variantIds.map((variantId) => ({ variantId, qty: 1 }))) : Promise.resolve({} as Record<string, PriceQuote>),
    inventory ? inventory.getStocks(variantIds) : Promise.resolve({} as Record<string, StockInfo>),
  ]);
  const rank = rows.map((r, i) => {
    const stock = r.variantId ? (stocks[r.variantId] ?? null) : null;
    const buyable = isPurchasable(deriveAvailability({ status: r.status, override: r.availabilityOverride, stock }));
    const price = r.variantId ? (prices[r.variantId]?.unitPaise ?? null) : null;
    return { r, i, buyable, price };
  });
  rank.sort((a, b) => {
    if (a.buyable !== b.buyable) return a.buyable ? -1 : 1;
    if (wantPrices && a.price !== b.price) {
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return query.sort === 'price_asc' ? a.price - b.price : b.price - a.price;
    }
    return a.i - b.i;
  });
  const pages = Math.max(1, Math.ceil(rank.length / query.pageSize));
  const page = Math.min(query.page, pages);
  const slice = rank.slice((page - 1) * query.pageSize, page * query.pageSize).map((x) => x.r);
  return { cards: await buildCards(slice, cardOptions), total: rank.length, page, pages, productIds: rank.map((x) => x.r.id) };
}
