import type { Metadata } from 'next';
import { Suspense } from 'react';
import { paymentsMessages } from '../messages';
import { returnView } from '../server/return';
import { PayReturn, PayReturnSkeleton } from '../ui/PayReturn';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export function generateMetadata(): Metadata {
  return { title: paymentsMessages.return.metaTitle, robots: { index: false, follow: false } };
}

async function Result({ searchParams }: Props) {
  const a = (await searchParams).a;
  const attemptId = typeof a === 'string' ? a : null;
  const view = await returnView(attemptId);
  return <PayReturn view={view} selfHref={`/pay/return?a=${encodeURIComponent(attemptId ?? '')}`} />;
}

/** /pay/return?a=<attempt id>: where the gateway sends the buyer back. State comes from the status API, never the query. */
export default function PayReturnPage(props: Props) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 py-10">
      <Suspense fallback={<PayReturnSkeleton />}>
        <Result {...props} />
      </Suspense>
    </section>
  );
}
