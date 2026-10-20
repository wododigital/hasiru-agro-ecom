import type { Metadata } from 'next';
import { DiscountsListPage } from '../admin/DiscountsListPage';

export function generateMetadata(): Metadata {
  return { title: 'Discounts' };
}

export default async function AdminDiscountsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DiscountsListPage searchParams={await searchParams} />;
}
