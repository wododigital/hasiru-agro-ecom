import { requirePermission } from '@ecomkit/core/auth-context';
import { listLevels } from '../server';

/** Home "Things to do": low stock, the count behind /admin/inventory?state=low. */
export async function lowStock(): Promise<number> {
  await requirePermission('inventory.read');
  return (await listLevels({ q: '', filters: { state: 'low' }, sort: null, dir: 'asc', page: 1 }, 1)).total;
}
