import type { ProductCardData } from '../domain/card';
import { buildCards, type CardOptions } from './cards';
import { getProductBySlug, listProducts, type ProductDetail } from './queries';

/** Plan API names: `getProduct(slug)` (PDP data), `productCard(id)` / `productCards(ids)` for other modules' rails. */
export async function getProduct(slug: string): Promise<ProductDetail | null> {
  return getProductBySlug(slug);
}

/** Cards in the order of `ids` (hidden or unknown ids are dropped). */
export async function getProductCardsByIds(ids: readonly string[], options: CardOptions = {}): Promise<ProductCardData[]> {
  if (!ids.length) return [];
  const { rows } = await listProducts({ ids, limit: ids.length });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return buildCards(ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])), options);
}

export const productCards = getProductCardsByIds;

export async function productCard(id: string, options: CardOptions = {}): Promise<ProductCardData | null> {
  return (await getProductCardsByIds([id], options))[0] ?? null;
}
