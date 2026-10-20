import { requireCustomer } from '@ecomkit/auth/server';
import type { Metadata } from 'next';
import { customersMessages } from '../messages';
import { listMyLand } from '../server';
import { LandView } from '../ui/AccountPages';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export function generateMetadata(): Metadata {
  return { title: customersMessages.land.title, robots: { index: false, follow: false } };
}

/** /account/land */
export default async function AccountLandPage({ searchParams }: Props) {
  await requireCustomer('/account/land');
  const [land, flags] = await Promise.all([listMyLand(), searchParams]);
  return <LandView land={land} flags={flags} />;
}
