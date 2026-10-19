import { can, getViewer, requirePermission } from '@ecomkit/core/auth-context';
import type { DateRange, Report } from '@ecomkit/core/contracts';
import { Button, cn, DateRange as DateRangeField, Skeleton } from '@ecomkit/ui';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { dateRangeSchema } from '../domain/reports';
import { lastDays } from '../domain/time';
import { AttentionTab, BotsTab, FunnelTab, JourneysTab, NotEnabled, OverviewTab, SearchTab, TrafficTab, VitalsTab, WizardTab } from './tabs';

/** Tab order from the plan. Sales, Products and Customers render `reports` of that group from other modules. */
export const ANALYTICS_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'funnel', label: 'Funnel' },
  { id: 'sales', label: 'Sales', group: 'sales' },
  { id: 'products', label: 'Products', group: 'products' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'customers', label: 'Customers', group: 'customers' },
  { id: 'journeys', label: 'Journeys' },
  { id: 'search', label: 'Search and filters' },
  { id: 'wizard', label: 'Wizard' },
  { id: 'attention', label: 'Attention' },
  { id: 'bots', label: 'Bots' },
  { id: 'vitals', label: 'Vitals' },
] as const;
type TabId = (typeof ANALYTICS_TABS)[number]['id'];

type SearchParams = Record<string, string | string[] | undefined>;
export interface AnalyticsPageProps {
  searchParams: Promise<SearchParams>;
  /** `registry.list('reports')` from the host; the Sales, Products and Customers tabs show the ones of their group. */
  reports?: readonly Report[];
}

const BASE = '/admin/analytics';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function href(tab: TabId, range: DateRange, extra: Record<string, string> = {}): string {
  return `${BASE}?${new URLSearchParams({ tab, from: range.from, to: range.to, ...extra })}`;
}

/** /admin/analytics: tabs in the URL (?tab=), date range in the URL (?from=&to=, IST), default the last 28 days. */
export async function AnalyticsPage({ searchParams, reports = [] }: AnalyticsPageProps) {
  await requirePermission('analytics.read');
  const sp = await searchParams;
  const tab: TabId = ANALYTICS_TABS.find((t) => t.id === one(sp.tab))?.id ?? 'overview';
  const parsed = dateRangeSchema.safeParse({ from: one(sp.from), to: one(sp.to) });
  const range: DateRange = parsed.success ? parsed.data : lastDays(28);
  const session = one(sp.session);

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold text-text">Analytics</h1>
        <form method="get" action={BASE} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          <DateRangeField defaultValue={range} />
          <Button type="submit" size="sm" variant="subtle">
            Apply
          </Button>
        </form>
      </header>
      <nav aria-label="Analytics reports" className="flex gap-2 overflow-x-auto pb-1">
        {ANALYTICS_TABS.map((t) => (
          <Link
            key={t.id}
            href={href(t.id, range)}
            prefetch={false}
            aria-current={t.id === tab ? 'page' : undefined}
            className={cn(
              'rounded-full border-[1.5px] border-border bg-surface px-4 py-1.5 text-sm font-semibold whitespace-nowrap text-primary hover:border-primary',
              t.id === tab && 'border-primary bg-primary text-primary-fg',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Suspense key={`${tab}:${range.from}:${range.to}:${session ?? ''}`} fallback={<TabSkeleton />}>
        <TabBody tab={tab} range={range} session={session} reports={reports} />
      </Suspense>
    </div>
  );
}

async function TabBody({ tab, range, session, reports }: { tab: TabId; range: DateRange; session?: string; reports: readonly Report[] }): Promise<ReactNode> {
  switch (tab) {
    case 'overview':
      return <OverviewTab range={range} />;
    case 'funnel':
      return <FunnelTab range={range} />;
    case 'traffic':
      return <TrafficTab range={range} />;
    case 'journeys':
      return <JourneysTab range={range} sessionId={session} hrefFor={(id) => href('journeys', range, { session: id })} />;
    case 'search':
      return <SearchTab range={range} />;
    case 'wizard':
      return <WizardTab range={range} />;
    case 'attention':
      return <AttentionTab range={range} />;
    case 'bots':
      return <BotsTab range={range} />;
    case 'vitals':
      return <VitalsTab range={range} />;
    case 'sales':
    case 'products':
    case 'customers':
      return <GroupReports group={tab} range={range} reports={reports} />;
  }
}

async function GroupReports({ group, range, reports }: { group: string; range: DateRange; reports: readonly Report[] }) {
  const viewer = await getViewer();
  const mine = reports.filter((r) => r.group === group && can(viewer, r.permission));
  if (mine.length === 0) return <NotEnabled what={group[0]!.toUpperCase() + group.slice(1)} />;
  const loaded = await Promise.all(mine.map(async (r) => ({ id: r.id, title: r.title, Component: await r.component() })));
  return (
    <div className="flex flex-col gap-6">
      {loaded.map(({ id, title, Component }) => (
        <section key={id} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-text">{title}</h2>
          <Component range={range} />
        </section>
      ))}
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
