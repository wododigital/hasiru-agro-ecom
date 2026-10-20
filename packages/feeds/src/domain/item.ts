// One feed item per sellable variant, built from plain rows the server assembles from catalog, pricing,
// inventory and media. Prices are GST-inclusive (A7), which is what both platforms expect for India.

export type Destination = 'google' | 'meta';
export const DESTINATIONS: readonly Destination[] = ['google', 'meta'];
export type FeedAvailability = 'in_stock' | 'out_of_stock' | 'preorder';

export interface FeedSourceRow {
  productId: string;
  variantId: string;
  /** Product sku plus the variant suffix, unique per variant: the stable item id on both platforms. */
  sku: string;
  productSku: string;
  kind: 'plant' | 'input';
  slug: string;
  name: string;
  variantLabel: string;
  skuSuffix: string;
  variantCount: number;
  shortDescription: string | null;
  descriptionHtml: string | null;
  /** Collection path names, outermost first. */
  collectionPath: string[];
  /** Paths on the site (`/media/...`), or null when the product has no image yet. */
  imageWebp: string | null;
  imageJpeg: string | null;
  additionalImages: string[];
  listPaise: number | null;
  compareAtPaise: number | null;
  availability: FeedAvailability;
  readyInDays: number | null;
}

export interface FeedContext {
  /** Canonical origin, no trailing slash (`https://shop.example`). */
  origin: string;
  brand: string;
  googleCategory: Record<FeedSourceRow['kind'], string>;
  now: Date;
}

export interface FeedItem {
  id: string;
  variantId: string;
  itemGroupId: string | null;
  title: string;
  description: string;
  link: string;
  imageLink: string | null;
  additionalImageLinks: string[];
  availability: FeedAvailability;
  /** ISO 8601 date for pre-orders (required by Google with `preorder`). */
  availabilityDate: string | null;
  /** Regular price; `salePricePaise` is set when a real compare-at exists (the list price is then the sale price). */
  pricePaise: number | null;
  salePricePaise: number | null;
  brand: string;
  condition: 'new';
  productType: string;
  googleProductCategory: string;
  /** Plants and own-brand inputs carry no GTIN or MPN. */
  identifierExists: false;
}

export const TITLE_MAX = 150;
export const DESCRIPTION_MAX = 5000;

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Plain text from the stored (already sanitised) description HTML: block tags become line breaks, entities decoded. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k]) return ENTITIES[k]!;
      if (!k.startsWith('#')) return m;
      const cp = k.startsWith('#x') ? parseInt(k.slice(2), 16) : Number(k.slice(1));
      // Out-of-range or surrogate code points would throw (and kill the whole feed run): keep the entity as text.
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export function toFeedItem(row: FeedSourceRow, ctx: FeedContext): FeedItem {
  const multi = row.variantCount > 1;
  const path = `${row.kind === 'input' ? '/input/' : '/plant/'}${row.slug}${multi ? `?variant=${encodeURIComponent(row.skuSuffix)}` : ''}`;
  const abs = (p: string) => `${ctx.origin}${p}`;
  const hasCompare = row.compareAtPaise != null && row.listPaise != null && row.compareAtPaise > row.listPaise;
  const readyAt = row.availability === 'preorder' ? new Date(ctx.now.getTime() + Math.max(1, row.readyInDays ?? 30) * 86_400_000) : null;
  return {
    id: row.sku,
    variantId: row.variantId,
    itemGroupId: multi ? row.productSku : null,
    title: clip(multi ? `${row.name} (${row.variantLabel})` : row.name, TITLE_MAX),
    description: clip(htmlToText(row.descriptionHtml) || (row.shortDescription ?? '').trim() || row.name, DESCRIPTION_MAX),
    link: abs(path),
    imageLink: row.imageWebp ? abs(row.imageWebp) : null,
    additionalImageLinks: row.additionalImages.slice(0, 10).map(abs),
    availability: row.availability,
    availabilityDate: readyAt ? readyAt.toISOString().slice(0, 10) : null,
    pricePaise: hasCompare ? row.compareAtPaise : row.listPaise,
    salePricePaise: hasCompare ? row.listPaise : null,
    brand: ctx.brand,
    condition: 'new',
    productType: row.collectionPath.join(' > '),
    googleProductCategory: ctx.googleCategory[row.kind] ?? '',
    identifierExists: false,
  };
}

/** Meta wants a JPEG it can fetch; Google takes the 800 px WebP derivative. Same item otherwise. */
export function forDestination(item: FeedItem, row: Pick<FeedSourceRow, 'imageJpeg'>, destination: Destination, origin: string): FeedItem {
  if (destination === 'google') return item;
  return { ...item, imageLink: row.imageJpeg ? `${origin}${row.imageJpeg}` : item.imageLink, additionalImageLinks: [] };
}

/** `2499.00 INR` from integer paise (feed number format, not display: display uses core formatINR). */
export function feedPrice(paise: number): string {
  const p = Math.round(paise);
  return `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')} INR`;
}

/** Stable text of everything that ends up in the feed for an item; hashed to decide whether a rebuild changed it. */
export function stableItemText(item: FeedItem): string {
  return JSON.stringify(Object.keys(item).sort().map((k) => [k, item[k as keyof FeedItem]]));
}
