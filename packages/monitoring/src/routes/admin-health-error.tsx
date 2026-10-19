import type { Metadata } from 'next';
import { ErrorDetailPage } from '../admin/ErrorDetailPage';
import { requireHealthRead } from '../admin/gate';

export function generateMetadata(): Metadata {
  return { title: 'Error' };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireHealthRead();
  return <ErrorDetailPage id={(await params).id} />;
}
