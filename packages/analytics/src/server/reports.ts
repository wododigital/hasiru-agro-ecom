import type { DateRange } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { dateRangeSchema, FUNNEL_STEPS, funnelCounts, pathKey, VITAL_METRICS, type ReportName, type VitalMetric } from '../domain/reports';
import { daysIn, istDay, previousRange, rangeBounds } from '../domain/time';
import { computeDayMetrics, HUMAN, storedDayMetrics, type MetricRow } from './rollup';

type Row = Record<string, string | number | boolean | null>;

function bounds(range: DateRange) {
  const { start, end } = rangeBounds(range);
  const from = start.toISOString();
  const to = end.toISOString();
  return (col: string): SQL => sql`${sql.raw(col)} >= ${from}::timestamptz and ${sql.raw(col)} < ${to}::timestamptz`;
}

/** Counts are cast to int and sums to float8 in SQL, so pg returns JS numbers. */
async function rows<T extends Row>(query: SQL): Promise<T[]> {
  return (await db.execute<T>(query)).rows as T[];
}

/** Human events in range, joined to their session. */
const humanEvents = (within: (c: string) => SQL, extra: SQL = sql`true`) =>
  sql`analytics_event e join analytics_session s on s.id = e.session_id where ${within('e.server_ts')} and ${HUMAN} and ${extra}`;

// ---- day metrics (rollups, computed live for today and for days not rolled up yet) ----------------

async function dayMetrics(range: DateRange, now: Date): Promise<Map<string, MetricRow[]>> {
  const today = istDay(now);
  const out = new Map<string, MetricRow[]>();
  for (const day of daysIn(range)) {
    if (day > today) continue;
    const stored = day < today ? await storedDayMetrics(day) : [];
    out.set(day, stored.some((r) => r.metric === 'sessions') ? stored : await computeDayMetrics(day));
  }
  return out;
}

const sum = (byDay: Map<string, MetricRow[]>, metric: string, dimension = '') =>
  [...byDay.values()].flat().reduce((n, r) => (r.metric === metric && r.dimension === dimension ? n + r.value : n), 0);

function sumByDimension(byDay: Map<string, MetricRow[]>, metric: string, limit: number): { key: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const r of [...byDay.values()].flat()) if (r.metric === metric) totals.set(r.dimension, (totals.get(r.dimension) ?? 0) + r.value);
  return [...totals].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value).slice(0, limit);
}

export interface Kpis {
  sessions: number;
  visitors: number;
  pageViews: number;
  purchases: number;
  revenuePaise: number;
  conversionRate: number;
}

async function kpis(range: DateRange, now: Date): Promise<{ kpis: Kpis; byDay: Map<string, MetricRow[]> }> {
  const within = bounds(range);
  const [s] = await rows<{ sessions: number; visitors: number }>(
    sql`select count(*)::int as sessions, count(distinct visitor_id)::int as visitors from analytics_session s where ${within('s.started_at')} and ${HUMAN}`,
  );
  const byDay = await dayMetrics(range, now);
  const sessions = Number(s?.sessions ?? 0);
  const purchases = sum(byDay, 'purchases');
  return {
    byDay,
    kpis: {
      sessions,
      visitors: Number(s?.visitors ?? 0),
      pageViews: sum(byDay, 'page_views'),
      purchases,
      revenuePaise: sum(byDay, 'revenue_paise'),
      conversionRate: sessions ? purchases / sessions : 0,
    },
  };
}

export async function overviewReport(range: DateRange, now = new Date()) {
  const current = await kpis(range, now);
  const previous = await kpis(previousRange(range), now);
  return {
    kpis: current.kpis,
    previous: previous.kpis,
    series: daysIn(range).map((day) => ({ day, sessions: sum(new Map([[day, current.byDay.get(day) ?? []]]), 'sessions') })),
    channels: sumByDimension(current.byDay, 'sessions_by_channel', 10),
    topPages: sumByDimension(current.byDay, 'page_views_by_path', 10),
  };
}

export async function funnelReport(range: DateRange) {
  const within = bounds(range);
  const steps = sql.join(FUNNEL_STEPS.map((s) => sql`${s}`), sql`, `);
  const raw = await rows<{ session_id: string; name: string; at: string }>(
    sql`select e.session_id, e.name, min(e.server_ts)::text as at from ${humanEvents(within, sql`e.name in (${steps})`)} group by 1, 2`,
  );
  const counts = funnelCounts(raw.map((r) => ({ sessionId: r.session_id, name: r.name, at: new Date(r.at) })));
  return { steps: FUNNEL_STEPS.map((step, i) => ({ step, sessions: counts[i]!, rate: i === 0 ? 1 : counts[i - 1] ? counts[i]! / counts[i - 1]! : 0 })) };
}

export async function trafficReport(range: DateRange) {
  const within = bounds(range);
  const sessions = sql`analytics_session s where ${within('s.started_at')} and ${HUMAN}`;
  return {
    channels: await rows<{ channel: string; sessions: number }>(sql`select channel, count(*)::int as sessions from ${sessions} group by 1 order by 2 desc`),
    devices: await rows<{ device: string; sessions: number }>(sql`select device::text, count(*)::int as sessions from ${sessions} group by 1 order by 2 desc`),
    referrers: await rows<{ host: string; sessions: number }>(
      sql`select referrer_host as host, count(*)::int as sessions from ${sessions} and referrer_host is not null group by 1 order by 2 desc limit 20`,
    ),
    campaigns: await rows<{ source: string | null; medium: string | null; campaign: string | null; sessions: number }>(
      sql`select utm->>'source' as source, utm->>'medium' as medium, utm->>'campaign' as campaign, count(*)::int as sessions
          from ${sessions} and utm is not null group by 1, 2, 3 order by 4 desc limit 20`,
    ),
    landingPages: await rows<{ path: string; sessions: number }>(sql`select landing_path as path, count(*)::int as sessions from ${sessions} group by 1 order by 2 desc limit 20`),
    aiReferrals: await rows<{ host: string; sessions: number }>(
      sql`select coalesce(referrer_host, utm->>'source') as host, count(*)::int as sessions from ${sessions} and channel = 'ai' group by 1 order by 2 desc`,
    ),
    visitorType: await rows<{ type: string; sessions: number }>(
      sql`select case when v.first_seen >= s.started_at - interval '1 minute' then 'new' else 'returning' end as type, count(*)::int as sessions
          from analytics_session s join analytics_visitor v on v.id = s.visitor_id where ${within('s.started_at')} and ${HUMAN} group by 1 order by 1`,
    ),
  };
}

export async function journeysReport(range: DateRange, options: { sessionId?: string } = {}) {
  const within = bounds(range);
  const perSession = await rows<{ id: string; paths: string }>(
    sql`select e.session_id as id, string_agg(e.path, chr(31) order by e.server_ts, e.id) as paths
        from ${humanEvents(within, sql`e.name = 'page_view'`)} group by 1 order by max(e.server_ts) desc limit 5000`,
  );
  const counts = new Map<string, number>();
  for (const s of perSession) {
    const key = pathKey(String(s.paths).split('\u001f'));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const recent = await rows<{ id: string; started_at: string; landing_path: string; channel: string; device: string; pages: number; converted: boolean }>(
    sql`select s.id, s.started_at::text, s.landing_path, s.channel, s.device::text,
          (select count(*)::int from analytics_event e where e.session_id = s.id and e.name = 'page_view') as pages,
          exists (select 1 from analytics_event e where e.session_id = s.id and e.name = 'purchase') as converted
        from analytics_session s where ${within('s.started_at')} and ${HUMAN} order by s.started_at desc limit 50`,
  );
  const sessionId = z.uuid().safeParse(options.sessionId);
  const timeline = sessionId.success
    ? await rows<{ at: string; name: string; path: string; props: string }>(
        sql`select e.server_ts::text as at, e.name, e.path, e.props::text as props from analytics_event e where e.session_id = ${sessionId.data} order by e.server_ts, e.id limit 500`,
      )
    : null;
  return {
    paths: [...counts].map(([path, sessions]) => ({ path, sessions })).sort((a, b) => b.sessions - a.sessions).slice(0, 20),
    recent,
    timeline,
  };
}

export async function searchReport(range: DateRange) {
  const within = bounds(range);
  return {
    queries: await rows<{ query: string; searches: number; zero: number }>(
      sql`select lower(e.props->>'q') as query, count(*)::int as searches, (count(*) filter (where e.props->>'results' = '0'))::int as zero
          from ${humanEvents(within, sql`e.name = 'search' and coalesce(e.props->>'q', '') <> ''`)} group by 1 order by 2 desc limit 30`,
    ),
    zeroResultQueries: await rows<{ query: string; searches: number }>(
      sql`select lower(e.props->>'q') as query, count(*)::int as searches
          from ${humanEvents(within, sql`e.name = 'search' and e.props->>'results' = '0'`)} group by 1 order by 2 desc limit 30`,
    ),
    filters: await rows<{ facet: string; value: string; uses: number; zero: number }>(
      sql`select e.props->>'facet' as facet, e.props->>'value' as value, count(*)::int as uses, (count(*) filter (where e.props->>'results' = '0'))::int as zero
          from ${humanEvents(within, sql`e.name = 'filter_apply'`)} group by 1, 2 order by 3 desc limit 40`,
    ),
  };
}

export async function wizardReport(range: DateRange) {
  const within = bounds(range);
  const names = ['plan_generated', 'plan_unlocked', 'calculator_used', 'assistant_open', 'assistant_question', 'enquiry_submit', 'notify_me'];
  return {
    steps: await rows<{ step: string; sessions: number }>(
      sql`select e.props->>'step' as step, count(distinct e.session_id)::int as sessions
          from ${humanEvents(within, sql`e.name = 'wizard_step'`)} group by 1 order by 1`,
    ),
    outcomes: await rows<{ name: string; events: number; sessions: number }>(
      sql`select e.name, count(*)::int as events, count(distinct e.session_id)::int as sessions
          from ${humanEvents(within, sql`e.name in (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`)} group by 1 order by 2 desc`,
    ),
    calculators: await rows<{ calculator: string; uses: number }>(
      sql`select coalesce(e.props->>'calculator', 'unknown') as calculator, count(*)::int as uses
          from ${humanEvents(within, sql`e.name = 'calculator_used'`)} group by 1 order by 2 desc`,
    ),
  };
}

export async function attentionReport(range: DateRange) {
  const within = bounds(range);
  return {
    sections: await rows<{ path: string; section: string; visible_ms: number; engaged_ms: number; sessions: number }>(
      sql`select e.path, e.props->>'s' as section, sum((e.props->>'v')::numeric)::float8 as visible_ms, sum((e.props->>'e')::numeric)::float8 as engaged_ms,
            count(distinct e.session_id)::int as sessions
          from ${humanEvents(within, sql`e.name = 'attention' and e.props->>'k' = 'section'`)} group by 1, 2 order by 4 desc limit 50`,
    ),
    products: await rows<{ product: string; engaged_ms: number; sessions: number; add_to_cart: number }>(
      sql`with att as (
            select e.props->>'s' as product, sum((e.props->>'e')::numeric)::float8 as engaged_ms, count(distinct e.session_id)::int as sessions
            from ${humanEvents(within, sql`e.name = 'attention' and e.props->>'k' = 'product'`)} group by 1),
          atc as (
            select e.props->>'item_id' as product, count(*)::int as add_to_cart
            from ${humanEvents(within, sql`e.name = 'add_to_cart'`)} group by 1)
          select att.product, att.engaged_ms, att.sessions, coalesce(atc.add_to_cart, 0) as add_to_cart
          from att left join atc on atc.product = att.product order by att.engaged_ms desc limit 50`,
    ),
    scroll: await rows<{ path: string; pct: number; sessions: number }>(
      sql`select e.path, (e.props->>'pct')::int as pct, count(distinct e.session_id)::int as sessions
          from ${humanEvents(within, sql`e.name = 'scroll_depth' and (e.props->>'pct') ~ '^[0-9]+$'`)} group by 1, 2 order by 1, 2 limit 200`,
    ),
    clicks: await rows<{ kind: string; path: string; target: string; clicks: number }>(
      sql`select e.name as kind, e.path, coalesce(e.props->>'s', '') as target, count(*)::int as clicks
          from ${humanEvents(within, sql`e.name in ('rage_click', 'dead_click')`)} group by 1, 2, 3 order by 4 desc limit 50`,
    ),
    ctas: await rows<{ cta: string; clicks: number }>(
      sql`select e.props->>'cta' as cta, count(*)::int as clicks from ${humanEvents(within, sql`e.name = 'cta_click'`)} group by 1 order by 2 desc limit 30`,
    ),
  };
}

export async function botsReport(range: DateRange) {
  const within = bounds(range);
  return {
    bots: await rows<{ bot: string; sessions: number; events: number }>(
      sql`select coalesce(s.bot_name, 'Other bot') as bot, count(distinct s.id)::int as sessions, count(e.id)::int as events
          from analytics_session s left join analytics_event e on e.session_id = s.id
          where ${within('s.started_at')} and s.is_bot group by 1 order by 2 desc`,
    ),
    aiReferrals: await rows<{ host: string; sessions: number }>(
      sql`select coalesce(referrer_host, utm->>'source') as host, count(*)::int as sessions
          from analytics_session s where ${within('s.started_at')} and ${HUMAN} and channel = 'ai' group by 1 order by 2 desc`,
    ),
  };
}

export async function vitalsReport(range: DateRange) {
  const within = bounds(range);
  const overall = await rows<{ metric: VitalMetric; device: string; p75: number; samples: number }>(
    sql`select metric::text as metric, device::text as device, percentile_cont(0.75) within group (order by value) as p75, count(*)::int as samples
        from analytics_web_vital where ${within('created_at')} group by 1, 2 order by 1, 2`,
  );
  const byPath = await rows<{ path: string; metric: VitalMetric; p75: number; samples: number }>(
    sql`with top as (select path from analytics_web_vital where ${within('created_at')} group by 1 order by count(*) desc limit 20)
        select v.path, v.metric::text as metric, percentile_cont(0.75) within group (order by v.value) as p75, count(*)::int as samples
        from analytics_web_vital v join top on top.path = v.path where ${within('v.created_at')} group by 1, 2`,
  );
  const paths = new Map<string, Partial<Record<VitalMetric, number>> & { samples: number }>();
  for (const r of byPath) {
    const p = paths.get(r.path) ?? { samples: 0 };
    p[r.metric] = Number(r.p75);
    p.samples = Math.max(p.samples, Number(r.samples));
    paths.set(r.path, p);
  }
  return {
    overall,
    paths: [...paths].map(([path, v]) => ({ path, ...v })).sort((a, b) => b.samples - a.samples),
    metrics: VITAL_METRICS,
  };
}

export interface ReportMap {
  overview: Awaited<ReturnType<typeof overviewReport>>;
  funnel: Awaited<ReturnType<typeof funnelReport>>;
  traffic: Awaited<ReturnType<typeof trafficReport>>;
  journeys: Awaited<ReturnType<typeof journeysReport>>;
  search: Awaited<ReturnType<typeof searchReport>>;
  wizard: Awaited<ReturnType<typeof wizardReport>>;
  attention: Awaited<ReturnType<typeof attentionReport>>;
  bots: Awaited<ReturnType<typeof botsReport>>;
  vitals: Awaited<ReturnType<typeof vitalsReport>>;
}

/** The reports API: one named report over an IST date range (validated). Bots and test sessions are excluded except in `bots`. */
export async function report<N extends ReportName>(name: N, range: DateRange, options: { sessionId?: string; now?: Date } = {}): Promise<ReportMap[N]> {
  const r = dateRangeSchema.parse(range);
  const run: { [K in ReportName]: () => Promise<ReportMap[K]> } = {
    overview: () => overviewReport(r, options.now),
    funnel: () => funnelReport(r),
    traffic: () => trafficReport(r),
    journeys: () => journeysReport(r, options),
    search: () => searchReport(r),
    wizard: () => wizardReport(r),
    attention: () => attentionReport(r),
    bots: () => botsReport(r),
    vitals: () => vitalsReport(r),
  };
  return run[name]() as Promise<ReportMap[N]>;
}
