import type { Metadata } from 'next';
import { AlertsPage } from '../admin/AlertsPage';
import { requireHealthRead } from '../admin/gate';

export function generateMetadata(): Metadata {
  return { title: 'Alerts' };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: Props) {
  await requireHealthRead();
  return <AlertsPage searchParams={await searchParams} />;
}
