import type { Metadata } from 'next';
import { JobsPage } from '../admin/JobsPage';
import { requireHealthRead } from '../admin/gate';

export function generateMetadata(): Metadata {
  return { title: 'Jobs' };
}

export default async function Page() {
  await requireHealthRead();
  return <JobsPage />;
}
