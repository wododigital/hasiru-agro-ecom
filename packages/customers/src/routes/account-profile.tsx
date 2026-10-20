import { requireCustomer } from '@ecomkit/auth/server';
import type { Metadata } from 'next';
import { customersMessages } from '../messages';
import { getMyProfile } from '../server';
import { ProfileView } from '../ui/AccountPages';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export function generateMetadata(): Metadata {
  return { title: customersMessages.profile.title, robots: { index: false, follow: false } };
}

/** /account/profile (a signed-out visitor goes to the login page and comes back here). */
export default async function AccountProfilePage({ searchParams }: Props) {
  const me = await requireCustomer('/account/profile');
  const [profile, flags] = await Promise.all([getMyProfile(), searchParams]);
  return <ProfileView profile={profile} phone={profile?.phoneE164 ?? me.phone} flags={flags} />;
}
