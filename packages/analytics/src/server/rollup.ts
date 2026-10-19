import type { JobHandler } from '@ecomkit/core/contracts';
import { db, withTx } from '@ecomkit/core/db';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, istDay, istDayBounds, RETENTION_DAYS } from '../domain/time';
import { analyticsDailyRollup } from '../schema';

export interface MetricRow {
  metric: string;
  dimension: string;
  value: number;
}

/** Real visitors only: bots and test sessions never reach a report. */
export const HUMAN = sql`s.is_bot = false and s.is_test = false`;

/**
 * Every daily metric for one IST day, computed from raw rows:
 * sessions, visitors, new_visitors, page_views, purchases, revenue_paise (purchase `value` prop, paise),
 * events / <name>, sessions_by_channel / <channel>, sessions_by_device / <device>, page_views_by_path / <path>,
 * bot_sessions / <bot name>. Session metrics count sessions started that day; event metrics count events that day.
 */
export async function computeDayMetrics(day: string): Promise<MetricRow[]> {
  const { start, end } = istDayBounds(day);
  const from = start.toISOString();
  const to = end.toISOString();
  const inDay = (col: string) => sql`${sql.raw(col)} >= ${from}::timestamptz and ${sql.raw(col)} < ${to}::timestamptz`;

  const { rows } = await db.execute<{ metric: string; dimension: string; value: string }>(sql`
    with s as (select * from analytics_session s where ${inDay('s.started_at')}),
    e as (
      select e.name, e.path, e.props from analytics_event e join analytics_session s on s.id = e.session_id
      where ${inDay('e.server_ts')} and ${HUMAN}
    )
    select 'sessions' as metric, '' as dimension, count(*)::text as value from s where ${HUMAN}
    union all select 'visitors', '', count(distinct s.visitor_id)::text from s where ${HUMAN}
    union all select 'new_visitors', '', count(*)::text from analytics_visitor v
      where ${inDay('v.first_seen')} and v.is_bot = false
    union all select 'page_views', '', count(*)::text from e where name = 'page_view'
    union all select 'purchases', '', count(*)::text from e where name = 'purchase'
    union all select 'revenue_paise', '', coalesce(sum(case when (props->>'value') ~ '^[0-9]+$' then (props->>'value')::bigint end), 0)::text
      from e where name = 'purchase'
    union all (select 'events', name, count(*)::text from e group by name)
    union all (select 'sessions_by_channel', s.channel, count(*)::text from s where ${HUMAN} group by s.channel)
    union all (select 'sessions_by_device', s.device::text, count(*)::text from s where ${HUMAN} group by s.device)
    union all (select 'page_views_by_path', path, count(*)::text from e where name = 'page_view' group by path order by count(*) desc limit 500)
    union all (select 'bot_sessions', coalesce(s.bot_name, 'Other bot'), count(*)::text from s where s.is_bot group by 2)
  `);
  return rows.map((r) => ({ metric: r.metric, dimension: r.dimension, value: Number(r.value) }));
}

/** Replaces the stored rollup of one day (re-running a day is safe). */
export async function rollupDay(day: string): Promise<number> {
  const rows = await computeDayMetrics(day);
  await withTx(async (tx) => {
    await tx.delete(analyticsDailyRollup).where(eq(analyticsDailyRollup.day, day));
    await tx.insert(analyticsDailyRollup).values(rows.map((r) => ({ day, metric: r.metric, dimension: r.dimension, value: String(r.value) })));
  });
  return rows.length;
}

/** Stored rollup rows of one day; empty when the day has not been rolled up. */
export async function storedDayMetrics(day: string): Promise<MetricRow[]> {
  const rows = await db
    .select()
    .from(analyticsDailyRollup)
    .where(eq(analyticsDailyRollup.day, day));
  return rows.map((r) => ({ metric: r.metric, dimension: r.dimension, value: Number(r.value) }));
}

/** Web vitals past retention (raw events go with their partitions). */
export async function pruneWebVitals(now: Date = new Date()): Promise<number> {
  const res = await db.execute(sql`delete from analytics_web_vital where created_at < ${now.toISOString()}::timestamptz - make_interval(days => ${RETENTION_DAYS})`);
  return res.rowCount ?? 0;
}

/**
 * analytics.rollup-daily (01:30 IST): rolls up yesterday, and re-rolls the day before so late batches count.
 * `{ day: 'YYYY-MM-DD' }` rolls up one specific day (backfill).
 */
const jobData = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).nullish();

export const rollupDailyJob: JobHandler<unknown> = async (data, ctx) => {
  const day = jobData.parse(data)?.day;
  const today = istDay(new Date());
  const days = day ? [day] : [addDays(today, -1), addDays(today, -2)];
  for (const day of days) ctx.log.info('analytics rollup', { day, rows: await rollupDay(day) });
  ctx.log.info('analytics vitals pruned', { rows: await pruneWebVitals() });
};
