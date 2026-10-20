import { formatINR } from '@ecomkit/core/money';
import { buttonVariants, EmptyState, Skeleton } from '@ecomkit/ui';
import Link from 'next/link';
import { paymentsMessages, type PaymentsMessages } from '../messages';
import type { ReturnView } from '../server/return';

const PENDING_REFRESH_SEC = 5;

/** Result of a payment, as the gateway status API reported it. Pending refreshes itself (no JS needed). */
export function PayReturn({ view, selfHref, messages = paymentsMessages }: { view: ReturnView | null; selfHref: string; messages?: PaymentsMessages }) {
  const m = messages.return;
  if (!view) return <EmptyState title={m.notFound.title} body={m.notFound.body} />;
  const order = view.orderLink ? (
    <Link href={view.orderLink} className={buttonVariants({ variant: view.state === 'failed' ? 'outline' : 'primary' })} data-cta="pay-return-order">
      {m.viewOrder}
    </Link>
  ) : null;

  if (view.state === 'paid') return <EmptyState title={m.paid.title} body={m.paid.body(formatINR(view.amountPaise))} action={order} />;
  if (view.state === 'review') return <EmptyState title={m.review.title} body={m.review.body} action={order} />;
  if (view.state === 'pending') {
    return (
      <>
        <meta httpEquiv="refresh" content={String(PENDING_REFRESH_SEC)} />
        <EmptyState
          title={m.pending.title}
          body={m.pending.body}
          action={
            <Link href={selfHref} className={buttonVariants({ variant: 'outline' })} data-cta="pay-return-refresh" prefetch={false}>
              {m.refresh}
            </Link>
          }
        />
      </>
    );
  }
  return (
    <EmptyState
      title={m.failed.title}
      body={view.retryLink ? m.failed.body : m.failed.expired}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {view.retryLink ? (
            <Link href={view.retryLink} className={buttonVariants()} data-cta="pay-return-retry" prefetch={false}>
              {m.retry}
            </Link>
          ) : null}
          {order}
        </div>
      }
    />
  );
}

export function PayReturnSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-10 w-40 rounded-full" />
    </div>
  );
}
