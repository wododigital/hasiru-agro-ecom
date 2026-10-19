import type { JobHandler } from '@ecomkit/core/contracts';
import { releaseExpired } from './stock';

/** `inventory.release-expired`, every minute: holds past their TTL go back to sellable stock (A27). */
export const releaseExpiredJob: JobHandler<unknown> = async (_data, ctx) => {
  let total = 0;
  for (let n = await releaseExpired(); n > 0; n = await releaseExpired()) total += n;
  if (total) ctx.log.info('released expired reservations', { rows: total });
};
