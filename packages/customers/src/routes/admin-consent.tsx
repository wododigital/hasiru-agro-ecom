import type { Metadata } from 'next';
import { ConsentPage } from '../admin/CustomersAdmin';

export function generateMetadata(): Metadata {
  return { title: 'Consent log' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ConsentPage searchParams={await searchParams} />;
}
