import { ReportPage } from '../admin/AnalyticsPage';
import manifest from '../manifest';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** One report; without the host's report list only this module's reports resolve. */
export default async function AdminAnalyticsReportRoute({ params, searchParams }: Props) {
  return <ReportPage id={decodeURIComponent((await params).id)} searchParams={searchParams} reports={manifest.reports ?? []} />;
}
