import type { DbOrTx } from '@ecomkit/core/db';
import { and, count, desc, gte, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { KEY_RE, VALUE_RE } from '../domain/facets';
import { normalise } from '../domain/suggest';
import { clientIp, hashIp } from '@ecomkit/core/http';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { searchQueryLog } from '../schema';

const RANGE_RE = /^\d*(?:\.\d+)?-\d*(?:\.\d+)?$/;

/** Same grammar encodeFilters writes (key:v1,v2, key:min-max or key: for a cleared default, joined by ';'), so the log only stores real filter strings. */
function isFilterString(f: string): boolean {
  return f.split(';').every((part) => {
    const idx = part.indexOf(':');
    const rest = part.slice(idx + 1);
    return idx > 0 && KEY_RE.test(part.slice(0, idx)) && (rest === '' || RANGE_RE.test(rest) || rest.split(',').every((v) => VALUE_RE.test(v)));
  });
}

export const logInputSchema = z.object({
  q: z.string().max(200).default(''),
  results: z.number().int().min(0).max(100_000),
  /** The `f` URL param (filters), at most a few hundred characters. */
  filters: z.string().max(600).refine(isFilterString, 'malformed filters').nullable().default(null),
  sessionId: z.string().max(64).nullable().default(null),
});
export type LogInput = z.input<typeof logInputSchema>;

/** One row per search or zero-result filter combination. Queries are normalised; no personal data. */
export async function logSearch(db: DbOrTx, input: LogInput): Promise<void> {
  const v = logInputSchema.parse(input);
  const q = normalise(v.q).slice(0, 80);
  if (!q && !v.filters) return;
  await db.insert(searchQueryLog).values({ q, results: v.results, filters: v.filters ? { f: v.filters } : null, sessionId: v.sessionId });
}

/**
 * The one entry point for logging from requests (search page and the beacon route): 30 per minute per
 * client IP, so neither path can be used to flood search insights.
 */
export async function logSearchLimited(db: DbOrTx, input: LogInput, source: Parameters<typeof clientIp>[0]): Promise<boolean> {
  const limit = await rateLimit(`search-log:${hashIp(clientIp(source)) ?? 'anon'}`, { limit: 30, windowSec: 60 });
  if (!limit.ok) return false;
  await logSearch(db, input);
  return true;
}

export interface QueryStat {
  q: string;
  searches: number;
  lastResults: number;
  lastAt: Date;
}

/** Search insights: most frequent queries, or only zero-result ones, over the last `days`. */
export async function queryStats(db: DbOrTx, options: { days?: number; zeroOnly?: boolean; limit?: number; now?: Date } = {}): Promise<QueryStat[]> {
  const since = new Date((options.now ?? new Date()).getTime() - (options.days ?? 30) * 86_400_000);
  const rows = await db
    .select({
      q: searchQueryLog.q,
      searches: count(),
      lastResults: sql<number>`(array_agg(${searchQueryLog.results} order by ${searchQueryLog.createdAt} desc))[1]`,
      lastAt: max(searchQueryLog.createdAt),
    })
    .from(searchQueryLog)
    .where(and(gte(searchQueryLog.createdAt, since), options.zeroOnly ? sql`${searchQueryLog.results} = 0` : undefined, sql`${searchQueryLog.q} <> ''`))
    .groupBy(searchQueryLog.q)
    .orderBy(desc(count()), searchQueryLog.q)
    .limit(options.limit ?? 50);
  return rows.map((r) => ({ q: r.q, searches: Number(r.searches), lastResults: Number(r.lastResults), lastAt: new Date(r.lastAt!) }));
}

/** Zero-result filter combinations (no query text), most frequent first. */
export async function zeroFilterStats(db: DbOrTx, options: { days?: number; limit?: number; now?: Date } = {}): Promise<{ filters: string; times: number }[]> {
  const since = new Date((options.now ?? new Date()).getTime() - (options.days ?? 30) * 86_400_000);
  const { rows } = await db.execute<{ filters: string; times: string }>(sql`
    select filters->>'f' as filters, count(*) as times from search_query_log
    where results = 0 and q = '' and filters is not null and created_at >= ${since.toISOString()}::timestamptz
    group by 1 order by 2 desc, 1 limit ${options.limit ?? 50}`);
  return rows.map((r) => ({ filters: r.filters, times: Number(r.times) }));
}
