import type { DashboardWidget, DateRange as Range } from '@ecomkit/core/contracts';
import type { Registry } from '@ecomkit/core/manifest';
import { captureError } from '@ecomkit/core/observability';
import { EmptyState, RangeBar, Skeleton, cn } from '@ecomkit/ui';
import { CircleCheck, ChevronRight, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { isKpiWidget } from '@ecomkit/ui/domain';
import { compareRange, parseCompare, parseRange, todoProviders } from '../domain';
import { requireAdmin } from '../server/access';
import { PageHeader, PageSkeleton } from '../admin/PageHeader';
import { WidgetBoundaryIsland } from './WidgetBoundaryIsland';

const SIZE: Record<DashboardWidget['size'], string> = {
  sm: '',
  md: 'md:col-span-2',
  lg: 'md:col-span-2 xl:col-span-3',
  full: 'md:col-span-2 xl:col-span-4',
};

/**
 * Widgets receive `compare` (the comparison window, or null) next to the contract's `range`; the frozen
 * `DashboardWidget` contract only names `range`, so a widget that wants it declares `compare?` itself.
 */
async function WidgetSlot({ load, range, compare }: { load: DashboardWidget['component']; range: Range; compare: Range | null }) {
  const Widget = await load();
  return <Widget range={range} {...{ compare }} />;
}

/** "Things to do": each enabled module's counts the viewer may see; zero counts are left out, a failing count is logged and skipped. */
async function ThingsToDo({ registry, permissions }: { registry: Registry; permissions: readonly string[] }) {
  const todos = todoProviders(registry.modules).filter((t) => permissions.includes(t.permission));
  if (!todos.length) return null;
  const counts = await Promise.allSettled(todos.map(async (t) => (await t.count())()));
  const due = todos.flatMap((t, i) => {
    const r = counts[i]!;
    if (r.status === 'rejected') {
      void captureError(r.reason, { route: 'admin-home-todos', level: 'warning' });
      return [];
    }
    return Number(r.value) > 0 ? [{ ...t, n: Number(r.value) }] : [];
  });
  return (
    <section aria-labelledby="things-to-do" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
      <h2 id="things-to-do" className="text-sm font-semibold text-muted">
        Things to do
      </h2>
      {due.length ? (
        <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
          {due.map((t) => (
            <li key={`${t.moduleId}:${t.id}`}>
              <Link href={t.href} className="flex items-center justify-between gap-2 rounded-sm px-2 py-2 text-sm hover:bg-surface-2" data-cta={`todo-${t.id.replace(/\W+/g, '-')}`}>
                <span>
                  <span className="font-semibold tabular-nums">{t.n.toLocaleString('en-IN')}</span> {t.label}
                </span>
                <ChevronRight aria-hidden="true" className="size-4 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <CircleCheck aria-hidden="true" className="size-4 text-success" /> Nothing needs your attention right now.
        </p>
      )}
    </section>
  );
}

function WidgetCard({ w, range, compare }: { w: DashboardWidget & { moduleId: string }; range: Range; compare: Range | null }) {
  return (
    <WidgetBoundaryIsland title={w.title}>
      <Suspense fallback={<Skeleton className="h-28 w-full" />}>
        <WidgetSlot load={w.component} range={range} compare={compare} />
      </Suspense>
    </WidgetBoundaryIsland>
  );
}

/**
 * /admin home (Shopify): date range + compare, a strip of KPI cards (widgets whose id has `.kpi.`), things to do,
 * then the other `dashboardWidgets` in a 4-column grid. Everything is filtered by permission; each widget streams
 * in behind its own skeleton and error boundary.
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
  const widgets = registry.list('dashboardWidgets').filter((w) => !w.permission || viewer.permissions.includes(w.permission));
  const kpis = widgets.filter(isKpiWidget);
  const others = widgets.filter((w) => !isKpiWidget(w));

  return (
    <>
      <PageHeader
        title={`Hello, ${viewer.name.split(' ')[0] || viewer.name}`}
        actions={<RangeBar action="/admin" range={range} compare={compareMode} compared={compare} />}
      />
      {kpis.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-kpis="">
          {kpis.map((w) => (
            <div key={`${w.moduleId}:${w.id}`} data-widget={w.id}>
              <WidgetCard w={w} range={range} compare={compare} />
            </div>
          ))}
        </div>
      ) : null}
      <ThingsToDo registry={registry} permissions={viewer.permissions} />
      {widgets.length === 0 ? (
        <EmptyState icon={<LayoutDashboard aria-hidden="true" />} title="Nothing to show yet" body="Sales, orders, stock and health tiles appear here as modules are enabled." />
      ) : others.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {others.map((w) => (
            <section key={`${w.moduleId}:${w.id}`} aria-label={w.title} className={cn('flex flex-col gap-3 rounded-md border border-border bg-surface p-4', SIZE[w.size])} data-widget={w.id}>
              <h2 className="text-sm font-semibold text-muted">{w.title}</h2>
              <WidgetCard w={w} range={range} compare={compare} />
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}
