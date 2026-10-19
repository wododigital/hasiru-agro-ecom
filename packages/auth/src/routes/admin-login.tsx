import { Skeleton } from '@ecomkit/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { authMessages } from '../messages';
import { requestHeaders } from '../server/config';
import { staffGate } from '../server/viewer';
import { StaffLoginIsland } from '../ui/StaffLoginIsland';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function generateMetadata(): Metadata {
  return { title: authMessages.staff.metaTitle, robots: { index: false, follow: false } };
}

async function StaffLoginBody({ searchParams }: { searchParams: SearchParams }) {
  const invite = (await searchParams).invite;
  const gate = await staffGate(await requestHeaders());
  if (gate.state === 'ready') redirect('/admin');
  const token = typeof invite === 'string' ? invite : undefined;
  return <StaffLoginIsland initialStep={token ? 'invite' : gate.state === 'enrol' ? 'enrol' : 'password'} inviteToken={token} />;
}

/** /admin/login: staff password, then authenticator (enrolment on first sign-in), or an invite link's password form. */
export default function AdminLoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <StaffLoginBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
