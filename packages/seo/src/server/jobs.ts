import type { JobHandler } from '@ecomkit/core/contracts';
import { pruneNotFound } from './not-found';

/** seo.prune-not-found (daily 03:45 IST): keeps the 404 log bounded. */
export const pruneNotFoundJob: JobHandler<unknown> = async (_data, ctx) => {
  ctx.log.info('pruned 404 log', { removed: await pruneNotFound() });
};
