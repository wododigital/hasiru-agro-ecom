import type { Metadata } from 'next';
import { OrdersListPage } from '../admin';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export function generateMetadata(): Metadata {
  return { title: 'Orders' };
}

export default async function AdminOrdersRoute({ searchParams }: Props) {
  return <OrdersListPage searchParams={await searchParams} />;
}
