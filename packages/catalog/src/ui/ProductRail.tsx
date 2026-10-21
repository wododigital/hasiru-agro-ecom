import { Rail } from '@ecomkit/ui';
import type { ProductCardData } from '../domain/card';
import type { Kind } from '../domain/enums';
import { loadListing } from '../server/listing';
import type { ListFilter } from '../server/queries';
import { catalogRuntime } from '../server/runtime';
import { ProductCard } from './ProductCard';

export type ProductRailSource = 'bestsellers' | 'collection' | 'tag' | 'ids';

export interface ProductRailProps {
  source: ProductRailSource;
  /** Collection slug (`collection`) or tag slug (`tag`). */
  value?: string | null;
  /** Hand-picked products, in this order (`ids`). */
  productIds?: readonly string[];
  kind?: Kind;
  limit?: number;
  /** Accessible name of the scroll region. */
  label: string;
}

async function railCards({ source, value, productIds = [], kind = 'plant', limit = 12 }: Omit<ProductRailProps, 'label'>): Promise<ProductCardData[]> {
  const load = async (filter: Omit<ListFilter, 'limit' | 'offset' | 'sort'>, size = limit) => (await loadListing(filter, { sort: 'featured', page: 1, pageSize: size })).cards;
  if (source === 'ids') {
    if (!productIds.length) return [];
    const cards = await load({ ids: productIds }, productIds.length);
    return cards.sort((a, b) => productIds.indexOf(a.id) - productIds.indexOf(b.id)).slice(0, limit);
  }
  if (source === 'collection') return value ? load({ kind, collectionSlug: value }) : [];
  if (source === 'tag') return value ? load({ kind, tagSlug: value }) : [];
  // Best sellers first; a short flagged list is topped up with the rest of the kind (in stock first).
  const flagged = await load({ kind, bestSellersOnly: true });
  if (flagged.length >= limit) return flagged;
  const seen = new Set(flagged.map((c) => c.id));
  const rest = (await load({ kind }, limit + flagged.length)).filter((c) => !seen.has(c.id));
  return [...flagged, ...rest].slice(0, limit);
}

/** A horizontal rail of product cards (home, landing pages). Renders nothing when the source has no products. */
export async function ProductRail({ label, ...query }: ProductRailProps) {
  const rt = catalogRuntime();
  const cards = await railCards(query);
  if (!cards.length) return null;
  const cartEnabled = rt.registry?.has('cart') ?? false;
  return (
    <Rail label={label} itemWidth="220px">
      {cards.map((card) => (
        <ProductCard key={card.id} card={card} cartEnabled={cartEnabled} messages={rt.messages} />
      ))}
    </Rail>
  );
}
