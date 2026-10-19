import type { Metadata } from 'next';
import { EnquiriesPage } from '../admin/EnquiriesAdmin';

export function generateMetadata(): Metadata {
  return { title: 'Enquiries' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <EnquiriesPage searchParams={await searchParams} />;
}
