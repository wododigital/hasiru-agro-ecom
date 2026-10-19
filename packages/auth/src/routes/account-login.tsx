import { Skeleton } from '@ecomkit/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { safeNextPath } from '../domain';
import { authMessages } from '../messages';
import { getViewer } from '../server/viewer';
import { CustomerLoginIsland } from '../ui/CustomerLoginIsland';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const m = authMessages.login;

export function generateMetadata(): Metadata {
  return { title: m.metaTitle, robots: { index: false, follow: false } };
}

async function LoginBody({ searchParams }: { searchParams: SearchParams }) {
  const next = safeNextPath((await searchParams).next, '/account');
  if ((await getViewer()).kind === 'customer') redirect(next);
  return <CustomerLoginIsland next={next} />;
}

/** /account/login: one field for a mobile number or email, then a 6-digit code. */
export default function AccountLoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-5">
      <h1 className="font-display text-3xl text-primary">{m.title}</h1>
      <p className="text-muted">{m.intro}</p>
      <Suspense fallback={<Skeleton className="h-44 w-full" />}>
        <LoginBody searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
