import type { TestDb } from '@ecomkit/core/testing';
import { TEST_NOW } from '@ecomkit/core/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REPORT_NAMES } from '../src/domain/reports';
import { istDay } from '../src/domain/time';
import { ingest } from '../src/server/ingest';
import { report } from '../src/server/reports';
import { computeDayMetrics, rollupDailyJob, rollupDay, storedDayMetrics } from '../src/server/rollup';
import { analyticsDb, BOT_UA, CHROME_UA, DESKTOP_UA, ev, minutes } from './helpers';

// Server-rendering the admin pages outside Next: the list toolbar and live-view islands call useRouter.
vi.mock('next/navigation', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

let t: TestDb;
const DAY = istDay(TEST_NOW); // 2026-10-20
const at = (ms: number) => new Date(TEST_NOW.getTime() + ms);
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };

async function visit(ua: string, batches: { at: number; e: ReturnType<typeof ev>[]; r?: string }[], extra: { isStaff?: boolean } = {}) {
  let cookie: string | null = null;
  for (const b of batches) {
    const res = await ingest({ e: b.e, ...(b.r ? { r: b.r } : {}) }, { cookie, userAgent: ua, now: at(b.at), ...extra });
    if (!res.ok) throw new Error('rejected');
    cookie = res.cookie;
  }
}

beforeAll(async () => {
  t = await analyticsDb('wp-12-rollup');
  // Buyer from search: full funnel with a purchase of Rs 1,250.
  await visit(CHROME_UA, [
    { at: 0, r: 'www.google.com', e: [ev('page_view', '/'), ev('view_item_list', '/plants'), ev('page_view', '/plants')] },
    { at: minutes(2), e: [ev('view_item', '/p/mango'), ev('page_view', '/p/mango'), ev('add_to_cart', '/p/mango', { item_id: 'mango', qty: 2 })] },
    { at: minutes(5), e: [ev('begin_checkout', '/checkout'), ev('add_payment_info', '/checkout'), ev('purchase', '/order/1', { value: 125000 })] },
  ]);
  // Browser who leaves, then comes back 40 minutes later (two sessions).
  await visit(DESKTOP_UA, [
    { at: minutes(10), e: [ev('page_view', '/'), ev('search', '/search', { q: 'jamun', results: 0 }), ev('filter_apply', '/plants', { facet: 'size', value: 'L', results: 4 })] },
    { at: minutes(50), e: [ev('page_view', '/plants'), ev('wizard_step', '/plan', { step: 1 }), ev('attention', '/plants', { k: 'product', s: 'mango', v: 4000, e: 3000 })] },
    { at: minutes(51), e: [ev('scroll_depth', '/plants', { pct: 50 }), ev('rage_click', '/plants', { s: 'size-filter' }), ev('web_vital', '/plants', { m: 'LCP', v: 3100 })] },
  ]);
  // Excluded: a bot and a staff member placing a test order.
  await visit(BOT_UA, [{ at: minutes(1), e: [ev('page_view', '/'), ev('page_view', '/plants')] }]);
  await visit(DESKTOP_UA, [{ at: minutes(3), e: [ev('page_view', '/'), ev('purchase', '/order/2', { value: 99900, test: true })] }], { isStaff: true });
  // Yesterday, for the previous period and multi-day ranges.
  await visit(CHROME_UA, [{ at: -minutes(24 * 60), e: [ev('page_view', '/')] }]);
});
afterAll(async () => {
  await t?.close();
});

async function rawCount(where: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await t.db.execute<{ n: number }>(sql`
    select count(*)::int as n from analytics_event e join analytics_session s on s.id = e.session_id
    where s.is_bot = false and s.is_test = false
      and e.server_ts >= ${`${DAY}T00:00:00+05:30`}::timestamptz and e.server_ts < ${`${DAY}T00:00:00+05:30`}::timestamptz + interval '1 day'
      and ${where}`);
  return rows[0]!.n;
}

describe('nightly rollup', () => {
  it('stores exactly what the raw rows say (bots and test sessions excluded)', async () => {
    await rollupDay(DAY);
    const stored = await storedDayMetrics(DAY);
    const get = (metric: string, dimension = '') => stored.find((r) => r.metric === metric && r.dimension === dimension)?.value ?? 0;

    expect(get('page_views')).toBe(await rawCount(sql`e.name = 'page_view'`));
    expect(get('page_views')).toBe(5);
    expect(get('events', 'add_to_cart')).toBe(await rawCount(sql`e.name = 'add_to_cart'`));
    expect(get('purchases')).toBe(1);
    expect(get('revenue_paise')).toBe(125000);
    expect(get('sessions')).toBe(3); // buyer + two sessions of the returning browser
    expect(get('visitors')).toBe(2);
    expect(get('sessions_by_channel', 'search')).toBe(1);
    expect(get('bot_sessions', 'Googlebot')).toBe(1);
    expect(get('page_views_by_path', '/plants')).toBe(await rawCount(sql`e.name = 'page_view' and e.path = '/plants'`));

    const totalEvents = stored.filter((r) => r.metric === 'events').reduce((n, r) => n + r.value, 0);
    expect(totalEvents).toBe(await rawCount(sql`true`));
  });

  it('re-running a day replaces it, and stored equals freshly computed', async () => {
    await rollupDay(DAY);
    const sort = (rows: { metric: string; dimension: string; value: number }[]) => [...rows].sort((a, b) => `${a.metric}|${a.dimension}`.localeCompare(`${b.metric}|${b.dimension}`));
    expect(sort(await storedDayMetrics(DAY))).toEqual(sort(await computeDayMetrics(DAY)));
  });

  it('the job backfills a named day and validates its input', async () => {
    await rollupDailyJob({ day: '2026-10-19' }, { jobId: 'j', queue: 'analytics.rollup-daily', attempt: 1, log });
    expect((await storedDayMetrics('2026-10-19')).find((r) => r.metric === 'page_views')?.value).toBe(1);
    await expect(rollupDailyJob({ day: '19-10-2026' }, { jobId: 'j', queue: 'analytics.rollup-daily', attempt: 1, log })).rejects.toThrow();
  });
});

describe('reports', () => {
  const range = { from: DAY, to: DAY };

  it('overview matches the rollup and excludes the test order', async () => {
    const r = await report('overview', range, { now: at(minutes(60 * 24 * 2)) });
    expect(r.kpis).toMatchObject({ sessions: 3, visitors: 2, pageViews: 5, purchases: 1, revenuePaise: 125000 });
    expect(r.kpis.conversionRate).toBeCloseTo(1 / 3);
    expect(r.previous.sessions).toBe(1);
    expect(r.series).toEqual([{ day: DAY, sessions: 3 }]);
  });

  it('overview computes today live when no rollup exists yet', async () => {
    await t.db.execute(sql`delete from analytics_daily_rollup where day = ${DAY}`);
    const r = await report('overview', range, { now: at(minutes(60)) });
    expect(r.kpis.pageViews).toBe(5);
  });

  it('funnel, search, wizard, attention, bots and vitals read the seeded journeys', async () => {
    const funnel = await report('funnel', range);
    expect(funnel.steps.map((s) => s.sessions)).toEqual([3, 1, 1, 1, 1, 1]);
    const search = await report('search', range);
    expect(search.zeroResultQueries).toEqual([{ query: 'jamun', searches: 1 }]);
    expect(search.filters[0]).toMatchObject({ facet: 'size', value: 'L', uses: 1, zero: 0 });
    const wizard = await report('wizard', range);
    expect(wizard.steps).toEqual([{ step: '1', sessions: 1 }]);
    const attention = await report('attention', range);
    expect(attention.products[0]).toMatchObject({ product: 'mango', engaged_ms: 3000, add_to_cart: 1 });
    expect(attention.clicks[0]).toMatchObject({ kind: 'rage_click', target: 'size-filter', clicks: 1 });
    const bots = await report('bots', range);
    expect(bots.bots[0]).toMatchObject({ bot: 'Googlebot', sessions: 1, events: 2 });
    const vitals = await report('vitals', range);
    expect(vitals.overall).toEqual([{ metric: 'LCP', device: 'desktop', p75: 3100, samples: 1 }]);
    const traffic = await report('traffic', range);
    expect(traffic.channels.find((c) => c.channel === 'search')?.sessions).toBe(1);
    const journeys = await report('journeys', range);
    expect(journeys.paths).toContainEqual({ path: '/ → /plants → /p/mango', sessions: 1 });
    const buyer = journeys.recent.find((s) => s.converted);
    const timeline = await report('journeys', range, { sessionId: buyer!.id });
    expect(timeline.timeline?.map((e) => e.name)).toContain('purchase');
  });

  it('every report runs on an empty range and rejects a bad range', async () => {
    for (const name of REPORT_NAMES) await expect(report(name, { from: '2025-01-01', to: '2025-01-02' }, { now: TEST_NOW })).resolves.toBeTruthy();
    await expect(report('overview', { from: '2026-10-20', to: '2026-10-01' })).rejects.toThrow();
  });
});

describe('admin page', () => {
  const range = { from: DAY, to: DAY };

  it('renders the overview, KPI cards and report bodies from real data', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { setAuthProvider } = await import('@ecomkit/core/auth-context');
    const tabs = await import('../src/admin/tabs');
    const kpis = await import('../src/admin/kpis');
    const overview = renderToStaticMarkup(await tabs.OverviewCharts({ range }));
    expect(overview).toContain('Sessions per day');
    setAuthProvider(async () => ({
      getViewer: async () => ({ kind: 'guest' }),
      requirePermission: async (p) => ({ kind: 'staff', userId: 'u', name: 'Owner', email: 'o@x.in', role: 'owner', permissions: [p] }),
      requireOwner: async () => {
        throw new Error('not used');
      },
    }));
    const conversion = renderToStaticMarkup(await kpis.ConversionKpi({ range, compare: { from: '2025-01-01', to: '2025-01-01' } }));
    expect(conversion).toContain('Conversion rate');
    expect(conversion).toContain('New in this period');
    expect(renderToStaticMarkup(await kpis.SessionsKpi({ range }))).toContain('<svg');
    const live = renderToStaticMarkup(await (await import('../src/admin/AnalyticsPage')).LivePage());
    expect(live).toContain('Visitors right now');
    setAuthProvider(async () => null);
    const vitals = renderToStaticMarkup(await tabs.VitalsTab({ range }));
    expect(vitals).toContain('3,100 ms');
    const journeys = renderToStaticMarkup(await tabs.JourneysTab({ range, params: { from: DAY } }));
    expect(journeys).toContain('session=');
    for (const Tab of [tabs.FunnelTab, tabs.TrafficTab, tabs.SearchTab, tabs.WizardTab, tabs.AttentionTab, tabs.BotsTab]) {
      expect(renderToStaticMarkup(await Tab({ range })).length).toBeGreaterThan(100);
    }
  });

  it('requires analytics.read', async () => {
    const { setAuthProvider, ForbiddenError } = await import('@ecomkit/core/auth-context');
    const { AnalyticsPage } = await import('../src/admin/AnalyticsPage');
    const searchParams = Promise.resolve({ tab: 'funnel', from: DAY, to: DAY });
    setAuthProvider(async () => null);
    await expect(AnalyticsPage({ searchParams })).rejects.toBeInstanceOf(ForbiddenError);
    setAuthProvider(async () => ({
      getViewer: async () => ({ kind: 'guest' }),
      requirePermission: async (p) => ({ kind: 'staff', userId: 'u', name: 'Owner', email: 'o@x.in', role: 'owner', permissions: [p] }),
      requireOwner: async () => {
        throw new Error('not used');
      },
    }));
    await expect(AnalyticsPage({ searchParams })).resolves.toBeTruthy();
    // the reports list hides reports needing a permission the viewer lacks; an unknown report is a 404
    const { ReportsListPage, ReportPage } = await import('../src/admin/AnalyticsPage');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const Body = async () => null;
    const reports = [
      { id: 'a.mine', title: 'Mine', group: 'sales', permission: 'analytics.read' as const, component: async () => Body },
      { id: 'b.other', title: 'Other', group: 'inventory', permission: 'inventory.read' as const, component: async () => Body },
    ];
    setAuthProvider(async () => ({
      getViewer: async () => ({ kind: 'staff', userId: 'u', name: 'Analyst', email: 'a@x.in', role: 'manager', permissions: ['analytics.read'] }),
      requirePermission: async (p) => {
        if (p !== 'analytics.read') throw new ForbiddenError();
        return { kind: 'staff', userId: 'u', name: 'Analyst', email: 'a@x.in', role: 'manager', permissions: ['analytics.read'] };
      },
      requireOwner: async () => {
        throw new Error('not used');
      },
    }));
    const list = renderToStaticMarkup(await ReportsListPage({ searchParams, reports }));
    expect(list).toContain('/admin/analytics/reports/a.mine?');
    expect(list).not.toContain('b.other');
    await expect(ReportPage({ id: 'b.other', searchParams, reports })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ReportPage({ id: 'nope', searchParams, reports })).rejects.toThrow();
    setAuthProvider(async () => null);
  });
});
