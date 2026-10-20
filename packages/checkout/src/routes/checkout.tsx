import type { Metadata } from 'next';
import { Suspense } from 'react';
import { checkoutMessages } from '../messages';
import { CheckoutPage, CheckoutSkeleton } from '../ui';

export function generateMetadata(): Metadata {
  return { title: checkoutMessages.title, robots: { index: false, follow: false } };
}

/** /checkout (request-time: cart cookie and viewer; streamed behind a skeleton). */
export default function CheckoutRoute() {
  return (
    <Suspense fallback={<CheckoutSkeleton />}>
      <CheckoutPage />
    </Suspense>
  );
}
