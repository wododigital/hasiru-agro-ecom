import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import { seesFullPii } from '@ecomkit/customers/domain';
import { invoiceResponse } from '../server';

/** GET /admin/orders/[id]/invoice.pdf (orders.read, and full-PII staff: the GST invoice carries the buyer's phone and address). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const staff = await requirePermission('orders.read');
    if (!seesFullPii(staff)) return new Response('Not found', { status: 404 });
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response('Not found', { status: 404 });
    throw err;
  }
  const { id } = await params;
  return invoiceResponse(/^[0-9a-f-]{36}$/i.test(id) ? id : null);
}
