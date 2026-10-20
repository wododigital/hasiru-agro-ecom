import { Skeleton } from '@ecomkit/ui';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { checkoutMessages } from '../messages';
import { PayPage } from '../ui';

type Props = { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string }> };

export function generateMetadata(): Metadata {
  return { title: checkoutMessages.payPage.title, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

async function Pay({ params, searchParams }: Props) {
  const [{ orderId }, { t }] = await Promise.all([params, searchParams]);
  return <PayPage orderId={orderId} token={typeof t === 'string' ? t : null} />;
}

/** /checkout/[orderId]/pay */
export default function CheckoutPayRoute(props: Props) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto my-12 h-64 max-w-md" />}>
      <Pay {...props} />
    </Suspense>
  );
}
