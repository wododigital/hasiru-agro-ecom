import { ReportsListPage } from '@ecomkit/analytics/admin';
// eslint-disable-next-line no-restricted-imports -- the app's own generated registry, not another package
import { registry } from '../../../../../src/generated/registry';

// Hand-written: lists every enabled module's `reports` (sales, products, customers, behaviour...).
export default function ReportsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReportsListPage searchParams={searchParams} reports={registry.list('reports')} />;
}
