import type { Metadata } from 'next';
import { ordersMessages } from '../messages';
import { listMyOrders } from '../server';
import { OrdersListView } from '../ui';

export function generateMetadata(): Metadata {
  return { title: ordersMessages.list.title, robots: { index: false, follow: false } };
}

/** /account/orders (inside auth's AccountLayout, which provides the Suspense boundary). */
export default async function AccountOrdersPage() {
  return <OrdersListView orders={await listMyOrders()} />;
}
