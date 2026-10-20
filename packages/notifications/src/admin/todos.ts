import { requirePermission } from '@ecomkit/core/auth-context';
import { listMessages } from '../server/queries';

/** Home "Things to do": failed messages, the count behind /admin/messages?status=failed. */
export async function failedMessages(): Promise<number> {
  await requirePermission('settings.read');
  return (await listMessages({ q: '', filters: { status: 'failed' }, sort: null, dir: 'desc', page: 1 }, 1)).total;
}
