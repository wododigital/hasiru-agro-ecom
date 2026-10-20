import { AnalyticsPage } from '@ecomkit/analytics/admin';
import { isKpiWidget } from '@ecomkit/ui/domain';
// eslint-disable-next-line no-restricted-imports -- the app's own generated registry, not another package (the cross-package pattern matches any ../../../.. hop)
import { registry } from '../../../../src/generated/registry';

// Hand-written: passes every enabled module's KPI cards (dashboard widgets with `.kpi.`) to the overview.
export default function AnalyticsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AnalyticsPage searchParams={searchParams} kpis={registry.list('dashboardWidgets').filter(isKpiWidget)} />;
}
