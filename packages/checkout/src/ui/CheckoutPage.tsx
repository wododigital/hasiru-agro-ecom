import { newId } from '@ecomkit/core/ids';
import { buttonVariants, EmptyState, Skeleton } from '@ecomkit/ui';
import Link from 'next/link';
import { checkoutMessages, type CheckoutMessages } from '../messages';
import { CheckoutError, openCheckout, type CheckoutPageData } from '../server';
import { CheckoutFormIsland } from './CheckoutFormIsland';

export interface CheckoutPageProps {
  messages?: CheckoutMessages;
  /** Places module pincode endpoint; null turns autofill off. */
  pincodeLookupUrl?: string | null;
}

export function CheckoutSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_22rem]" aria-busy="true">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
        <Skeleton className="h-56" />
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

/** Server part of /checkout: loads the quote and the saved details, then hands over to the form island. */
export async function CheckoutPage({ messages = checkoutMessages, pincodeLookupUrl = '/api/places/pincode' }: CheckoutPageProps) {
  const m = messages;
  let data: CheckoutPageData;
  try {
    data = await openCheckout();
  } catch (err) {
    if (err instanceof CheckoutError && err.code === 'cart_empty') {
      return (
        <section className="mx-auto max-w-xl px-4 py-12">
          <EmptyState
            title={m.emptyCart.title}
            action={
              <Link href={m.emptyCart.href} className={buttonVariants({})} data-cta="checkout-empty-browse">
                {m.emptyCart.action}
              </Link>
            }
          />
        </section>
      );
    }
    throw err;
  }
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl text-primary">{m.title}</h1>
        <p className="text-muted">{m.intro}</p>
      </header>
      <CheckoutFormIsland data={data} idempotencyKey={newId()} messages={m} pincodeLookupUrl={pincodeLookupUrl} />
    </section>
  );
}
