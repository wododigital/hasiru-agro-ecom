import type { Metadata } from 'next';
import { SegmentsPage } from '../admin/CustomersAdmin';

export function generateMetadata(): Metadata {
  return { title: 'Segments' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SegmentsPage searchParams={await searchParams} />;
}
