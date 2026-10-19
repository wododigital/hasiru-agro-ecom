// Pure review rules: input schema and the aggregate shape. No React, no Next, no database.
import { RATING_MIN_REVIEWS, type ReviewAggregate } from '@ecomkit/core/contracts';
import { z } from 'zod';

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const MAX_REVIEW_PHOTOS = 4;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const reviewInputSchema = z.object({
  productId: z.uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  title: optionalText(120),
  body: z.string().trim().min(10).max(2000),
  authorName: optionalText(60),
  districtText: optionalText(80),
});
export type ReviewInput = z.output<typeof reviewInputSchema>;

export const moderationSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reply: optionalText(1000),
});

/** One decimal average; the rating shows only from RATING_MIN_REVIEWS approved reviews (A13). */
export function toAggregate(productId: string, count: number, avg: number | null): ReviewAggregate {
  return {
    productId,
    count,
    average: count > 0 && avg != null ? Math.round(avg * 10) / 10 : null,
    showRating: count >= RATING_MIN_REVIEWS,
  };
}
