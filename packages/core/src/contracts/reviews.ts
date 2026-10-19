/** Ratings are shown only with at least this many approved reviews (A13). */
export const RATING_MIN_REVIEWS = 3;

export interface ReviewAggregate {
  productId: string;
  count: number;
  /** One decimal, null when count is 0. */
  average: number | null;
  /** count >= RATING_MIN_REVIEWS. Cards show the "New" chip otherwise. */
  showRating: boolean;
}

/** Service key `reviews`, provided by `@ecomkit/reviews`. */
export interface ReviewsReader {
  aggregate(productId: string): Promise<ReviewAggregate>;
  aggregates(productIds: readonly string[]): Promise<Record<string, ReviewAggregate>>;
}
