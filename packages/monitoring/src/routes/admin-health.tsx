import type { Metadata } from 'next';
import { HealthOverviewPage } from '../admin/HealthOverviewPage';
import { requireHealthRead } from '../admin/gate';

export function generateMetadata(): Metadata {
  return { title: 'Health' };
}

export default async function Page() {
  await requireHealthRead();
  return <HealthOverviewPage />;
}
