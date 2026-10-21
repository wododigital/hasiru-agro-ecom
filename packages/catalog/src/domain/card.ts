import type { CardChip, FitLevel, ImageRef, Paise, PriceQuote, ReviewAggregate, StockInfo } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import type { CatalogMessages } from '../messages';
import { deriveAvailability, isPurchasable, wantsNotify, type AvailabilityState } from './availability';
import type { AvailabilityOverride, Kind, SizeClass, Status } from './enums';

/** The product fields a card needs (one query shape for every surface). */
export interface CardSource {
  id: string;
  slug: string;
  kind: Kind;
  name: string;
  nameKn: string | null;
  status: Status;
  availabilityOverride: AvailabilityOverride | null;
  collectionName: string | null;
  subcategory: string | null;
  sizeClass: SizeClass | null;
  bearingYearsMin: number | null;
  bearingYearsMax: number | null;
  timberRotationYears: number | null;
  yieldText: string | null;
  isBestSeller: boolean;
  publishedAt: Date | null;
  variantId: string | null;
  /** Quick facts line (height at dispatch, sunlight, temperature range); absent fields are skipped. */
  heightFt?: number | null;
  exposure?: string | null;
  tempMin?: number | null;
  tempMax?: number | null;
}

export interface CardContext {
  image: ImageRef | null;
  price: PriceQuote | null;
  stock: StockInfo | null;
  reviews: ReviewAggregate | null;
  /** Climate fit for the visitor's district; null when no district is known or places is off. */
  fit: FitLevel | null;
  /** Chips resolved by other modules' productCardChips sources. */
  extraChips: readonly CardChip[];
  /** Quantity of this product already in the cart (bulk line turns accent once it reaches the tier). */
  cartQty: number;
  now: Date;
  messages: CatalogMessages;
}

export interface CardBadge {
  id: 'out_of_stock' | 'bulk_unlocked' | 'fits_district' | 'bestseller' | 'new' | 'save';
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'accent' | 'danger';
}

export interface ProductCardData {
  id: string;
  slug: string;
  href: string;
  kind: Kind;
  name: string;
  nameKn: string | null;
  collectionLine: string | null;
  image: ImageRef | null;
  variantId: string | null;
  badges: CardBadge[];
  chips: CardChip[];
  /** Short facts shown under the name: height, sunlight, temperature. */
  facts: string[];
  price: { unitPaise: Paise; compareAtPaise: Paise | null } | null;
  bulk: { label: string; minQty: number; reached: boolean } | null;
  rating: { average: number | null; count: number; show: boolean } | null;
  availability: AvailabilityState;
  stockLabel: string | null;
  purchasable: boolean;
  notifyMe: boolean;
}

/** "New" badge window after publishing. */
export const NEW_DAYS = 30;
export const MAX_BADGES = 2;

export const productPath = (kind: Kind, slug: string): string => (kind === 'input' ? `/input/${slug}` : `/plant/${slug}`);

export function buildProductCard(p: CardSource, ctx: CardContext): ProductCardData {
  const m = ctx.messages.card;
  const availability = deriveAvailability({ status: p.status, override: p.availabilityOverride, stock: ctx.stock });
  const unit = ctx.price?.unitPaise ?? null;
  const compareAt = ctx.price?.compareAtPaise && unit != null && ctx.price.compareAtPaise > unit ? ctx.price.compareAtPaise : null;
  const bulkTier = ctx.price?.tier ?? ctx.price?.nextTier ?? null;
  const reached = !!bulkTier && ctx.cartQty >= bulkTier.minQty;

  const candidates: (CardBadge | null)[] = [
    availability === 'out_of_stock' || availability === 'temporarily_unavailable' ? { id: 'out_of_stock', label: m.outOfStock, tone: 'danger' } : null,
    reached ? { id: 'bulk_unlocked', label: m.bulkUnlocked, tone: 'accent' } : null,
    ctx.fit === 'good' ? { id: 'fits_district', label: m.fitsDistrict, tone: 'success' } : null,
    p.isBestSeller ? { id: 'bestseller', label: m.bestseller, tone: 'accent' } : null,
    p.publishedAt && ctx.now.getTime() - p.publishedAt.getTime() < NEW_DAYS * 86_400_000 ? { id: 'new', label: m.newArrival, tone: 'neutral' } : null,
    compareAt != null && unit != null ? { id: 'save', label: m.save(formatINR((compareAt - unit) as Paise)), tone: 'success' } : null,
  ];

  const chips: CardChip[] = [];
  if (p.sizeClass) chips.push({ id: 'size', label: m.sizeClass[p.sizeClass] ?? p.sizeClass, tone: 'neutral' });
  if (ctx.fit === 'good') chips.push({ id: 'fit', label: m.fitGood, tone: 'success' });
  else if (ctx.fit === 'ok') chips.push({ id: 'fit', label: m.fitOk, tone: 'warning' });
  // not_recommended never shows on a card (no red chips); the PDP explains it.
  if (p.bearingYearsMin != null || p.bearingYearsMax != null) chips.push({ id: 'bearing', label: m.fruitsIn(p.bearingYearsMin, p.bearingYearsMax), tone: 'neutral' });
  else if (p.timberRotationYears != null) chips.push({ id: 'bearing', label: m.harvestIn(p.timberRotationYears), tone: 'neutral' });
  else if (p.yieldText) chips.push({ id: 'yield', label: m.yieldLabel(p.yieldText), tone: 'neutral' });
  chips.push(...ctx.extraChips);

  const facts: string[] = [];
  if (p.heightFt != null) facts.push(m.height(p.heightFt));
  if (p.exposure) facts.push(m.exposure[p.exposure] ?? p.exposure);
  if (p.tempMin != null && p.tempMax != null) facts.push(m.temp(p.tempMin, p.tempMax));

  let stockLabel: string | null = null;
  if (availability === 'low_stock' && ctx.stock) stockLabel = m.onlyLeft(ctx.stock.available);
  else if (availability === 'in_stock') stockLabel = m.inStock;
  else if (availability === 'preorder') stockLabel = m.preorder(ctx.stock?.readyInDays ?? null);
  else if (availability === 'coming_soon') stockLabel = m.comingSoon;
  else if (availability === 'temporarily_unavailable') stockLabel = m.unavailable;
  else if (availability === 'out_of_stock') stockLabel = m.outOfStock;

  return {
    id: p.id,
    slug: p.slug,
    href: productPath(p.kind, p.slug),
    kind: p.kind,
    name: p.name,
    nameKn: p.nameKn,
    collectionLine: [p.collectionName, p.subcategory && p.subcategory !== p.collectionName ? p.subcategory : null].filter(Boolean).join(' · ') || null,
    image: ctx.image,
    variantId: p.variantId,
    badges: candidates.filter((b): b is CardBadge => b !== null).slice(0, MAX_BADGES),
    chips,
    facts,
    price: unit != null ? { unitPaise: unit, compareAtPaise: compareAt } : null,
    bulk: bulkTier ? { label: m.bulkFrom(formatINR(bulkTier.unitPaise), bulkTier.minQty), minQty: bulkTier.minQty, reached } : null,
    rating: ctx.reviews ? { average: ctx.reviews.average, count: ctx.reviews.count, show: ctx.reviews.showRating } : null,
    availability,
    stockLabel,
    purchasable: isPurchasable(availability) && !!p.variantId && unit != null,
    notifyMe: wantsNotify(availability),
  };
}
