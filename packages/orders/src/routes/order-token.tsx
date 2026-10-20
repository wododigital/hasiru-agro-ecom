import { Skeleton } from '@ecomkit/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ordersMessages } from '../messages';
import { getOrderByToken } from '../server';
import { OrderView } from '../ui';

type Props = { params: Promise<{ token: string }> };

export function generateMetadata(): Metadata {
  return { title: ordersMessages.detail.title, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

async function GuestOrder({ params }: Props) {
  const { token } = await params;
  const detail = await getOrderByToken(token);
  if (!detail) notFound();
  const o = detail.order;
  return (
    <OrderView
      detail={detail}
      guest
      invoiceHref={`/order/${token}/invoice.pdf`}
      payHref={o.status === 'pending_payment' ? `/checkout/${o.id}/pay?t=${encodeURIComponent(token)}` : null}
    />
  );
}

/** /order/[token]: guest confirmation page; the unguessable token is the capability. */
export default function GuestOrderPage(props: Props) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto my-8 h-96 max-w-3xl" />}>
      <GuestOrder {...props} />
    </Suspense>
  );
}
