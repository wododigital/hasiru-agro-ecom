import type { Metadata } from 'next';
import { OrderDetailPage } from '../admin';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export function generateMetadata(): Metadata {
  return { title: 'Order' };
}

export default async function AdminOrderRoute({ params, searchParams }: Props) {
  const [{ id }, flags] = await Promise.all([params, searchParams]);
  return <OrderDetailPage id={id} flags={flags} />;
}
