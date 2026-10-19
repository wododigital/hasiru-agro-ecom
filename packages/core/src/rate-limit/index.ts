import { sql } from 'drizzle-orm';
import { db } from '../db';

/** `<routeId>:<subject>`, e.g. `otp-send:+919876543210`, `enquiry:<ipHash>`. */
export const RATE_KEY_RE = /^[a-z0-9]+(?:[-.][a-z0-9]+)*:\S+$/;

export interface RateLimitResult {
  ok: boolean;
  /** Hits in the current window, including this one. */
  count: number;
  remaining: number;
  resetAt: Date;
}

/**
 * Fixed-window limiter in one atomic upsert on core_rate_limit (UNLOGGED). Counts this hit and
 * reports whether it is within `limit` for the window that started at the first hit.
 * `now` exists for tests (fixed clock); production uses the database clock.
 */
export async function rateLimit(key: string, options: { limit: number; windowSec: number; now?: Date }): Promise<RateLimitResult> {
  if (!RATE_KEY_RE.test(key)) throw new Error(`rate limit key "${key}" must be <routeId>:<subject>`);
  const now = options.now ? sql`${options.now.toISOString()}::timestamptz` : sql`now()`;
  const window = sql`make_interval(secs => ${options.windowSec})`;
  const { rows } = await db.execute<{ count: number; window_start: string | Date }>(sql`
    insert into core_rate_limit (key, count, window_start) values (${key}, 1, ${now})
    on conflict (key) do update set
      count = case when core_rate_limit.window_start <= ${now} - ${window} then 1 else core_rate_limit.count + 1 end,
      window_start = case when core_rate_limit.window_start <= ${now} - ${window} then ${now} else core_rate_limit.window_start end
    returning count, window_start`);
  const row = rows[0]!;
  const count = Number(row.count);
  return {
    ok: count <= options.limit,
    count,
    remaining: Math.max(0, options.limit - count),
    resetAt: new Date(new Date(row.window_start).getTime() + options.windowSec * 1000),
  };
}

/** Removes windows that ended more than a day ago (daily core.prune job). */
export async function pruneRateLimits(): Promise<number> {
  const res = await db.execute(sql`delete from core_rate_limit where window_start < now() - interval '1 day'`);
  return res.rowCount ?? 0;
}
