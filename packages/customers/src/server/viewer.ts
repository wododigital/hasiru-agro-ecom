import { getViewer, NotFoundError } from '@ecomkit/core/auth-context';
import type { CustomerViewer } from '@ecomkit/core/contracts';

/** The signed-in customer, or a 404 (never reveal that a record exists to anyone else). */
export async function currentCustomer(): Promise<CustomerViewer> {
  const viewer = await getViewer();
  if (viewer.kind !== 'customer') throw new NotFoundError();
  return viewer;
}

/** A record id from the request; anything that is not a uuid is simply not found. */
export function idOr404(id: unknown): string {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundError();
  return id;
}
