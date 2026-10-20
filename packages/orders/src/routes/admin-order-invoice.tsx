import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import { invoiceResponse } from '../server';

/** GET /admin/orders/[id]/invoice.pdf (orders.read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requirePermission('orders.read');
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response('Not found', { status: 404 });
    throw err;
  }
  const { id } = await params;
  return invoiceResponse(/^[0-9a-f-]{36}$/i.test(id) ? id : null);
}
