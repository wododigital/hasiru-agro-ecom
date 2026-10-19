import { audit } from '@ecomkit/core/audit';
import { getViewer, NotFoundError, requirePermission } from '@ecomkit/core/auth-context';
import { invalidateTags, tags } from '@ecomkit/core/cache-tags';
import type { CustomerViewer, ImageRef, ReviewAggregate, ReviewsReader } from '@ecomkit/core/contracts';
import { db, withTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { MAX_REVIEW_PHOTOS, moderationSchema, PHOTO_MAX_BYTES, PHOTO_TYPES, reviewInputSchema, toAggregate, type ReviewStatus } from '../domain';
import { reviewsAggregate, reviewsMedia, reviewsReview } from '../schema';

export type ReviewRow = typeof reviewsReview.$inferSelect;
export type ReviewWithMedia = ReviewRow & { mediaIds: string[] };

export interface UploadedPhoto {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/**
 * What reviews needs from orders and media. Both live in other modules, so the host passes them in at
 * boot (`configureReviews`). Without `purchases` no review is marked verified; without `images` photos are refused.
 */
export interface ReviewPorts {
  /** The id of a delivered order of this product placed by this customer, or null. */
  purchases: { verifiedOrderId(customerId: string, productId: string): Promise<string | null> } | null;
  /** Public image storage (sniffed and re-encoded by media) and the rendered reference for a stored id. */
  images: {
    putImage(file: UploadedPhoto, meta: { owner: string }): Promise<{ mediaId: string }>;
    ref?(mediaId: string): Promise<ImageRef | null>;
  } | null;
  /** Product name and link for the account pages (catalog). */
  products: { label(productId: string): Promise<{ name: string; href: string } | null> } | null;
}
const ports: ReviewPorts = { purchases: null, images: null, products: null };
export const getReviewPorts = (): Readonly<ReviewPorts> => ports;
export function configureReviews(next: Partial<ReviewPorts>): void {
  Object.assign(ports, next);
}

export class ReviewError extends Error {
  constructor(readonly code: 'already_reviewed' | 'rate_limited' | 'photos' | 'photos_unavailable') {
    super(`review_${code}`);
    this.name = 'ReviewError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundError();
  return id;
};

async function currentCustomer(): Promise<CustomerViewer> {
  const viewer = await getViewer();
  if (viewer.kind !== 'customer') throw new NotFoundError();
  return viewer;
}

/** Recomputes one product's aggregate from approved, non-sample reviews, in the caller's transaction. */
async function refreshAggregate(tx: Tx, productId: string): Promise<void> {
  const [agg] = await tx
    .select({ n: count(), avg: sql<string | null>`avg(${reviewsReview.rating})` })
    .from(reviewsReview)
    .where(and(eq(reviewsReview.productId, productId), eq(reviewsReview.status, 'approved'), eq(reviewsReview.isSample, false)));
  const n = agg?.n ?? 0;
  const avg = agg?.avg == null ? null : Number(agg.avg);
  await tx
    .insert(reviewsAggregate)
    .values({ productId, count: n, avg, updatedAt: new Date() })
    .onConflictDoUpdate({ target: reviewsAggregate.productId, set: { count: n, avg, updatedAt: new Date() } });
}

function checkPhotos(files: readonly UploadedPhoto[]): void {
  if (files.length > MAX_REVIEW_PHOTOS) throw new ReviewError('photos');
  if (files.some((f) => f.bytes.byteLength > PHOTO_MAX_BYTES || !PHOTO_TYPES.includes(f.type))) throw new ReviewError('photos');
  if (files.length && !ports.images) throw new ReviewError('photos_unavailable');
}

/**
 * A signed-in customer reviews a product once (edit later instead). Starts `pending`; verified when the
 * orders port finds a delivered order of the product. Emits `review.submitted`.
 */
export async function submitReview(raw: unknown, options: { photos?: readonly UploadedPhoto[] } = {}): Promise<ReviewRow> {
  const me = await currentCustomer();
  const input = reviewInputSchema.parse(raw);
  const photos = options.photos ?? [];
  checkPhotos(photos);
  if (!(await rateLimit(`review-submit:${me.customerId}`, { limit: 10, windowSec: 86_400 })).ok) throw new ReviewError('rate_limited');
  const [existing] = await db
    .select({ id: reviewsReview.id })
    .from(reviewsReview)
    .where(and(eq(reviewsReview.productId, input.productId), eq(reviewsReview.customerId, me.customerId)));
  if (existing) throw new ReviewError('already_reviewed');
  const orderId = (await ports.purchases?.verifiedOrderId(me.customerId, input.productId)) ?? null;
  const mediaIds: string[] = [];
  for (const p of photos) mediaIds.push((await ports.images!.putImage(p, { owner: 'reviews' })).mediaId);

  return withTx(async (tx) => {
    const [row] = await tx
      .insert(reviewsReview)
      .values({ ...input, authorName: input.authorName ?? me.name, customerId: me.customerId, orderId, isVerifiedBuyer: orderId !== null })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ReviewError('already_reviewed');
    if (mediaIds.length) await tx.insert(reviewsMedia).values(mediaIds.map((mediaId, position) => ({ reviewId: row.id, mediaId, position })));
    await emit('review.submitted', { reviewId: row.id, productId: row.productId }, { tx });
    return row;
  });
}

/** Edits the viewer's own review (someone else's id is a 404). An edit goes back to moderation. */
export async function updateMyReview(rawId: string, raw: unknown): Promise<ReviewRow> {
  const me = await currentCustomer();
  const id = idOr404(rawId);
  const input = reviewInputSchema.omit({ productId: true }).parse(raw);
  const row = await withTx(async (tx) => {
    const [before] = await tx.select().from(reviewsReview).where(and(eq(reviewsReview.id, id), eq(reviewsReview.customerId, me.customerId))).for('update');
    if (!before) throw new NotFoundError();
    const [after] = await tx
      .update(reviewsReview)
      .set({ ...input, authorName: input.authorName ?? before.authorName, status: 'pending', updatedAt: new Date() })
      .where(eq(reviewsReview.id, id))
      .returning();
    if (before.status === 'approved') await refreshAggregate(tx, before.productId);
    await emit('review.submitted', { reviewId: id, productId: before.productId }, { tx });
    return after!;
  });
  await invalidateTags([tags.reviews(row.productId)]);
  return row;
}

export async function deleteMyReview(rawId: string): Promise<void> {
  const me = await currentCustomer();
  const id = idOr404(rawId);
  const productId = await withTx(async (tx) => {
    const [gone] = await tx
      .delete(reviewsReview)
      .where(and(eq(reviewsReview.id, id), eq(reviewsReview.customerId, me.customerId)))
      .returning({ productId: reviewsReview.productId, status: reviewsReview.status });
    if (!gone) throw new NotFoundError();
    if (gone.status === 'approved') await refreshAggregate(tx, gone.productId);
    return gone.productId;
  });
  await invalidateTags([tags.reviews(productId)]);
}

export async function listMyReviews(): Promise<ReviewRow[]> {
  const me = await currentCustomer();
  return db.select().from(reviewsReview).where(eq(reviewsReview.customerId, me.customerId)).orderBy(desc(reviewsReview.createdAt), desc(reviewsReview.id));
}

/** Approve or reject (reviews.moderate). Refreshes the aggregate in the same transaction; audited. */
export async function moderate(rawId: string, raw: unknown): Promise<ReviewRow> {
  const staff = await requirePermission('reviews.moderate');
  const id = idOr404(rawId);
  const { decision, reply } = moderationSchema.parse(raw);
  const row = await withTx(async (tx) => {
    const [before] = await tx.select({ status: reviewsReview.status }).from(reviewsReview).where(eq(reviewsReview.id, id)).for('update');
    if (!before) throw new NotFoundError();
    const [after] = await tx
      .update(reviewsReview)
      .set({ status: decision, adminReply: reply, moderatedBy: staff.userId, moderatedAt: new Date(), updatedAt: new Date() })
      .where(eq(reviewsReview.id, id))
      .returning();
    await refreshAggregate(tx, after!.productId);
    await audit({ actorId: staff.userId, actorType: 'staff', action: `review.${decision === 'approved' ? 'approve' : 'reject'}`, entity: 'review', entityId: id, before, after: { status: decision, reply } }, { tx });
    if (decision === 'approved' && before.status !== 'approved') await emit('review.approved', { reviewId: id, productId: after!.productId }, { tx });
    return after!;
  });
  await invalidateTags([tags.reviews(row.productId)]);
  return row;
}

/** Admin moderation queue. */
export async function listForModeration(options: { status?: ReviewStatus; page?: number; pageSize?: number } = {}): Promise<{ rows: ReviewWithMedia[]; total: number }> {
  await requirePermission('reviews.moderate');
  const pageSize = options.pageSize ?? 25;
  const where = options.status ? eq(reviewsReview.status, options.status) : undefined;
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(reviewsReview)
      .where(where)
      .orderBy(desc(reviewsReview.createdAt), desc(reviewsReview.id))
      .limit(pageSize)
      .offset(((options.page ?? 1) - 1) * pageSize),
    db.select({ n: count() }).from(reviewsReview).where(where),
  ]);
  return { rows: await withMedia(rows), total: total!.n };
}

async function withMedia(rows: ReviewRow[]): Promise<ReviewWithMedia[]> {
  if (!rows.length) return [];
  const media = await db
    .select()
    .from(reviewsMedia)
    .where(inArray(reviewsMedia.reviewId, rows.map((r) => r.id)))
    .orderBy(asc(reviewsMedia.position));
  return rows.map((r) => ({ ...r, mediaIds: media.filter((m) => m.reviewId === r.id).map((m) => m.mediaId) }));
}

/** Public: approved, genuine reviews of one product, newest first. */
export async function listApproved(productId: string, options: { page?: number; pageSize?: number } = {}): Promise<ReviewWithMedia[]> {
  if (!UUID_RE.test(productId)) return [];
  const pageSize = options.pageSize ?? 10;
  const rows = await db
    .select()
    .from(reviewsReview)
    .where(and(eq(reviewsReview.productId, productId), eq(reviewsReview.status, 'approved'), eq(reviewsReview.isSample, false)))
    .orderBy(desc(reviewsReview.createdAt), desc(reviewsReview.id))
    .limit(pageSize)
    .offset(((options.page ?? 1) - 1) * pageSize);
  return withMedia(rows);
}

export async function aggregates(productIds: readonly string[]): Promise<Record<string, ReviewAggregate>> {
  const ids = [...new Set(productIds.filter((id) => UUID_RE.test(id)))];
  const rows = ids.length ? await db.select().from(reviewsAggregate).where(inArray(reviewsAggregate.productId, ids)) : [];
  const out: Record<string, ReviewAggregate> = {};
  for (const id of productIds) {
    const r = rows.find((x) => x.productId === id);
    out[id] = toAggregate(id, r?.count ?? 0, r?.avg ?? null);
  }
  return out;
}

export async function aggregate(productId: string): Promise<ReviewAggregate> {
  return (await aggregates([productId]))[productId]!;
}

/** Service `reviews` (core contract `ReviewsReader`), provided through the manifest. */
export const reviewsReader: ReviewsReader = { aggregate, aggregates };
