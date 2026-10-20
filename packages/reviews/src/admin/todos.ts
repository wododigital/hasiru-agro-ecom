import { listForModeration } from '../server';

/** Home "Things to do": reviews waiting for a decision (listForModeration checks reviews.moderate). */
export const pendingReviews = async (): Promise<number> => (await listForModeration({ status: 'pending', pageSize: 1 })).total;
