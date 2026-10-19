import type { Metadata } from 'next';
import { customersMessages } from '../messages';
import { getMyProfile } from '../server';
import { currentCustomer } from '../server/viewer';
import { ProfileView } from '../ui/AccountPages';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export function generateMetadata(): Metadata {
  return { title: customersMessages.profile.title, robots: { index: false, follow: false } };
}

/** /account/profile (the account layout signs the visitor in; a guest gets a 404 here). */
export default async function AccountProfilePage({ searchParams }: Props) {
  const [me, profile, flags] = await Promise.all([currentCustomer(), getMyProfile(), searchParams]);
  return <ProfileView profile={profile} phone={profile?.phoneE164 ?? me.phone} flags={flags} />;
}
