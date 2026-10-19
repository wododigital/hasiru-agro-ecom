import type { Metadata } from 'next';
import { ErrorsPage } from '../admin/ErrorsPage';
import { requireHealthRead } from '../admin/gate';

export function generateMetadata(): Metadata {
  return { title: 'Errors' };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: Props) {
  await requireHealthRead();
  return <ErrorsPage searchParams={await searchParams} />;
}
