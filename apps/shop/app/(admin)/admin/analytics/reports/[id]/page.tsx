import { ReportPage } from '@ecomkit/analytics/admin';
// eslint-disable-next-line no-restricted-imports -- the app's own generated registry, not another package
import { registry } from '../../../../../../src/generated/registry';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// Hand-written: resolves the report id against every enabled module's `reports`.
export default async function ReportAdminPage({ params, searchParams }: Props) {
  return <ReportPage id={decodeURIComponent((await params).id)} searchParams={searchParams} reports={registry.list('reports')} />;
}
