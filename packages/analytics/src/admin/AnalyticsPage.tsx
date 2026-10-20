import { can, requirePermission } from '@ecomkit/core/auth-context';
import type { DashboardWidget, DateRange, Report } from '@ecomkit/core/contracts';
import { buttonVariants, DetailFrame, RangeBar, Skeleton, Stat, TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import { compareRange, parseCompare, parseRange, rangeQuery, type CompareMode } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { liveReport } from '../server/reports';
import { LiveRefreshIsland } from './LiveRefreshIsland';
import { OverviewCharts, type ReportProps } from './tabs';

// Admin copy is English-only (exempt from the messages rule).

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Widget = Pick<DashboardWidget, 'id' | 'title' | 'permission' | 'component'>;

const BASE = '/admin/analytics';
const GROUP_LABEL: Record<string, string> = { sales: 'Sales', products: 'Products', customers: 'Customers', acquisition: 'Acquisition', behaviour: 'Behaviour', inventory: 'Inventory', performance: 'Performance' };
const groupLabel = (g: string) => GROUP_LABEL[g] ?? g.charAt(0).toUpperCase() + g.slice(1);

/** Range, compare and the page's other string params from the URL. Call after a permission check (it reads the clock). */
async function readQuery(searchParams: SearchParams): Promise<{ range: DateRange; mode: CompareMode; compare: DateRange | null; params: Record<string, string> }> {
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : Array.isArray(v) && v[0] ? [[k, v[0]]] : [])));
  const range = parseRange(params, new Date());
  const mode = parseCompare(params.compare);
  return { range, mode, compare: compareRange(range, mode), params };
}

async function Slot({ load, ...props }: { load: Widget['component'] | Report['component'] } & ReportProps) {
  const Body = await load();
  return <Body range={props.range} {...{ compare: props.compare, params: props.params }} />;
}

function Header({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <h1 className="text-2xl font-semibold text-text">{title}</h1>
      {actions}
    </header>
  );
}

const subLinks = (
  <div className="flex gap-2">
    <Link href={`${BASE}/reports`} className={buttonVariants({ size: 'sm', variant: 'outline' })} data-cta="analytics-reports">
      Reports
    </Link>
    <Link href={`${BASE}/live`} className={buttonVariants({ size: 'sm', variant: 'outline' })} data-cta="analytics-live">
      Live view
    </Link>
  </div>
);

export interface AnalyticsPageProps {
  searchParams: SearchParams;
  /** KPI dashboard widgets (`registry.list('dashboardWidgets').filter(isKpiWidget)` in the host); default: this module's own. */
  kpis?: readonly Widget[];
}

/** /admin/analytics (Shopify overview): date range + compare, KPI cards, sessions per day, channels, top pages. */
export async function AnalyticsPage({ searchParams, kpis = [] }: AnalyticsPageProps) {
  const viewer = await requirePermission('analytics.read');
  const { range, mode, compare } = await readQuery(searchParams);
  const cards = kpis.filter((w) => !w.permission || can(viewer, w.permission));
  return (
    <div className="flex flex-col gap-5">
      <Header title="Analytics" actions={subLinks} />
      <RangeBar action={BASE} range={range} compare={mode} compared={compare} className="items-start" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-kpis="">
        {cards.map((w) => (
          <Suspense key={w.id} fallback={<Skeleton className="h-28" />}>
            <Slot load={w.component} range={range} compare={compare} />
          </Suspense>
        ))}
      </div>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <OverviewCharts range={range} />
      </Suspense>
    </div>
  );
}

/** /admin/analytics/reports: every report the viewer may open (from all enabled modules), grouped by category. */
export async function ReportsListPage({ searchParams, reports }: { searchParams: SearchParams; reports: readonly Report[] }) {
  const viewer = await requirePermission('analytics.read');
  const { range, mode } = await readQuery(searchParams);
  const mine = reports.filter((r) => can(viewer, r.permission)).sort((a, b) => groupLabel(a.group).localeCompare(groupLabel(b.group)) || a.title.localeCompare(b.title));
  const q = rangeQuery(range, mode);
  return (
    <div className="flex flex-col gap-5">
      <Header title="Reports" actions={subLinks} />
      <Table>
        <THead>
          <Tr>
            <Th>Report</Th>
            <Th>Category</Th>
          </Tr>
        </THead>
        <TBody>
          {mine.map((r) => (
            <Tr key={r.id} className="relative">
              <Td>
                <Link href={`${BASE}/reports/${r.id}?${q}`} className="font-medium after:absolute after:inset-0 hover:underline" data-cta={`report-${r.id}`}>
                  {r.title}
                </Link>
              </Td>
              <Td className="text-muted">{groupLabel(r.group)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/** /admin/analytics/reports/[id]: one report over the URL's range, with compare passed to the report body. */
export async function ReportPage({ id, searchParams, reports }: { id: string; searchParams: SearchParams; reports: readonly Report[] }) {
  await requirePermission('analytics.read');
  const r = reports.find((x) => x.id === id);
  if (!r) notFound();
  await requirePermission(r.permission);
  const { range, mode, compare, params } = await readQuery(searchParams);
  return (
    <DetailFrame
      title={r.title}
      backHref={`${BASE}/reports`}
      meta={groupLabel(r.group)}
      primary={<RangeBar action={`${BASE}/reports/${r.id}`} range={range} compare={mode} compared={compare} keep={params.session ? { session: params.session } : {}} />}
    >
      <Suspense key={`${range.from}:${range.to}:${mode}:${params.session ?? ''}`} fallback={<Skeleton className="h-64" />}>
        <Slot load={r.component} range={range} compare={compare} params={params} />
      </Suspense>
    </DetailFrame>
  );
}

const num = (n: number) => n.toLocaleString('en-IN');
const timeIst = (at: string) => new Date(at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });

/** /admin/analytics/live: visitors right now, pages and events of the last 30 minutes; refreshes itself. */
export async function LivePage() {
  const live = await liveReport();
  return (
    <div className="flex flex-col gap-5">
      <LiveRefreshIsland />
      <Header title="Live view" actions={subLinks} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Visitors right now" value={num(live.visitorsNow)} delta="active in the last 5 minutes" />
        <Stat label="Sessions right now" value={num(live.sessionsNow)} />
        <Stat label="Sessions today" value={num(live.sessionsToday)} />
        <Stat label="Purchases today" value={num(live.purchasesToday)} delta="tracked in the browser" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <LiveTable title="Pages, last 30 minutes" rows={live.pages.map((p) => [p.path, num(p.views)])} head={['Path', 'Views']} />
        <LiveTable title="Channels, last 30 minutes" rows={live.channels.map((c) => [c.channel, num(c.sessions)])} head={['Channel', 'Sessions']} />
      </div>
      <LiveTable title="Latest events" rows={live.events.map((e) => [timeIst(e.at), e.name.replaceAll('_', ' '), e.path, e.device])} head={['Time (IST)', 'Event', 'Path', 'Device']} />
    </div>
  );
}

function LiveTable({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-text">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">Nobody here in the last 30 minutes.</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              {head.map((h) => (
                <Th key={h}>{h}</Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <Tr key={i}>
                {r.map((c, j) => (
                  <Td key={j} className="max-w-[28rem] truncate">
                    {c}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
