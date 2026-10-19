import type { CustomerViewer } from '@ecomkit/core/contracts';
import { redirect } from 'next/navigation';
import { getViewer } from './viewer';

/** For account pages: the signed-in customer, or a redirect to the login page that comes back to `returnTo`. */
export async function requireCustomer(returnTo = '/account'): Promise<CustomerViewer> {
  const viewer = await getViewer();
  if (viewer.kind === 'customer') return viewer;
  redirect(`/account/login?next=${encodeURIComponent(returnTo)}`);
}
