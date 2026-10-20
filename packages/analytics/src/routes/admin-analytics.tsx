import { isKpiWidget } from '@ecomkit/ui/domain';
import { AnalyticsPage } from '../admin/AnalyticsPage';
import manifest from '../manifest';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Without the host's widget list the overview shows this module's own KPI cards (the shop's host file passes every module's). */
export default function AdminAnalyticsRoute({ searchParams }: Props) {
  return <AnalyticsPage searchParams={searchParams} kpis={(manifest.dashboardWidgets ?? []).filter(isKpiWidget)} />;
}
