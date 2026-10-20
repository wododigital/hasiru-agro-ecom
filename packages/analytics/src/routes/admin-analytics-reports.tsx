import { ReportsListPage } from '../admin/AnalyticsPage';
import manifest from '../manifest';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Without the host's report list only this module's reports are listed (the shop's host file passes every module's). */
export default function AdminAnalyticsReportsRoute({ searchParams }: Props) {
  return <ReportsListPage searchParams={searchParams} reports={manifest.reports ?? []} />;
}
