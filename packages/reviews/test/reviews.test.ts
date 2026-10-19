import { NotFoundError } from '@ecomkit/core/auth-context';
import { listAudit } from '@ecomkit/core/audit';
import { newId } from '@ecomkit/core/ids';
import { createTestDb, fakeReviews, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aggregate,
  aggregates,
  configureReviews,
  deleteMyReview,
  listApproved,
  listForModeration,
  listMyReviews,
  moderate,
  reviewsReader,
  submitReview,
  updateMyReview,
} from '../src/server';
import { asCustomer, asGuest, asStaff } from './viewers';

let t: TestDb;
const product = newId();
const deliveredOrder = newId();
const buyer = newId();
const stored: string[] = [];
const events = async (name: string) =>
  (await queuedJobs(t.db, 'core.event')).filter((j) => (j.data as { event: string }).event === name).map((j) => (j.data as { payload: unknown }).payload);
const review = (rating: number, over: Record<string, unknown> = {}) => ({ productId: product, rating: String(rating), body: 'Healthy sapling, well packed and growing.', ...over });
const photo = () => ({ name: 'tree.jpg', type: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) });

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'r'.repeat(40);
  t = await createTestDb('wp-16-reviews', { schemas: ['core', 'reviews'] });
  configureReviews({
    purchases: { verifiedOrderId: async (customerId, productId) => (customerId === buyer && productId === product ? deliveredOrder : null) },
    images: {
      putImage: async () => {
        stored.push(newId());
        return { mediaId: stored.at(-1)! };
      },
    },
  });
});
afterAll(async () => {
  await t?.close();
});

describe('submit, moderate, aggregate', () => {
  it('keeps new reviews pending, marks verified buyers, stores photos, and counts only approved ones', async () => {
    asCustomer(buyer);
    const first = await submitReview(review(5, { title: 'Great mango', districtText: 'Kolar' }), { photos: [photo(), photo()] });
    expect(first).toMatchObject({ status: 'pending', isVerifiedBuyer: true, orderId: deliveredOrder, customerId: buyer, rating: 5, authorName: 'Test Customer' });
    await expect(submitReview(review(4))).rejects.toThrow('review_already_reviewed');
    expect(await events('review.submitted')).toContainEqual({ reviewId: first.id, productId: product });

    asCustomer();
    const second = await submitReview(review(4));
    expect(second.isVerifiedBuyer).toBe(false);
    asCustomer();
    const third = await submitReview(review(3));
    asCustomer();
    const spam = await submitReview(review(1, { body: 'Bad bad bad bad bad' }));

    // Nothing is public before moderation.
    expect(await listApproved(product)).toEqual([]);
    expect(await aggregate(product)).toEqual({ productId: product, count: 0, average: null, showRating: false });

    asStaff('support');
    await moderate(first.id, { decision: 'approved', reply: 'Thank you!' });
    await moderate(second.id, { decision: 'approved' });
    // Two approved: still below the threshold, so the card shows "New".
    expect(await aggregate(product)).toEqual({ productId: product, count: 2, average: 4.5, showRating: false });
    await moderate(third.id, { decision: 'approved' });
    await moderate(spam.id, { decision: 'rejected' });
    expect(await reviewsReader.aggregate(product)).toEqual({ productId: product, count: 3, average: 4, showRating: true });

    const shown = await listApproved(product);
    expect(shown.map((r) => r.id)).toEqual([third.id, second.id, first.id]);
    expect(shown.find((r) => r.id === first.id)).toMatchObject({ adminReply: 'Thank you!', mediaIds: stored.slice(0, 2) });
    expect(await events('review.approved')).toHaveLength(3);
    expect((await listAudit({ entity: 'review', entityId: spam.id }))[0]!.action).toBe('review.reject');

    // Batched reader matches the frozen contract and its fake.
    const other = newId();
    const batch = await aggregates([product, other]);
    expect(batch[other]).toEqual({ productId: other, count: 0, average: null, showRating: false });
    expect(Object.keys(await fakeReviews().aggregate(other))).toEqual(Object.keys(batch[other]!));

    asStaff('fulfilment');
    await expect(moderate(spam.id, { decision: 'approved' })).rejects.toThrow('forbidden');
    await expect(listForModeration()).rejects.toThrow('forbidden');
    asStaff('catalog_editor');
    expect((await listForModeration({ status: 'rejected' })).rows.map((r) => r.id)).toEqual([spam.id]);
  });

  it('never counts sample rows', async () => {
    const id = newId();
    await t.pool.query(
      "insert into reviews_review (id, product_id, rating, body, status, is_sample, data_source) values ($1, $2, 1, 'sample text for a demo', 'approved', true, 'sample')",
      [id, product],
    );
    asStaff('manager');
    await moderate(id, { decision: 'approved' });
    expect(await aggregate(product)).toMatchObject({ count: 3, average: 4 });
    expect((await listApproved(product)).map((r) => r.id)).not.toContain(id);
  });
});

describe('IDOR on reviews', () => {
  it('lets only the author edit or delete; an edit goes back to moderation and leaves the aggregate', async () => {
    asCustomer(buyer);
    const [mine] = await listMyReviews();
    expect(mine!.status).toBe('approved');

    const intruder = asCustomer();
    expect(await listMyReviews()).toEqual([]);
    await expect(updateMyReview(mine!.id, { rating: 1, body: 'Hijacked review text here' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMyReview(mine!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMyReview('../../etc')).rejects.toBeInstanceOf(NotFoundError);
    expect(intruder.customerId).not.toBe(buyer);
    asGuest();
    await expect(submitReview(review(5))).rejects.toBeInstanceOf(NotFoundError);
    await expect(listMyReviews()).rejects.toBeInstanceOf(NotFoundError);

    asCustomer(buyer);
    const edited = await updateMyReview(mine!.id, { rating: 2, body: 'Changed my mind after a month.' });
    expect(edited).toMatchObject({ status: 'pending', rating: 2, customerId: buyer });
    expect(await aggregate(product)).toMatchObject({ count: 2, average: 3.5, showRating: false });
    await deleteMyReview(mine!.id);
    expect(await listMyReviews()).toEqual([]);
  });

  it('validates input and photo limits', async () => {
    asCustomer();
    await expect(submitReview(review(6))).rejects.toThrow();
    await expect(submitReview(review(5, { body: 'short' }))).rejects.toThrow();
    await expect(submitReview(review(5, { productId: 'not-a-uuid' }))).rejects.toThrow();
    await expect(submitReview(review(5), { photos: [photo(), photo(), photo(), photo(), photo()] })).rejects.toThrow('review_photos');
    await expect(submitReview(review(5), { photos: [{ name: 'x.svg', type: 'image/svg+xml', bytes: new Uint8Array(3) }] })).rejects.toThrow('review_photos');
  });
});
