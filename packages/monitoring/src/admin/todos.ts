import { requirePermission } from '@ecomkit/core/auth-context';
import { listAlerts } from '../server/alerts';

/** Home "Things to do": unresolved alerts, the count behind /admin/health/alerts. */
export async function openAlerts(): Promise<number> {
  await requirePermission('health.read');
  return (await listAlerts({ status: 'unresolved', pageSize: 1 })).total;
}
