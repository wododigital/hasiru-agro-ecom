import { requirePermission } from '@ecomkit/core/auth-context';
import { csvLine } from '../domain';
import { pendingOrderRows } from '../server';

/** GET /api/admin/erp/pending-orders: orders not yet in the ERP as CSV (manual bridge). Staff with orders.write. */
export async function GET(): Promise<Response> {
  try {
    await requirePermission('orders.write');
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const body = `${(await pendingOrderRows()).map(csvLine).join('\r\n')}\r\n`;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="orders-pending-erp-${stamp}.csv"`, 'cache-control': 'no-store' },
  });
}
