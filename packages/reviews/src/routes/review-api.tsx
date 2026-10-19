import { handleReviewPost } from '../server';

/** POST /api/reviews: submit a review with optional photos (works without JS). */
export const POST = handleReviewPost;
