import { requireCustomer } from '@ecomkit/auth/server';
import type { Metadata } from 'next';
import { customersMessages } from '../messages';
import { listMyAddresses } from '../server';
import { AddressesView } from '../ui/AccountPages';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export function generateMetadata(): Metadata {
  return { title: customersMessages.addresses.title, robots: { index: false, follow: false } };
}

/** /account/addresses */
export default async function AccountAddressesPage({ searchParams }: Props) {
  await requireCustomer('/account/addresses');
  const [addresses, flags] = await Promise.all([listMyAddresses(), searchParams]);
  return <AddressesView addresses={addresses} flags={flags} />;
}
