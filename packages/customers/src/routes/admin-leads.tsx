import type { Metadata } from 'next';
import { LeadsPage } from '../admin/CustomersAdmin';

export function generateMetadata(): Metadata {
  return { title: 'Leads' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LeadsPage searchParams={await searchParams} />;
}
