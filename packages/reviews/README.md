# @ecomkit/reviews

Product reviews with photos, a verified-buyer flag, moderation and a per-product aggregate. No Q&A. No seeded or fabricated reviews (A13): sample rows are flagged `is_sample` / `data_source` and never counted or shown. Brand-neutral.

## Public API

`@ecomkit/reviews/server`:
- `configureReviews({ purchases?, images?, products? })`: called once at app boot. `purchases.verifiedOrderId(customerId, productId)` (orders) marks verified buyers; `images.putImage(file)` / `images.ref(mediaId)` (media) store and render photos; `products.label(productId)` (catalog) names products on the account page. All optional: without them reviews are unverified, photos are refused, names are omitted.
- `submitReview(input, { photos })` (signed-in customer): one review per customer per product, `pending`, up to 4 photos (jpeg/png/webp/heic, 8 MB), 10 per customer per day; emits `review.submitted`.
- `updateMyReview(id, input)`, `deleteMyReview(id)`, `listMyReviews()`: scoped to the author (someone else's id is a 404); an edit returns to `pending` and leaves the aggregate.
- `moderate(id, { decision, reply? })` (`reviews.moderate`): refreshes `reviews_aggregate` in the same transaction, audits, emits `review.approved`, expires cache tag `reviews:<productId>`.
- `listForModeration({ status })`, `listApproved(productId)`, `aggregate(productId)`, `aggregates(ids)`, `reviewsReader` (service `reviews`, the frozen `ReviewsReader` contract).
- `handleReviewPost(req)`: the `/api/reviews` multipart handler (route handler because photos exceed the 1 MB server-action body), 303 to `/account/reviews?review=<outcome>` or JSON.

`@ecomkit/reviews/domain`: `reviewInputSchema`, `moderationSchema`, `toAggregate(productId, count, avg)` (one decimal; `showRating` from `RATING_MIN_REVIEWS` = 3), limits.

`@ecomkit/reviews/ui`: `ReviewsSection` (PDP section `#reviews`; cached with `'use cache'` + tag `reviews:<productId>`; stars only from 3 approved reviews, else the "New" chip), `AccountReviews`. Copy: `reviewsMessages`.

`@ecomkit/reviews/admin`: `ReviewsModerationPage` (queue by status, approve/reject with an optional public reply).

## Tables
`reviews_review` (rating check 1..5, unique per product + customer, `is_sample`, `data_source`, moderator fields), `reviews_media` (review, media id, position), `reviews_aggregate` (product pk, count, avg of approved non-sample reviews). Enum `reviews_status`. No foreign keys into catalog, orders, media or auth.

## Routes
`/account/reviews` (noindex; `?product=<id>` opens the write form, `?edit=<id>` the edit form), `POST /api/reviews`, admin `/admin/reviews`.

## Extension points
`provides.reviews` (ReviewsReader for product cards and JSON-LD), `pdpSections`: `reviews` (slot `below`, order 80).

## Events
Emits `review.submitted`, `review.approved`. Consumes none (the review request message after delivery belongs to flows).

## Settings, jobs
None.

## Disabling
Remove `reviews` from the app config: `registry.service('reviews')` returns null and cards show no rating; the PDP section disappears with the manifest.

## Tests
`test/reviews.test.ts` (real Postgres): pending until moderated, verified buyer through the purchases port, photos stored and listed, duplicate refused, aggregate only from approved non-sample reviews with the 3-review threshold, admin reply, audit and events, role checks; IDOR (another customer cannot edit or delete, guests cannot submit), edit back to pending updates the aggregate; validation and photo limits. `test/manifest.test.ts`: manifest resolves, route exports, the `reviews` service resolves through the registry.
