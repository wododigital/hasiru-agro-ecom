import { NotFoundError } from '@ecomkit/core/auth-context';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ordersMessages } from '../messages';
import { getMyOrder, type OrderDetail } from '../server';
import { OrderView } from '../ui';

type Props = { params: Promise<{ id: string }> };

export function generateMetadata(): Metadata {
  return { title: ordersMessages.detail.title, robots: { index: false, follow: false } };
}

/** /account/orders/[id]: only the owner sees it; anyone else gets a 404 (no existence leak). */
export default async function AccountOrderPage({ params }: Props) {
  const { id } = await params;
  let detail: OrderDetail;
  try {
    detail = await getMyOrder(id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const o = detail.order;
  return (
    <OrderView
      detail={detail}
      backHref="/account/orders"
      invoiceHref={`/account/orders/${o.id}/invoice.pdf`}
      payHref={o.status === 'pending_payment' ? `/checkout/${o.id}/pay` : null}
    />
  );
}
