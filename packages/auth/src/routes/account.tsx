import { Skeleton } from '@ecomkit/ui';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { authMessages } from '../messages';
import { requireCustomer } from '../server/navigation';

const m = authMessages.account;

export function generateMetadata(): Metadata {
  return { title: m.metaTitle, robots: { index: false, follow: false } };
}

async function Overview() {
  const viewer = await requireCustomer('/account');
  const who = viewer.phone ?? viewer.email;
  return (
    <>
      <h1 className="font-display text-3xl text-primary">{m.greeting(viewer.name)}</h1>
      {who ? <p className="text-muted">{m.signedInAs(who)}</p> : null}
    </>
  );
}

/** /account: greeting; the account nav (from the layout) links to the pages other modules add. */
export default function AccountPage() {
  return (
    <section className="flex flex-col gap-2">
      <Suspense fallback={<Skeleton className="h-10 w-64" />}>
        <Overview />
      </Suspense>
    </section>
  );
}
