import { requirePermission } from '@ecomkit/core/auth-context';
import { exportCsv, exportSheet } from '../server/import';

/** GET /api/catalog/export?format=xlsx|csv (staff with products.read). */
export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('products.read');
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    return new Response(await exportCsv(), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="products-${stamp}.csv"`, 'cache-control': 'no-store' },
    });
  }
  const body = await exportSheet();
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="plant-data-${stamp}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
