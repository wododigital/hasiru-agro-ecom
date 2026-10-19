import { AnalyticsPage } from '@ecomkit/analytics/admin';
// eslint-disable-next-line no-restricted-imports -- the app's own generated registry, not another package (the cross-package pattern matches any ../../../.. hop)
import { registry } from '../../../../src/generated/registry';

// Hand-written: passes the store's `reports` (orders, customers...) to the Sales, Products and Customers tabs.
export default function AnalyticsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AnalyticsPage searchParams={searchParams} reports={registry.list('reports')} />;
}
