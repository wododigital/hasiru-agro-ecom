import type { JobHandler } from '../contracts';
import { pruneObservability } from '../observability';
import { pruneRateLimits } from '../rate-limit';

/** core.prune (daily): error events > 30 days, integration log > 90 days, finished rate-limit windows. */
export const pruneJob: JobHandler<unknown> = async (_data, ctx) => {
  const observability = await pruneObservability();
  const rateLimits = await pruneRateLimits();
  ctx.log.info('pruned', { ...observability, rateLimits });
};
