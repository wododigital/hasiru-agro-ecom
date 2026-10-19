import type { ProductJsonLdInput, ReviewAggregate } from '@ecomkit/core/contracts';
import { offerAvailability, type AvailabilityState } from './availability';
import type { TierStep } from './tiers';

export interface JsonLdSource {
  name: string;
  path: string;
  sku: string;
  description: string | null;
  images: readonly string[];
  listUnitPaise: number | null;
  tiers: readonly TierStep[];
  availability: AvailabilityState;
  reviews: ReviewAggregate | null;
  facts: readonly { name: string; value: string }[];
  now: Date;
}

/** Offers stay valid for a year from render (pages are rebuilt on every price change through cache tags). */
export const PRICE_VALID_DAYS = 365;

/**
 * Input for the seo module's `jsonLd.product()`: no Offer price means no product node (a priceless
 * product would fail rich-result validation), rating only with enough approved reviews (A13).
 */
export function productJsonLdInput(s: JsonLdSource): ProductJsonLdInput | null {
  if (s.listUnitPaise == null || s.availability === 'hidden') return null;
  const first = s.tiers[0];
  return {
    name: s.name,
    path: s.path,
    sku: s.sku,
    description: s.description ?? s.name,
    images: s.images,
    pricePaise: s.listUnitPaise,
    priceValidUntil: new Date(s.now.getTime() + PRICE_VALID_DAYS * 86_400_000).toISOString().slice(0, 10),
    availability: offerAvailability(s.availability),
    bulk: first ? { minQty: first.minQty, unitPaise: first.unitPaise } : null,
    rating: s.reviews?.showRating && s.reviews.average != null ? { average: s.reviews.average, count: s.reviews.count } : null,
    reviews: [],
    additionalProperties: s.facts,
  };
}
