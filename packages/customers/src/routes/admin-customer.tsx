import type { Metadata } from 'next';
import { CustomerDetailPage } from '../admin/CustomersAdmin';

export function generateMetadata(): Metadata {
  return { title: 'Customer' };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CustomerDetailPage id={(await params).id} />;
}
