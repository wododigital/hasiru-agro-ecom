import type { DashboardWidget, DateRange as Range } from '@ecomkit/core/contracts';
import type { Registry } from '@ecomkit/core/manifest';
import { Button, DateRange, EmptyState, Skeleton, cn } from '@ecomkit/ui';
import { LayoutDashboard } from 'lucide-react';
import { Suspense } from 'react';
import { parseRange } from '../domain';
import { requireAdmin } from '../server/access';
import { PageHeader, PageSkeleton } from '../admin/PageHeader';
import { WidgetBoundaryIsland } from './WidgetBoundaryIsland';

const SIZE: Record<DashboardWidget['size'], string> = {
  sm: '',
  md: 'md:col-span-2',
  lg: 'md:col-span-2 xl:col-span-3',
  full: 'md:col-span-2 xl:col-span-4',
};

async function WidgetSlot({ load, range }: { load: DashboardWidget['component']; range: Range }) {
  const Widget = await load();
  return <Widget range={range} />;
}

/**
 * /admin home: the date range bar and a 4-column grid of `dashboardWidgets` from enabled modules, sorted by
 * order and filtered by permission. Each widget streams in behind its own skeleton and error boundary.
 */
export function DashboardPage(props: DashboardPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard {...props} />
    </Suspense>
  );
}

export interface DashboardPageProps {
  registry: Registry;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  /** Tests pin the clock; pages leave it out. */
  now?: Date;
}

async function Dashboard({ registry, searchParams, now }: DashboardPageProps) {
  const { viewer } = await requireAdmin();
  const query = await searchParams;
  const first = (k: string) => [query[k]].flat()[0];
  // The clock is read after the viewer (a request-time read), as cache components require.
  const range = parseRange({ from: first('from'), to: first('to') }, now ?? new Date());
  const widgets = registry.list('dashboardWidgets').filter((w) => !w.permission || viewer.permissions.includes(w.permission));

  return (
    <>
      <PageHeader
        title={`Hello, ${viewer.name.split(' ')[0] || viewer.name}`}
        actions={
          <form method="get" action="/admin" className="flex flex-wrap items-end gap-2">
            <DateRange defaultValue={range} />
            <Button type="submit" size="sm" variant="outline" data-cta="dashboard-range">
              Apply
            </Button>
          </form>
        }
      />
      {widgets.length === 0 ? (
        <EmptyState icon={<LayoutDashboard aria-hidden="true" />} title="Nothing to show yet" body="Sales, orders, stock and health tiles appear here as modules are enabled." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {widgets.map((w) => (
            <section key={`${w.moduleId}:${w.id}`} aria-label={w.title} className={cn('flex flex-col gap-3 rounded-md border border-border bg-surface p-4', SIZE[w.size])} data-widget={w.id}>
              <h2 className="text-sm font-semibold text-muted">{w.title}</h2>
              <WidgetBoundaryIsland title={w.title}>
                <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                  <WidgetSlot load={w.component} range={range} />
                </Suspense>
              </WidgetBoundaryIsland>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
