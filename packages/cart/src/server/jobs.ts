import type { JobHandler } from '@ecomkit/core/contracts';
import { markAbandoned } from './cart';

/** `cart.mark-abandoned`, every 5 minutes: idle carts with lines become abandoned, one `cart.abandoned` each. */
export const markAbandonedJob: JobHandler<unknown> = async (_data, ctx) => {
  let total = 0;
  for (let n = await markAbandoned(); n > 0; n = await markAbandoned()) total += n;
  if (total) ctx.log.info('marked carts abandoned', { carts: total });
};
