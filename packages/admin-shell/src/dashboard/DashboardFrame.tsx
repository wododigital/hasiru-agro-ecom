import type { DashboardWidget, DateRange as Range } from '@ecomkit/core/contracts';
import type { Registry } from '@ecomkit/core/manifest';
import { Button, DateRange, EmptyState, Skeleton, cn, fieldClass } from '@ecomkit/ui';
import { ChevronRight, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { compareRange, parseCompare, parseRange } from '../domain';
import { requireAdmin } from '../server/access';
import { PageHeader, PageSkeleton } from '../admin/PageHeader';
import { WidgetBoundaryIsland } from './WidgetBoundaryIsland';

const SIZE: Record<DashboardWidget['size'], string> = {
  sm: '',
  md: 'md:col-span-2',
  lg: 'md:col-span-2 xl:col-span-3',
  full: 'md:col-span-2 xl:col-span-4',
};

/** Home "things to do": shortcuts to the lists that need action, shown only when that module's page is enabled. */
const TODOS = [
  { label: 'Orders to dispatch', href: '/admin/orders/dispatch' },
  { label: 'Payments pending', href: '/admin/payments' },
  { label: 'New enquiries', href: '/admin/enquiries' },
  { label: 'Failed messages', href: '/admin/messages' },
  { label: 'Low stock', href: '/admin/inventory' },
  { label: 'Open alerts', href: '/admin/health' },
  { label: 'Reviews to moderate', href: '/admin/reviews' },
] as const;

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
  const compareMode = parseCompare(first('compare'));
  const compare = compareRange(range, compareMode);
  const todos = TODOS.filter((t) => registry.nav.some((n) => n.href === t.href && (!n.permission || viewer.permissions.includes(n.permission))));
  const widgets = registry.list('dashboardWidgets').filter((w) => !w.permission || viewer.permissions.includes(w.permission));

  return (
    <>
      <PageHeader
        title={`Hello, ${viewer.name.split(' ')[0] || viewer.name}`}
        actions={
          <form method="get" action="/admin" className="flex flex-wrap items-end gap-2">
            <DateRange defaultValue={range} />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Compare to
              <select name="compare" defaultValue={compareMode} className={cn(fieldClass, 'w-auto py-1.5')}>
                <option value="previous-period">Previous period</option>
                <option value="previous-year">Previous year</option>
                <option value="none">No comparison</option>
              </select>
            </label>
            <Button type="submit" size="sm" variant="outline" data-cta="dashboard-range">
              Apply
            </Button>
          </form>
        }
      />
      {compare ? (
        <p className="-mt-3 text-xs text-muted">
          {range.from} to {range.to}, compared with {compare.from} to {compare.to}
        </p>
      ) : null}
      {todos.length ? (
        <section aria-labelledby="things-to-do" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
          <h2 id="things-to-do" className="text-sm font-semibold text-muted">
            Things to do
          </h2>
          <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
            {todos.map((t) => (
              <li key={t.href}>
                <Link href={t.href} className="flex items-center justify-between gap-2 rounded-sm px-2 py-2 text-sm hover:bg-surface-2" data-cta={`todo-${t.href.replace(/\W+/g, '-')}`}>
                  {t.label}
                  <ChevronRight aria-hidden="true" className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
