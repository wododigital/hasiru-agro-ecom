import type { Metadata } from 'next';
import { LogsPage } from '../admin/LogsPage';
import { requireHealthRead } from '../admin/gate';

export function generateMetadata(): Metadata {
  return { title: 'Logs' };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: Props) {
  await requireHealthRead();
  return <LogsPage searchParams={await searchParams} />;
}
