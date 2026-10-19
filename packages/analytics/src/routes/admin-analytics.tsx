import { AnalyticsPage } from '../admin/AnalyticsPage';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Without the host's report list the Sales, Products and Customers tabs show their empty state (see README). */
export default function AdminAnalyticsRoute({ searchParams }: Props) {
  return <AnalyticsPage searchParams={searchParams} />;
}
