import type { Metadata } from 'next';
import { CustomersListPage } from '../admin/CustomersAdmin';

export function generateMetadata(): Metadata {
  return { title: 'Customers' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CustomersListPage searchParams={await searchParams} />;
}
