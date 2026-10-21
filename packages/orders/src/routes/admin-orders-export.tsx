import { clientIp, csvResponse, hashIp } from '@ecomkit/core/http';
import { istDay, SAVED_VIEWS, type SavedView } from '../domain';
import { exportOrders, ORDER_EXPORT_HEADER } from '../server';

/**
 * GET /admin/orders/export.csv?view=&q=&status=&placed= (the index's current view, every page) or `?ids=..&ids=..`
 * (the bulk bar's ticked rows). orders.read + orders.export; anyone else gets a quiet 404 (the denial carries Next's
 * not-found digest).
 */
export async function GET(request: Request): Promise<Response> {
  const p = new URL(request.url).searchParams;
  const view = (SAVED_VIEWS as readonly string[]).includes(p.get('view') ?? '') ? (p.get('view') as SavedView) : 'all';
  const now = new Date();
  const { rows } = await exportOrders(
    { view, q: p.get('q'), status: p.get('status'), placed: p.get('placed'), ids: p.has('ids') ? p.getAll('ids') : null, now },
    { ipHash: hashIp(clientIp(request)) },
  );
  return csvResponse(`orders-${istDay(now)}.csv`, ORDER_EXPORT_HEADER, rows);
}
