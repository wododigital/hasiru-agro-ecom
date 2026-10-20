import type { Paise } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Button, buttonVariants } from '@ecomkit/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checkoutMessages, type CheckoutMessages } from '../messages';
import { getCheckoutPorts } from '../server';
import { retryPaymentAction } from './actions';

/** /checkout/[orderId]/pay: retry or finish payment for a pending order (guest token or the signed-in owner). */
export async function PayPage({ orderId, token, messages = checkoutMessages }: { orderId: string; token: string | null; messages?: CheckoutMessages }) {
  const m = messages.payPage;
  const orders = getCheckoutPorts().orders;
  const order = orders ? await orders.forBuyer(orderId, token) : null;
  if (!order || !orders) notFound();
  const guest = orders.guestToken(order.id);
  const due = (order.advancePaise || order.totalPaise) - order.paidPaise;
  return (
    <section className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
      <h1 className="font-display text-3xl text-primary">{m.title}</h1>
      {order.status === 'pending_payment' ? (
        <>
          <p className="text-muted">{m.intro}</p>
          <p>
            {m.order} {order.number}
          </p>
          <p className="text-lg font-semibold">
            {m.amount}: {formatINR(due as Paise)}
          </p>
          <form action={retryPaymentAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="t" value={token ?? ''} />
            <Button type="submit" variant="accent" size="lg" className="w-full" data-cta="pay-retry">
              {m.retry} {formatINR(due as Paise)}
            </Button>
          </form>
        </>
      ) : (
        <p className="text-muted">{m.expired}</p>
      )}
      <Link href={`/order/${guest}`} className={buttonVariants({ variant: 'outline' })} data-cta="pay-view-order">
        {m.view}
      </Link>
    </section>
  );
}
