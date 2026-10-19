import type { DbOrTx } from '@ecomkit/core/db';
import { and, count, desc, gte, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalise } from '../domain/suggest';
import { searchQueryLog } from '../schema';

export const logInputSchema = z.object({
  q: z.string().max(200).default(''),
  results: z.number().int().min(0).max(100_000),
  /** The `f` URL param (filters), at most a few hundred characters. */
  filters: z.string().max(600).nullable().default(null),
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
